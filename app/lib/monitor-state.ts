import { getAddress } from "ethers";
import type { VaultReminder } from "./vault-reminders";

export const MONITOR_STATE_VERSION = 1;
export const DEFAULT_MONITOR_CONFIRMATIONS = 12;
export const DEFAULT_REORG_LOOKBACK_BLOCKS = 128;
export const DEFAULT_OUTBOX_RETRY_SECONDS = 60;
export const MAX_OUTBOX_RETRY_SECONDS = 3_600;
export const DEFAULT_OUTBOX_LEASE_SECONDS = 60;

export type MonitorIdentity = {
  chainId: number;
  contractAddress: string;
  deploymentBlock: number;
};

export type MonitorCursor = MonitorIdentity & {
  nextBlock: number;
  anchorBlock: number;
  anchorBlockHash: string;
  updatedAt: number;
};

export type MonitorScanPlan = {
  fromBlock: number;
  toBlock: number | null;
  safeBlock: number | null;
  reorgDetected: boolean;
};

export type PlanMonitorScanOptions = MonitorIdentity & {
  latestBlock: number;
  cursor?: MonitorCursor;
  observedAnchorHash?: string;
  confirmations?: number;
  reorgLookbackBlocks?: number;
};

export type ReminderOutboxStatus =
  | "pending"
  | "processing"
  | "failed"
  | "delivered"
  | "cancelled";

export type ReminderOutboxItem = {
  id: string;
  reminder: VaultReminder;
  status: ReminderOutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  deliveredAt?: number;
  lastError?: string;
  leaseUntil?: number;
};

export type ClaimedReminderOutbox = {
  outbox: ReminderOutboxItem[];
  claimed: ReminderOutboxItem[];
};

export type MonitorState = {
  version: typeof MONITOR_STATE_VERSION;
  cursors: Record<string, MonitorCursor>;
  outbox: ReminderOutboxItem[];
};

function safeInteger(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer of at least ${minimum}.`);
  }
  return value;
}

function blockHash(value: string, label: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte block hash.`);
  }
  return value.toLowerCase();
}

function normalizeIdentity(identity: MonitorIdentity): MonitorIdentity {
  return {
    chainId: safeInteger(identity.chainId, "Chain ID", 1),
    contractAddress: getAddress(identity.contractAddress),
    deploymentBlock: safeInteger(identity.deploymentBlock, "Deployment block"),
  };
}

function assertCursorIdentity(
  cursor: MonitorCursor,
  identity: MonitorIdentity,
): void {
  if (
    cursor.chainId !== identity.chainId ||
    getAddress(cursor.contractAddress) !== identity.contractAddress ||
    cursor.deploymentBlock !== identity.deploymentBlock
  ) {
    throw new Error("Monitor cursor does not match this deployment.");
  }
}

export function getMonitorKey(
  identity: Pick<MonitorIdentity, "chainId" | "contractAddress">,
): string {
  return `${safeInteger(identity.chainId, "Chain ID", 1)}:${getAddress(identity.contractAddress)}`;
}

export function planMonitorScan({
  latestBlock,
  cursor,
  observedAnchorHash,
  confirmations = DEFAULT_MONITOR_CONFIRMATIONS,
  reorgLookbackBlocks = DEFAULT_REORG_LOOKBACK_BLOCKS,
  ...rawIdentity
}: PlanMonitorScanOptions): MonitorScanPlan {
  const identity = normalizeIdentity(rawIdentity);
  const latest = safeInteger(latestBlock, "Latest block");
  const confirmationCount = safeInteger(confirmations, "Confirmations");
  const rollback = safeInteger(reorgLookbackBlocks, "Reorg lookback", 1);
  const safeBlock = latest >= confirmationCount ? latest - confirmationCount : null;

  if (cursor) {
    assertCursorIdentity(cursor, identity);
    safeInteger(cursor.nextBlock, "Cursor next block");
    safeInteger(cursor.anchorBlock, "Cursor anchor block");
    blockHash(cursor.anchorBlockHash, "Cursor anchor hash");
    if (!observedAnchorHash) {
      throw new Error("The cursor anchor hash must be verified before scanning.");
    }
  }

  const reorgDetected = Boolean(
    cursor &&
      blockHash(observedAnchorHash!, "Observed anchor hash") !==
        blockHash(cursor.anchorBlockHash, "Cursor anchor hash"),
  );
  const fromBlock = reorgDetected
    ? Math.max(
        identity.deploymentBlock,
        cursor!.anchorBlock - rollback + 1,
      )
    : cursor?.nextBlock ?? identity.deploymentBlock;

  return {
    fromBlock,
    toBlock:
      safeBlock === null || safeBlock < fromBlock ? null : safeBlock,
    safeBlock,
    reorgDetected,
  };
}

