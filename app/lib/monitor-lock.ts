import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rmdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * A single-writer lock for the monitor state file.
 *
 * `load` is a plain read and `save` is an atomic rename, with nothing between
 * them. Two workers on one state file therefore interleave as: A loads, B
 * loads, A saves, B saves — and B's write, built on the state it read before
 * A's, silently discards A's advanced cursor and delivered marks. The visible
 * result is a reminder sent twice, or a cursor rewound so events are scanned
 * again. Neither reports an error.
 *
 * The CLI takes one contract per invocation and defaults every invocation to
 * the same state file, so watching two deployments means exactly this.
 */

export type LockContents = {
  pid: number;
  acquiredAt: number;
  host: string;
};

type LockOwner = {
  filename: string;
  contents: LockContents;
};

const OWNER_FILENAME =
  /^owner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

export class MonitorLockedError extends Error {
  // Plain fields, not constructor parameter properties: the CLI runs under
  // Node's strip-only TypeScript, which cannot emit the assignments those
  // imply. Vitest's full transform accepts them, so the unit tests passed
  // while the real command failed to load the module at all.
  readonly lockPath: string;
  readonly holder: LockContents | null;

  constructor(lockPath: string, holder: LockContents | null) {
    const held = holder
      ? `held by process ${holder.pid} on ${holder.host} since ${new Date(holder.acquiredAt).toISOString()}`
      : "ownership is unknown or the lock is incomplete";
    super(
      `Another monitor is using this state file (${held}).\n` +
        `Before manually removing ${lockPath}, stop and verify every monitor using this state file.\n` +
        "To watch a second deployment, give it its own --state-file.",
    );
    this.name = "MonitorLockedError";
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

function ownerHasExited(holder: LockContents): boolean {
  // A PID on another host says nothing about whether that worker is alive.
  if (holder.host !== hostname()) return false;
  try {
    // Signal 0 performs the permission and existence checks without delivering.
    process.kill(holder.pid, 0);
    return false;
  } catch (error) {
    // Permission errors and unknown failures are not evidence of process death.
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function readLockOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    // Legacy plain-file locks and partially written locks require inspection;
    // never guess that an unknown owner is dead.
    if (!(await lstat(lockPath)).isDirectory()) return null;
    const entries = await readdir(lockPath, { withFileTypes: true });
    if (
      entries.length !== 1 ||
      !entries[0].isFile() ||
      !OWNER_FILENAME.test(entries[0].name)
    ) {
      return null;
    }

    const filename = entries[0].name;
    const parsed: unknown = JSON.parse(
      await readFile(join(lockPath, filename), "utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Number.isSafeInteger((parsed as LockContents).pid) &&
      (parsed as LockContents).pid > 0 &&
      (parsed as LockContents).pid <= 2_147_483_647 &&
      Number.isSafeInteger((parsed as LockContents).acquiredAt) &&
      (parsed as LockContents).acquiredAt >= 0 &&
      (parsed as LockContents).acquiredAt <= 8_640_000_000_000_000 &&
      typeof (parsed as LockContents).host === "string" &&
      (parsed as LockContents).host.length > 0
    ) {
      return { filename, contents: parsed as LockContents };
    }
    return null;
  } catch {
    return null;
  }
}

async function removeOwnedLock(
  lockPath: string,
  filename: string,
): Promise<boolean> {
  try {
    // The filename is unique to one acquisition. Only the caller that removes
    // this exact marker may remove the now-empty directory. A delayed release
    // or competing reclaimer cannot unlink a new owner's different marker.
    await unlink(join(lockPath, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  // Never recursive: unexpected contents must block cleanup, not be discarded.
  await rmdir(lockPath);
  return true;
}

async function lockedError(lockPath: string): Promise<MonitorLockedError> {
  return new MonitorLockedError(
    lockPath,
    (await readLockOwner(lockPath))?.contents ?? null,
  );
}

/**
 * Takes the lock, returning a release function.
 *
 * Only a confirmed-dead owner on this host is reclaimed. A live worker never
 * loses ownership due to elapsed time. This is a cooperating-process lock on
 * a local filesystem, not a distributed lease.
 */
export async function acquireMonitorLock(
  stateFilePath: string,
  now: () => number = Date.now,
): Promise<() => Promise<void>> {
  const statePath = resolve(stateFilePath);
  const lockPath = `${statePath}.lock`;
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });

  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

    const owner = await readLockOwner(lockPath);
    if (!owner || !ownerHasExited(owner.contents)) {
      throw new MonitorLockedError(lockPath, owner?.contents ?? null);
    }
    if (!(await removeOwnedLock(lockPath, owner.filename))) {
      throw await lockedError(lockPath);
    }

    // Another contender may acquire the empty path first. Retry once without
    // touching whatever lock it created.
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === "EEXIST") {
        throw await lockedError(lockPath);
      }
      throw retryError;
    }
  }

  const filename = `owner-${randomUUID()}.json`;
  try {
    const handle = await open(join(lockPath, filename), "wx", 0o600);
    try {
      const contents: LockContents = {
        pid: process.pid,
        acquiredAt: now(),
        host: hostname(),
      };
      await handle.writeFile(JSON.stringify(contents), "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    await removeOwnedLock(lockPath, filename);
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await removeOwnedLock(lockPath, filename);
  };
}
