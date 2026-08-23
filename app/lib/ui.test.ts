import { describe, expect, it } from "vitest";
import {
  buildClaimUrl,
  formatRemaining,
  parseClaimSearch,
  secondsFromDays,
  shortAddress,
} from "./ui";

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("claim links", () => {
  it("round-trips owner and chain parameters", () => {
    const url = buildClaimUrl("https://vault.example/claim", OWNER, 84532);
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/claim");
    expect(parseClaimSearch(parsed.search)).toEqual({
      owner: OWNER,
      chainId: 84532,
    });
  });

  it("ignores malformed query values", () => {
    expect(parseClaimSearch("?owner=nope&chain=-1")).toEqual({
      owner: null,
      chainId: null,
    });
  });
});

describe("display and input helpers", () => {
  it("converts valid day values to seconds", () => {
    expect(secondsFromDays("1.5", "Timeout")).toBe(BigInt(129_600));
    expect(() => secondsFromDays("0", "Timeout")).toThrow("positive");
  });

  it("formats durations and addresses", () => {
    expect(formatRemaining(90_000)).toBe("1d 1h");
    expect(formatRemaining(3_660)).toBe("1h 1m");
    expect(shortAddress(OWNER)).toBe("0xf39Fd6...2266");
  });
});
