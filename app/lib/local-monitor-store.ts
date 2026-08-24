import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getAddress } from "ethers";
import {
  createMonitorState,
  getMonitorKey,
  parseMonitorState,
  type MonitorIdentity,
  type MonitorState,
} from "./monitor-state.ts";
import {
  VAULT_EVENT_NAMES,
  type VaultActivity,
  type VaultEventName,
} from "./vault-events.ts";

export const LOCAL_MONITOR_STORE_VERSION = 1;

export type MonitorSubscriptionAudience = "owner" | "beneficiary" | "both";

export type MonitorSubscription = {
  id: string;
  chainId: number;
  contractAddress: string;
  owner: string;
  audience: MonitorSubscriptionAudience;
  createdAt: number;
};

export type StoredVaultActivity = Omit<
  VaultActivity,
  | "amount"
  | "newBalance"
  | "remainingBalance"
  | "timeout"
  | "claimDelay"
  | "recordedAt"
  | "executableAt"
> & {
  amount?: string;
  newBalance?: string;
  remainingBalance?: string;
  timeout?: string;
  claimDelay?: string;
  recordedAt?: string;
  executableAt?: string;
};

export type LocalMonitorState = {
  version: typeof LOCAL_MONITOR_STORE_VERSION;
  monitor: MonitorState;
  events: Record<string, StoredVaultActivity[]>;
  subscriptions: MonitorSubscription[];
};

export interface LocalMonitorStore {
  load(): Promise<LocalMonitorState>;
  save(state: LocalMonitorState): Promise<void>;
}

