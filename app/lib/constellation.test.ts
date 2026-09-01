import { describe, expect, it } from "vitest";

import {
  FRESH_WINDOW_SECONDS,
  buildConstellation,
  starPosition,
} from "./constellation";

const OWNER_A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const OWNER_B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("starPosition", () => {
  it("is deterministic and case-insensitive", () => {
    expect(starPosition(OWNER_A)).toEqual(starPosition(OWNER_A.toLowerCase()));
  });

  it("keeps stars inside the sky with a margin", () => {
    for (const owner of [OWNER_A, OWNER_B, "0x0", "0x" + "f".repeat(40)]) {
      const { x, y } = starPosition(owner);
      expect(x).toBeGreaterThanOrEqual(0.06);
      expect(x).toBeLessThanOrEqual(0.94);
      expect(y).toBeGreaterThanOrEqual(0.06);
      expect(y).toBeLessThanOrEqual(0.94);
    }
  });

  it("separates different owners", () => {
    const a = starPosition(OWNER_A);
    const b = starPosition(OWNER_B);
    expect(a).not.toEqual(b);
  });
});

describe("buildConstellation", () => {
  it("keeps one star per owner with the latest heartbeat", () => {
    const now = 1_000_000;
    const stars = buildConstellation(
      [OWNER_A, OWNER_A, OWNER_B],
      [
        { owner: OWNER_A.toLowerCase(), timestamp: now - 30 },
        { owner: OWNER_A, timestamp: now - 90 },
      ],
      now,
    );
    expect(stars).toHaveLength(2);
    const starA = stars.find((star) => star.owner === OWNER_A);
    expect(starA?.lastSeen).toBe(now - 30);
    expect(starA?.fresh).toBe(true);
    const starB = stars.find((star) => star.owner === OWNER_B);
    expect(starB?.lastSeen).toBeNull();
    expect(starB?.fresh).toBe(false);
  });

  it("marks old heartbeats as not fresh", () => {
    const now = 1_000_000;
    const stars = buildConstellation(
      [OWNER_A],
      [{ owner: OWNER_A, timestamp: now - FRESH_WINDOW_SECONDS - 1 }],
      now,
    );
    expect(stars[0]?.fresh).toBe(false);
  });
});
