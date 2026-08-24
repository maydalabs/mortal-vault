import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { advanceMonitorCursor, putMonitorCursor } from "./monitor-state";
import type { VaultActivity } from "./vault-events";
import {
  JsonFileLocalMonitorStore,
  createLocalMonitorState,
  decodeVaultActivity,
  encodeVaultActivity,
  parseLocalMonitorState,
  serializeLocalMonitorState,
} from "./local-monitor-store";

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BENEFICIARY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function createdActivity(): VaultActivity {
  const transactionHash = `0x${"1".repeat(64)}`;
  return {
    id: `${transactionHash}:0`,
    eventName: "VaultCreated",
    owner: OWNER,
    beneficiary: BENEFICIARY,
    timeout: BigInt(86_400),
    claimDelay: BigInt(86_400),
    amount: BigInt(100),
    transactionHash,
    blockHash: `0x${"2".repeat(64)}`,
    blockNumber: 10,
    logIndex: 0,
    blockTimestamp: 1_700_000_000,
  };
}

describe("local monitor storage", () => {
  it("round-trips bigint event fields through JSON-safe values", () => {
    const activity = createdActivity();
    const stored = encodeVaultActivity(activity);

    expect(stored.timeout).toBe("86400");
    expect(decodeVaultActivity(stored)).toEqual(activity);
  });

  it("rejects malformed or internally inconsistent activity", () => {
    const stored = encodeVaultActivity(createdActivity());

    expect(() =>
      decodeVaultActivity({ ...stored, amount: "-1" }),
    ).toThrow("unsigned decimal string");
    expect(() =>
      decodeVaultActivity({
        ...stored,
        amount: (BigInt(1) << BigInt(256)).toString(),
      }),
    ).toThrow("exceeds uint256");
    expect(() =>
      decodeVaultActivity({ ...stored, id: "wrong" }),
    ).toThrow("ID does not match");
  });

  it("persists state with an atomic private file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mortal-vault-monitor-"));
    const filePath = join(directory, "nested", "state.json");
    const store = new JsonFileLocalMonitorStore(filePath);
    const state = createLocalMonitorState();

    expect(await store.load()).toEqual(state);
    await store.save(state);

    expect(parseLocalMonitorState(await readFile(filePath, "utf8"))).toEqual(state);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("rejects unknown state versions", () => {
    const serialized = serializeLocalMonitorState(createLocalMonitorState());
    const value = JSON.parse(serialized);
    value.version = 2;

    expect(() => parseLocalMonitorState(JSON.stringify(value))).toThrow(
      "does not match version 1",
    );
  });

  it("rejects events beyond a deployment's finalized cursor", () => {
    const state = createLocalMonitorState();
    const identity = {
      chainId: 31_337,
      contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      deploymentBlock: 1,
    };
    state.monitor = putMonitorCursor(
      state.monitor,
      advanceMonitorCursor(
        identity,
        9,
        `0x${"3".repeat(64)}`,
        1_700_000_000,
      ),
    );
    state.events[`${identity.chainId}:${identity.contractAddress}`] = [
      encodeVaultActivity(createdActivity()),
    ];

    expect(() =>
      parseLocalMonitorState(serializeLocalMonitorState(state)),
    ).toThrow("exceed their finalized cursor");
  });
});
