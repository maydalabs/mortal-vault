import { describe, expect, it } from "vitest";
import { Interface, type Filter, type Log } from "ethers";
import { MORTAL_VAULT_ABI } from "./mortal-vault";
import {
  createLocalMonitorState,
  parseLocalMonitorState,
  serializeLocalMonitorState,
  type LocalMonitorState,
  type LocalMonitorStore,
} from "./local-monitor-store";
import {
  FakeReminderDeliveryAdapter,
  runLocalMonitorOnce,
  type LocalMonitorProvider,
} from "./local-monitor-worker";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BENEFICIARY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const eventInterface = new Interface(MORTAL_VAULT_ABI);
const identity = {
  chainId: 31_337,
  contractAddress: CONTRACT,
  deploymentBlock: 100,
};

function hash(seed: number): string {
  return `0x${seed.toString(16).padStart(64, "0")}`;
}

function makeLog(
  eventName: string,
  values: readonly unknown[],
  blockNumber: number,
  index: number,
  transactionSeed: number,
  blockHash: string,
): Log {
  const encoded = eventInterface.encodeEventLog(
    eventInterface.getEvent(eventName)!,
    values,
  );
  return {
    address: CONTRACT,
    blockHash,
    blockNumber,
    data: encoded.data,
    index,
    removed: false,
    topics: encoded.topics,
    transactionHash: hash(transactionSeed),
    transactionIndex: 0,
  } as unknown as Log;
}

class MemoryMonitorStore implements LocalMonitorStore {
  state: LocalMonitorState = createLocalMonitorState();
  saves = 0;

  async load(): Promise<LocalMonitorState> {
    return parseLocalMonitorState(serializeLocalMonitorState(this.state));
  }

  async save(state: LocalMonitorState): Promise<void> {
    this.state = parseLocalMonitorState(serializeLocalMonitorState(state));
    this.saves += 1;
  }
}

class FakeMonitorProvider implements LocalMonitorProvider {
  readonly filters: Filter[] = [];
  latestBlock = 100;
  logs: Log[] = [];
  blocks = new Map<number, { timestamp: number; hash: string }>();

  async getBlockNumber(): Promise<number> {
    return this.latestBlock;
  }

  async getLogs(filter: Filter): Promise<Log[]> {
    this.filters.push(filter);
    const fromBlock = Number(filter.fromBlock);
    const toBlock = Number(filter.toBlock);
    return this.logs.filter(
      (item) => item.blockNumber >= fromBlock && item.blockNumber <= toBlock,
    );
  }

  async getBlock(
    blockNumber: number,
  ): Promise<{ timestamp: number; hash: string } | null> {
    return this.blocks.get(blockNumber) ?? null;
  }
}

function configureLifecycle(
  provider: FakeMonitorProvider,
  blockHash: string,
  timestamp: number,
  transactionSeed = 1,
): void {
  provider.blocks.set(100, { timestamp, hash: blockHash });
  provider.logs = [
    makeLog(
      "VaultCreated",
      [OWNER, BENEFICIARY, BigInt(86_400), BigInt(86_400), BigInt(100)],
      100,
      0,
      transactionSeed,
      blockHash,
    ),
    makeLog(
      "Heartbeat",
      [OWNER, BigInt(timestamp)],
      100,
      1,
      transactionSeed,
      blockHash,
    ),
  ];
}

