import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MonitorLockedError,
  STALE_LOCK_MS,
  acquireMonitorLock,
} from "./monitor-lock";

let directory: string;
let statePath: string;
let lockPath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mortal-vault-lock-"));
  statePath = join(directory, "state.json");
  lockPath = `${statePath}.lock`;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("acquireMonitorLock", () => {
  it("takes the lock and releases it", async () => {
    const release = await acquireMonitorLock(statePath);

    const held = JSON.parse(await readFile(lockPath, "utf8"));
    expect(held.pid).toBe(process.pid);
    expect(typeof held.acquiredAt).toBe("number");

    await release();
    await expect(readFile(lockPath, "utf8")).rejects.toThrow();
  });

  it("refuses a second holder while the first is running", async () => {
    const release = await acquireMonitorLock(statePath);

    // This process is demonstrably alive, so its lock must be respected.
    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(
      MonitorLockedError,
    );
    await expect(acquireMonitorLock(statePath)).rejects.toThrow(
      /Another monitor is using this state file/,
    );

    await release();
    // Once released, the next worker gets it.
    await (await acquireMonitorLock(statePath))();
  });

  it("takes over a lock whose owner is gone", async () => {
    // PID 2^22 is above the usual maximum, so nothing holds it.
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 4_194_304, acquiredAt: Date.now() }),
      "utf8",
    );

    const release = await acquireMonitorLock(statePath);
    const held = JSON.parse(await readFile(lockPath, "utf8"));
    expect(held.pid).toBe(process.pid);
    await release();
  });

  it("takes over a lock that is simply too old", async () => {
    // Alive, but holding far longer than any scan should take: a machine must
    // not be blocked forever by one wedged process.
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: Date.now() - STALE_LOCK_MS - 1 }),
      "utf8",
    );

    const release = await acquireMonitorLock(statePath);
    expect(JSON.parse(await readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await release();
  });

  it("does not take over a fresh lock held by a live process", async () => {
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
      "utf8",
    );
    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(
      MonitorLockedError,
    );
  });

  it("refuses an unreadable lock rather than assuming it is safe to take", async () => {
    await writeFile(lockPath, "not json at all", "utf8");
    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(
      MonitorLockedError,
    );
  });

  it("releases only once, even if called again", async () => {
    const release = await acquireMonitorLock(statePath);
    await release();

    // A second worker may now hold it; a stale release must not delete theirs.
    const second = await acquireMonitorLock(statePath);
    await release();
    expect(JSON.parse(await readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await second();
  });
});
