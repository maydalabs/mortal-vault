import { getAddress } from "ethers";
import {
  advanceMonitorCursor,
  claimDeliverableOutboxItems,
  getMonitorKey,
  markOutboxDelivered,
  markOutboxFailed,
  planMonitorScan,
  putMonitorCursor,
  reconcileReminderOutbox,
  type MonitorIdentity,
  type ReminderOutboxItem,
} from "./monitor-state.ts";
import {
  decodeVaultActivity,
  encodeVaultActivity,
  getSubscriptionId,
  type LocalMonitorState,
  type LocalMonitorStore,
  type MonitorSubscription,
  type MonitorSubscriptionAudience,
} from "./local-monitor-store.ts";
import {
  loadVaultActivityRange,
  type VaultActivity,
  type VaultEventProvider,
} from "./vault-events.ts";
import { projectVaultActivity } from "./vault-projection.ts";
import {
  scheduleVaultReminders,
  type VaultReminder,
} from "./vault-reminders.ts";

const MISSING_BLOCK_HASH = `0x${"0".repeat(64)}`;

export type LocalMonitorProvider = VaultEventProvider;

export type MonitorSubscriptionInput = {
  owner: string;
  audience: MonitorSubscriptionAudience;
};

export interface ReminderDeliveryAdapter {
  deliver(reminder: VaultReminder): Promise<void>;
}

export type RunLocalMonitorOptions = {
  provider: LocalMonitorProvider;
  store: LocalMonitorStore;
  identity: MonitorIdentity;
  subscriptions?: MonitorSubscriptionInput[];
  unsubscribeOwners?: string[];
  deliveryAdapter?: ReminderDeliveryAdapter;
  confirmations?: number;
  reorgLookbackBlocks?: number;
  blockRange?: number;
  now?: number;
  deliveryLimit?: number;
};

export type LocalMonitorRunSummary = {
  fromBlock: number;
  toBlock: number | null;
  safeBlock: number | null;
  chainTimestamp: number;
  reorgDetected: boolean;
  eventsRead: number;
  eventsStored: number;
  subscriptions: number;
  remindersScheduled: number;
  remindersClaimed: number;
  delivered: number;
  failed: number;
};

export type FakeReminderDeliveryOptions = {
  write?: (line: string) => void;
  failKinds?: VaultReminder["kind"][];
};

export class FakeReminderDeliveryAdapter implements ReminderDeliveryAdapter {
  private readonly write: (line: string) => void;
  private readonly failKinds: Set<VaultReminder["kind"]>;

  constructor(
    { write = console.log, failKinds = [] }: FakeReminderDeliveryOptions = {},
  ) {
    this.write = write;
    this.failKinds = new Set(failKinds);
  }

  async deliver(reminder: VaultReminder): Promise<void> {
    if (this.failKinds.has(reminder.kind)) {
      throw new Error(`Simulated ${reminder.kind} delivery failure.`);
    }
    this.write(
      JSON.stringify({
        type: "mortal-vault.reminder.preview",
        reminderId: reminder.id,
        kind: reminder.kind,
        audience: reminder.audience,
        title: reminder.title,
        message: reminder.message,
        chainId: reminder.chainId,
        contractAddress: reminder.contractAddress,
        owner: reminder.owner,
        beneficiary: reminder.beneficiary,
        deliverAt: reminder.deliverAt,
      }),
    );
  }
}

function normalizedIdentity(identity: MonitorIdentity): MonitorIdentity {
  return {
    ...identity,
    contractAddress: getAddress(identity.contractAddress),
  };
}

function matchesDeployment(
  item: Pick<VaultReminder, "chainId" | "contractAddress">,
  identity: MonitorIdentity,
): boolean {
  return (
    item.chainId === identity.chainId &&
    getAddress(item.contractAddress) === identity.contractAddress
  );
}