describe("local monitor worker", () => {
  it("scans, persists, delivers, and stays idempotent on the next run", async () => {
    const provider = new FakeMonitorProvider();
    const store = new MemoryMonitorStore();
    const delivered: string[] = [];
    const timestamp = 1_700_000_000;
    configureLifecycle(provider, hash(100), timestamp);
    const adapter = new FakeReminderDeliveryAdapter({
      write: (line) => delivered.push(line),
    });

    const first = await runLocalMonitorOnce({
      provider,
      store,
      identity,
      subscriptions: [{ owner: OWNER, audience: "both" }],
      deliveryAdapter: adapter,
      confirmations: 0,
      now: timestamp + 86_401,
    });
    const second = await runLocalMonitorOnce({
      provider,
      store,
      identity,
      deliveryAdapter: adapter,
      confirmations: 0,
      now: timestamp + 86_401,
    });

    expect(first).toMatchObject({
      fromBlock: 100,
      toBlock: 100,
      eventsRead: 2,
      eventsStored: 2,
      remindersScheduled: 2,
      remindersClaimed: 2,
      delivered: 2,
      failed: 0,
    });
    expect(second).toMatchObject({
      fromBlock: 101,
      toBlock: null,
      eventsRead: 0,
      remindersClaimed: 0,
      delivered: 0,
    });
    expect(delivered).toHaveLength(2);
    expect(store.state.monitor.outbox.every((item) => item.status === "delivered"))
      .toBe(true);
    expect(store.state.monitor.cursors[`${identity.chainId}:${CONTRACT}`])
      .toMatchObject({ nextBlock: 101, anchorBlockHash: hash(100) });
  });

  it("filters reminders by subscription audience and retries fake failures", async () => {
    const provider = new FakeMonitorProvider();
    const store = new MemoryMonitorStore();
    const timestamp = 1_700_000_000;
    configureLifecycle(provider, hash(100), timestamp);
    const failing = new FakeReminderDeliveryAdapter({
      write: () => undefined,
      failKinds: ["owner-heartbeat-overdue"],
    });

    const first = await runLocalMonitorOnce({
      provider,
      store,
      identity,
      subscriptions: [{ owner: OWNER, audience: "owner" }],
      deliveryAdapter: failing,
      confirmations: 0,
      now: timestamp + 86_401,
    });
    const early = await runLocalMonitorOnce({
      provider,
      store,
      identity,
      deliveryAdapter: failing,
      confirmations: 0,
      now: timestamp + 86_430,
    });
    const recovered = await runLocalMonitorOnce({
      provider,
      store,
      identity,
      deliveryAdapter: new FakeReminderDeliveryAdapter({ write: () => undefined }),
      confirmations: 0,
      now: timestamp + 86_461,
    });

    expect(first).toMatchObject({
      remindersScheduled: 1,
      remindersClaimed: 1,
      failed: 1,
    });
    expect(early.remindersClaimed).toBe(0);
    expect(recovered).toMatchObject({ remindersClaimed: 1, delivered: 1 });
    expect(store.state.monitor.outbox[0]).toMatchObject({
      status: "delivered",
      attempts: 2,
    });
  });

  it("detects an anchor reorg and replaces canonical logs", async () => {
    const provider = new FakeMonitorProvider();
    const store = new MemoryMonitorStore();
    const timestamp = 1_700_000_000;
    configureLifecycle(provider, hash(100), timestamp, 1);
    await runLocalMonitorOnce({
      provider,
      store,
      identity,
      subscriptions: [{ owner: OWNER, audience: "both" }],
      confirmations: 0,
      now: timestamp,
    });
    const oldIds = store.state.events[`${identity.chainId}:${CONTRACT}`].map(
      (item) => item.id,
    );

    configureLifecycle(provider, hash(200), timestamp + 10, 2);
    const result = await runLocalMonitorOnce({
      provider,
      store,
      identity,
      confirmations: 0,
      reorgLookbackBlocks: 16,
      now: timestamp + 10,
    });
    const stored = store.state.events[`${identity.chainId}:${CONTRACT}`];

    expect(result).toMatchObject({
      reorgDetected: true,
      fromBlock: 100,
      toBlock: 100,
      eventsRead: 2,
    });
    expect(stored.every((item) => item.blockHash === hash(200))).toBe(true);
    expect(stored.map((item) => item.id)).not.toEqual(oldIds);
    expect(store.state.monitor.cursors[`${identity.chainId}:${CONTRACT}`]
      .anchorBlockHash).toBe(hash(200));
  });

  it("uses the finalized block timestamp as the reminder clock", async () => {
    const provider = new FakeMonitorProvider();
    const store = new MemoryMonitorStore();
    const timestamp = 1_700_000_000;
    configureLifecycle(provider, hash(100), timestamp);
    provider.latestBlock = 112;
    provider.blocks.set(112, {
      timestamp: timestamp + 200_000,
      hash: hash(112),
    });

    const result = await runLocalMonitorOnce({
      provider,
      store,
      identity,
      subscriptions: [{ owner: OWNER, audience: "both" }],
      confirmations: 12,
    });

    expect(result).toMatchObject({
      safeBlock: 100,
      chainTimestamp: timestamp,
      remindersScheduled: 3,
      remindersClaimed: 0,
    });
    expect(store.state.monitor.outbox.map((item) => item.reminder.kind)).toContain(
      "owner-heartbeat-upcoming",
    );
    expect(
      store.state.monitor.outbox.find(
        (item) => item.reminder.kind === "owner-heartbeat-overdue",
      )?.nextAttemptAt,
    ).toBe(timestamp + 86_401);
  });
});
