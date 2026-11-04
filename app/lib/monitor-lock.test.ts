import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JsonFileLocalMonitorStore, createLocalMonitorState } from "./local-monitor-store";
import { MonitorLockedError, acquireMonitorLock } from "./monitor-lock";

const filesystemGate = vi.hoisted(() => ({
  beforeUnlink: undefined as undefined | ((path: unknown) => Promise<void>),
}));

// Keep real files; pause only unlink in the race test so both contenders
// identify the same abandoned marker before either can remove it.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
      await filesystemGate.beforeUnlink?.(path);
      return actual.unlink(path);
    },
  };
});

// Keep the mocked probe distinct from the real owner, regardless of its PID.
const FIXTURE_PID = process.pid === 654_321 ? 654_322 : 654_321;
const NOW = 1_800_000_000_000;
const realKill = process.kill.bind(process);
let directory: string;
let statePath: string;
let lockPath: string;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function probeFailsWith(code?: string) {
  return vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid !== FIXTURE_PID) return realKill(pid, signal);
    expect(signal).toBe(0);
    throw Object.assign(new Error("Fixture process probe failed"), { code });
  });
}

async function writeOwnerFixture(
  contents: unknown = { pid: FIXTURE_PID, acquiredAt: NOW, host: hostname() },
) {
  await mkdir(lockPath, { mode: 0o700 });
  const markerPath = join(lockPath, `owner-${randomUUID()}.json`);
  await writeFile(markerPath, JSON.stringify(contents), { mode: 0o600 });
  return markerPath;
}

async function readOwner() {
  const entries = await readdir(lockPath);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/^owner-[0-9a-f-]{36}\.json$/);
  const markerPath = join(lockPath, entries[0]);
  const bytes = await readFile(markerPath, "utf8");
  return { markerPath, bytes, contents: JSON.parse(bytes) };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mortal-vault-lock-"));
  statePath = join(directory, "state.json");
  lockPath = `${statePath}.lock`;
});