const bigintFields = [
  "amount",
  "newBalance",
  "remainingBalance",
  "timeout",
  "claimDelay",
  "recordedAt",
  "executableAt",
] as const;
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(`${label} must be a safe integer of at least ${minimum}.`);
  }
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte hash.`);
  }
  return value.toLowerCase();
}

function optionalAddress(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  try {
    return getAddress(String(value));
  } catch {
    throw new Error(`${label} must be a valid address.`);
  }
}

function optionalBigInt(value: unknown, label: string): bigint | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) {
    throw new Error(`${label} must be an unsigned decimal string.`);
  }
  const decoded = BigInt(value);
  if (decoded > MAX_UINT256) throw new Error(`${label} exceeds uint256.`);
  return decoded;
}

function requireActivityField<T>(
  value: T | undefined,
  eventName: VaultEventName,
  field: string,
): T {
  if (value === undefined) throw new Error(`${eventName} is missing ${field}.`);
  return value;
}

function validateActivityShape(activity: VaultActivity): void {
  switch (activity.eventName) {
    case "VaultCreated":
      requireActivityField(
        activity.beneficiary,
        activity.eventName,
        "beneficiary",
      );
      requireActivityField(activity.timeout, activity.eventName, "timeout");
      requireActivityField(activity.claimDelay, activity.eventName, "claimDelay");
      requireActivityField(activity.amount, activity.eventName, "amount");
      break;
    case "Deposited":
      requireActivityField(activity.amount, activity.eventName, "amount");
      requireActivityField(
        activity.newBalance,
        activity.eventName,
        "newBalance",
      );
      break;
    case "Heartbeat":
    case "ClaimCancelled":
      requireActivityField(activity.recordedAt, activity.eventName, "recordedAt");
      break;
    case "VaultUpdated":
      requireActivityField(
        activity.beneficiary,
        activity.eventName,
        "beneficiary",
      );
      requireActivityField(activity.timeout, activity.eventName, "timeout");
      requireActivityField(activity.claimDelay, activity.eventName, "claimDelay");
      break;
    case "Withdrawn":
      requireActivityField(activity.amount, activity.eventName, "amount");
      requireActivityField(
        activity.remainingBalance,
        activity.eventName,
        "remainingBalance",
      );
      break;
    case "ClaimRequested":
      requireActivityField(
        activity.beneficiary,
        activity.eventName,
        "beneficiary",
      );
      requireActivityField(activity.recordedAt, activity.eventName, "recordedAt");
      requireActivityField(
        activity.executableAt,
        activity.eventName,
        "executableAt",
      );
      break;
    case "Claimed":
      requireActivityField(
        activity.beneficiary,
        activity.eventName,
        "beneficiary",
      );
      requireActivityField(activity.recipient, activity.eventName, "recipient");
      requireActivityField(activity.amount, activity.eventName, "amount");
      break;
    case "VaultClosed":
      requireActivityField(activity.amount, activity.eventName, "amount");
      break;
  }
}

export function encodeVaultActivity(activity: VaultActivity): StoredVaultActivity {
  const stored = { ...activity } as StoredVaultActivity;
  for (const field of bigintFields) {
    const value = activity[field];
    if (value !== undefined) stored[field] = value.toString();
  }
  return stored;
}

export function decodeVaultActivity(value: unknown): VaultActivity {
  if (!isRecord(value)) {
    throw new Error("Stored vault activity must be an object.");
  }
  if (
    typeof value.eventName !== "string" ||
    !VAULT_EVENT_NAMES.includes(value.eventName as VaultEventName)
  ) {
    throw new Error("Stored vault activity has an unknown event name.");
  }
  const transactionHash = hash(value.transactionHash, "Transaction hash");
  const blockHash = hash(value.blockHash, "Block hash");
  const logIndex = safeInteger(value.logIndex, "Log index");
  const activity: VaultActivity = {
    id: `${transactionHash}:${logIndex}`,
    eventName: value.eventName as VaultEventName,
    owner: getAddress(String(value.owner)),
    transactionHash,
    blockHash,
    blockNumber: safeInteger(value.blockNumber, "Block number"),
    logIndex,
    blockTimestamp:
      value.blockTimestamp === null
        ? null
        : safeInteger(value.blockTimestamp, "Block timestamp"),
    beneficiary: optionalAddress(value.beneficiary, "Beneficiary"),
    recipient: optionalAddress(value.recipient, "Recipient"),
  };
  for (const field of bigintFields) {
    const decoded = optionalBigInt(value[field], field);
    if (decoded !== undefined) activity[field] = decoded;
  }
  if (value.id !== activity.id) {
    throw new Error("Stored vault activity ID does not match its log identity.");
  }
  validateActivityShape(activity);
  return activity;
}

function parseDeploymentKey(key: string): MonitorIdentity | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const chainId = Number(key.slice(0, separator));
  const contractAddress = key.slice(separator + 1);
  try {
    const identity = {
      chainId: safeInteger(chainId, "Chain ID", 1),
      contractAddress: getAddress(contractAddress),
      deploymentBlock: 0,
    };
    return getMonitorKey(identity) === key ? identity : null;
  } catch {
    return null;
  }
}

export function getSubscriptionId(
  identity: Pick<MonitorIdentity, "chainId" | "contractAddress">,
  owner: string,
  audience: MonitorSubscriptionAudience,
): string {
  return `${getMonitorKey(identity)}:${getAddress(owner)}:${audience}`;
}

function parseSubscription(value: unknown): MonitorSubscription {
  if (!isRecord(value)) throw new Error("Monitor subscription must be an object.");
  if (
    value.audience !== "owner" &&
    value.audience !== "beneficiary" &&
    value.audience !== "both"
  ) {
    throw new Error("Monitor subscription has an invalid audience.");
  }
  const subscription: MonitorSubscription = {
    id: String(value.id),
    chainId: safeInteger(value.chainId, "Subscription chain ID", 1),
    contractAddress: getAddress(String(value.contractAddress)),
    owner: getAddress(String(value.owner)),
    audience: value.audience,
    createdAt: safeInteger(value.createdAt, "Subscription timestamp", 1),
  };
  if (
    subscription.id !==
    getSubscriptionId(subscription, subscription.owner, subscription.audience)
  ) {
    throw new Error("Monitor subscription ID does not match its fields.");
  }
  return subscription;
}

export function createLocalMonitorState(): LocalMonitorState {
  return {
    version: LOCAL_MONITOR_STORE_VERSION,
    monitor: createMonitorState(),
    events: {},
    subscriptions: [],
  };
}

export function serializeLocalMonitorState(state: LocalMonitorState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function parseLocalMonitorState(serialized: string): LocalMonitorState {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Local monitor state is not valid JSON.");
  }
  if (
    !isRecord(value) ||
    value.version !== LOCAL_MONITOR_STORE_VERSION ||
    !isRecord(value.events) ||
    !Array.isArray(value.subscriptions)
  ) {
    throw new Error("Local monitor state does not match version 1.");
  }

  const monitor = parseMonitorState(JSON.stringify(value.monitor));

  const events: Record<string, StoredVaultActivity[]> = {};
  for (const [key, storedEvents] of Object.entries(value.events)) {
    if (!parseDeploymentKey(key) || !Array.isArray(storedEvents)) {
      throw new Error("Local monitor event storage has an invalid deployment.");
    }
    const decoded = storedEvents.map(decodeVaultActivity);
    if (new Set(decoded.map((item) => item.id)).size !== decoded.length) {
      throw new Error("Local monitor event storage contains duplicate logs.");
    }
    const cursor = monitor.cursors[key];
    if (
      cursor &&
      decoded.some(
        (item) =>
          item.blockNumber < cursor.deploymentBlock ||
          item.blockNumber > cursor.anchorBlock,
      )
    ) {
      throw new Error("Local monitor events exceed their finalized cursor.");
    }
    events[key] = decoded.map(encodeVaultActivity);
  }

  const subscriptions = value.subscriptions.map(parseSubscription);
  if (new Set(subscriptions.map((item) => item.id)).size !== subscriptions.length) {
    throw new Error("Local monitor state contains duplicate subscriptions.");
  }

  return {
    version: LOCAL_MONITOR_STORE_VERSION,
    monitor,
    events,
    subscriptions,
  };
}

export class JsonFileLocalMonitorStore implements LocalMonitorStore {
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  async load(): Promise<LocalMonitorState> {
    try {
      return parseLocalMonitorState(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createLocalMonitorState();
      }
      throw error;
    }
  }

  async save(state: LocalMonitorState): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    let handle;
    try {
      handle = await open(temporaryPath, "w", 0o600);
      await handle.writeFile(serializeLocalMonitorState(state), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await handle?.close();
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
