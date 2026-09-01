import { describe, expect, it } from "vitest";

import { buildVigil } from "./vigil";
import type { VaultActivity } from "./vault-events";

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DAY = 86_400;

function event(
  eventName: VaultActivity["eventName"],
  blockTimestamp: number | null,
): VaultActivity {
  return {
    id: `${eventName}-${blockTimestamp}`,
    eventName,
    owner: OWNER,
    beneficiary: undefined,
    blockNumber: 1,
    blockHash: "0xblock",
    blockTimestamp,
    transactionHash: "0xhash",
    logIndex: 0,
  } as VaultActivity;
}

describe("buildVigil", () => {
  const now = Date.UTC(2026, 10, 1) / 1000;

  it("counts the vigil and buckets marks by day", () => {
    const created = now - 62 * DAY;
    const vigil = buildVigil(
      [
        event("VaultCreated", created),
        event("Heartbeat", created),
        event("Heartbeat", now - 31 * DAY),
        event("ClaimRequested", now - 32 * DAY),
        event("ClaimCancelled", now - 31 * DAY),
        event("Deposited", now - DAY),
      ],
      now,
    );
    expect(vigil.stats.vigilDays).toBe(62);
    expect(vigil.stats.checkIns).toBe(2);
    expect(vigil.stats.deposits).toBe(2);
    expect(vigil.stats.claimsTurnedAway).toBe(1);
    expect(vigil.stats.partial).toBe(false);

    const days = vigil.weeks.flat();
    const scare = days.find((day) => day.marks.includes("claim"));
    expect(scare).toBeDefined();
    const saveDay = days.find((day) => day.marks.includes("saved"));
    expect(saveDay?.marks).toContain("checkin");
  });

  it("keeps weeks as full seven-day columns", () => {
    const vigil = buildVigil([event("VaultCreated", now - 10 * DAY)], now);
    for (const week of vigil.weeks) {
      expect(week).toHaveLength(7);
    }
  });

  it("flags missing creation and clamped windows as partial", () => {
    expect(buildVigil([event("Heartbeat", now - DAY)], now).stats.partial).toBe(true);
    const old = buildVigil([event("VaultCreated", now - 300 * DAY)], now, 4);
    expect(old.stats.partial).toBe(true);
    expect(old.weeks.length).toBeLessThanOrEqual(6);
  });

  it("ignores undated events", () => {
    const vigil = buildVigil([event("Heartbeat", null)], now);
    expect(vigil.stats.checkIns).toBe(0);
  });
});