function mergeScopedOutbox(
  current: ReminderOutboxItem[],
  scoped: ReminderOutboxItem[],
  identity: MonitorIdentity,
): ReminderOutboxItem[] {
  return [
    ...current.filter(
      (item) => !matchesDeployment(item.reminder, identity),
    ),
    ...scoped,
  ].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

function updateSubscriptions(
  state: LocalMonitorState,
  identity: MonitorIdentity,
  additions: MonitorSubscriptionInput[],
  removals: string[],
  now: number,
): void {
  const removalSet = new Set(removals.map(getAddress));
  const additionsByOwner = new Map(
    additions.map((item) => [getAddress(item.owner), item.audience]),
  );
  state.subscriptions = state.subscriptions.filter(
    (item) =>
      !(
        item.chainId === identity.chainId &&
        item.contractAddress === identity.contractAddress &&
        (removalSet.has(item.owner) || additionsByOwner.has(item.owner))
      ),
  );

  for (const [owner, audience] of additionsByOwner) {
    const subscription: MonitorSubscription = {
      id: getSubscriptionId(identity, owner, audience),
      chainId: identity.chainId,
      contractAddress: identity.contractAddress,
      owner,
      audience,
      createdAt: now,
    };
    state.subscriptions.push(subscription);
  }
  state.subscriptions.sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalizeEvents(
  existing: VaultActivity[],
  replacement: VaultActivity[],
  replaceFromBlock: number,
): VaultActivity[] {
  const unique = new Map(
    existing
      .filter((item) => item.blockNumber < replaceFromBlock)
      .map((item) => [item.id, item]),
  );
  for (const activity of replacement) unique.set(activity.id, activity);
  return [...unique.values()].sort(
    (left, right) =>
      left.blockNumber - right.blockNumber || left.logIndex - right.logIndex,
  );
}

function remindersForSubscriptions(
  state: LocalMonitorState,
  identity: MonitorIdentity,
  events: VaultActivity[],
  now: number,
  historyComplete: boolean,
): VaultReminder[] {
  if (!historyComplete) return [];
  const reminders = new Map<string, VaultReminder>();
  const subscriptions = state.subscriptions.filter(
    (item) =>
      item.chainId === identity.chainId &&
      item.contractAddress === identity.contractAddress,
  );

  for (const subscription of subscriptions) {
    const projection = projectVaultActivity(
      events.filter((item) => item.owner === subscription.owner),
      { historyComplete: true },
    );
    if (!projection.complete || !projection.vault) continue;
    for (const reminder of scheduleVaultReminders(projection.vault, {
      chainId: identity.chainId,
      contractAddress: identity.contractAddress,
      now,
    })) {
      if (
        subscription.audience === "both" ||
        subscription.audience === reminder.audience
      ) {
        reminders.set(reminder.id, reminder);
      }
    }
  }

  return [...reminders.values()].sort(
    (left, right) =>
      left.deliverAt - right.deliverAt || left.id.localeCompare(right.id),
  );
}

function scopedOutbox(
  state: LocalMonitorState,
  identity: MonitorIdentity,
): ReminderOutboxItem[] {
  return state.monitor.outbox.filter((item) =>
    matchesDeployment(item.reminder, identity),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runLocalMonitorOnce({
  provider,
  store,
  identity: rawIdentity,
  subscriptions = [],
  unsubscribeOwners = [],
  deliveryAdapter,
  confirmations,
  reorgLookbackBlocks,
  blockRange,
  now,
  deliveryLimit = 25,
}: RunLocalMonitorOptions): Promise<LocalMonitorRunSummary> {
  const identity = normalizedIdentity(rawIdentity);
  const key = getMonitorKey(identity);
  const state = await store.load();
  const latestBlock = await provider.getBlockNumber();
  const latest = await provider.getBlock(latestBlock);
  if (!latest) throw new Error(`Latest block ${latestBlock} is unavailable.`);

  const cursor = state.monitor.cursors[key];
  const observedAnchorHash = cursor
    ? (await provider.getBlock(cursor.anchorBlock))?.hash ?? MISSING_BLOCK_HASH
    : undefined;
  const plan = planMonitorScan({
    ...identity,
    latestBlock,
    cursor,
    observedAnchorHash,
    confirmations,
    reorgLookbackBlocks,
  });
  const clockBlockNumber = plan.safeBlock ?? latestBlock;
  const clockBlock =
    clockBlockNumber === latestBlock
      ? latest
      : await provider.getBlock(clockBlockNumber);
  if (!clockBlock) {
    throw new Error(`Monitor clock block ${clockBlockNumber} is unavailable.`);
  }
  const chainTimestamp = now ?? clockBlock.timestamp;
  updateSubscriptions(
    state,
    identity,
    subscriptions,
    unsubscribeOwners,
    chainTimestamp,
  );
  let events = (state.events[key] ?? []).map(decodeVaultActivity);
  let eventsRead = 0;
  let historyComplete = Boolean(cursor);

  if (plan.toBlock !== null) {
    const result = await loadVaultActivityRange({
      provider,
      contractAddress: identity.contractAddress,
      fromBlock: plan.fromBlock,
      toBlock: plan.toBlock,
      blockRange,
    });
    eventsRead = result.items.length;
    events = canonicalizeEvents(events, result.items, plan.fromBlock);
    const anchor = await provider.getBlock(plan.toBlock);
    if (!anchor?.hash) {
      throw new Error(`Finalized anchor block ${plan.toBlock} is unavailable.`);
    }
    state.monitor = putMonitorCursor(
      state.monitor,
      advanceMonitorCursor(
        identity,
        plan.toBlock,
        anchor.hash,
        chainTimestamp,
      ),
    );
    historyComplete = true;
  } else if (plan.reorgDetected) {
    events = events.filter((item) => item.blockNumber < plan.fromBlock);
    delete state.monitor.cursors[key];
    historyComplete = false;
  }

  state.events[key] = events.map(encodeVaultActivity);
  const scheduled = remindersForSubscriptions(
    state,
    identity,
    events,
    chainTimestamp,
    historyComplete,
  );
  const reconciled = reconcileReminderOutbox(
    scopedOutbox(state, identity),
    scheduled,
    chainTimestamp,
  );
  state.monitor.outbox = mergeScopedOutbox(
    state.monitor.outbox,
    reconciled,
    identity,
  );
  await store.save(state);

  let remindersClaimed = 0;
  let delivered = 0;
  let failed = 0;
  if (deliveryAdapter) {
    const claim = claimDeliverableOutboxItems(
      scopedOutbox(state, identity),
      chainTimestamp,
      deliveryLimit,
    );
    remindersClaimed = claim.claimed.length;
    state.monitor.outbox = mergeScopedOutbox(
      state.monitor.outbox,
      claim.outbox,
      identity,
    );
    if (claim.claimed.length > 0) await store.save(state);

    for (const item of claim.claimed) {
      try {
        await deliveryAdapter.deliver(item.reminder);
        state.monitor.outbox = markOutboxDelivered(
          state.monitor.outbox,
          item.id,
          chainTimestamp,
        );
        delivered += 1;
      } catch (error) {
        state.monitor.outbox = markOutboxFailed(
          state.monitor.outbox,
          item.id,
          errorMessage(error),
          chainTimestamp,
        );
        failed += 1;
      }
      await store.save(state);
    }
  }

  return {
    ...plan,
    chainTimestamp,
    eventsRead,
    eventsStored: events.length,
    subscriptions: state.subscriptions.filter(
      (item) =>
        item.chainId === identity.chainId &&
        item.contractAddress === identity.contractAddress,
    ).length,
    remindersScheduled: scheduled.length,
    remindersClaimed,
    delivered,
    failed,
  };
}
