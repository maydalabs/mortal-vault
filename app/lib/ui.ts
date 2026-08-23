import { getAddress, isAddress } from "ethers";

export function shortAddress(address: string | null | undefined): string {
  if (!address) return "-";
  if (!address.startsWith("0x") || address.length < 12) return address;
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

export function secondsFromDays(value: string, label: string): bigint {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`${label} must be a positive number of days.`);
  }
  const seconds = Math.round(days * 24 * 60 * 60);
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`${label} is too large.`);
  }
  return BigInt(seconds);
}

export function formatRemaining(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const days = Math.floor(safeSeconds / 86_400);
  const hours = Math.floor((safeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function buildClaimUrl(origin: string, owner: string, chainId: number): string {
  if (!isAddress(owner)) throw new Error("Cannot share an invalid owner address.");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Cannot share an invalid chain ID.");
  }

  const url = new URL(origin);
  url.search = "";
  url.hash = "";
  url.searchParams.set("owner", getAddress(owner));
  url.searchParams.set("chain", chainId.toString());
  return url.toString();
}

export function parseClaimSearch(search: string): {
  owner: string | null;
  chainId: number | null;
} {
  const params = new URLSearchParams(search);
  const ownerParam = params.get("owner");
  const chainParam = params.get("chain");
  const parsedChain = chainParam === null ? null : Number(chainParam);

  return {
    owner: ownerParam && isAddress(ownerParam) ? getAddress(ownerParam) : null,
    chainId:
      parsedChain !== null && Number.isSafeInteger(parsedChain) && parsedChain > 0
        ? parsedChain
        : null,
  };
}
