import { describe, expect, it } from "vitest";

import { assessVaultHealth } from "./health";

const DAY = 86_400;

const ETHER = BigInt("1000000000000000000");

const base = {
  timeoutSeconds: 30 * DAY,
  balance: BigInt(5) * ETHER,
  maxVaultBalance: BigInt(1000) * ETHER,
  beneficiaryNonce: 12,
  beneficiaryBalance: ETHER,
  beneficiaryName: "Deniz",
  heartbeatTimestamps: [0, 5 * DAY, 10 * DAY, 15 * DAY],
};

describe("assessVaultHealth", () => {
  it("stays quiet for a healthy vault", () => {
    expect(assessVaultHealth(base)).toEqual([]);
  });

  it("warns about a never-used beneficiary address", () => {
    const notes = assessVaultHealth({ ...base, beneficiaryNonce: 0, beneficiaryBalance: BigInt(0) });
    expect(notes.map((note) => note.id)).toContain("fresh-beneficiary");
    expect(notes[0].message).toContain("Deniz");
  });

  it("warns when check-in rhythm crowds the quiet period", () => {
    const notes = assessVaultHealth({
      ...base,
      heartbeatTimestamps: [0, 31 * DAY, 62 * DAY],
    });
    expect(notes.map((note) => note.id)).toContain("tight-rhythm");
  });

  it("needs at least three heartbeats before judging rhythm", () => {
    const notes = assessVaultHealth({ ...base, heartbeatTimestamps: [0, 40 * DAY] });
    expect(notes).toEqual([]);
  });

  it("notes cap proximity", () => {
    const notes = assessVaultHealth({ ...base, balance: BigInt(950) * ETHER });
    expect(notes.map((note) => note.id)).toContain("near-cap");
  });
});
