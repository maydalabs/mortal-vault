"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  formatEther,
  isAddress,
  parseEther,
  type ContractTransactionResponse,
  type Eip1193Provider,
} from "ethers";
import {
  MORTAL_VAULT_ABI,
  SUPPORTED_CHAINS,
  VAULT_STATUS,
  assertVaultBalanceWithinLimit,
  getChainConfig,
  getErrorMessage,
  getExplorerUrl,
  getWalletAddChainParams,
  getVaultStatusLabel,
  parseVaultResult,
  requireContractAddress,
  toHexChainId,
  type ChainConfig,
  type VaultView,
} from "@/lib/mortal-vault";
import {
  buildClaimUrl,
  formatRemaining,
  parseClaimSearch,
  secondsFromDays,
  shortAddress,
} from "@/lib/ui";

type EthereumEventProvider = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};

type ActivityType =
  | "create"
  | "update"
  | "deposit"
  | "heartbeat"
  | "withdraw"
  | "close"
  | "request"
  | "execute";

type ActivityItem = {
  id: number;
  type: ActivityType;
  label: string;
  timestamp: Date;
  hash: string;
  chain: ChainConfig | null;
};

type PendingTransaction = {
  action: string;
  label: string;
  stage: "wallet" | "confirming";
  hash?: string;
  chain?: ChainConfig | null;
};

declare global {
  interface Window {
    ethereum?: EthereumEventProvider;
  }
}

function getEthereum(): EthereumEventProvider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No injected wallet found. Install MetaMask or another EVM wallet.");
  }
  return window.ethereum;
}

