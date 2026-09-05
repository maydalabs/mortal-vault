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
  getWalletAddChainParams,
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
import {
  DEFAULT_CLAIM_DELAY_DAYS,
  DEFAULT_INACTIVITY_DAYS,
} from "@/lib/duration-policy";
import { assessVaultHealth } from "@/lib/health";
import { buildCheckInIcs } from "@/lib/ics";
import { loadConstellation, type Constellation } from "@/lib/constellation";
import { readLabels, writeLabel } from "@/lib/labels";
import {
  loadVaultActivity,
  type VaultActivityQueryResult,
  type VaultActivityRole,
} from "@/lib/vault-events";
import { projectVaultActivity } from "@/lib/vault-projection";
import { isReminderDue, scheduleVaultReminders } from "@/lib/vault-reminders";

import {
  ActivityCard,
  type ActivityScope,
  type ReminderPreview,
} from "@/components/ActivityCard";
import { ErrorBanner, PendingBanner, type PendingTransaction } from "@/components/Banners";
import { BeneficiaryView } from "@/components/BeneficiaryView";
import { Footer } from "@/components/Footer";
import { Landing } from "@/components/Landing";
import { PlanCard } from "@/components/PlanCard";
import { RitualOverlay, type Ritual } from "@/components/RitualOverlay";
import { SetupWizard } from "@/components/SetupWizard";
import nextDynamic from "next/dynamic";

const CosmicScene = nextDynamic(
  () => import("@/components/CosmicScene").then((module) => module.CosmicScene),
  { ssr: false },
);
import { StatusHero, type HeroRing } from "@/components/StatusHero";
import { TopBar } from "@/components/TopBar";
import { VaultCard } from "@/components/VaultCard";
import { VigilCalendar } from "@/components/VigilCalendar";
import { TONE_HEX, type Tone } from "@/components/tone";

type EthereumEventProvider = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};

type Workspace = "owner" | "beneficiary";

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

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const two = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const seconds = safe % 60;
  return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
}

