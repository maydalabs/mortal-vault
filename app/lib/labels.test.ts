import { describe, expect, it } from "vitest";

import { readLabel, readLabels, writeLabel } from "./labels";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("address labels", () => {
  it("returns nothing without storage", () => {
    expect(readLabels(null)).toEqual({});
    expect(readLabel(null, "0xAb")).toBeNull();
  });

  it("round-trips a label case-insensitively", () => {
    const storage = fakeStorage();
    writeLabel(storage, "0xABCD", "Deniz");
    expect(readLabel(storage, "0xabcd")).toBe("Deniz");
    expect(readLabel(storage, "0xABCD")).toBe("Deniz");
  });

  it("removes a label when set to blank", () => {
    const storage = fakeStorage();
    writeLabel(storage, "0xabcd", "Deniz");
    writeLabel(storage, "0xABCD", "   ");
    expect(readLabel(storage, "0xabcd")).toBeNull();
  });

  it("trims and caps stored labels", () => {
    const storage = fakeStorage();
    writeLabel(storage, "0x1", `  ${"x".repeat(60)}  `);
    expect(readLabel(storage, "0x1")).toBe("x".repeat(40));
  });

  it("ignores corrupted storage payloads", () => {
    expect(readLabels(fakeStorage({ "mortal-vault-labels-v1": "not json" }))).toEqual({});
    expect(readLabels(fakeStorage({ "mortal-vault-labels-v1": "[1,2]" }))).toEqual({});
    expect(
      readLabels(fakeStorage({ "mortal-vault-labels-v1": '{"0xa":7,"0xb":"ok"}' })),
    ).toEqual({ "0xb": "ok" });
  });
});
