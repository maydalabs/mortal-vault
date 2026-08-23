import { describe, expect, it } from "vitest";
import type { ProjectedVault } from "./vault-projection";
import {
  isReminderDue,
  scheduleVaultReminders,
} from "./vault-reminders";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BENEFICIARY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const HEARTBEAT = 1_700_000_000;

function projectedVault(
  values: Partial<ProjectedVault> = {},
): ProjectedVault {
  return {
    id: "0xcreate:0",
    owner: OWNER,
    beneficiary: BENEFICIARY,
    timeout: BigInt(30 * 86_400),
    claimDelay: BigInt(7 * 86_400),
    lastHeartbeat: BigInt(HEARTBEAT),
    claimRequestedAt: null,
    claimExecutableAt: null,
    balance: BigInt(100),
    status: "active",
    createdAt: HEARTBEAT,
    lastEventBlock: 2,
    lastEventLogIndex: 0,
    ...values,
  };
}

function schedule(vault: ProjectedVault, now = HEARTBEAT) {
  return scheduleVaultReminders(vault, {
    chainId: 31_337,
    contractAddress: CONTRACT,
    now,
  });
}

describe("vault reminder scheduling", () => {
  it("schedules heartbeat notice and inactivity reminders deterministically", () => {
    const first = schedule(projectedVault());
    const second = schedule(projectedVault());
    const deadline = HEARTBEAT + 30 * 86_400;

    expect(first.map((item) => item.kind)).toEqual([
      "owner-heartbeat-upcoming",
      "owner-heartbeat-overdue",
      "beneficiary-claim-available",
    ]);
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first[0].deliverAt).toBe(deadline - 7 * 86_400);
    expect(first[1].deliverAt).toBe(deadline + 1);
    expect(first[2].deliverAt).toBe(deadline + 1);
  });

  it("drops the obsolete upcoming notice after inactivity", () => {
    const now = HEARTBEAT + 30 * 86_400 + 1;
    const reminders = schedule(projectedVault(), now);

    expect(reminders.map((item) => item.kind)).toEqual([
      "owner-heartbeat-overdue",
      "beneficiary-claim-available",
    ]);
    expect(reminders.every((item) => isReminderDue(item, now))).toBe(true);
  });

  it("schedules an immediate owner warning and beneficiary execution reminder", () => {
    const requestedAt = HEARTBEAT + 30 * 86_400 + 2;
    const executableAt = requestedAt + 7 * 86_400;
    const reminders = schedule(
      projectedVault({
        status: "claim-requested",
        claimRequestedAt: BigInt(requestedAt),
        claimExecutableAt: BigInt(executableAt),
      }),
      requestedAt,
    );

    expect(reminders.map((item) => [item.kind, item.deliverAt])).toEqual([
      ["owner-claim-challenge", requestedAt],
      ["beneficiary-claim-ready", executableAt],
    ]);
    expect(isReminderDue(reminders[0], requestedAt)).toBe(true);
    expect(isReminderDue(reminders[1], requestedAt)).toBe(false);
  });

  it("does not schedule reminders for terminal vaults", () => {
    expect(schedule(projectedVault({ status: "claimed" }))).toEqual([]);
    expect(schedule(projectedVault({ status: "closed" }))).toEqual([]);
  });

  it("refuses to schedule from an incomplete active projection", () => {
    expect(() =>
      schedule(projectedVault({ lastHeartbeat: null })),
    ).toThrow("missing its heartbeat");
  });
});
