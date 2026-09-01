import { Contract, EventLog, type Provider } from "ethers";

import { MORTAL_VAULT_ABI } from "./mortal-vault";

export type ConstellationStar = {
  owner: string;
  /** Deterministic position in the sky, 0..1 on both axes. */
  x: number;
  y: number;
  /** Unix timestamp of the last observed heartbeat, if any. */
  lastSeen: number | null;
  /** True when the star pulsed recently relative to chain time. */
  fresh: boolean;
};

export type Constellation = {
  stars: ConstellationStar[];
  scannedFrom: number;
  scannedTo: number;
  /** Chain time (latest block timestamp) at load. */
  now: number;
};

/** Heartbeats younger than this (in seconds) render as flaring stars. */
export const FRESH_WINDOW_SECONDS = 15 * 60;

const MAX_SCAN_BLOCKS = 30_000;
const CHUNK_BLOCKS = 5_000;

/**
 * Map an owner address to a stable spot in the sky. Two independent
 * accumulators keep x and y uncorrelated; the margin keeps stars off
 * the very edge of the viewport.
 */
export function starPosition(owner: string): { x: number; y: number } {
  const normalized = owner.toLowerCase();
  let a = 7;
  let b = 13;
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    a = (a * 31 + code) % 100_003;
    b = (b * 37 + code * 7) % 99_991;
  }
  const margin = 0.06;
  return {
    x: margin + (a / 100_003) * (1 - 2 * margin),
    y: margin + (b / 99_991) * (1 - 2 * margin),
  };
}

/** Pure assembly step, separated from the RPC scan so it can be tested. */
export function buildConstellation(
  createdOwners: string[],
  heartbeats: Array<{ owner: string; timestamp: number }>,
  now: number,
): ConstellationStar[] {
  const lastSeen = new Map<string, number>();
  for (const beat of heartbeats) {
    const key = beat.owner.toLowerCase();
    const previous = lastSeen.get(key);
    if (previous === undefined || beat.timestamp > previous) {
      lastSeen.set(key, beat.timestamp);
    }
  }

  const seen = new Set<string>();
  const stars: ConstellationStar[] = [];
  for (const owner of createdOwners) {
    const key = owner.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const beat = lastSeen.get(key) ?? null;
    stars.push({
      owner,
      ...starPosition(owner),
      lastSeen: beat,
      fresh: beat !== null && now - beat <= FRESH_WINDOW_SECONDS,
    });
  }
  return stars;
}

/**
 * Scan a bounded recent range of the chain for every vault and its latest
 * heartbeat. Read-only; requires no account.
 */
export async function loadConstellation(options: {
  provider: Provider;
  contractAddress: string;
  fromBlock?: number;
}): Promise<Constellation> {
  const { provider, contractAddress, fromBlock } = options;
  const latest = await provider.getBlockNumber();
  const latestBlock = await provider.getBlock(latest);
  const now = latestBlock ? Number(latestBlock.timestamp) : Math.floor(Date.now() / 1000);

  const lowest = Math.max(0, latest - MAX_SCAN_BLOCKS);
  const start = fromBlock === undefined ? Math.max(0, latest - CHUNK_BLOCKS) : Math.max(fromBlock, lowest);

  const contract = new Contract(contractAddress, MORTAL_VAULT_ABI, provider);
  const createdOwners: string[] = [];
  const heartbeats: Array<{ owner: string; timestamp: number }> = [];

  for (let from = start; from <= latest; from += CHUNK_BLOCKS + 1) {
    const to = Math.min(latest, from + CHUNK_BLOCKS);
    const [createdLogs, heartbeatLogs] = await Promise.all([
      contract.queryFilter(contract.filters.VaultCreated(), from, to),
      contract.queryFilter(contract.filters.Heartbeat(), from, to),
    ]);
    for (const log of createdLogs) {
      if (log instanceof EventLog) createdOwners.push(String(log.args[0]));
    }
    for (const log of heartbeatLogs) {
      if (log instanceof EventLog) {
        heartbeats.push({ owner: String(log.args[0]), timestamp: Number(log.args[1]) });
      }
    }
  }

  return {
    stars: buildConstellation(createdOwners, heartbeats, now),
    scannedFrom: start,
    scannedTo: latest,
    now,
  };
}
