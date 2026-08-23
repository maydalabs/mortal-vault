import { describe, expect, it } from "vitest";
import {
  advanceMonitorCursor,
  claimDeliverableOutboxItems,
  createMonitorState,
  getMonitorKey,
  markOutboxDelivered,
  markOutboxFailed,
  parseMonitorState,
  planMonitorScan,
  putMonitorCursor,
  reconcileReminderOutbox,
  serializeMonitorState,
} from "./monitor-state";
import type { VaultReminder } from "./vault-reminders";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BENEFICIARY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const NOW = 1_700_000_000;

const identity = {
  chainId: 31_337,
  contractAddress: CONTRACT,
  deploymentBlock: 100,
};

function reminder(id: string, deliverAt = NOW): VaultReminder {
  return {
    id,
    kind: "owner-heartbeat-upcoming",
    audience: "owner",
    severity: "warning",
    title: "Heartbeat deadline approaching",
    message: "Check in.",
    chainId: identity.chainId,
    contractAddress: CONTRACT,
    vaultId: "create:0",
    owner: OWNER,
    beneficiary: BENEFICIARY,
    deliverAt,
  };
}

describe("monitor scan cursors", () => {
  it("starts at deployment and excludes unconfirmed blocks", () => {
    expect(
      planMonitorScan({ ...identity, latestBlock: 150, confirmations: 12 }),
    ).toEqual({
      fromBlock: 100,
      toBlock: 138,
      safeBlock: 138,
      reorgDetected: false,
    });
  });

  it("requires cursor anchor verification and continues from nextBlock", () => {
    const cursor = advanceMonitorCursor(identity, 138, HASH_A, NOW);

    expect(() =>
      planMonitorScan({ ...identity, latestBlock: 160, cursor }),
    ).toThrow("anchor hash must be verified");
    expect(
      planMonitorScan({
        ...identity,
        latestBlock: 160,
        cursor,
        observedAnchorHash: HASH_A,
      }),
    ).toMatchObject({ fromBlock: 139, toBlock: 148, reorgDetected: false });
  });

  it("rejects a cursor from another deployment", () => {
    const cursor = advanceMonitorCursor(identity, 138, HASH_A, NOW);

    expect(() =>
      planMonitorScan({
        ...identity,
        chainId: 1,
        latestBlock: 160,
        cursor,
        observedAnchorHash: HASH_A,
      }),
    ).toThrow("does not match this deployment");
  });

  it("rolls back a bounded range when the anchor hash changes", () => {
    const cursor = advanceMonitorCursor(identity, 200, HASH_A, NOW);

    expect(
      planMonitorScan({
        ...identity,
        latestBlock: 230,
        cursor,
        observedAnchorHash: HASH_B,
        confirmations: 12,
        reorgLookbackBlocks: 32,
      }),
    ).toEqual({
      fromBlock: 169,
      toBlock: 218,
      safeBlock: 218,
      reorgDetected: true,
    });
  });

  it("returns no range when the deployment is not finalized yet", () => {
    expect(
      planMonitorScan({ ...identity, latestBlock: 105, confirmations: 12 }),
    ).toEqual({
      fromBlock: 100,
      toBlock: null,
      safeBlock: 93,
      reorgDetected: false,
    });
  });

  it("stores cursors by normalized deployment identity", () => {
    const cursor = advanceMonitorCursor(identity, 120, HASH_A, NOW);
    const state = putMonitorCursor(createMonitorState(), cursor);

    expect(state.cursors[getMonitorKey(identity)]).toEqual(cursor);
  });
});

describe("reminder outbox", () => {
  it("deduplicates schedules and cancels stale pending reminders", () => {
    const first = reminder("first");
    const second = reminder("second", NOW + 100);
    const initial = reconcileReminderOutbox([], [first, second, first], NOW);
    const reconciled = reconcileReminderOutbox(initial, [second], NOW + 1);

    expect(initial).toHaveLength(2);
    expect(reconciled.find((item) => item.id === "first")?.status).toBe(
      "cancelled",
    );
    expect(reconciled.find((item) => item.id === "second")?.status).toBe(
      "pending",
    );
  });

  it("selects due items and records delivery exactly once", () => {
    const outbox = reconcileReminderOutbox(
      [],
      [reminder("due"), reminder("future", NOW + 100)],
      NOW,
    );
    const claim = claimDeliverableOutboxItems(outbox, NOW);
    const delivered = markOutboxDelivered(
      claim.outbox,
      claim.claimed[0].id,
      NOW + 1,
    );

    expect(claim.claimed.map((item) => item.id)).toEqual(["due"]);
    expect(claim.claimed[0]).toMatchObject({
      status: "processing",
      attempts: 1,
      leaseUntil: NOW + 60,
    });
    expect(delivered.find((item) => item.id === "due")).toMatchObject({
      status: "delivered",
      attempts: 1,
      deliveredAt: NOW + 1,
    });
    expect(markOutboxDelivered(delivered, "due", NOW + 2)).toEqual(delivered);
    expect(claimDeliverableOutboxItems(delivered, NOW + 60).claimed).toEqual([]);
  });

  it("applies capped exponential retry delays", () => {
    let outbox = reconcileReminderOutbox([], [reminder("retry")], NOW);
    outbox = claimDeliverableOutboxItems(outbox, NOW).outbox;
    outbox = markOutboxFailed(outbox, "retry", "provider unavailable", NOW);
    expect(outbox[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      nextAttemptAt: NOW + 60,
      lastError: "provider unavailable",
    });

    outbox = claimDeliverableOutboxItems(outbox, NOW + 60).outbox;
    outbox = markOutboxFailed(outbox, "retry", "still unavailable", NOW + 60);
    expect(outbox[0]).toMatchObject({
      attempts: 2,
      nextAttemptAt: NOW + 180,
    });
  });

  it("reclaims an expired processing lease without double-claiming", () => {
    const initial = reconcileReminderOutbox([], [reminder("leased")], NOW);
    const first = claimDeliverableOutboxItems(initial, NOW);
    const concurrent = claimDeliverableOutboxItems(first.outbox, NOW + 30);
    const reclaimed = claimDeliverableOutboxItems(first.outbox, NOW + 60);

    expect(concurrent.claimed).toEqual([]);
    expect(reclaimed.claimed[0]).toMatchObject({
      id: "leased",
      attempts: 2,
      leaseUntil: NOW + 120,
    });
  });

  it("clears a lease when a processing reminder becomes stale", () => {
    const initial = reconcileReminderOutbox([], [reminder("stale")], NOW);
    const processing = claimDeliverableOutboxItems(initial, NOW).outbox;
    const cancelled = reconcileReminderOutbox(processing, [], NOW + 1);

    expect(cancelled[0]).toMatchObject({ status: "cancelled" });
    expect(cancelled[0].leaseUntil).toBeUndefined();
  });

  it("round-trips JSON state and rejects invalid state", () => {
    const cursor = advanceMonitorCursor(identity, 120, HASH_A, NOW);
    const state = putMonitorCursor(createMonitorState(), cursor);
    state.outbox = reconcileReminderOutbox([], [reminder("persisted")], NOW);

    expect(parseMonitorState(serializeMonitorState(state))).toEqual(state);
    expect(() => parseMonitorState("not-json")).toThrow("not valid JSON");
    expect(() =>
      parseMonitorState(JSON.stringify({ ...state, version: 2 })),
    ).toThrow("does not match version 1");
    expect(() =>
      parseMonitorState(
        JSON.stringify({
          ...state,
          cursors: { wrong: cursor },
        }),
      ),
    ).toThrow("does not match version 1");
  });
});