function getTimeline(vault: VaultView | null, now: number): {
  tone: Tone;
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

  if (vault.status === VAULT_STATUS.claimRequested) {
    const executableAt =
      Number(vault.claimRequestedAt) + Number(vault.claimDelay);
    if (vault.claimable || executableAt <= now) {
      return { tone: "danger", label: "The beneficiary can execute this claim now." };
    }
    return {
      tone: "warn",
      label: `Claim requested. The owner has ${formatRemaining(executableAt - now)} to respond.`,
    };
  }

  if (vault.inactive) {
    return {
      tone: "danger",
      label: "Check-in overdue. The beneficiary can request a claim.",
    };
  }

  const deadline = Number(vault.lastHeartbeat) + Number(vault.timeout);
  const remaining = deadline - now;
  return {
    tone: remaining > 2 * 86_400 ? "safe" : "warn",
    label: `${formatRemaining(remaining)} until the beneficiary can request a claim.`,
  };
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
  const [currentTimestamp, setCurrentTimestamp] = useState(() =>
    Math.floor(Date.now() / 1000),
  );
  const [account, setAccount] = useState<string | null>(null);
  const [chainTimeOffset, setChainTimeOffset] = useState(0);
  const [chain, setChain] = useState<ChainConfig | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [ownerVault, setOwnerVault] = useState<VaultView | null>(null);
  const [maxVaultBalance, setMaxVaultBalance] = useState<bigint | null>(null);

  const [workspace, setWorkspace] = useState<Workspace>("owner");
  const [ritual, setRitual] = useState<Ritual | null>(null);
  const [constellation, setConstellation] = useState<Constellation | null>(null);
  const [beneficiaryProfile, setBeneficiaryProfile] = useState<{
    nonce: number;
    balance: bigint;
  } | null>(null);
  const [deepAction, setDeepAction] = useState<string | null>(null);
  const [planEditing, setPlanEditing] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});

  const [beneficiary, setBeneficiary] = useState("");
  const [beneficiaryLabel, setBeneficiaryLabel] = useState("");
  const [timeoutDays, setTimeoutDays] = useState(
    DEFAULT_INACTIVITY_DAYS.toString(),
  );
  const [claimDelayDays, setClaimDelayDays] = useState(
    DEFAULT_CLAIM_DELAY_DAYS.toString(),
  );
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
  const [activityScope, setActivityScope] = useState<ActivityScope>("owner");
  const [activityResult, setActivityResult] =
    useState<VaultActivityQueryResult | null>(null);
  const [activityChain, setActivityChain] = useState<ChainConfig | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityRevision, setActivityRevision] = useState(0);
  const [claimLinkCopied, setClaimLinkCopied] = useState(false);

  const chainNow = currentTimestamp + chainTimeOffset;
  const ownerTimeline = useMemo(
    () => getTimeline(ownerVault, chainNow),
    [chainNow, ownerVault],
  );
  const claimTimeline = useMemo(
    () => getTimeline(claimVault, chainNow),
    [chainNow, claimVault],
  );
  const canUpdate =
    ownerVault?.status === VAULT_STATUS.active ||
    ownerVault?.status === VAULT_STATUS.claimRequested;
  const nativeSymbol = chain?.walletAdd?.nativeCurrency.symbol ?? "ETH";
  const labelFor = useCallback(
    (address: string | null | undefined): string | null => {
      if (!address) return null;
      return labels[address.toLowerCase()] ?? null;
    },
    [labels],
  );

  const activitySelection = useMemo<{
    role: VaultActivityRole;
    address: string;
    label: string;
  } | null>(() => {
    if (activityScope === "loaded-owner") {
      return claimLoaded && isAddress(claimOwner)
        ? { role: "owner", address: claimOwner, label: "Loaded vault owner" }
        : null;
    }
    if (!account) return null;
    return activityScope === "beneficiary"
      ? {
          role: "beneficiary",
          address: account,
          label: "Connected wallet as beneficiary",
        }
      : { role: "owner", address: account, label: "Connected wallet as owner" };
  }, [account, activityScope, claimLoaded, claimOwner]);

  const reminderPreview = useMemo<ReminderPreview | null>(() => {
    if (
      !activityResult ||
      activitySelection?.role !== "owner" ||
      !activityChain?.contractAddress
    ) {
      return null;
    }

    try {
      const projection = projectVaultActivity(activityResult.items, {
        historyComplete: !activityResult.partial,
      });
      if (!projection.complete) {
        return {
          state: "incomplete",
          message:
            "Complete lifecycle history is required before reminders can be scheduled safely.",
        };
      }
      if (!projection.vault) {
        return {
          state: "empty",
          message: "No current vault lifecycle was found for this owner.",
        };
      }

      const reminders = scheduleVaultReminders(projection.vault, {
        chainId: activityChain.chainId,
        contractAddress: activityChain.contractAddress,
        now: chainNow,
      });
      const due = reminders.filter((item) =>
        isReminderDue(item, chainNow),
      );
      const next =
        reminders
          .filter((item) => !isReminderDue(item, chainNow))
          .sort((left, right) => left.deliverAt - right.deliverAt)[0] ?? null;
      return {
        state: "ready",
        status: projection.vault.status,
        due,
        next,
      };
    } catch (caught) {
      return { state: "error", message: getErrorMessage(caught) };
    }
  }, [
    activityChain,
    activityResult,
    activitySelection?.role,
    chainNow,
  ]);

  const syncSession = useCallback(async (address: string) => {
    const context = await getNetworkContext();
    const [balance, vault, balanceLimit, latestBlock] = await Promise.all([
      context.provider.getBalance(address),
      readVault(context.provider, context.contractAddress, address),
      readVaultBalanceLimit(context.provider, context.contractAddress),
      context.provider.getBlock("latest"),
    ]);

    if (latestBlock) {
      setChainTimeOffset(
        Number(latestBlock.timestamp) - Math.floor(Date.now() / 1000),
      );
    }

    if (vault) {
      const [beneficiaryNonce, beneficiaryBalance] = await Promise.all([
        context.provider.getTransactionCount(vault.beneficiary),
        context.provider.getBalance(vault.beneficiary),
      ]);
      setBeneficiaryProfile({ nonce: beneficiaryNonce, balance: beneficiaryBalance });
    } else {
      setBeneficiaryProfile(null);
      setBeneficiary("");
      setBeneficiaryLabel("");
      setTimeoutDays(DEFAULT_INACTIVITY_DAYS.toString());
      setClaimDelayDays(DEFAULT_CLAIM_DELAY_DAYS.toString());
    }

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
      const [vault, balanceLimit, latestBlock] = await Promise.all([
        readVault(context.provider, context.contractAddress, owner),
        readVaultBalanceLimit(context.provider, context.contractAddress),
        context.provider.getBlock("latest"),
      ]);
      if (latestBlock) {
        setChainTimeOffset(
          Number(latestBlock.timestamp) - Math.floor(Date.now() / 1000),
        );
      }
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
      setActivityRevision((current) => current + 1);
      await refreshAfterTransaction(signerAddress);
      return true;
    } catch (caught) {
      setError(getErrorMessage(caught));
      return false;
    } finally {
      setLoadingAction(null);
      setPendingTransaction(null);
    }
  }

  function persistBeneficiaryLabel(address: string) {
    if (typeof window === "undefined") return;
    writeLabel(window.localStorage, address, beneficiaryLabel);
    setLabels(readLabels(window.localStorage));
  }

  async function saveOwnerConfiguration() {
    try {
      setError(null);
      if (!isAddress(beneficiary)) {
        throw new Error("Enter a valid beneficiary address.");
      }
      const timeout = secondsFromDays(timeoutDays, "Inactivity timeout");
      const claimDelay = secondsFromDays(claimDelayDays, "Claim delay");
      persistBeneficiaryLabel(beneficiary);

      if (canUpdate) {
        await runTransaction(
          "save",
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
      const created = await runTransaction(
        "save",
        `Created a vault with ${initialDeposit} ${nativeSymbol}.`,
        (contract) =>
          contract.createVault(beneficiary, timeout, claimDelay, { value }),
      );
      if (created) {
        setRitual({ kind: "sealed", days: Math.round(Number(timeoutDays)) });
      }
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
        `Deposited ${depositAmount} ${nativeSymbol}.`,
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
      `Executed claim for ${shortAddress(claimVault.owner)}.`,
      (contract) => contract.executeClaimTo(claimVault.owner, recipient),
    );
  }

  function requestBeneficiaryClaim() {
    if (!claimVault) return;
    void runTransaction(
      "request",
      `Requested claim for ${shortAddress(claimVault.owner)}.`,
      (contract) => contract.requestClaim(claimVault.owner),
    );
  }

  async function checkInNow() {
    const timeoutDaysNow = ownerVault
      ? Math.round(Number(ownerVault.timeout) / 86_400)
      : Math.round(Number(timeoutDays));
    const confirmed = await runTransaction(
      "heartbeat",
      "Owner check-in confirmed.",
      (contract) => contract.heartbeat(),
    );
    if (confirmed) {
      setRitual({ kind: "checkin", days: timeoutDaysNow });
    }
  }

  async function previewAsBeneficiary() {
    if (!account) return;
    setClaimOwner(account);
    setClaimChainId(null);
    setClaimVault(null);
    setClaimLoaded(false);
    setWorkspace("beneficiary");
    try {
      setLoadingAction("load-claim");
      setError(null);
      await refreshClaimVault(account, chain?.chainId ?? null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoadingAction(null);
    }
  }

  const downloadCheckInIcs = useCallback(() => {
    if (!ownerVault) return;
    const dueAt = Number(ownerVault.lastHeartbeat) + Number(ownerVault.timeout);
    const ics = buildCheckInIcs({
      dueAt,
      url: `${window.location.origin}/?action=checkin`,
    });
    const blob = new Blob([ics], { type: "text/calendar" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "mortal-vault-checkin.ics";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }, [ownerVault]);

  function closeOwnerVault() {
    if (
      window.confirm(
        "Close this vault permanently and withdraw its full balance? This cannot be undone.",
      )
    ) {
      void runTransaction(
        "close",
        "Closed vault and recovered remaining funds.",
        (contract) => contract.closeVault(),
      );
    }
  }

  useEffect(() => {
    const timer = window.setInterval(
      () => setCurrentTimestamp(Math.floor(Date.now() / 1000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLabels(readLabels(window.localStorage));
  }, []);

  useEffect(() => {
    if (deepAction !== "checkin" || !account || !canUpdate || loadingAction !== null) {
      return;
    }
    setDeepAction(null);
    void checkInNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepAction, account, canUpdate, loadingAction]);

  useEffect(() => {
    if (ownerVault && canUpdate) {
      setBeneficiary(ownerVault.beneficiary);
      setTimeoutDays((Number(ownerVault.timeout) / 86_400).toString());
      setClaimDelayDays((Number(ownerVault.claimDelay) / 86_400).toString());
    }
  }, [canUpdate, ownerVault]);

  useEffect(() => {
    if (ownerVault) {
      setBeneficiaryLabel(labelFor(ownerVault.beneficiary) ?? "");
    }
  }, [labelFor, ownerVault]);

  useEffect(() => {
    let active = true;

    if (!activitySelection || !chain || !contractAddress) {
      setActivityResult(null);
      setActivityChain(null);
      setActivityError(null);
      setActivityLoading(false);
      return;
    }

    const refresh = async () => {
      setActivityLoading(true);
      setActivityError(null);
      setActivityResult(null);
      setActivityChain(null);
      try {
        const provider = new BrowserProvider(getEthereum());
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== chain.chainId) {
          throw new Error("Wallet network changed while loading activity.");
        }
        const result = await loadVaultActivity({
          provider,
          contractAddress,
          role: activitySelection.role,
          address: activitySelection.address,
          fromBlock: chain.deploymentBlock,
        });
        if (!active) return;
        setActivityResult(result);
        setActivityChain(chain);
      } catch (caught) {
        if (!active) return;
        setActivityResult(null);
        setActivityChain(null);
        setActivityError(getErrorMessage(caught));
      } finally {
        if (active) setActivityLoading(false);
      }
    };

    void refresh();
    return () => {
      active = false;
    };
  }, [activityRevision, activitySelection, chain, contractAddress]);

  useEffect(() => {
    if (!contractAddress || !chain) {
      return;
    }
    let active = true;

    const load = async () => {
      try {
        const provider = new BrowserProvider(getEthereum());
        const result = await loadConstellation({
          provider,
          contractAddress,
          fromBlock: chain.deploymentBlock,
        });
        if (active) setConstellation(result);
      } catch {
        if (active) setConstellation(null);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [chain, contractAddress]);

  useEffect(() => {
    const sharedClaim = parseClaimSearch(window.location.search);
    if (sharedClaim.owner) {
      setClaimOwner(sharedClaim.owner);
      setWorkspace("beneficiary");
    }
    if (sharedClaim.chainId) setClaimChainId(sharedClaim.chainId);

    const params = new URLSearchParams(window.location.search);
    if (params.get("action") === "checkin") {
      setDeepAction("checkin");
      params.delete("action");
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    let pollTimer: number | undefined;
    let attached: EthereumEventProvider | null = null;
    let onAccountsChanged: ((...args: unknown[]) => void) | null = null;
    let onChainChanged: (() => void) | null = null;

    // Wallet extensions can inject after hydration; look for one briefly
    // instead of deciding at first render that none exists.
    const attach = (ethereum: EthereumEventProvider) => {
      attached = ethereum;

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

      onAccountsChanged = (...args: unknown[]) => {
        const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
        void resync(accounts[0]);
      };
      onChainChanged = () => {
        void ethereum
          .request({ method: "eth_accounts" })
          .then((value) => resync((value as string[])[0]))
          .catch(() => {});
      };

      void ethereum
        .request({ method: "eth_accounts" })
        .then((value) => resync((value as string[])[0]))
        .catch(() => {});
      ethereum.on?.("accountsChanged", onAccountsChanged);
      ethereum.on?.("chainChanged", onChainChanged);
    };

    let attempts = 0;
    const seek = () => {
      if (!active) return;
      const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
      if (ethereum) {
        attach(ethereum);
        return;
      }
      if (attempts < 20) {
        attempts += 1;
        pollTimer = window.setTimeout(seek, 500);
      }
    };
    seek();

    return () => {
      active = false;
      window.clearTimeout(pollTimer);
      if (attached) {
        if (onAccountsChanged) attached.removeListener?.("accountsChanged", onAccountsChanged);
        if (onChainChanged) attached.removeListener?.("chainChanged", onChainChanged);
      }
    };
  }, [syncSession]);

  const busy = loadingAction !== null;
  const beneficiaryDisplay =
    labelFor(ownerVault?.beneficiary) ??
    (ownerVault ? shortAddress(ownerVault.beneficiary) : "your beneficiary");

  const healthNotes = useMemo(() => {
    if (!ownerVault || !canUpdate) return [];
    const heartbeatTimestamps = (
      activitySelection?.role === "owner" ? (activityResult?.items ?? []) : []
    )
      .filter(
        (item) => item.eventName === "Heartbeat" && item.blockTimestamp !== null,
      )
      .map((item) => item.blockTimestamp as number);
    return assessVaultHealth({
      timeoutSeconds: Number(ownerVault.timeout),
      balance: ownerVault.balance,
      maxVaultBalance,
      beneficiaryNonce: beneficiaryProfile?.nonce ?? null,
      beneficiaryBalance: beneficiaryProfile?.balance ?? null,
      beneficiaryName:
        labelFor(ownerVault.beneficiary) ?? shortAddress(ownerVault.beneficiary),
      heartbeatTimestamps,
    });
  }, [
    activityResult,
    activitySelection?.role,
    beneficiaryProfile,
    canUpdate,
    labelFor,
    maxVaultBalance,
    ownerVault,
  ]);

  const hero = useMemo<{
    tone: Tone;
    overline: string;
    headline: string;
    body: React.ReactNode;
    note?: React.ReactNode;
    ring: HeroRing | null;
    showSetup: boolean;
  }>(() => {
    const strong = (value: string) => (
      <strong className="font-medium text-ink">{value}</strong>
    );

    if (!ownerVault || !canUpdate) {
      const context =
        ownerVault?.status === VAULT_STATUS.claimed
          ? "Your previous vault completed its journey — its full balance passed to your beneficiary. "
          : ownerVault?.status === VAULT_STATUS.closed
            ? "Your previous vault was closed, and everything returned to you. "
            : "";
      return {
        tone: "neutral" as Tone,
        overline: "A NEW PLAN",
        headline: ownerVault ? "Start a new vault." : "Set up your vault.",
        body: (
          <>
            {context}
            Deposit what you want protected, choose someone you trust, and stay
            in control simply by checking in.
          </>
        ),
        ring: null,
        showSetup: true,
      };
    }

    const timeoutSeconds = Number(ownerVault.timeout);
    const lastHeartbeat = Number(ownerVault.lastHeartbeat);
    const sinceCheckIn = Math.max(0, chainNow - lastHeartbeat);

    if (ownerVault.status === VAULT_STATUS.claimRequested) {
      const claimDelay = Number(ownerVault.claimDelay);
      const executableAt = Number(ownerVault.claimRequestedAt) + claimDelay;
      const remaining = executableAt - chainNow;
      const requestedAgo = Math.max(
        0,
        chainNow - Number(ownerVault.claimRequestedAt),
      );
      const executable = ownerVault.claimable || remaining <= 0;
      return {
        tone: "danger" as Tone,
        overline: "CLAIM IN PROGRESS",
        headline: "A claim has started.",
        body: (
          <>
            {beneficiaryDisplay} asked to claim your vault{" "}
            {strong(`${formatRemaining(requestedAgo)} ago`)}. If you&apos;re
            reading this, one check-in cancels it — no questions asked.
          </>
        ),
        note: executable
          ? "The waiting period has passed, so the claim can execute at any moment — but checking in still cancels it until then."
          : `If you do nothing, the vault transfers to ${beneficiaryDisplay} in ${formatRemaining(remaining)}.`,
        ring: executable
          ? { fraction: 1, value: "Now", label: "claim can execute", eclipseFraction: 1 }
          : {
              fraction: claimDelay > 0 ? remaining / claimDelay : 0,
              value: remaining >= 86_400 ? `${Math.floor(remaining / 86_400)}d` : formatRemaining(remaining),
              label: "left to cancel",
              clock: formatClock(remaining % 86_400),
              eclipseFraction: claimDelay > 0 ? 1 - remaining / claimDelay : 1,
            },
        showSetup: false,
      };
    }

    if (ownerVault.inactive) {
      const overdue = Math.max(
        0,
        chainNow - (lastHeartbeat + timeoutSeconds),
      );
      const overdueDays = Math.floor(overdue / 86_400);
      return {
        tone: "warn" as Tone,
        overline: "ACTION NEEDED",
        headline: "Time to check in.",
        body: (
          <>
            Your check-in window lapsed {strong(`${formatRemaining(overdue)} ago`)}.{" "}
            {beneficiaryDisplay} can now start a claim — one check-in from you
            stops that instantly.
          </>
        ),
        note: `Nothing has moved. Even if a claim starts, you keep a ${Math.round(Number(ownerVault.claimDelay) / 86_400)}-day window to cancel it.`,
        ring: {
          fraction: 1,
          value: overdue >= 86_400 ? `${overdueDays}` : formatRemaining(overdue),
          label: overdue >= 86_400 ? `day${overdueDays === 1 ? "" : "s"} past due` : "past due",
        },
        showSetup: false,
      };
    }

    const deadline = lastHeartbeat + timeoutSeconds;
    const remaining = Math.max(0, deadline - chainNow);
    const remainingDays = Math.ceil(remaining / 86_400);
    const soon = ownerTimeline.tone === "warn";
    return {
      tone: (soon ? "warn" : "safe") as Tone,
      overline: soon ? "CHECK IN SOON" : "ALL QUIET",
      headline: soon ? "Check in soon." : "You’re protected.",
      body: (
        <>
          Your last check-in was {strong(`${formatRemaining(sinceCheckIn)} ago`)}.{" "}
          {soon
            ? "Your quiet period is almost over — a quick check-in resets it."
            : "Your plan is standing guard, and nothing needs your attention."}
        </>
      ),
      note: (
        <>
          Next check-in due by{" "}
          <strong className="font-medium text-ink">
            {new Date(deadline * 1000).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </strong>
          {" · "}
          <button
            type="button"
            onClick={downloadCheckInIcs}
            className="text-gold underline decoration-hairline-strong underline-offset-4 transition hover:text-gold-bright"
          >
            Add to calendar
          </button>
        </>
      ),
      ring: {
        fraction: timeoutSeconds > 0 ? remaining / timeoutSeconds : 0,
        value: remaining >= 86_400 ? `${remainingDays}` : formatRemaining(remaining),
        label:
          remaining >= 86_400
            ? `day${remainingDays === 1 ? "" : "s"} until check-in`
            : "until check-in",
      },
      showSetup: false,
    };
  }, [beneficiaryDisplay, canUpdate, chainNow, downloadCheckInIcs, ownerTimeline.tone, ownerVault]);

  const showWorkspaceToggle = !!account || claimOwner !== "";

  return (
    <>
      <CosmicScene vaultStars={constellation?.stars} />
      <main className="relative z-10 flex min-h-screen flex-col text-ink">
      <div className={`h-[3px] ${account && hero.tone === "danger" ? "strip-pulse" : ""}`} style={{ background: account ? TONE_HEX[hero.tone] : "#d8c58f" }} />

      <TopBar
        chains={SUPPORTED_CHAINS}
        currentChainId={chain?.chainId ?? null}
        switchingChainId={
          loadingAction?.startsWith("switch-")
            ? Number(loadingAction.slice("switch-".length))
            : null
        }
        busy={busy}
        account={account}
        walletBalance={walletBalance}
        nativeSymbol={nativeSymbol}
        workspace={workspace}
        showWorkspaceToggle={showWorkspaceToggle}
        onSwitchChain={(chainId) => void switchNetwork(chainId)}
        onConnect={() => void connectWallet()}
        onWorkspaceChange={setWorkspace}
      />

      <div className="flex flex-1 flex-col gap-5 pb-8">
        {error && <ErrorBanner message={error} />}
        {pendingTransaction && <PendingBanner pending={pendingTransaction} />}

        {workspace === "beneficiary" ? (
          <BeneficiaryView
            account={account}
            chain={chain}
            nativeSymbol={nativeSymbol}
            claimChainId={claimChainId}
            claimOwner={claimOwner}
            claimLoaded={claimLoaded}
            claimVault={claimVault}
            claimRecipient={claimRecipient}
            timelineTone={claimTimeline.tone}
            timelineLabel={claimTimeline.label}
            currentTimestamp={chainNow}
            busy={busy}
            loadBusy={loadingAction === "load-claim"}
            rehearsal={!!account && claimOwner.toLowerCase() === account.toLowerCase()}
            onClaimOwnerChange={(value) => {
              setClaimOwner(value);
              setClaimChainId(null);
              setClaimLoaded(false);
              setClaimVault(null);
            }}
            onLoad={() => void loadBeneficiaryVault()}
            onSwitchNetwork={(chainId) => void switchNetwork(chainId)}
            onClaimRecipientChange={setClaimRecipient}
            onRequestClaim={requestBeneficiaryClaim}
            onExecuteClaim={() => void executeBeneficiaryClaim()}
          />
        ) : !account ? (
          <Landing
            busy={busy}
            chainName={chain?.name ?? null}
            constellation={constellation}
            onConnect={() => void connectWallet()}
          />
        ) : (
          <>
            <StatusHero
              tone={hero.tone}
              overline={hero.overline}
              headline={hero.headline}
              body={hero.body}
              note={hero.note}
              ring={hero.ring}
              primary={
                hero.showSetup
                  ? undefined
                  : {
                      label:
                        hero.tone === "danger"
                          ? "Check in and cancel the claim"
                          : "Check in now",
                      onClick: () => void checkInNow(),
                      disabled: busy,
                    }
              }
              secondary={
                hero.showSetup
                  ? undefined
                  : {
                      label: planEditing ? "Hide plan editor" : "Manage plan",
                      onClick: () => setPlanEditing((current) => !current),
                    }
              }
            >
              {hero.showSetup && (
                <SetupWizard
                  beneficiary={beneficiary}
                  beneficiaryLabel={beneficiaryLabel}
                  timeoutDays={timeoutDays}
                  claimDelayDays={claimDelayDays}
                  initialDeposit={initialDeposit}
                  maxVaultBalance={maxVaultBalance}
                  nativeSymbol={nativeSymbol}
                  saving={loadingAction === "save"}
                  disabled={busy}
                  onBeneficiaryChange={setBeneficiary}
                  onLabelChange={setBeneficiaryLabel}
                  onTimeoutChange={setTimeoutDays}
                  onClaimDelayChange={setClaimDelayDays}
                  onDepositChange={setInitialDeposit}
                  onCreate={() => void saveOwnerConfiguration()}
                />
              )}
            </StatusHero>

            {healthNotes.length > 0 && (
              <div className="mx-4 flex flex-col gap-2 sm:mx-6 md:mx-10">
                {healthNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] leading-relaxed ${
                      note.severity === "warn"
                        ? "border-warn/30 bg-warn/10 text-warn"
                        : "border-hairline bg-panel/70 text-muted"
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        note.severity === "warn" ? "bg-warn" : "bg-faint"
                      }`}
                      aria-hidden="true"
                    />
                    {note.message}
                  </div>
                ))}
              </div>
            )}

            {ownerVault &&
              canUpdate &&
              activitySelection?.role === "owner" &&
              activityResult &&
              activityResult.items.length > 0 && (
                <div className="mx-4 sm:mx-6 md:mx-10">
                  <VigilCalendar items={activityResult.items} nowSeconds={chainNow} />
                </div>
              )}

            {ownerVault && canUpdate ? (
              <div className="mx-4 grid grid-cols-1 gap-5 sm:mx-6 md:mx-10 lg:grid-cols-3">
                <div className="rise rise-3"><VaultCard
                  balance={ownerVault.balance}
                  maxVaultBalance={maxVaultBalance}
                  nativeSymbol={nativeSymbol}
                  depositAmount={depositAmount}
                  withdrawAmount={withdrawAmount}
                  disabled={busy}
                  onDepositAmountChange={setDepositAmount}
                  onWithdrawAmountChange={setWithdrawAmount}
                  onDeposit={() => void depositToOwnerVault()}
                  onWithdraw={() =>
                    void runTransaction(
                      "withdraw",
                      `Withdrew ${withdrawAmount} ${nativeSymbol}.`,
                      (contract) => contract.withdraw(parseEther(withdrawAmount)),
                    )
                  }
                /></div>
                <div className="rise rise-4"><PlanCard
                  beneficiary={ownerVault.beneficiary}
                  beneficiaryLabel={labelFor(ownerVault.beneficiary)}
                  vaultTimeoutDays={Number(ownerVault.timeout) / 86_400}
                  vaultClaimDelayDays={Number(ownerVault.claimDelay) / 86_400}
                  editing={planEditing}
                  formBeneficiary={beneficiary}
                  formLabel={beneficiaryLabel}
                  formTimeoutDays={timeoutDays}
                  formClaimDelayDays={claimDelayDays}
                  saving={loadingAction === "save"}
                  disabled={busy}
                  linkCopied={claimLinkCopied}
                  onToggleEdit={() => setPlanEditing((current) => !current)}
                  onFormBeneficiaryChange={setBeneficiary}
                  onFormLabelChange={setBeneficiaryLabel}
                  onFormTimeoutChange={setTimeoutDays}
                  onFormClaimDelayChange={setClaimDelayDays}
                  onSave={() => void saveOwnerConfiguration()}
                  onCopyLink={() => void copyBeneficiaryLink()}
                  onPreview={() => void previewAsBeneficiary()}
                  onCloseVault={closeOwnerVault}
                /></div>
                <div className="rise rise-5"><ActivityCard
                  selectionLabel={activitySelection?.label ?? null}
                  scope={activityScope}
                  scopeOptions={[
                    { scope: "owner", label: "My vault", disabled: !account },
                    { scope: "beneficiary", label: "As beneficiary", disabled: !account },
                    {
                      scope: "loaded-owner",
                      label: "Loaded owner",
                      disabled: !claimLoaded || !isAddress(claimOwner),
                    },
                  ]}
                  loading={activityLoading}
                  error={activityError}
                  result={activityResult}
                  chain={activityChain}
                  reminderPreview={reminderPreview}
                  onScopeChange={setActivityScope}
                  onRefresh={() => setActivityRevision((current) => current + 1)}
                /></div>
              </div>
            ) : (
              <div className="mx-4 sm:mx-6 md:mx-10">
                <ActivityCard
                  selectionLabel={activitySelection?.label ?? null}
                  scope={activityScope}
                  scopeOptions={[
                    { scope: "owner", label: "My vault", disabled: !account },
                    { scope: "beneficiary", label: "As beneficiary", disabled: !account },
                    {
                      scope: "loaded-owner",
                      label: "Loaded owner",
                      disabled: !claimLoaded || !isAddress(claimOwner),
                    },
                  ]}
                  loading={activityLoading}
                  error={activityError}
                  result={activityResult}
                  chain={activityChain}
                  reminderPreview={reminderPreview}
                  onScopeChange={setActivityScope}
                  onRefresh={() => setActivityRevision((current) => current + 1)}
                />
              </div>
            )}
          </>
        )}
      </div>

      <Footer
        chain={chain}
        contractAddress={contractAddress}
        maxVaultBalance={maxVaultBalance}
        nativeSymbol={nativeSymbol}
      />

      {ritual && <RitualOverlay ritual={ritual} onDone={() => setRitual(null)} />}
    </main>
    </>
  );
}
