import { describe, expect, it } from "vitest";
import {
  Interface,
  parseEther,
  zeroPadValue,
  type Filter,
  type Log,
} from "ethers";
import { MORTAL_VAULT_ABI } from "./mortal-vault";
import {
  VAULT_EVENT_NAMES,
  getVaultActivityLabel,
  loadVaultActivity,
  loadVaultActivityRange,
  parseVaultActivityLog,
  type VaultEventProvider,
} from "./vault-events";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BENEFICIARY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const eventInterface = new Interface(MORTAL_VAULT_ABI);

function hash(seed: number): string {
  return `0x${seed.toString(16).padStart(64, "0")}`;
}

function makeLog(
  eventName: string,
  values: readonly unknown[],
  blockNumber: number,
  index = 0,
): Log {
  const fragment = eventInterface.getEvent(eventName)!;
  const encoded = eventInterface.encodeEventLog(fragment, values);
  return {
    address: CONTRACT,
    blockHash: hash(blockNumber),
    blockNumber,
    data: encoded.data,
    index,
    removed: false,
    topics: encoded.topics,
    transactionHash: hash(blockNumber * 100 + index),
    transactionIndex: 0,
  } as unknown as Log;
}

class FakeProvider implements VaultEventProvider {
  readonly filters: Filter[] = [];
  readonly blockCalls: number[] = [];
  failAtBlock?: number;

  constructor(
    readonly latestBlock: number,
    readonly logs: Log[] = [],
  ) {}

  async getBlockNumber(): Promise<number> {
    return this.latestBlock;
  }

