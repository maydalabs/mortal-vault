export type HealthNote = {
  id: string;
  severity: "warn" | "info";
  message: string;
};

const DAY = 86_400;

/**
 * Gentle co-pilot checks over the owner's plan. Pure heuristics — every
 * input is something the app already knows.
 */
export function assessVaultHealth(input: {
  timeoutSeconds: number;
  balance: bigint;
  maxVaultBalance: bigint | null;
  beneficiaryNonce: number | null;
  beneficiaryBalance: bigint | null;
  beneficiaryName: string;
  heartbeatTimestamps: number[];
}): HealthNote[] {
  const notes: HealthNote[] = [];

  if (input.beneficiaryNonce === 0 && input.beneficiaryBalance === BigInt(0)) {
    notes.push({
      id: "fresh-beneficiary",
      severity: "warn",
      message: `${input.beneficiaryName} has never been used on this network — triple-check the address before relying on it.`,
    });
  }

  const beats = [...input.heartbeatTimestamps].sort((a, b) => a - b);
  if (beats.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < beats.length; i++) gaps.push(beats[i] - beats[i - 1]);
    const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    if (average > input.timeoutSeconds * 0.5) {
      const averageDays = Math.round(average / DAY);
      const timeoutDays = Math.round(input.timeoutSeconds / DAY);
      notes.push({
        id: "tight-rhythm",
        severity: "warn",
        message: `Your check-ins average every ${averageDays} days against a ${timeoutDays}-day quiet period — a longer quiet period would give you more room.`,
      });
    }
  }

  if (input.maxVaultBalance !== null && input.maxVaultBalance > BigInt(0)) {
    const usedTenths = (input.balance * BigInt(10)) / input.maxVaultBalance;
    if (usedTenths >= BigInt(9)) {
      notes.push({
        id: "near-cap",
        severity: "info",
        message: "The vault is over 90% of its deposit cap — further deposits may be rejected.",
      });
    }
  }

  return notes;
}
