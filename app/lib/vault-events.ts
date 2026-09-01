import {
  Interface,
  formatEther,
  getAddress,
  zeroPadValue,
  type Filter,
  type Log,
} from "ethers";
import { MORTAL_VAULT_ABI } from "./mortal-vault.ts";

export const VAULT_EVENT_NAMES = [
  "VaultCreated",
  "Deposited",
  "Heartbeat",
  "VaultUpdated",
  "Withdrawn",
  "ClaimRequested",
  "ClaimCancelled",
  "Claimed",
  "VaultClosed",
] as const;

const BENEFICIARY_EVENT_NAMES = [
  "VaultCreated",
  "VaultUpdated",
  "ClaimRequested",
  "Claimed",
] as const;

export type VaultEventName = (typeof VAULT_EVENT_NAMES)[number];
export type VaultActivityRole = "owner" | "beneficiary";

export type VaultActivity = {
  id: string;
  eventName: VaultEventName;
  owner: string;
  beneficiary?: string;
  recipient?: string;
  amount?: bigint;
  newBalance?: bigint;
  remainingBalance?: bigint;
  timeout?: bigint;
  claimDelay?: bigint;
  recordedAt?: bigint;
  executableAt?: bigint;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  logIndex: number;
  blockTimestamp: number | null;
};

export type VaultActivityQueryResult = {
  items: VaultActivity[];
  fromBlock: number;
  toBlock: number;
  partial: boolean;
};

export type VaultEventProvider = {
  getBlockNumber(): Promise<number>;
  getLogs(filter: Filter): Promise<Log[]>;
  getBlock(
    blockNumber: number,
  ): Promise<{ timestamp: number; hash?: string | null } | null>;
};

export type LoadVaultActivityOptions = {
  provider: VaultEventProvider;
  contractAddress: string;
  role: VaultActivityRole;
  address: string;
  fromBlock?: number;
  toBlock?: number;
  blockRange?: number;
  fallbackLookbackBlocks?: number;
};

export type LoadVaultActivityRangeOptions = {
  provider: VaultEventProvider;
  contractAddress: string;
  fromBlock: number;
  toBlock: number;
  blockRange?: number;
};

export const DEFAULT_EVENT_BLOCK_RANGE = 5_000;
export const DEFAULT_EVENT_LOOKBACK_BLOCKS = 50_000;

const eventInterface = new Interface(MORTAL_VAULT_ABI);
const eventTopics = VAULT_EVENT_NAMES.map(
  (name) => eventInterface.getEvent(name)!.topicHash,
);
const beneficiaryEventTopics = BENEFICIARY_EVENT_NAMES.map(
  (name) => eventInterface.getEvent(name)!.topicHash,
);

