"use client";

import { useEffect, useState } from "react";
import {
  BrowserProvider,
  Contract,
  formatEther,
  parseEther,
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

export default function Home() {
  const [account, setAccount] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultView | null>(null);
  const [beneficiary, setBeneficiary] = useState("");
  const [timeoutDays, setTimeoutDays] = useState("30");
  const [depositEth, setDepositEth] = useState("0.1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getProviderAndSigner() {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      throw new Error("No injected wallet. Install MetaMask.");
    }
    const provider = new BrowserProvider((window as any).ethereum);
    const signer = await provider.getSigner();
    return { provider, signer };
  }

  async function connectWallet() {
    try {
      setError(null);
      if (!(window as any).ethereum) {
        throw new Error("Install MetaMask first.");
      }

      await (window as any).ethereum.request({
        method: "eth_requestAccounts",
      });

      const { signer } = await getProviderAndSigner();
      const addr = await signer.getAddress();
      setAccount(addr);
      await loadVault(addr);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? "Failed to connect wallet.");
    }
  }

  async function loadVault(addr?: string) {
    try {
      setError(null);
      const { provider, signer } = await getProviderAndSigner();
      const address = addr ?? (await signer.getAddress());

      const contract = new Contract(
        VAULT_ADDRESS,
        VAULT_ABI,
        provider,
      );

      const result = await contract.getVault(address);

      const [
        owner,
        beneficiary,
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

      setVault({
        owner,
        beneficiary,
        timeout,
        lastHeartbeat,
        balance,
        exists,
        claimed,
        expired,
      });
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? "Failed to load vault.");
    }
  }

  async function handleCreateVault() {
    try {
      setLoading(true);
      setError(null);

      const { signer } = await getProviderAndSigner();
      const contract = new Contract(
        VAULT_ADDRESS,
        VAULT_ABI,
        signer,
      );

      const timeoutSeconds =
        Number(timeoutDays || "0") * 24 * 60 * 60;
      const value = parseEther(depositEth || "0");

      const tx = await contract.createVault(beneficiary, timeoutSeconds, {
        value,
      });
      await tx.wait();

      const addr = await signer.getAddress();
      setAccount(addr);
      await loadVault(addr);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? "Failed to create vault.");
    } finally {
      setLoading(false);
    }
  }

  async function handleHeartbeat() {
    try {
      setLoading(true);
      setError(null);
      const { signer } = await getProviderAndSigner();
      const contract = new Contract(
        VAULT_ADDRESS,
        VAULT_ABI,
        signer,
      );
      const tx = await contract.heartbeat();
      await tx.wait();
      const addr = await signer.getAddress();
      await loadVault(addr);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? "Failed to send heartbeat.");
    } finally {
      setLoading(false);
    }
  }

  async function handleWithdraw(amountEth: string) {
    try {
      setLoading(true);
      setError(null);
      const { signer } = await getProviderAndSigner();
      const contract = new Contract(
        VAULT_ADDRESS,
        VAULT_ABI,
        signer,
      );
      const amount = parseEther(amountEth);
      const tx = await contract.withdraw(amount);
      await tx.wait();
      const addr = await signer.getAddress();
      await loadVault(addr);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? "Failed to withdraw.");
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim(ownerAddr: string) {
    try {
      setLoading(true);
      setError(null);
      const { signer } = await getProviderAndSigner();
      const contract = new Contract(
        VAULT_ADDRESS,
        VAULT_ABI,
        signer,
      );
      const tx = await contract.claim(ownerAddr);
      await tx.wait();
      await loadVault(ownerAddr);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? "Failed to claim.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        if (!(window as any).ethereum) return;
        const accounts = await (window as any).ethereum.request({
          method: "eth_accounts",
        });
        if (accounts && accounts.length > 0) {
          setAccount(accounts[0]);
          await loadVault(accounts[0]);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl border border-slate-800 rounded-2xl bg-slate-900/70 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            Mortal Vault – Local Dev Playground
          </h1>
          <button
            onClick={connectWallet}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60"
          >
            {account ? `Connected: ${account.slice(0, 6)}…${account.slice(-4)}` : "Connect Wallet"}
          </button>
        </div>

        {error && (
          <div className="text-sm text-rose-400 border border-rose-500/40 bg-rose-950/40 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <section className="border border-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-200">
            Create / Update Vault
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <label className="text-slate-400">Beneficiary address</label>
              <input
                className="rounded-lg px-3 py-2 bg-slate-950 border border-slate-800 text-xs"
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                placeholder="0x..."
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-slate-400">Timeout (days)</label>
              <input
                className="rounded-lg px-3 py-2 bg-slate-950 border border-slate-800 text-xs"
                value={timeoutDays}
                onChange={(e) => setTimeoutDays(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-slate-400">Initial deposit (ETH)</label>
              <input
                className="rounded-lg px-3 py-2 bg-slate-950 border border-slate-800 text-xs"
                value={depositEth}
                onChange={(e) => setDepositEth(e.target.value)}
              />
            </div>
          </div>
          <button
            onClick={handleCreateVault}
            disabled={loading || !account}
            className="mt-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Working..." : "Create / Replace Vault"}
          </button>
        </section>

        <section className="border border-slate-800 rounded-xl p-4 space-y-3 text-sm">
          <h2 className="text-sm font-semibold text-slate-200">
            Vault Status
          </h2>
          {!vault || !vault.exists ? (
            <p className="text-slate-400 text-sm">
              No vault found for this address.
            </p>
          ) : (
            <div className="space-y-1">
              <p>
                <span className="text-slate-400">Beneficiary:</span>{" "}
                {vault.beneficiary}
              </p>
              <p>
                <span className="text-slate-400">Balance:</span>{" "}
                {formatEther(vault.balance)} ETH
              </p>
              <p>
                <span className="text-slate-400">Timeout:</span>{" "}
                {Number(vault.timeout) / (24 * 60 * 60)} days
              </p>
              <p>
                <span className="text-slate-400">Expired:</span>{" "}
                {vault.expired ? "Yes" : "No"}
              </p>
              <p>
                <span className="text-slate-400">Claimed:</span>{" "}
                {vault.claimed ? "Yes" : "No"}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-2">
            <button
              onClick={handleHeartbeat}
              disabled={loading || !account}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700"
            >
              Send heartbeat
            </button>
            <button
              onClick={() => handleWithdraw("0.01")}
              disabled={loading || !account}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700"
            >
              Withdraw 0.01 ETH
            </button>
            {vault && vault.expired && (
              <button
                onClick={() => handleClaim(vault.owner)}
                disabled={loading || !account}
                className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600"
              >
                Claim as beneficiary
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
