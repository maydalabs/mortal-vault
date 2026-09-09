import { open, readFile, rm } from "node:fs/promises";

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

/** A lock older than this is treated as abandoned by a crashed process. */
export const STALE_LOCK_MS = 15 * 60 * 1000;

export type LockContents = {
  pid: number;
  acquiredAt: number;
  host?: string;
};

export class MonitorLockedError extends Error {
  // Plain fields, not constructor parameter properties: the CLI runs under
  // Node's strip-only TypeScript, which cannot emit the assignments those
  // imply. Vitest's full transform accepts them, so the unit tests passed
  // while the real command failed to load the module at all.
  readonly lockPath: string;
  readonly holder: LockContents | null;

  constructor(lockPath: string, holder: LockContents | null) {
    const held = holder
      ? `held by process ${holder.pid} since ${new Date(holder.acquiredAt).toISOString()}`
      : "held by an unreadable lock file";
    super(
      `Another monitor is using this state file (${held}).\n` +
        `If that process is gone, delete ${lockPath} and run again.\n` +
        "To watch a second deployment, give it its own --state-file.",
    );
    this.name = "MonitorLockedError";
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence checks without delivering.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else, so it is alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLock(lockPath: string): Promise<LockContents | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(lockPath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as LockContents).pid === "number" &&
      typeof (parsed as LockContents).acquiredAt === "number"
    ) {
      return parsed as LockContents;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Takes the lock, returning a release function.
 *
 * A lock whose owner is gone, or which is older than STALE_LOCK_MS, is taken
 * over rather than left to block a machine forever after a crash.
 */
export async function acquireMonitorLock(
  stateFilePath: string,
  now: () => number = Date.now,
): Promise<() => Promise<void>> {
  const lockPath = `${stateFilePath}.lock`;

  const write = async () => {
    const handle = await open(lockPath, "wx", 0o600);
    try {
      const contents: LockContents = {
        pid: process.pid,
        acquiredAt: now(),
        host: process.env.HOSTNAME,
      };
      await handle.writeFile(JSON.stringify(contents), "utf8");
    } finally {
      await handle.close();
    }
  };

  try {
    await write();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

    const holder = await readLock(lockPath);
    const abandoned =
      holder !== null &&
      (!isAlive(holder.pid) || now() - holder.acquiredAt > STALE_LOCK_MS);

    if (!abandoned) throw new MonitorLockedError(lockPath, holder);

    // Take over: remove and retry once. Losing this race means someone else
    // claimed it first, which is the correct outcome.
    await rm(lockPath, { force: true });
    try {
      await write();
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === "EEXIST") {
        throw new MonitorLockedError(lockPath, await readLock(lockPath));
      }
      throw retryError;
    }
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await rm(lockPath, { force: true });
  };
}
