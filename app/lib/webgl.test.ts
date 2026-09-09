import { afterEach, describe, expect, it, vi } from "vitest";

import { tryCreateRenderer } from "./webgl";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tryCreateRenderer", () => {
  it("returns whatever the factory built when WebGL is available", () => {
    const renderer = { domElement: "canvas" };
    expect(tryCreateRenderer(() => renderer)).toBe(renderer);
  });

  it("returns null instead of throwing when the context cannot be created", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // three.js throws exactly this when the browser refuses a context.
    const result = tryCreateRenderer(() => {
      throw new Error("THREE.WebGLRenderer: Error creating WebGL context.");
    });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("swallows a non-Error throw too", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      tryCreateRenderer(() => {
        throw "no context";
      }),
    ).toBeNull();
  });

  it("does not disguise a null the factory itself returned", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(tryCreateRenderer(() => null)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
