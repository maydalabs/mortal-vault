"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BrowserProvider,
  Contract,
  formatEther,
  parseEther,
  type Eip1193Provider,
} from "ethers";

// LOCALHOST MortalVault address from Hardhat Ignition deploy
const VAULT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// Minimal ABI for the functions we use
const VAULT_ABI = [
  "function createVault(address _beneficiary, uint256 _timeout) payable",
  "function deposit() payable",
  "function heartbeat()",
  "function withdraw(uint256 amount)",
  "function claim(address ownerAddr)",
  "function getVault(address ownerAddr) view returns (address owner,address beneficiary,uint256 timeout,uint256 lastHeartbeat,uint256 balance,bool exists,bool claimed,bool expired)",
] as const;

type VaultView = {
  owner: string;
  beneficiary: string;
  timeout: bigint;
  lastHeartbeat: bigint;
  balance: bigint;
  exists: boolean;
  claimed: boolean;
  expired: boolean;
};

type ActivityType = "create" | "heartbeat" | "withdraw" | "claim";

type ActivityItem = {
  id: number;
  type: ActivityType;
  timestamp: Date;
  meta?: string;
};

type ExpiryInfo =
  | { state: "none"; label: string }
  | { state: "safe" | "warn" | "danger"; label: string };

// ---- helpers ----------------------------------------------------------

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

function getErrorMessage(error: unknown): string {
  // MetaMask / provider objects are usually plain objects with code + message
  if (error && typeof error === "object") {
    const err = error as {
      code?: number;
      message?: unknown;
      reason?: unknown;
    };

    const code = err.code;
    const rawMsg =
      typeof err.message === "string"
        ? err.message
        : typeof err.reason === "string"
        ? err.reason
        : undefined;

    const msg = rawMsg ?? "";

    if (code === -32002) {
      return "Wallet request already pending in MetaMask. Open the extension and approve or reject the existing request.";
    }

    if (msg.toLowerCase().includes("user rejected")) {
      return "You rejected the request in your wallet.";
    }

    if (msg) {
      // Keep it short-ish
      return msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
    }
  }

  if (typeof error === "string") {
    return error.length > 160 ? error.slice(0, 157) + "…" : error;
  }

  return "Unexpected error from wallet. Check the console for details.";
}

function getEthereum(): Eip1193Provider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No injected wallet found. Install MetaMask.");
  }
  return window.ethereum;
}

async function getProviderAndSigner() {
  const ethereum = getEthereum();
  const provider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  return { provider, signer };
}