function requireBlockNumber(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function requirePositiveBlockCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function getFilterTopics(role: VaultActivityRole, address: string): Filter["topics"] {
  const addressTopic = zeroPadValue(getAddress(address), 32);
  return role === "owner"
    ? [eventTopics, addressTopic]
    : [beneficiaryEventTopics, null, addressTopic];
}

async function readLogsInRanges(
  provider: VaultEventProvider,
  filter: Pick<Filter, "address" | "topics">,
  fromBlock: number,
  toBlock: number,
  blockRange: number,
): Promise<Log[]> {
  const logs: Log[] = [];

  for (let start = fromBlock; start <= toBlock; start += blockRange) {
    const end = Math.min(toBlock, start + blockRange - 1);
    try {
      logs.push(
        ...(await provider.getLogs({
          ...filter,
          fromBlock: start,
          toBlock: end,
        })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to read vault events for blocks ${start}-${end}: ${message}`,
      );
    }
  }

  return logs;
}

async function resolveBlockTimestamps(
  provider: VaultEventProvider,
  blockNumbers: number[],
): Promise<Map<number, number | null>> {
  const timestamps = new Map<number, number | null>();
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(4, blockNumbers.length) },
    async () => {
      while (cursor < blockNumbers.length) {
        const index = cursor;
        cursor += 1;
        const blockNumber = blockNumbers[index];
        try {
          const block = await provider.getBlock(blockNumber);
          timestamps.set(blockNumber, block?.timestamp ?? null);
        } catch {
          timestamps.set(blockNumber, null);
        }
      }
    },
  );

  await Promise.all(workers);
  return timestamps;
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  return BigInt(String(value));
}

export function parseVaultActivityLog(
  log: Log,
  blockTimestamp: number | null,
): VaultActivity | null {
  if (log.removed) return null;

  let parsed;
  try {
    parsed = eventInterface.parseLog({ topics: log.topics, data: log.data });
  } catch {
    return null;
  }
  if (!parsed || !VAULT_EVENT_NAMES.includes(parsed.name as VaultEventName)) {
    return null;
  }

  const eventName = parsed.name as VaultEventName;
  const activity: VaultActivity = {
    id: `${log.transactionHash}:${log.index}`,
    eventName,
    owner: getAddress(String(parsed.args.owner)),
    transactionHash: log.transactionHash,
    blockHash: log.blockHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    blockTimestamp,
  };

  switch (eventName) {
    case "VaultCreated":
      activity.beneficiary = getAddress(String(parsed.args.beneficiary));
      activity.timeout = asBigInt(parsed.args.timeout);
      activity.claimDelay = asBigInt(parsed.args.claimDelay);
      activity.amount = asBigInt(parsed.args.amount);
      break;
    case "Deposited":
      activity.amount = asBigInt(parsed.args.amount);
      activity.newBalance = asBigInt(parsed.args.newBalance);
      break;
    case "Heartbeat":
      activity.recordedAt = asBigInt(parsed.args.timestamp);
      break;
    case "VaultUpdated":
      activity.beneficiary = getAddress(String(parsed.args.beneficiary));
      activity.timeout = asBigInt(parsed.args.timeout);
      activity.claimDelay = asBigInt(parsed.args.claimDelay);
      break;
    case "Withdrawn":
      activity.amount = asBigInt(parsed.args.amount);
      activity.remainingBalance = asBigInt(parsed.args.remainingBalance);
      break;
    case "ClaimRequested":
      activity.beneficiary = getAddress(String(parsed.args.beneficiary));
      activity.recordedAt = asBigInt(parsed.args.requestedAt);
      activity.executableAt = asBigInt(parsed.args.executableAt);
      break;
    case "ClaimCancelled":
      activity.recordedAt = asBigInt(parsed.args.timestamp);
      break;
    case "Claimed":
      activity.beneficiary = getAddress(String(parsed.args.beneficiary));
      activity.recipient = getAddress(String(parsed.args.recipient));
      activity.amount = asBigInt(parsed.args.amount);
      break;
    case "VaultClosed":
      activity.amount = asBigInt(parsed.args.amount);
      break;
  }

  return activity;
}

async function decodeVaultActivityLogs(
  provider: VaultEventProvider,
  contractAddress: string,
  logs: Log[],
): Promise<VaultActivity[]> {
  const matchingLogs = logs.filter((log) => {
    try {
      return getAddress(log.address) === contractAddress;
    } catch {
      return false;
    }
  });
  const blockNumbers = [
    ...new Set(matchingLogs.map((log) => log.blockNumber)),
  ];
  const timestamps = await resolveBlockTimestamps(provider, blockNumbers);
  const uniqueActivities = new Map<string, VaultActivity>();

  for (const log of matchingLogs) {
    const activity = parseVaultActivityLog(
      log,
      timestamps.get(log.blockNumber) ?? null,
    );
    if (activity) uniqueActivities.set(activity.id, activity);
  }

  return [...uniqueActivities.values()].sort(
    (left, right) =>
      right.blockNumber - left.blockNumber || right.logIndex - left.logIndex,
  );
}

export async function loadVaultActivityRange({
  provider,
  contractAddress,
  fromBlock,
  toBlock,
  blockRange = DEFAULT_EVENT_BLOCK_RANGE,
}: LoadVaultActivityRangeOptions): Promise<VaultActivityQueryResult> {
  const normalizedContract = getAddress(contractAddress);
  const resolvedFromBlock = requireBlockNumber(fromBlock, "Start block");
  const resolvedToBlock = requireBlockNumber(toBlock, "End block");
  const resolvedRange = requirePositiveBlockCount(blockRange, "Block range");
  if (resolvedFromBlock > resolvedToBlock) {
    throw new Error("Start block cannot exceed end block.");
  }

  const logs = await readLogsInRanges(
    provider,
    { address: normalizedContract, topics: [eventTopics] },
    resolvedFromBlock,
    resolvedToBlock,
    resolvedRange,
  );

  return {
    items: await decodeVaultActivityLogs(provider, normalizedContract, logs),
    fromBlock: resolvedFromBlock,
    toBlock: resolvedToBlock,
    partial: false,
  };
}

export async function loadVaultActivity({
  provider,
  contractAddress,
  role,
  address,
  fromBlock,
  toBlock,
  blockRange = DEFAULT_EVENT_BLOCK_RANGE,
  fallbackLookbackBlocks = DEFAULT_EVENT_LOOKBACK_BLOCKS,
}: LoadVaultActivityOptions): Promise<VaultActivityQueryResult> {
  const normalizedContract = getAddress(contractAddress);
  const normalizedAddress = getAddress(address);
  const resolvedRange = requirePositiveBlockCount(blockRange, "Block range");
  const resolvedLookback = requirePositiveBlockCount(
    fallbackLookbackBlocks,
    "Fallback lookback",
  );
  const latestBlock = requireBlockNumber(
    toBlock ?? (await provider.getBlockNumber()),
    "Latest block",
  );
  const resolvedFromBlock = requireBlockNumber(
    fromBlock ?? Math.max(0, latestBlock - resolvedLookback + 1),
    "Deployment block",
  );

  if (resolvedFromBlock > latestBlock) {
    return {
      items: [],
      fromBlock: resolvedFromBlock,
      toBlock: latestBlock,
      partial: fromBlock === undefined && resolvedFromBlock > 0,
    };
  }

  const logs = await readLogsInRanges(
    provider,
    {
      address: normalizedContract,
      topics: getFilterTopics(role, normalizedAddress),
    },
    resolvedFromBlock,
    latestBlock,
    resolvedRange,
  );
  const items = (
    await decodeVaultActivityLogs(provider, normalizedContract, logs)
  ).filter((activity) =>
    role === "owner"
      ? activity.owner === normalizedAddress
      : activity.beneficiary === normalizedAddress,
  );

  return {
    items,
    fromBlock: resolvedFromBlock,
    toBlock: latestBlock,
    partial: fromBlock === undefined && resolvedFromBlock > 0,
  };
}

export function getVaultActivityLabel(
  activity: VaultActivity,
  symbol = "ETH",
): string {
  switch (activity.eventName) {
    case "VaultCreated":
      return `Vault created with ${formatEther(activity.amount!)} ${symbol}.`;
    case "Deposited":
      return `Deposited ${formatEther(activity.amount!)} ${symbol}; balance became ${formatEther(activity.newBalance!)}.`;
    case "Heartbeat":
      return "Owner heartbeat confirmed.";
    case "VaultUpdated":
      return "Beneficiary or timing configuration updated.";
    case "Withdrawn":
      return `Withdrew ${formatEther(activity.amount!)} ${symbol}; ${formatEther(activity.remainingBalance!)} remains.`;
    case "ClaimRequested":
      return "Beneficiary claim requested; challenge period started.";
    case "ClaimCancelled":
      return "Pending claim cancelled by owner activity.";
    case "Claimed":
      return `Claim executed for ${formatEther(activity.amount!)} ${symbol}.`;
    case "VaultClosed":
      return `Vault closed; ${formatEther(activity.amount!)} ${symbol} returned.`;
  }
}
