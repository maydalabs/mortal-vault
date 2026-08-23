import { describe, expect, it } from "vitest";
import type { VaultActivity, VaultEventName } from "./vault-events";
import { projectVaultActivity } from "./vault-projection";

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BENEFICIARY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER_BENEFICIARY = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

function activity(
  eventName: VaultEventName,
  blockNumber: number,
  values: Partial<VaultActivity> = {},
): VaultActivity {
  const logIndex = values.logIndex ?? 0;
  return {
    id: `${blockNumber}:${logIndex}`,
    eventName,
    owner: OWNER,
    transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    blockNumber,
    logIndex,
    blockTimestamp: 1_700_000_000 + blockNumber,
    ...values,
  };
}

function created(blockNumber = 1): VaultActivity {
  return activity("VaultCreated", blockNumber, {
    beneficiary: BENEFICIARY,
    timeout: BigInt(30 * 86_400),
    claimDelay: BigInt(7 * 86_400),
    amount: BigInt(100),
  });
}

describe("vault activity projection", () => {
  it("reconstructs owner activity and claim cancellation in chain order", () => {
    const result = projectVaultActivity(
      [
        activity("Withdrawn", 7, { remainingBalance: BigInt(125) }),
        activity("ClaimCancelled", 5, { recordedAt: BigInt(1_700_000_005) }),
        activity("Deposited", 3, { newBalance: BigInt(150) }),
        created(),
        activity("Heartbeat", 2, { recordedAt: BigInt(1_700_000_002) }),
        activity("ClaimRequested", 4, {
          beneficiary: BENEFICIARY,
          recordedAt: BigInt(1_700_000_004),
          executableAt: BigInt(1_700_604_804),
        }),
        activity("Heartbeat", 6, { recordedAt: BigInt(1_700_000_006) }),
      ],
      { historyComplete: true },
    );

    expect(result).toMatchObject({ complete: true, ignoredEvents: 0 });
    expect(result.vault).toMatchObject({
      status: "active",
      balance: BigInt(125),
      lastHeartbeat: BigInt(1_700_000_006),
      claimRequestedAt: null,
      claimExecutableAt: null,
      lastEventBlock: 7,
    });
  });

  it("projects configuration changes and a pending claim", () => {
    const result = projectVaultActivity(
      [
        created(),
        activity("Heartbeat", 2, { recordedAt: BigInt(1_700_000_002) }),
        activity("VaultUpdated", 3, {
          beneficiary: OTHER_BENEFICIARY,
          timeout: BigInt(60 * 86_400),
          claimDelay: BigInt(14 * 86_400),
        }),
        activity("ClaimRequested", 4, {
          beneficiary: OTHER_BENEFICIARY,
          recordedAt: BigInt(1_705_184_003),
          executableAt: BigInt(1_706_393_603),
        }),
      ],
      { historyComplete: true },
    );

    expect(result.vault).toMatchObject({
      beneficiary: OTHER_BENEFICIARY,
      timeout: BigInt(60 * 86_400),
      claimDelay: BigInt(14 * 86_400),
      status: "claim-requested",
      claimRequestedAt: BigInt(1_705_184_003),
      claimExecutableAt: BigInt(1_706_393_603),
    });
  });

  it("keeps only the latest lifecycle after a terminal vault is recreated", () => {
    const firstCreated = created();
    const secondCreated = created(10);
    secondCreated.amount = BigInt(250);
    secondCreated.beneficiary = OTHER_BENEFICIARY;

    const result = projectVaultActivity(
      [
        firstCreated,
        activity("Heartbeat", 2, { recordedAt: BigInt(1_700_000_002) }),
        activity("Claimed", 3, {
          beneficiary: BENEFICIARY,
          recipient: BENEFICIARY,
          amount: BigInt(100),
        }),
        secondCreated,
        activity("Heartbeat", 11, { recordedAt: BigInt(1_700_000_011) }),
      ],
      { historyComplete: true },
    );

    expect(result.vault).toMatchObject({
      id: secondCreated.id,
      beneficiary: OTHER_BENEFICIARY,
      balance: BigInt(250),
      status: "active",
      lastHeartbeat: BigInt(1_700_000_011),
    });
  });

  it("marks a partial history without creation as incomplete", () => {
    const result = projectVaultActivity(
      [activity("Heartbeat", 20, { recordedAt: BigInt(1_700_000_020) })],
      { historyComplete: false },
    );

    expect(result).toEqual({ vault: null, complete: false, ignoredEvents: 1 });
  });

  it("rejects decoded events that omit required projection fields", () => {
    expect(() =>
      projectVaultActivity(
        [activity("VaultCreated", 1, { beneficiary: BENEFICIARY })],
        { historyComplete: true },
      ),
    ).toThrow("VaultCreated is missing timeout");
  });
});