  async getLogs(filter: Filter): Promise<Log[]> {
    this.filters.push(filter);
    const fromBlock = Number(filter.fromBlock);
    const toBlock = Number(filter.toBlock);
    if (
      this.failAtBlock !== undefined &&
      fromBlock <= this.failAtBlock &&
      toBlock >= this.failAtBlock
    ) {
      throw new Error("provider range rejected");
    }
    return this.logs.filter(
      (log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock,
    );
  }

  async getBlock(blockNumber: number): Promise<{ timestamp: number }> {
    this.blockCalls.push(blockNumber);
    return { timestamp: 1_700_000_000 + blockNumber };
  }
}

describe("vault event parsing", () => {
  it("parses every MortalVault event shape", () => {
    const eventCases: Array<[string, readonly unknown[]]> = [
      [
        "VaultCreated",
        [OWNER, BENEFICIARY, BigInt(86_400), BigInt(86_400), parseEther("1")],
      ],
      ["Deposited", [OWNER, parseEther("0.25"), parseEther("1.25")]],
      ["Heartbeat", [OWNER, BigInt(1_700_000_000)]],
      [
        "VaultUpdated",
        [OWNER, BENEFICIARY, BigInt(172_800), BigInt(86_400)],
      ],
      ["Withdrawn", [OWNER, parseEther("0.1"), parseEther("1.15")]],
      [
        "ClaimRequested",
        [
          OWNER,
          BENEFICIARY,
          BigInt(1_700_000_000),
          BigInt(1_700_086_400),
        ],
      ],
      ["ClaimCancelled", [OWNER, BigInt(1_700_000_001)]],
      ["Claimed", [OWNER, BENEFICIARY, RECIPIENT, parseEther("1.15")]],
      ["VaultClosed", [OWNER, parseEther("1.15")]],
    ];

    const parsed = eventCases.map(([name, values], index) =>
      parseVaultActivityLog(makeLog(name, values, 10 + index), 1_700_000_000),
    );

    expect(parsed.map((activity) => activity?.eventName)).toEqual(
      VAULT_EVENT_NAMES,
    );
    expect(parsed[0]).toMatchObject({
      owner: OWNER,
      beneficiary: BENEFICIARY,
      amount: parseEther("1"),
    });
    expect(parsed[7]).toMatchObject({
      beneficiary: BENEFICIARY,
      recipient: RECIPIENT,
      amount: parseEther("1.15"),
    });
    expect(getVaultActivityLabel(parsed[1]!)).toContain("balance became");
  });

  it("ignores malformed and removed logs", () => {
    const valid = makeLog("Heartbeat", [OWNER, BigInt(1)], 10);
    const malformed = {
      ...valid,
      topics: [hash(999)],
    } as unknown as Log;
    const removed = { ...valid, removed: true } as Log;

    expect(parseVaultActivityLog(malformed, null)).toBeNull();
    expect(parseVaultActivityLog(removed, null)).toBeNull();
  });
});

describe("bounded vault event queries", () => {
  it("queries owner topics in inclusive bounded ranges", async () => {
    const provider = new FakeProvider(112);

    const result = await loadVaultActivity({
      provider,
      contractAddress: CONTRACT,
      role: "owner",
      address: OWNER,
      fromBlock: 100,
      blockRange: 5,
    });

    expect(provider.filters.map(({ fromBlock, toBlock }) => [fromBlock, toBlock]))
      .toEqual([
        [100, 104],
        [105, 109],
        [110, 112],
      ]);
    const topics = provider.filters[0].topics!;
    expect(topics[0]).toHaveLength(9);
    expect(topics[1]).toBe(zeroPadValue(OWNER, 32));
    expect(result).toMatchObject({ fromBlock: 100, toBlock: 112, partial: false });
  });

  it("queries only beneficiary-indexed event topics", async () => {
    const provider = new FakeProvider(10);

    await loadVaultActivity({
      provider,
      contractAddress: CONTRACT,
      role: "beneficiary",
      address: BENEFICIARY,
      fromBlock: 0,
    });

    const topics = provider.filters[0].topics!;
    expect(topics[0]).toHaveLength(4);
    expect(topics[1]).toBeNull();
    expect(topics[2]).toBe(zeroPadValue(BENEFICIARY, 32));
  });

  it("queries all event topics for a deployment-wide worker range", async () => {
    const ownerEvent = makeLog("Heartbeat", [OWNER, BigInt(1)], 10);
    const otherEvent = makeLog("Heartbeat", [RECIPIENT, BigInt(2)], 11);
    const provider = new FakeProvider(11, [ownerEvent, otherEvent]);

    const result = await loadVaultActivityRange({
      provider,
      contractAddress: CONTRACT,
      fromBlock: 10,
      toBlock: 11,
      blockRange: 1,
    });

    expect(provider.filters).toHaveLength(2);
    expect(provider.filters[0].topics?.[0]).toHaveLength(9);
    expect(result.items.map((item) => item.owner)).toEqual([RECIPIENT, OWNER]);
    expect(result.items[0].blockHash).toBe(otherEvent.blockHash);
  });

  it("deduplicates logs, resolves timestamps, and sorts newest first", async () => {
    const older = makeLog("Heartbeat", [OWNER, BigInt(1)], 10, 0);
    const newerFirst = makeLog("Deposited", [OWNER, BigInt(1), BigInt(2)], 11, 0);
    const newerSecond = makeLog("Heartbeat", [OWNER, BigInt(2)], 11, 1);
    const provider = new FakeProvider(11, [older, newerFirst, newerSecond, older]);

    const result = await loadVaultActivity({
      provider,
      contractAddress: CONTRACT,
      role: "owner",
      address: OWNER,
      fromBlock: 0,
    });

    expect(result.items.map(({ blockNumber, logIndex }) => [blockNumber, logIndex]))
      .toEqual([
        [11, 1],
        [11, 0],
        [10, 0],
      ]);
    expect(provider.blockCalls.sort()).toEqual([10, 11]);
    expect(result.items[0].blockTimestamp).toBe(1_700_000_011);
  });

  it("filters decoded logs by the requested role and address", async () => {
    const ownerEvent = makeLog("VaultCreated", [
      OWNER,
      BENEFICIARY,
      BigInt(86_400),
      BigInt(86_400),
      parseEther("1"),
    ], 10);
    const otherOwnerEvent = makeLog("VaultCreated", [
      RECIPIENT,
      OWNER,
      BigInt(86_400),
      BigInt(86_400),
      parseEther("2"),
    ], 11);
    const provider = new FakeProvider(11, [ownerEvent, otherOwnerEvent]);

    const ownerResult = await loadVaultActivity({
      provider,
      contractAddress: CONTRACT,
      role: "owner",
      address: OWNER,
      fromBlock: 0,
    });
    const beneficiaryResult = await loadVaultActivity({
      provider,
      contractAddress: CONTRACT,
      role: "beneficiary",
      address: BENEFICIARY,
      fromBlock: 0,
    });

    expect(ownerResult.items).toHaveLength(1);
    expect(ownerResult.items[0].owner).toBe(OWNER);
    expect(beneficiaryResult.items).toHaveLength(1);
    expect(beneficiaryResult.items[0].beneficiary).toBe(BENEFICIARY);
  });

  it("uses a bounded recent window when deployment block is unavailable", async () => {
    const provider = new FakeProvider(100);

    const result = await loadVaultActivity({
      provider,
      contractAddress: CONTRACT,
      role: "owner",
      address: OWNER,
      blockRange: 5,
      fallbackLookbackBlocks: 10,
    });

    expect(result).toMatchObject({ fromBlock: 91, toBlock: 100, partial: true });
    expect(provider.filters.map(({ fromBlock, toBlock }) => [fromBlock, toBlock]))
      .toEqual([
        [91, 95],
        [96, 100],
      ]);
  });

  it("reports the exact failing RPC block range", async () => {
    const provider = new FakeProvider(112);
    provider.failAtBlock = 106;

    await expect(
      loadVaultActivity({
        provider,
        contractAddress: CONTRACT,
        role: "owner",
        address: OWNER,
        fromBlock: 100,
        blockRange: 5,
      }),
    ).rejects.toThrow(
      "Unable to read vault events for blocks 105-109: provider range rejected",
    );
  });
});