function getTimeToExpiry(vault: VaultView | null): ExpiryInfo {
  if (!vault || !vault.exists) {
    return { state: "none", label: "No active vault yet for this address." };
  }

  // If contract already marks it expired, trust that.
  if (vault.expired) {
    return {
      state: "danger",
      label: "Vault is expired – beneficiary can claim now.",
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const timeoutSec = Number(vault.timeout);
  const last = Number(vault.lastHeartbeat);
  const deadline = last + timeoutSec;
  const remaining = deadline - nowSec;

  if (remaining <= 0) {
    return {
      state: "danger",
      label: "Vault is expired – beneficiary can claim now.",
    };
  }

  const days = Math.floor(remaining / (24 * 3600));
  const hours = Math.floor((remaining % (24 * 3600)) / 3600);
  const mins = Math.floor((remaining % 3600) / 60);

  if (days > 2) {
    return {
      state: "safe",
      label: `${days}d ${hours}h until beneficiary can claim.`,
    };
  }
  if (days >= 1) {
    return {
      state: "warn",
      label: `${days}d ${hours}h until claimable – consider sending a heartbeat.`,
    };
  }

  // < 1 day
  return {
    state: "danger",
    label: `${hours}h ${mins}m until claimable – heartbeat recommended.`,
  };
}

function activityLabel(type: ActivityType): string {
  switch (type) {
    case "create":
      return "Created / updated vault";
    case "heartbeat":
      return "Heartbeat sent";
    case "withdraw":
      return "Withdrawal executed";
    case "claim":
      return "Claim transaction sent";
    default:
      return "Activity";
  }
}

function activityBadgeClasses(type: ActivityType): string {
  switch (type) {
    case "create":
      return "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40";
    case "heartbeat":
      return "bg-cyan-500/10 text-cyan-300 border border-cyan-500/40";
    case "withdraw":
      return "bg-slate-500/10 text-slate-200 border border-slate-500/40";
    case "claim":
      return "bg-rose-500/10 text-rose-300 border border-rose-500/40";
    default:
      return "bg-slate-700/20 text-slate-200 border border-slate-600";
  }
}

function shortAddress(
  addr: string | null | undefined,
  chars = 6,
): string {
  if (!addr) return "-";
  if (!addr.startsWith("0x") || addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-4)}`;
}

// ---- main component ---------------------------------------------------

export default function Home() {
  const [account, setAccount] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultView | null>(null);
  const [beneficiary, setBeneficiary] = useState("");
  const [timeoutDays, setTimeoutDays] = useState("30");
  const [depositEth, setDepositEth] = useState("0.1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [networkName, setNetworkName] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balanceEth, setBalanceEth] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const pushActivity = (type: ActivityType, meta?: string) => {
    setActivity((prev) => {
      const next: ActivityItem[] = [
        {
          id: prev.length ? prev[0].id + 1 : 1,
          type,
          timestamp: new Date(),
          meta,
        },
        ...prev,
      ];
      // keep the latest 12
      return next.slice(0, 12);
    });
  };

  const syncNetworkAndBalance = useCallback(async (addr: string) => {
    try {
      const { provider } = await getProviderAndSigner();
      const [network, balance] = await Promise.all([
        provider.getNetwork(),
        provider.getBalance(addr),
      ]);

      setChainId(Number(network.chainId));
      setNetworkName(network.name || "Unknown");
      setBalanceEth(Number(formatEther(balance)).toFixed(4));
    } catch (e) {
      console.error(e);
      // don't surface to UI; not critical
    }
  }, []);

  const loadVault = useCallback(async (addr?: string) => {
    try {
      setError(null);
      const { provider, signer } = await getProviderAndSigner();
      const address = addr ?? (await signer.getAddress());

      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
      setNetworkName(network.name || "Unknown");

      if (Number(network.chainId) !== 31337) {
        setVault(null);
        setError(
          "Wrong network: switch MetaMask to Hardhat localhost (chainId 31337) to use the local MortalVault.",
        );
        return;
      }

      // Ensure contract is deployed
      const code = await provider.getCode(VAULT_ADDRESS);
      if (code === "0x") {
        setVault(null);
        setError(
          "MortalVault contract is not deployed at the configured address on this network.",
        );
        return;
      }

      const contract = new Contract(VAULT_ADDRESS, VAULT_ABI, provider);
      const result = await contract.getVault(address);

      const [
        owner,
        vaultBeneficiary,
        timeout,
        lastHeartbeat,
        balance,
        exists,
        claimed,
        expired,
      ] = result as [
        string,
        string,
        bigint,
        bigint,
        bigint,
        boolean,
        boolean,
        boolean
      ];

      if (!exists) {
        setVault(null);
        return;
      }

      setVault({
        owner,
        beneficiary: vaultBeneficiary,
        timeout,
        lastHeartbeat,
        balance,
        exists,
        claimed,
        expired,
      });

      // Also keep balance in sync with owner
      const bal = await provider.getBalance(address);
      setBalanceEth(Number(formatEther(bal)).toFixed(4));
    } catch (e: unknown) {
      console.error(e);
      setVault(null);
      setError(getErrorMessage(e));
    }
  }, []);

  async function connectWallet() {
    try {
      setError(null);
      const ethereum = getEthereum();

      await ethereum.request({
        method: "eth_requestAccounts",
      });

      const { signer, provider } = await getProviderAndSigner();
      const addr = await signer.getAddress();
      const [network, balance] = await Promise.all([
        provider.getNetwork(),
        provider.getBalance(addr),
      ]);

      setAccount(addr);
      setChainId(Number(network.chainId));
      setNetworkName(network.name || "Unknown");
      setBalanceEth(Number(formatEther(balance)).toFixed(4));

      await loadVault(addr);
    } catch (e: unknown) {
      console.error(e);
      setError(getErrorMessage(e));
    }
  }

  async function handleCreateVault() {
    try {
      setLoading(true);
      setError(null);

      const { signer, provider } = await getProviderAndSigner();
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
      setNetworkName(network.name || "Unknown");

      if (Number(network.chainId) !== 31337) {
        setLoading(false);
        setError(
          "Wrong network: switch MetaMask to Hardhat localhost (chainId 31337) before creating a vault.",
        );
        return;
      }

      const contract = new Contract(VAULT_ADDRESS, VAULT_ABI, signer);

      const timeoutSeconds = Number(timeoutDays || "0") * 24 * 60 * 60;
      const value = parseEther(depositEth || "0");

      const tx = await contract.createVault(beneficiary, timeoutSeconds, {
        value,
      });
      await tx.wait();

      const addr = await signer.getAddress();
      setAccount(addr);
      pushActivity("create", `Created vault with ${depositEth || "0"} ETH.`);
      await loadVault(addr);
      await syncNetworkAndBalance(addr);
    } catch (e: unknown) {
      console.error(e);
      setError(getErrorMessage(e) || "Failed to create vault.");
    } finally {
      setLoading(false);
    }
  }

  async function handleHeartbeat() {
    try {
      setLoading(true);
      setError(null);
      const { signer, provider } = await getProviderAndSigner();
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
      setNetworkName(network.name || "Unknown");

      if (Number(network.chainId) !== 31337) {
        setLoading(false);
        setError(
          "Wrong network: switch MetaMask to Hardhat localhost (chainId 31337) before sending a heartbeat.",
        );
        return;
      }

      const contract = new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
      const tx = await contract.heartbeat();
      await tx.wait();
      const addr = await signer.getAddress();

      pushActivity("heartbeat", "Heartbeat sent.");
      await loadVault(addr);
      await syncNetworkAndBalance(addr);
    } catch (e: unknown) {
      console.error(e);
      setError(getErrorMessage(e) || "Failed to send heartbeat.");
    } finally {
      setLoading(false);
    }
  }

  async function handleWithdraw(amountEth: string) {
    try {
      setLoading(true);
      setError(null);
      const { signer, provider } = await getProviderAndSigner();
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
      setNetworkName(network.name || "Unknown");

      if (Number(network.chainId) !== 31337) {
        setLoading(false);
        setError(
          "Wrong network: switch MetaMask to Hardhat localhost (chainId 31337) before withdrawing.",
        );
        return;
      }

      const contract = new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
      const amount = parseEther(amountEth);
      const tx = await contract.withdraw(amount);
      await tx.wait();
      const addr = await signer.getAddress();

      pushActivity("withdraw", `Withdrew ${amountEth} ETH.`);
      await loadVault(addr);
      await syncNetworkAndBalance(addr);
    } catch (e: unknown) {
      console.error(e);
      setError(getErrorMessage(e) || "Failed to withdraw.");
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim(ownerAddr: string) {
    try {
      setLoading(true);
      setError(null);
      const { signer, provider } = await getProviderAndSigner();
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
      setNetworkName(network.name || "Unknown");

      if (Number(network.chainId) !== 31337) {
        setLoading(false);
        setError(
          "Wrong network: switch MetaMask to Hardhat localhost (chainId 31337) before claiming.",
        );
        return;
      }

      const contract = new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
      const tx = await contract.claim(ownerAddr);
      await tx.wait();

      pushActivity("claim", "Claimed vault as beneficiary.");
      await loadVault(ownerAddr);
      await syncNetworkAndBalance(ownerAddr);
    } catch (e: unknown) {
      console.error(e);
      setError(getErrorMessage(e) || "Failed to claim.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        if (typeof window === "undefined" || !window.ethereum) return;
        const ethereum = getEthereum();
        const accounts = (await ethereum.request({
          method: "eth_accounts",
        })) as string[];

        if (accounts && accounts.length > 0) {
          const addr = accounts[0];
          setAccount(addr);
          await loadVault(addr);
          await syncNetworkAndBalance(addr);
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expiryInfo = getTimeToExpiry(vault);

  const riskBaseClasses = "rounded-xl px-4 py-3 text-xs border";
  let riskStateClasses =
    "border-slate-800 bg-slate-900/70 text-slate-300";
  if (expiryInfo.state === "safe") {
    riskStateClasses =
      "border-emerald-500/50 bg-emerald-950/40 text-emerald-100";
  } else if (expiryInfo.state === "warn") {
    riskStateClasses =
      "border-amber-500/50 bg-amber-950/40 text-amber-100";
  } else if (expiryInfo.state === "danger") {
    riskStateClasses =
      "border-rose-500/60 bg-rose-950/40 text-rose-100";
  }

  const networkLabel =
    chainId === 31337 ? "Hardhat localhost" : networkName ?? "Unknown";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex justify-center px-4 py-10">
      <div className="w-full max-w-5xl space-y-6">
        {/* Shell header */}
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-xs text-slate-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              <span>Mortal Vault · Local Dev</span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold">
              Cold storage with a dead-man switch.
            </h1>
            <p className="mt-1 text-sm text-slate-400 max-w-xl">
              As long as you keep sending heartbeats, only you control the
              funds. If you disappear long enough, your chosen beneficiary can
              step in.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 text-sm">
            <div className="flex flex-wrap justify-end gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 min-w-[160px]">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Network
                </div>
                <div className="text-xs text-slate-200">
                  {chainId
                    ? `${networkLabel} · chainId ${chainId}`
                    : "Not connected"}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 min-w-[120px]">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Balance
                </div>
                <div className="text-xs text-slate-200">
                  {balanceEth ? `${balanceEth} ETH` : "—"}
                </div>
              </div>
            </div>
            <button
              onClick={connectWallet}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60"
            >
              {account
                ? `Connected: ${account.slice(0, 6)}…${account.slice(-4)}`
                : "Connect wallet"}
            </button>
          </div>
        </header>

        {/* Error alert */}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-100">
            <div className="font-medium">Something went wrong</div>
            <p className="mt-1 text-xs text-rose-200/90">{error}</p>
          </div>
        )}

        {/* Main grid */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Left column: vault controls + status */}
          <div className="space-y-4">
            {/* Create / update */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Create / Update Vault
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Set who inherits and how long you can go silent before it
                    unlocks.
                  </p>
                </div>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                  Owner:{" "}
                  {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "—"}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="text-slate-400">Beneficiary address</label>
                  <input
                    className="rounded-lg px-3 py-2 bg-slate-950 border border-slate-800 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    value={beneficiary}
                    onChange={(e) => setBeneficiary(e.target.value)}
                    placeholder="0x… (second Hardhat account)"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-slate-400">Timeout (days)</label>
                  <input
                    className="rounded-lg px-3 py-2 bg-slate-950 border border-slate-800 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    value={timeoutDays}
                    onChange={(e) => setTimeoutDays(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-slate-400">Initial deposit (ETH)</label>
                  <input
                    className="rounded-lg px-3 py-2 bg-slate-950 border border-slate-800 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    value={depositEth}
                    onChange={(e) => setDepositEth(e.target.value)}
                  />
                </div>
              </div>

              <button
                onClick={handleCreateVault}
                disabled={loading || !account}
                className="mt-3 inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                {loading ? "Working…" : "Create / Replace vault"}
              </button>
            </section>

            {/* Vault status */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-100">
                  Vault Status
                </h2>
                {vault?.exists && (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                    Local dev · test ETH only
                  </span>
                )}
              </div>

              {!vault || !vault.exists ? (
                <p className="text-xs text-slate-400">
                  No vault found for this address. Create one above to see it
                  here.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-[11px]">
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-16">Owner</span>
                    <span
                      className="font-mono text-slate-100 break-all"
                      title={vault.owner}
                    >
                      {shortAddress(vault.owner)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-20">Beneficiary</span>
                    <span
                      className="font-mono text-slate-100 break-all"
                      title={vault.beneficiary}
                    >
                      {shortAddress(vault.beneficiary)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-16">Balance</span>
                    <span className="text-slate-100">
                      {formatEther(vault.balance)} ETH
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-20">Timeout</span>
                    <span className="text-slate-100">
                      {Number(vault.timeout) / (24 * 60 * 60)} days
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-16">Expired</span>
                    <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-100">
                      {vault.expired ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-20">Claimed</span>
                    <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-100">
                      {vault.claimed ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={handleHeartbeat}
                  disabled={loading || !account}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-40"
                >
                  Send heartbeat
                </button>
                <button
                  onClick={() => handleWithdraw("0.01")}
                  disabled={loading || !account}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-40"
                >
                  Withdraw 0.01 ETH
                </button>
                {vault && vault.expired && (
                  <button
                    onClick={() => handleClaim(vault.owner)}
                    disabled={loading || !account}
                    className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-xs font-medium disabled:opacity-40"
                  >
                    Claim as beneficiary
                  </button>
                )}
              </div>
            </section>
          </div>

          {/* Right column: risk + activity */}
          <div className="space-y-4">
            {/* Risk / time-to-expiry */}
            <section className={`${riskBaseClasses} ${riskStateClasses}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-slate-500 opacity-40" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-slate-200" />
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide">
                    Risk radar
                  </span>
                </div>
                {vault?.exists && (
                  <span className="text-[11px] text-slate-400">
                    Last heartbeat:{" "}
                    {Number(vault.lastHeartbeat) === 0
                      ? "never"
                      : new Date(
                          Number(vault.lastHeartbeat) * 1000,
                        ).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs">{expiryInfo.label}</p>
            </section>

            {/* Activity timeline (local only) */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-100">
                  Activity (local only)
                </h2>
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                  Dev console
                </span>
              </div>

              {activity.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">
                  No recent actions. Create a vault, send a heartbeat, or
                  withdraw to see history here.
                </p>
              ) : (
                <ol className="mt-3 space-y-2 text-xs">
                  {activity.map((item) => (
                    <li key={item.id} className="flex items-start gap-2">
                      <div
                        className={
                          "mt-0.5 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] " +
                          activityBadgeClasses(item.type)
                        }
                      >
                        {activityLabel(item.type)}
                      </div>
                      <div className="flex-1">
                        <div className="text-slate-300">
                          {item.meta || ""}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {item.timestamp.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {activity.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActivity([])}
                  className="mt-3 text-[11px] text-slate-500 hover:text-slate-300"
                >
                  Clear local history
                </button>
              )}

              <p className="mt-2 text-[10px] text-slate-500">
                This activity log lives only in this browser during this
                session. It&apos;s just for dev / UX.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