export function advanceMonitorCursor(
  identity: MonitorIdentity,
  processedThrough: number,
  processedBlockHash: string,
  updatedAt: number,
): MonitorCursor {
  const normalized = normalizeIdentity(identity);
  const anchorBlock = safeInteger(processedThrough, "Processed block");
  if (anchorBlock < normalized.deploymentBlock) {
    throw new Error("Processed block cannot precede the deployment block.");
  }

  return {
    ...normalized,
    nextBlock: safeInteger(anchorBlock + 1, "Next block"),
    anchorBlock,
    anchorBlockHash: blockHash(processedBlockHash, "Processed block hash"),
    updatedAt: safeInteger(updatedAt, "Cursor update timestamp", 1),
  };
}

export function createMonitorState(): MonitorState {
  return { version: MONITOR_STATE_VERSION, cursors: {}, outbox: [] };
}

export function putMonitorCursor(
  state: MonitorState,
  cursor: MonitorCursor,
): MonitorState {
  return {
    ...state,
    cursors: {
      ...state.cursors,
      [getMonitorKey(cursor)]: cursor,
    },
  };
}

export function reconcileReminderOutbox(
  current: ReminderOutboxItem[],
  reminders: VaultReminder[],
  now: number,
): ReminderOutboxItem[] {
  const timestamp = safeInteger(now, "Outbox timestamp", 1);
  const scheduled = new Map(reminders.map((item) => [item.id, item]));
  const reconciled: ReminderOutboxItem[] = [];

  for (const item of current) {
    const nextReminder = scheduled.get(item.id);
    if (!nextReminder) {
      reconciled.push(
        item.status === "pending" ||
          item.status === "processing" ||
          item.status === "failed"
          ? {
              ...item,
              status: "cancelled",
              updatedAt: timestamp,
              leaseUntil: undefined,
            }
          : item,
      );
      continue;
    }

    scheduled.delete(item.id);
    if (item.status === "delivered") {
      reconciled.push(item);
      continue;
    }
    if (item.status === "cancelled") {
      reconciled.push({
        ...item,
        reminder: nextReminder,
        status: "pending",
        nextAttemptAt: Math.max(timestamp, nextReminder.deliverAt),
        updatedAt: timestamp,
        lastError: undefined,
        leaseUntil: undefined,
      });
      continue;
    }
    reconciled.push({ ...item, reminder: nextReminder, updatedAt: timestamp });
  }

  for (const reminderItem of scheduled.values()) {
    reconciled.push({
      id: reminderItem.id,
      reminder: reminderItem,
      status: "pending",
      attempts: 0,
      nextAttemptAt: Math.max(timestamp, reminderItem.deliverAt),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  return reconciled.sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

export function claimDeliverableOutboxItems(
  outbox: ReminderOutboxItem[],
  now: number,
  limit = 25,
  leaseSeconds = DEFAULT_OUTBOX_LEASE_SECONDS,
): ClaimedReminderOutbox {
  const timestamp = safeInteger(now, "Delivery timestamp", 1);
  const deliveryLimit = safeInteger(limit, "Delivery limit", 1);
  const lease = safeInteger(leaseSeconds, "Delivery lease", 1);
  const candidateIds = new Set(
    outbox
      .filter(
        (item) =>
          ((item.status === "pending" || item.status === "failed") &&
            item.nextAttemptAt <= timestamp) ||
          (item.status === "processing" &&
            item.leaseUntil !== undefined &&
            item.leaseUntil <= timestamp),
      )
      .sort(
        (left, right) =>
          left.nextAttemptAt - right.nextAttemptAt ||
          left.id.localeCompare(right.id),
      )
      .slice(0, deliveryLimit)
      .map((item) => item.id),
  );
  const nextOutbox = outbox.map((item) =>
    candidateIds.has(item.id)
      ? {
          ...item,
          status: "processing" as const,
          attempts: item.attempts + 1,
          leaseUntil: safeInteger(timestamp + lease, "Lease expiration"),
          updatedAt: timestamp,
        }
      : item,
  );
  return {
    outbox: nextOutbox,
    claimed: nextOutbox.filter((item) => candidateIds.has(item.id)),
  };
}

export function markOutboxDelivered(
  outbox: ReminderOutboxItem[],
  id: string,
  deliveredAt: number,
): ReminderOutboxItem[] {
  const timestamp = safeInteger(deliveredAt, "Delivery timestamp", 1);
  let found = false;
  const next = outbox.map((item) => {
    if (item.id !== id) return item;
    found = true;
    if (item.status === "delivered") return item;
    if (item.status !== "processing") {
      throw new Error(`Outbox item is not processing: ${id}`);
    }
    return {
      ...item,
      status: "delivered" as const,
      deliveredAt: timestamp,
      updatedAt: timestamp,
      lastError: undefined,
      leaseUntil: undefined,
    };
  });
  if (!found) throw new Error(`Outbox item not found: ${id}`);
  return next;
}

export function markOutboxFailed(
  outbox: ReminderOutboxItem[],
  id: string,
  error: string,
  failedAt: number,
): ReminderOutboxItem[] {
  const timestamp = safeInteger(failedAt, "Failure timestamp", 1);
  let found = false;
  const next = outbox.map((item) => {
    if (item.id !== id) return item;
    found = true;
    if (item.status === "delivered") return item;
    if (item.status !== "processing") {
      throw new Error(`Outbox item is not processing: ${id}`);
    }
    const retrySeconds = Math.min(
      DEFAULT_OUTBOX_RETRY_SECONDS * 2 ** (item.attempts - 1),
      MAX_OUTBOX_RETRY_SECONDS,
    );
    return {
      ...item,
      status: "failed" as const,
      nextAttemptAt: safeInteger(timestamp + retrySeconds, "Next retry"),
      updatedAt: timestamp,
      deliveredAt: undefined,
      lastError: error.slice(0, 500),
      leaseUntil: undefined,
    };
  });
  if (!found) throw new Error(`Outbox item not found: ${id}`);
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCursor(value: unknown): value is MonitorCursor {
  if (!isRecord(value)) return false;
  try {
    const identity = normalizeIdentity({
      chainId: Number(value.chainId),
      contractAddress: String(value.contractAddress),
      deploymentBlock: Number(value.deploymentBlock),
    });
    return (
      identity.chainId === value.chainId &&
      identity.contractAddress === value.contractAddress &&
      identity.deploymentBlock === value.deploymentBlock &&
      Number.isSafeInteger(value.nextBlock) &&
      Number(value.nextBlock) === Number(value.anchorBlock) + 1 &&
      Number.isSafeInteger(value.anchorBlock) &&
      Number(value.anchorBlock) >= identity.deploymentBlock &&
      blockHash(String(value.anchorBlockHash), "Cursor anchor hash") ===
        value.anchorBlockHash &&
      Number.isSafeInteger(value.updatedAt) &&
      Number(value.updatedAt) > 0
    );
  } catch {
    return false;
  }
}

function isReminder(value: unknown): value is VaultReminder {
  if (!isRecord(value)) return false;
  const kinds = [
    "owner-heartbeat-upcoming",
    "owner-heartbeat-overdue",
    "beneficiary-claim-available",
    "owner-claim-challenge",
    "beneficiary-claim-ready",
  ];
  try {
    return (
      typeof value.id === "string" &&
      value.id.length > 0 &&
      typeof value.kind === "string" &&
      kinds.includes(value.kind) &&
      (value.audience === "owner" || value.audience === "beneficiary") &&
      (value.severity === "info" ||
        value.severity === "warning" ||
        value.severity === "urgent") &&
      typeof value.title === "string" &&
      typeof value.message === "string" &&
      Number.isSafeInteger(value.chainId) &&
      Number(value.chainId) > 0 &&
      getAddress(String(value.contractAddress)) === value.contractAddress &&
      typeof value.vaultId === "string" &&
      getAddress(String(value.owner)) === value.owner &&
      getAddress(String(value.beneficiary)) === value.beneficiary &&
      Number.isSafeInteger(value.deliverAt) &&
      Number(value.deliverAt) > 0
    );
  } catch {
    return false;
  }
}

function isOutboxItem(value: unknown): value is ReminderOutboxItem {
  if (!isRecord(value) || !isReminder(value.reminder)) return false;
  return (
    value.id === value.reminder.id &&
    (value.status === "pending" ||
      value.status === "processing" ||
      value.status === "failed" ||
      value.status === "delivered" ||
      value.status === "cancelled") &&
    Number.isSafeInteger(value.attempts) &&
    Number(value.attempts) >= 0 &&
    Number.isSafeInteger(value.nextAttemptAt) &&
    Number.isSafeInteger(value.createdAt) &&
    Number.isSafeInteger(value.updatedAt) &&
    (value.deliveredAt === undefined || Number.isSafeInteger(value.deliveredAt)) &&
    (value.lastError === undefined || typeof value.lastError === "string") &&
    (value.status === "processing"
      ? Number.isSafeInteger(value.leaseUntil)
      : value.leaseUntil === undefined)
  );
}

export function serializeMonitorState(state: MonitorState): string {
  return JSON.stringify(state, null, 2);
}

export function parseMonitorState(serialized: string): MonitorState {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Monitor state is not valid JSON.");
  }
  if (
    !isRecord(value) ||
    value.version !== MONITOR_STATE_VERSION ||
    !isRecord(value.cursors) ||
    !Array.isArray(value.outbox) ||
    !Object.entries(value.cursors).every(
      ([key, cursor]) => isCursor(cursor) && getMonitorKey(cursor) === key,
    ) ||
    !value.outbox.every(isOutboxItem)
  ) {
    throw new Error("Monitor state does not match version 1.");
  }
  return value as MonitorState;
}