afterEach(async () => {
  filesystemGate.beforeUnlink = undefined;
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("acquireMonitorLock", () => {
  it("takes a private lock with a unique owner marker and releases it", async () => {
    const release = await acquireMonitorLock(statePath, () => NOW);
    const held = await readOwner();

    expect(held.contents).toEqual({ pid: process.pid, acquiredAt: NOW, host: hostname() });
    expect((await stat(lockPath)).mode & 0o777).toBe(0o700);
    expect((await stat(held.markerPath)).mode & 0o777).toBe(0o600);

    await release();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("starts with missing nested directories before the state store is loaded or saved", async () => {
    statePath = join(directory, "nested", ".monitor", "state.json");
    lockPath = `${statePath}.lock`;
    const release = await acquireMonitorLock(statePath);
    const held = await readOwner();
    const store = new JsonFileLocalMonitorStore(statePath);
    const state = createLocalMonitorState();

    expect(await store.load()).toEqual(state);
    await store.save(state);
    expect((await stat(lockPath)).mode & 0o777).toBe(0o700);
    expect((await stat(held.markerPath)).mode & 0o777).toBe(0o600);
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);

    await release();
    expect(await store.load()).toEqual(state);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual(state);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a second holder while the first is running", async () => {
    const release = await acquireMonitorLock(statePath);
    const held = await readOwner();

    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
    await expect(acquireMonitorLock(statePath)).rejects.toThrow(/Another monitor is using this state file/);
    expect(await readOwner()).toEqual(held);

    await release();
    await (await acquireMonitorLock(statePath))();
  });

  it("refuses an old lock while its owner is still alive", async () => {
    const release = await acquireMonitorLock(statePath, () => NOW - 60 * 60 * 1000);
    const held = await readOwner();

    await expect(acquireMonitorLock(statePath, () => NOW)).rejects.toBeInstanceOf(MonitorLockedError);
    expect(await readOwner()).toEqual(held);
    await release();
  });

  it("takes over a same-host lock only when its owner probe reports ESRCH", async () => {
    const probe = probeFailsWith("ESRCH");
    const abandonedMarker = await writeOwnerFixture();
    const release = await acquireMonitorLock(statePath, () => NOW);
    const held = await readOwner();

    expect(probe).toHaveBeenCalledWith(FIXTURE_PID, 0);
    expect(held.markerPath).not.toBe(abandonedMarker);
    expect(held.contents).toEqual({ pid: process.pid, acquiredAt: NOW, host: hostname() });
    await expect(stat(abandonedMarker)).rejects.toMatchObject({ code: "ENOENT" });
    await release();
  });

  it.each(["EPERM", "EACCES", "EINVAL", undefined])(
    "preserves ownership when the process probe fails with %s instead of ESRCH",
    async (code) => {
      probeFailsWith(code);
      await writeOwnerFixture();
      const held = await readOwner();

      await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
      expect(await readOwner()).toEqual(held);
    },
  );

  it("does not use local PID liveness to reclaim a foreign host's lock", async () => {
    const probe = probeFailsWith("ESRCH");
    await writeOwnerFixture({ pid: FIXTURE_PID, acquiredAt: 0, host: `${hostname()}-other` });
    const held = await readOwner();

    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
    expect(probe).not.toHaveBeenCalled();
    expect(await readOwner()).toEqual(held);
  });

  it("preserves a legacy regular lock file", async () => {
    const bytes = JSON.stringify({ pid: FIXTURE_PID, acquiredAt: 0 });
    await writeFile(lockPath, bytes, { mode: 0o600 });
    const probe = probeFailsWith("ESRCH");

    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
    expect(probe).not.toHaveBeenCalled();
    expect(await readFile(lockPath, "utf8")).toBe(bytes);
    expect((await stat(lockPath)).isFile()).toBe(true);
  });

  it("preserves an empty lock directory rather than assuming it is abandoned", async () => {
    await mkdir(lockPath);

    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
    expect(await readdir(lockPath)).toEqual([]);
  });

  it("preserves an unreadable owner marker", async () => {
    const markerPath = await writeOwnerFixture();
    await writeFile(markerPath, "not json at all");

    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
    expect(await readdir(lockPath)).toEqual([markerPath.slice(lockPath.length + 1)]);
    expect(await readFile(markerPath, "utf8")).toBe("not json at all");
  });

  it.each([
    { pid: 0, acquiredAt: NOW, host: hostname() },
    { pid: FIXTURE_PID, acquiredAt: "yesterday", host: hostname() },
    { pid: FIXTURE_PID, acquiredAt: NOW },
  ])("preserves malformed owner metadata %j", async (contents) => {
    const probe = probeFailsWith("ESRCH");
    await writeOwnerFixture(contents);
    const held = await readOwner();

    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
    expect(probe).not.toHaveBeenCalled();
    expect(await readOwner()).toEqual(held);
  });

  it("preserves a lock directory with multiple owner markers", async () => {
    const firstMarker = await writeOwnerFixture();
    const secondMarker = join(lockPath, `owner-${randomUUID()}.json`);
    const bytes = await readFile(firstMarker, "utf8");
    await writeFile(secondMarker, bytes);
    const entries = (await readdir(lockPath)).sort();

    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
    expect((await readdir(lockPath)).sort()).toEqual(entries);
    expect(await readFile(firstMarker, "utf8")).toBe(bytes);
    expect(await readFile(secondMarker, "utf8")).toBe(bytes);
  });

  it("preserves a non-file owner marker", async () => {
    await mkdir(lockPath);
    const markerPath = join(lockPath, `owner-${randomUUID()}.json`);
    await mkdir(markerPath);

    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
    expect((await stat(markerPath)).isDirectory()).toBe(true);
  });

  it("does not let a displaced holder's first release remove its replacement", async () => {
    const releaseFirst = await acquireMonitorLock(statePath, () => NOW);
    const first = await readOwner();
    // Model an external replacement before the original holder releases.
    await rm(lockPath, { recursive: true });
    const releaseSecond = await acquireMonitorLock(statePath, () => NOW);
    const second = await readOwner();
    expect(second.contents).toEqual(first.contents);
    expect(second.markerPath).not.toBe(first.markerPath);

    await releaseFirst();
    expect(await readOwner()).toEqual(second);
    await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
    await releaseSecond();
  });

  it("allows only one contender to reclaim the same dead owner's marker", async () => {
    probeFailsWith("ESRCH");
    const abandonedMarker = await writeOwnerFixture();
    const firstReached = deferred();
    const secondReached = deferred();
    const allowFirst = deferred();
    const allowSecond = deferred();
    let unlinkCalls = 0;
    filesystemGate.beforeUnlink = async (path) => {
      if (path !== abandonedMarker) return;
      unlinkCalls += 1;
      if (unlinkCalls === 1) {
        firstReached.resolve();
        await allowFirst.promise;
      } else if (unlinkCalls === 2) {
        secondReached.resolve();
        await allowSecond.promise;
      }
    };

    const firstAttempt = acquireMonitorLock(statePath);
    await firstReached.promise;
    const secondAttempt = acquireMonitorLock(statePath);
    const secondOutcome = secondAttempt.then(
      (release) => ({ release, error: undefined }),
      (error: unknown) => ({ release: undefined, error }),
    );
    await secondReached.promise;
    let releaseFirst: (() => Promise<void>) | undefined;
    try {
      allowFirst.resolve();
      releaseFirst = await firstAttempt;
      const held = await readOwner();
      allowSecond.resolve();
      const result = await secondOutcome;
      try {
        expect(result.error).toBeInstanceOf(MonitorLockedError);
        expect(result.release).toBeUndefined();
        expect(unlinkCalls).toBe(2);
        expect(await readOwner()).toEqual(held);
        await expect(acquireMonitorLock(statePath)).rejects.toBeInstanceOf(MonitorLockedError);
      } finally {
        await result.release?.();
      }
    } finally {
      allowFirst.resolve();
      allowSecond.resolve();
      filesystemGate.beforeUnlink = undefined;
      await releaseFirst?.();
    }
    await (await acquireMonitorLock(statePath))();
  });

  it("releases only once, even if called again", async () => {
    const release = await acquireMonitorLock(statePath);
    await release();
    const second = await acquireMonitorLock(statePath);
    const held = await readOwner();

    await release();
    expect(await readOwner()).toEqual(held);
    await second();
  });
});
