import type { VaultActivity } from "./vault-events";

export type VigilMark = "checkin" | "deposit" | "withdraw" | "claim" | "saved";

export type VigilDay = {
  iso: string;
  marks: VigilMark[];
};

export type Vigil = {
  /** Columns of weeks, oldest first; each week is 7 days, Sunday first. */
  weeks: VigilDay[][];
  stats: {
    vigilDays: number | null;
    checkIns: number;
    deposits: number;
    claimsTurnedAway: number;
    /** True when the window was clamped or creation wasn't in range. */
    partial: boolean;
  };
};

const DAY = 86_400;

const MARK_BY_EVENT: Partial<Record<VaultActivity["eventName"], VigilMark>> = {
  Heartbeat: "checkin",
  VaultCreated: "deposit",
  Deposited: "deposit",
  Withdrawn: "withdraw",
  ClaimRequested: "claim",
  Claimed: "claim",
  ClaimCancelled: "saved",
};

const isoDay = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/**
 * Fold on-chain activity into a contribution-style calendar plus the
 * headline numbers of the owner's vigil.
 */
export function buildVigil(
  items: VaultActivity[],
  nowSeconds: number,
  maxWeeks = 26,
): Vigil {
  const dated = items.filter(
    (item): item is VaultActivity & { blockTimestamp: number } =>
      item.blockTimestamp !== null,
  );

  const created = dated
    .filter((item) => item.eventName === "VaultCreated")
    .reduce<number | null>(
      (earliest, item) =>
        earliest === null ? item.blockTimestamp : Math.min(earliest, item.blockTimestamp),
      null,
    );

  const stats = {
    vigilDays: created === null ? null : Math.max(0, Math.floor((nowSeconds - created) / DAY)),
    checkIns: dated.filter((item) => item.eventName === "Heartbeat").length,
    deposits: dated.filter(
      (item) => item.eventName === "Deposited" || item.eventName === "VaultCreated",
    ).length,
    claimsTurnedAway: dated.filter((item) => item.eventName === "ClaimCancelled").length,
    partial: created === null,
  };

  const windowStart = nowSeconds - maxWeeks * 7 * DAY;
  const start = created === null ? windowStart : Math.max(created, windowStart);
  if (created !== null && created < windowStart) stats.partial = true;

  const marksByDay = new Map<string, Set<VigilMark>>();
  for (const item of dated) {
    const mark = MARK_BY_EVENT[item.eventName];
    if (!mark || item.blockTimestamp < start) continue;
    const key = isoDay(item.blockTimestamp);
    const set = marksByDay.get(key) ?? new Set<VigilMark>();
    set.add(mark);
    marksByDay.set(key, set);
  }

  // Align the grid to the Sunday on or before the start.
  const startDate = new Date(start * 1000);
  startDate.setUTCHours(0, 0, 0, 0);
  startDate.setUTCDate(startDate.getUTCDate() - startDate.getUTCDay());

  const weeks: VigilDay[][] = [];
  const cursor = new Date(startDate);
  const end = new Date(nowSeconds * 1000);
  while (cursor.getTime() <= end.getTime()) {
    const week: VigilDay[] = [];
    for (let day = 0; day < 7; day++) {
      const iso = cursor.toISOString().slice(0, 10);
      week.push({
        iso,
        marks:
          cursor.getTime() <= end.getTime()
            ? Array.from(marksByDay.get(iso) ?? [])
            : [],
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }

  return { weeks, stats };
}