function getTimeline(vault: VaultView | null): {
  tone: "neutral" | "safe" | "warn" | "danger";
  label: string;
} {
  if (!vault) {
    return { tone: "neutral", label: "No current vault for this address." };
  }
  if (vault.status === VAULT_STATUS.claimed) {
    return { tone: "neutral", label: "This vault has been claimed." };
  }
  if (vault.status === VAULT_STATUS.closed) {
    return { tone: "neutral", label: "This vault was closed by its owner." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (vault.status === VAULT_STATUS.claimRequested) {
    const executableAt =
      Number(vault.claimRequestedAt) + Number(vault.claimDelay);
    if (vault.claimable || executableAt <= now) {
      return { tone: "danger", label: "The beneficiary can execute this claim now." };
    }
    return {
      tone: "warn",
      label: `Claim requested. Owner has ${formatRemaining(executableAt - now)} to respond.`,
    };
  }

  if (vault.inactive) {
    return {
      tone: "danger",
      label: "Heartbeat overdue. The beneficiary can request a claim.",
    };
  }

  const deadline = Number(vault.lastHeartbeat) + Number(vault.timeout);
  const remaining = deadline - now;
  return {
    tone: remaining > 2 * 86_400 ? "safe" : "warn",
    label: `${formatRemaining(remaining)} until the beneficiary can request a claim.`,
  };
}

function toneClasses(tone: ReturnType<typeof getTimeline>["tone"]): string {
  if (tone === "safe") {
    return "border-emerald-500/40 bg-emerald-950/40 text-emerald-100";
  }
  if (tone === "warn") {
    return "border-amber-500/40 bg-amber-950/40 text-amber-100";
  }
  if (tone === "danger") {
    return "border-rose-500/50 bg-rose-950/40 text-rose-100";
  }
  return "border-slate-800 bg-slate-900/70 text-slate-300";
}

async function getNetworkContext() {
  const provider = new BrowserProvider(getEthereum());
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const chain = getChainConfig(chainId);
  const contractAddress = requireContractAddress(chainId);
  const code = await provider.getCode(contractAddress);

  if (code === "0x") {
    throw new Error(
      `No MortalVault deployment found at ${contractAddress} on ${chain?.name ?? `chain ${chainId}`}.`,
    );
  }

  return { provider, chainId, chain, contractAddress };
}

async function readVault(
  provider: BrowserProvider,
  contractAddress: string,
  owner: string,
): Promise<VaultView | null> {
  const contract = new Contract(contractAddress, MORTAL_VAULT_ABI, provider);
  const result = await contract.getVault(owner);
  return parseVaultResult(result);
}

async function readVaultBalanceLimit(
  provider: BrowserProvider,
  contractAddress: string,
): Promise<bigint> {
  const contract = new Contract(contractAddress, MORTAL_VAULT_ABI, provider);
  return contract.MAX_VAULT_BALANCE();
}

export default function Home() {
  const [account, setAccount] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainConfig | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [ownerVault, setOwnerVault] = useState<VaultView | null>(null);
  const [maxVaultBalance, setMaxVaultBalance] = useState<bigint | null>(null);

  const [beneficiary, setBeneficiary] = useState("");
  const [timeoutDays, setTimeoutDays] = useState("30");
  const [claimDelayDays, setClaimDelayDays] = useState("7");
  const [initialDeposit, setInitialDeposit] = useState("0.1");
  const [depositAmount, setDepositAmount] = useState("0.05");
  const [withdrawAmount, setWithdrawAmount] = useState("0.01");

  const [claimOwner, setClaimOwner] = useState("");
  const [claimChainId, setClaimChainId] = useState<number | null>(null);
  const [claimRecipient, setClaimRecipient] = useState("");
  const [claimVault, setClaimVault] = useState<VaultView | null>(null);
  const [claimLoaded, setClaimLoaded] = useState(false);

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [pendingTransaction, setPendingTransaction] =
    useState<PendingTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [claimLinkCopied, setClaimLinkCopied] = useState(false);

  const ownerTimeline = useMemo(() => getTimeline(ownerVault), [ownerVault]);
  const claimTimeline = useMemo(() => getTimeline(claimVault), [claimVault]);
  const canUpdate =
    ownerVault?.status === VAULT_STATUS.active ||
    ownerVault?.status === VAULT_STATUS.claimRequested;

  const pushActivity = useCallback(
    (type: ActivityType, label: string, hash: string, activityChain: ChainConfig | null) => {
      setActivity((current) => [
        {
          id: Date.now(),
          type,
          label,
          timestamp: new Date(),
          hash,
          chain: activityChain,
        },
        ...current,
      ].slice(0, 12));
    },
    [],
  );

  const syncSession = useCallback(async (address: string) => {
    const context = await getNetworkContext();
    const [balance, vault, balanceLimit] = await Promise.all([
      context.provider.getBalance(address),
      readVault(context.provider, context.contractAddress, address),
      readVaultBalanceLimit(context.provider, context.contractAddress),
    ]);

    setAccount(address);
    setChain(context.chain ?? null);
    setContractAddress(context.contractAddress);
    setWalletBalance(Number(formatEther(balance)).toFixed(4));
    setOwnerVault(vault);
    setMaxVaultBalance(balanceLimit);
  }, []);

  const refreshClaimVault = useCallback(
    async (owner: string, expectedChainId?: number | null) => {
      if (!isAddress(owner)) throw new Error("Enter a valid owner address.");
      const context = await getNetworkContext();
      if (expectedChainId && context.chainId !== expectedChainId) {
        const expectedChain = getChainConfig(expectedChainId);
        throw new Error(
          `This link targets ${expectedChain?.name ?? `chain ${expectedChainId}`}. Switch networks before loading it.`,
        );
      }
      const [vault, balanceLimit] = await Promise.all([
        readVault(context.provider, context.contractAddress, owner),
        readVaultBalanceLimit(context.provider, context.contractAddress),
      ]);
      setChain(context.chain ?? null);
      setContractAddress(context.contractAddress);
      setClaimVault(vault);
      setMaxVaultBalance(balanceLimit);
      setClaimLoaded(true);
    },
    [],
  );

  const refreshAfterTransaction = useCallback(
    async (signerAddress: string) => {
      await syncSession(signerAddress);
      if (claimOwner && isAddress(claimOwner)) {
        await refreshClaimVault(claimOwner, claimChainId);
      }
    },
    [claimChainId, claimOwner, refreshClaimVault, syncSession],
  );

  async function connectWallet() {
    try {
      setLoadingAction("connect");
      setError(null);
      const ethereum = getEthereum();
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (!accounts[0]) throw new Error("The wallet returned no accounts.");
      await syncSession(accounts[0]);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoadingAction(null);
    }
  }

  async function switchNetwork(targetChainId: number) {
    try {
      setLoadingAction(`switch-${targetChainId}`);
      setError(null);
      const ethereum = getEthereum();

      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: toHexChainId(targetChainId) }],
        });
      } catch (switchError) {
        const code =
          switchError && typeof switchError === "object"
            ? (switchError as { code?: number }).code
            : undefined;
        const addParams = getWalletAddChainParams(targetChainId);
        if (code !== 4902 || !addParams) throw switchError;
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [addParams],
        });
      }

      const switchedChain = getChainConfig(targetChainId) ?? null;
      setChain(switchedChain);
      setContractAddress(switchedChain?.contractAddress ?? null);
      setMaxVaultBalance(null);
      const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
      if (accounts[0]) await syncSession(accounts[0]);
    } catch (caught) {
      const chainName = getChainConfig(targetChainId)?.name ?? `chain ${targetChainId}`;
      const message = getErrorMessage(caught);
      setError(
        message.includes("wallet_switchEthereumChain")
          ? `Add or enable ${chainName} in your wallet, then try again.`
          : message,
      );
    } finally {
      setLoadingAction(null);
    }
  }

  async function runTransaction(
    action: string,
    type: ActivityType,
    label: string,
    send: (contract: Contract) => Promise<ContractTransactionResponse>,
  ) {
    try {
      setLoadingAction(action);
      setError(null);
      setPendingTransaction({ action, label, stage: "wallet" });
      const context = await getNetworkContext();
      const signer = await context.provider.getSigner();
      const signerAddress = await signer.getAddress();
      const contract = new Contract(
        context.contractAddress,
        MORTAL_VAULT_ABI,
        signer,
      );
      const transaction = await send(contract);
      setPendingTransaction({
        action,
        label,
        stage: "confirming",
        hash: transaction.hash,
        chain: context.chain ?? null,
      });
      await transaction.wait();
      pushActivity(type, label, transaction.hash, context.chain ?? null);
      await refreshAfterTransaction(signerAddress);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoadingAction(null);
      setPendingTransaction(null);
    }
  }

  async function saveOwnerConfiguration() {
    try {
      setError(null);
      if (!isAddress(beneficiary)) {
        throw new Error("Enter a valid beneficiary address.");
      }
      const timeout = secondsFromDays(timeoutDays, "Inactivity timeout");
      const claimDelay = secondsFromDays(claimDelayDays, "Claim delay");

      if (canUpdate) {
        await runTransaction(
          "save",
          "update",
          "Updated beneficiary and timing configuration.",
          (contract) => contract.updateVault(beneficiary, timeout, claimDelay),
        );
        return;
      }

      const value = parseEther(initialDeposit);
      if (maxVaultBalance === null) {
        throw new Error("Connect to the deployment before creating a vault.");
      }
      assertVaultBalanceWithinLimit(BigInt(0), value, maxVaultBalance);
      await runTransaction(
        "save",
        "create",
        `Created a vault with ${initialDeposit} native tokens.`,
        (contract) =>
          contract.createVault(beneficiary, timeout, claimDelay, { value }),
      );
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function depositToOwnerVault() {
    try {
      if (!ownerVault || maxVaultBalance === null) {
        throw new Error("Load an active vault before depositing.");
      }
      const value = parseEther(depositAmount);
      assertVaultBalanceWithinLimit(
        ownerVault.balance,
        value,
        maxVaultBalance,
      );
      await runTransaction(
        "deposit",
        "deposit",
        `Deposited ${depositAmount} native tokens.`,
        (contract) => contract.deposit({ value }),
      );
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function loadBeneficiaryVault() {
    try {
      setLoadingAction("load-claim");
      setError(null);
      await refreshClaimVault(claimOwner, claimChainId);
    } catch (caught) {
      setClaimVault(null);
      setClaimLoaded(false);
      setError(getErrorMessage(caught));
    } finally {
      setLoadingAction(null);
    }
  }

  async function copyBeneficiaryLink() {
    try {
      if (!account || !chain) throw new Error("Connect the owner wallet first.");
      const url = buildClaimUrl(window.location.href, account, chain.chainId);
      await navigator.clipboard.writeText(url);
      setClaimLinkCopied(true);
      window.setTimeout(() => setClaimLinkCopied(false), 2_000);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function executeBeneficiaryClaim() {
    const recipient = claimRecipient || account;
    if (!recipient || !isAddress(recipient)) {
      setError("Enter a valid payout recipient address.");
      return;
    }
    if (!claimVault) return;

    await runTransaction(
      "execute",
      "execute",
      `Executed claim for ${shortAddress(claimVault.owner)}.`,
      (contract) => contract.executeClaimTo(claimVault.owner, recipient),
    );
  }

  useEffect(() => {
    if (ownerVault && canUpdate) {
      setBeneficiary(ownerVault.beneficiary);
      setTimeoutDays((Number(ownerVault.timeout) / 86_400).toString());
      setClaimDelayDays((Number(ownerVault.claimDelay) / 86_400).toString());
    }
  }, [canUpdate, ownerVault]);

  useEffect(() => {
    const sharedClaim = parseClaimSearch(window.location.search);
    if (sharedClaim.owner) setClaimOwner(sharedClaim.owner);
    if (sharedClaim.chainId) setClaimChainId(sharedClaim.chainId);
  }, []);

  useEffect(() => {
    let active = true;
    const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!ethereum) return;

    const resync = async (address?: string) => {
      if (!active) return;
      if (!address) {
        try {
          const provider = new BrowserProvider(ethereum);
          const network = await provider.getNetwork();
          const currentChain = getChainConfig(Number(network.chainId)) ?? null;
          setAccount(null);
          setChain(currentChain);
          setContractAddress(currentChain?.contractAddress ?? null);
          setOwnerVault(null);
          setMaxVaultBalance(null);
          setWalletBalance(null);
        } catch (caught) {
          if (active) setError(getErrorMessage(caught));
        }
        return;
      }
      try {
        setError(null);
        await syncSession(address);
      } catch (caught) {
        if (active) setError(getErrorMessage(caught));
      }
    };

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      void resync(accounts[0]);
    };
    const handleChainChanged = () => {
      void ethereum
        .request({ method: "eth_accounts" })
        .then((value) => resync((value as string[])[0]));
    };

    void ethereum
      .request({ method: "eth_accounts" })
      .then((value) => resync((value as string[])[0]));
    ethereum.on?.("accountsChanged", handleAccountsChanged);
    ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      active = false;
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [syncSession]);

  const statusBadge = (vault: VaultView | null) =>
    vault ? getVaultStatusLabel(vault.status) : "No vault";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Public beta development
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Plan continuity without surrendering control.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
              You retain full custody while active. After prolonged inactivity,
              your beneficiary can start a delayed claim that you can cancel by
              checking in.
            </p>
          </div>

          <div className="grid min-w-full gap-2 sm:min-w-[420px] sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                Network
              </div>
              <div className="mt-1 text-xs text-slate-200">
                {chain ? `${chain.name} - ${chain.chainId}` : "Not connected"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                Wallet balance
              </div>
              <div className="mt-1 text-xs text-slate-200">
                {walletBalance ? `${walletBalance} native` : "-"}
              </div>
            </div>
            <button
              type="button"
              onClick={connectWallet}
              disabled={loadingAction !== null}
              className="rounded-xl bg-emerald-400 px-4 py-2 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:opacity-50 sm:col-span-2"
            >
              {account ? `Connected ${shortAddress(account)}` : "Connect wallet"}
            </button>
            <div className="flex flex-wrap justify-end gap-1.5 sm:col-span-2">
              {SUPPORTED_CHAINS.map((supportedChain) => (
                <button
                  key={supportedChain.chainId}
                  type="button"
                  onClick={() => void switchNetwork(supportedChain.chainId)}
                  disabled={loadingAction !== null}
                  className={`rounded-full border px-2.5 py-1 text-[10px] transition disabled:opacity-40 ${
                    chain?.chainId === supportedChain.chainId
                      ? "border-emerald-400/50 bg-emerald-950/50 text-emerald-200"
                      : "border-slate-800 bg-slate-950 text-slate-500 hover:border-slate-700 hover:text-slate-300"
                  }`}
                >
                  {loadingAction === `switch-${supportedChain.chainId}`
                    ? "Switching..."
                    : supportedChain.name.replace("Ethereum ", "")}
                </button>
              ))}
            </div>
            {contractAddress && (
              <div className="text-right text-[10px] text-slate-600 sm:col-span-2">
                {maxVaultBalance !== null && (
                  <span className="mr-2 font-medium text-amber-300/80">
                    Immutable vault cap: {formatEther(maxVaultBalance)} native
                  </span>
                )}
                {getExplorerUrl(chain, "address", contractAddress) ? (
                  <a
                    href={getExplorerUrl(chain, "address", contractAddress)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono hover:text-slate-400"
                  >
                    Open contract {shortAddress(contractAddress)}
                  </a>
                ) : (
                  <span className="font-mono">
                    Contract {shortAddress(contractAddress)}
                  </span>
                )}
              </div>
            )}
          </div>
        </header>

        {error && (
          <section className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
            <div className="font-medium">Transaction or connection failed</div>
            <p className="mt-1 text-xs leading-5 text-rose-200/90">{error}</p>
          </section>
        )}

        {pendingTransaction && (
          <section className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">
                  {pendingTransaction.stage === "wallet"
                    ? "Confirm in your wallet"
                    : "Transaction submitted"}
                </div>
                <p className="mt-1 text-xs leading-5 text-cyan-200/80">
                  {pendingTransaction.stage === "wallet"
                    ? pendingTransaction.label
                    : "Waiting for on-chain confirmation before refreshing the vault."}
                </p>
              </div>
              {pendingTransaction.hash &&
                getExplorerUrl(
                  pendingTransaction.chain,
                  "tx",
                  pendingTransaction.hash,
                ) && (
                  <a
                    href={getExplorerUrl(
                      pendingTransaction.chain,
                      "tx",
                      pendingTransaction.hash,
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-cyan-500/30 px-3 py-2 text-xs hover:bg-cyan-950/50"
                  >
                    View transaction
                  </a>
                )}
            </div>
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                    Owner workspace
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">My continuity plan</h2>
                </div>
                <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] text-slate-300">
                  {statusBadge(ownerVault)}
                </span>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5 text-xs text-slate-400 md:col-span-2">
                  <span>Beneficiary address</span>
                  <input
                    value={beneficiary}
                    onChange={(event) => setBeneficiary(event.target.value)}
                    placeholder="0x..."
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none transition focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5 text-xs text-slate-400">
                  <span>Inactivity timeout (days)</span>
                  <input
                    type="number"
                    min="1"
                    value={timeoutDays}
                    onChange={(event) => setTimeoutDays(event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-slate-100 outline-none transition focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5 text-xs text-slate-400">
                  <span>Claim challenge period (days)</span>
                  <input
                    type="number"
                    min="1"
                    value={claimDelayDays}
                    onChange={(event) => setClaimDelayDays(event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-slate-100 outline-none transition focus:border-emerald-500"
                  />
                </label>
                {!canUpdate && (
                  <label className="space-y-1.5 text-xs text-slate-400 md:col-span-2">
                    <span>
                      Initial deposit
                      {maxVaultBalance !== null
                        ? ` (maximum ${formatEther(maxVaultBalance)} native)`
                        : ""}
                    </span>
                    <input
                      value={initialDeposit}
                      onChange={(event) => setInitialDeposit(event.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-slate-100 outline-none transition focus:border-emerald-500"
                    />
                  </label>
                )}
              </div>

              <button
                type="button"
                onClick={saveOwnerConfiguration}
                disabled={!account || loadingAction !== null}
                className="mt-4 rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:opacity-40"
              >
                {loadingAction === "save"
                  ? "Waiting for confirmation..."
                  : canUpdate
                    ? "Update plan"
                    : "Create vault"}
              </button>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className={`rounded-xl border px-4 py-3 text-xs ${toneClasses(ownerTimeline.tone)}`}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
                  Timeline
                </div>
                <p className="mt-1.5">{ownerTimeline.label}</p>
              </div>

              {ownerVault ? (
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 text-xs sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="text-slate-500">Beneficiary</div>
                      <div
                        className="mt-1 font-mono text-slate-200"
                        title={ownerVault.beneficiary}
                      >
                        {shortAddress(ownerVault.beneficiary)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="text-slate-500">Vault balance</div>
                      <div className="mt-1 text-slate-200">
                        {formatEther(ownerVault.balance)} native
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="text-slate-500">Last owner activity</div>
                      <div className="mt-1 text-slate-200">
                        {new Date(
                          Number(ownerVault.lastHeartbeat) * 1000,
                        ).toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="text-slate-500">State</div>
                      <div className="mt-1 text-slate-200">
                        {getVaultStatusLabel(ownerVault.status)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyBeneficiaryLink()}
                    className="w-full rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-3 py-2.5 text-xs font-medium text-emerald-200 hover:bg-emerald-950/40"
                  >
                    {claimLinkCopied
                      ? "Beneficiary link copied"
                      : "Copy beneficiary claim link"}
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs leading-5 text-slate-400">
                  Connect an owner wallet and create a vault to activate controls.
                </p>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                  <input
                    value={depositAmount}
                    onChange={(event) => setDepositAmount(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none"
                    aria-label="Deposit amount"
                  />
                  <button
                    type="button"
                    disabled={!canUpdate || loadingAction !== null}
                    onClick={() => void depositToOwnerVault()}
                    className="rounded-md bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40"
                  >
                    Deposit
                  </button>
                </div>
                <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                  <input
                    value={withdrawAmount}
                    onChange={(event) => setWithdrawAmount(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none"
                    aria-label="Withdrawal amount"
                  />
                  <button
                    type="button"
                    disabled={!canUpdate || loadingAction !== null}
                    onClick={() =>
                      runTransaction(
                        "withdraw",
                        "withdraw",
                        `Withdrew ${withdrawAmount} native tokens.`,
                        (contract) => contract.withdraw(parseEther(withdrawAmount)),
                      )
                    }
                    className="rounded-md bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40"
                  >
                    Withdraw
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!canUpdate || loadingAction !== null}
                  onClick={() =>
                    runTransaction(
                      "heartbeat",
                      "heartbeat",
                      "Owner heartbeat confirmed.",
                      (contract) => contract.heartbeat(),
                    )
                  }
                  className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-3 py-2.5 text-xs font-medium text-cyan-100 hover:bg-cyan-950/50 disabled:opacity-40"
                >
                  Check in now
                </button>
                <button
                  type="button"
                  disabled={!canUpdate || loadingAction !== null}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Close this vault permanently and withdraw its full balance? This cannot be undone.",
                      )
                    ) {
                      void runTransaction(
                        "close",
                        "close",
                        "Closed vault and recovered remaining funds.",
                        (contract) => contract.closeVault(),
                      );
                    }
                  }}
                  className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2.5 text-xs font-medium text-rose-200 hover:bg-rose-950/40 disabled:opacity-40"
                >
                  Close and recover vault
                </button>
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-amber-300">
                Beneficiary workspace
              </p>
              <h2 className="mt-1 text-lg font-semibold">Claim an inactive vault</h2>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Enter the owner address shared with you. Your connected wallet
                must match the configured beneficiary.
              </p>

              {claimChainId && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-100">
                  <span>
                    Shared on {getChainConfig(claimChainId)?.name ?? `chain ${claimChainId}`}
                  </span>
                  {chain?.chainId !== claimChainId && (
                    <button
                      type="button"
                      onClick={() => void switchNetwork(claimChainId)}
                      disabled={loadingAction !== null}
                      className="rounded-md bg-amber-300 px-2.5 py-1.5 font-semibold text-amber-950 disabled:opacity-40"
                    >
                      Switch network
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4 flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                <input
                  value={claimOwner}
                  onChange={(event) => {
                    setClaimOwner(event.target.value);
                    setClaimChainId(null);
                    setClaimLoaded(false);
                  }}
                  placeholder="Owner address 0x..."
                  className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={loadBeneficiaryVault}
                  disabled={loadingAction !== null}
                  className="rounded-md bg-amber-300 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-200 disabled:opacity-40"
                >
                  Load
                </button>
              </div>

              {claimLoaded && !claimVault && (
                <p className="mt-4 text-xs text-slate-400">No vault exists for that owner.</p>
              )}

              {claimVault && (
                <div className="mt-4 space-y-3">
                  <div className={`rounded-xl border px-4 py-3 text-xs ${toneClasses(claimTimeline.tone)}`}>
                    {claimTimeline.label}
                  </div>
                  <dl className="grid gap-2 text-xs">
                    <div className="flex justify-between gap-3 border-b border-slate-800 pb-2">
                      <dt className="text-slate-500">Owner</dt>
                      <dd className="font-mono text-slate-200" title={claimVault.owner}>
                        {shortAddress(claimVault.owner)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-slate-800 pb-2">
                      <dt className="text-slate-500">Beneficiary</dt>
                      <dd className="font-mono text-slate-200" title={claimVault.beneficiary}>
                        {shortAddress(claimVault.beneficiary)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-slate-800 pb-2">
                      <dt className="text-slate-500">Balance</dt>
                      <dd className="text-slate-200">{formatEther(claimVault.balance)} native</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">State</dt>
                      <dd className="text-slate-200">{getVaultStatusLabel(claimVault.status)}</dd>
                    </div>
                  </dl>

                  {account?.toLowerCase() !== claimVault.beneficiary.toLowerCase() && (
                    <p className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-400">
                      Connect the beneficiary wallet {shortAddress(claimVault.beneficiary)} to continue.
                    </p>
                  )}

                  {claimVault.status === VAULT_STATUS.active && claimVault.inactive && (
                    <button
                      type="button"
                      disabled={
                        loadingAction !== null ||
                        account?.toLowerCase() !== claimVault.beneficiary.toLowerCase()
                      }
                      onClick={() =>
                        runTransaction(
                          "request",
                          "request",
                          `Requested claim for ${shortAddress(claimVault.owner)}.`,
                          (contract) => contract.requestClaim(claimVault.owner),
                        )
                      }
                      className="w-full rounded-lg bg-amber-300 px-3 py-2.5 text-xs font-semibold text-amber-950 hover:bg-amber-200 disabled:opacity-40"
                    >
                      Request claim
                    </button>
                  )}

                  {claimVault.status === VAULT_STATUS.claimRequested && (
                    <div className="space-y-2">
                      <label className="block space-y-1.5 text-xs text-slate-400">
                        <span>Payout recipient</span>
                        <input
                          value={claimRecipient}
                          onChange={(event) => setClaimRecipient(event.target.value)}
                          placeholder={account ?? "Recipient address 0x..."}
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none transition focus:border-rose-400"
                        />
                      </label>
                      <p className="text-[10px] leading-4 text-slate-500">
                        Defaults to the connected beneficiary. A smart-contract
                        beneficiary may choose another payable recipient.
                      </p>
                      <button
                        type="button"
                        disabled={
                          !claimVault.claimable ||
                          loadingAction !== null ||
                          account?.toLowerCase() !==
                            claimVault.beneficiary.toLowerCase()
                        }
                        onClick={() => void executeBeneficiaryClaim()}
                        className="w-full rounded-lg bg-rose-400 px-3 py-2.5 text-xs font-semibold text-rose-950 hover:bg-rose-300 disabled:opacity-40"
                      >
                        {claimVault.claimable
                          ? "Execute claim"
                          : "Challenge period active"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    This session
                  </p>
                  <h2 className="mt-1 text-sm font-semibold">Recent confirmations</h2>
                </div>
                {activity.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActivity([])}
                    className="text-[11px] text-slate-500 hover:text-slate-300"
                  >
                    Clear
                  </button>
                )}
              </div>

              {activity.length === 0 ? (
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  Confirmed transactions from this browser session appear here.
                  The chain remains the source of truth.
                </p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {activity.map((item) => (
                    <li key={item.id} className="border-l border-slate-700 pl-3 text-xs">
                      <div className="font-medium capitalize text-slate-300">{item.type}</div>
                      <div className="mt-0.5 leading-5 text-slate-500">{item.label}</div>
                      <div className="mt-0.5 text-[10px] text-slate-600">
                        {item.timestamp.toLocaleTimeString()}
                        {getExplorerUrl(item.chain, "tx", item.hash) && (
                          <>
                            {" - "}
                            <a
                              href={getExplorerUrl(item.chain, "tx", item.hash)}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-slate-400"
                            >
                              View
                            </a>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>

        <footer className="border-t border-slate-900 pt-4 text-[10px] leading-5 text-slate-600">
          Development software. Contracts are unaudited. Do not use meaningful funds.
          Mortal Vault is a technical continuity tool, not a legal will.
        </footer>
      </div>
    </main>
  );
}
