export const DEFAULT_INACTIVITY_DAYS = 180;
export const DEFAULT_CLAIM_DELAY_DAYS = 60;
export const SHORT_INACTIVITY_DAYS = 90;
export const SHORT_CLAIM_DELAY_DAYS = 30;

export type DurationRiskNote = {
  id: "short-inactivity" | "short-claim-delay";
  message: string;
};

function positiveDays(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function assessDurationRisk(
  inactivityDays: string | number,
  claimDelayDays: string | number,
): DurationRiskNote[] {
  const inactivity = positiveDays(inactivityDays);
  const claimDelay = positiveDays(claimDelayDays);
  const notes: DurationRiskNote[] = [];

  if (inactivity !== null && inactivity < SHORT_INACTIVITY_DAYS) {
    notes.push({
      id: "short-inactivity",
      message: `A quiet period under ${SHORT_INACTIVITY_DAYS} days can make travel, illness, or temporary wallet loss look like inactivity. The beta default is ${DEFAULT_INACTIVITY_DAYS} days.`,
    });
  }
  if (claimDelay !== null && claimDelay < SHORT_CLAIM_DELAY_DAYS) {
    notes.push({
      id: "short-claim-delay",
      message: `A claim countdown under ${SHORT_CLAIM_DELAY_DAYS} days leaves little time to notice and cancel a mistaken claim. The beta default is ${DEFAULT_CLAIM_DELAY_DAYS} days.`,
    });
  }

  return notes;
}
