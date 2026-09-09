import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLAIM_DELAY_DAYS,
  DEFAULT_INACTIVITY_DAYS,
  assessDurationRisk,
} from "./duration-policy";

describe("vault duration policy", () => {
  it("keeps the beta defaults clear of short-duration warnings", () => {
    expect(
      assessDurationRisk(DEFAULT_INACTIVITY_DAYS, DEFAULT_CLAIM_DELAY_DAYS),
    ).toEqual([]);
  });

  it("treats the warning thresholds as acceptable boundaries", () => {
    expect(assessDurationRisk("90", "30")).toEqual([]);
  });

  it("warns independently about short inactivity and claim periods", () => {
    expect(assessDurationRisk("30", "60").map((note) => note.id)).toEqual([
      "short-inactivity",
    ]);
    expect(assessDurationRisk("180", "7").map((note) => note.id)).toEqual([
      "short-claim-delay",
    ]);
    expect(assessDurationRisk("30", "7").map((note) => note.id)).toEqual([
      "short-inactivity",
      "short-claim-delay",
    ]);
  });

  it("does not replace input validation for empty or invalid values", () => {
    expect(assessDurationRisk("", "not-a-number")).toEqual([]);
    expect(assessDurationRisk("0", "-1")).toEqual([]);
  });
});
