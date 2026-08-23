import type { VaultActivity } from "./vault-events";

export type ProjectedVaultStatus =
  | "active"
  | "claim-requested"
  | "claimed"
  | "closed";

export type ProjectedVault = {
  id: string;
  owner: string;
  beneficiary: string;
  timeout: bigint;
  claimDelay: bigint;
  lastHeartbeat: bigint | null;
  claimRequestedAt: bigint | null;
  claimExecutableAt: bigint | null;
  balance: bigint;
  status: ProjectedVaultStatus;
  createdAt: number | null;
  lastEventBlock: number;
  lastEventLogIndex: number;
};

export type VaultProjectionResult = {
  vault: ProjectedVault | null;
  complete: boolean;
  ignoredEvents: number;
};

export type ProjectVaultActivityOptions = {
  historyComplete: boolean;
};

function requireValue<T>(
  value: T | undefined,
  eventName: VaultActivity["eventName"],
  field: string,
): T {
  if (value === undefined) {
    throw new Error(`${eventName} is missing ${field}.`);
  }
  return value;
}

function compareActivity(left: VaultActivity, right: VaultActivity): number {
  return (
    left.blockNumber - right.blockNumber || left.logIndex - right.logIndex
  );
}

export function projectVaultActivity(
  activities: VaultActivity[],
  { historyComplete }: ProjectVaultActivityOptions,
): VaultProjectionResult {
  const ordered = [...activities].sort(compareActivity);
  let vault: ProjectedVault | null = null;
  let ignoredEvents = 0;

  for (const activity of ordered) {
    if (activity.eventName === "VaultCreated") {
      vault = {
        id: activity.id,
        owner: activity.owner,
        beneficiary: requireValue(
          activity.beneficiary,
          activity.eventName,
          "beneficiary",
        ),
        timeout: requireValue(activity.timeout, activity.eventName, "timeout"),
        claimDelay: requireValue(
          activity.claimDelay,
          activity.eventName,
          "claimDelay",
        ),
        lastHeartbeat: null,
        claimRequestedAt: null,
        claimExecutableAt: null,
        balance: requireValue(activity.amount, activity.eventName, "amount"),
        status: "active",
        createdAt: activity.blockTimestamp,
        lastEventBlock: activity.blockNumber,
        lastEventLogIndex: activity.logIndex,
      };
      continue;
    }

    if (!vault || vault.owner !== activity.owner) {
      ignoredEvents += 1;
      continue;
    }

    if (vault.status === "claimed" || vault.status === "closed") {
      ignoredEvents += 1;
      continue;
    }

    switch (activity.eventName) {
      case "Deposited":
        vault.balance = requireValue(
          activity.newBalance,
          activity.eventName,
          "newBalance",
        );
        break;
      case "Heartbeat":
        vault.lastHeartbeat = requireValue(
          activity.recordedAt,
          activity.eventName,
          "recordedAt",
        );
        vault.claimRequestedAt = null;
        vault.claimExecutableAt = null;
        vault.status = "active";
        break;
      case "VaultUpdated":
        vault.beneficiary = requireValue(
          activity.beneficiary,
          activity.eventName,
          "beneficiary",
        );
        vault.timeout = requireValue(
          activity.timeout,
          activity.eventName,
          "timeout",
        );
        vault.claimDelay = requireValue(
          activity.claimDelay,
          activity.eventName,
          "claimDelay",
        );
        break;
      case "Withdrawn":
        vault.balance = requireValue(
          activity.remainingBalance,
          activity.eventName,
          "remainingBalance",
        );
        break;
      case "ClaimRequested":
        vault.beneficiary = requireValue(
          activity.beneficiary,
          activity.eventName,
          "beneficiary",
        );
        vault.claimRequestedAt = requireValue(
          activity.recordedAt,
          activity.eventName,
          "recordedAt",
        );
        vault.claimExecutableAt = requireValue(
          activity.executableAt,
          activity.eventName,
          "executableAt",
        );
        vault.status = "claim-requested";
        break;
      case "ClaimCancelled":
        vault.claimRequestedAt = null;
        vault.claimExecutableAt = null;
        vault.status = "active";
        break;
      case "Claimed":
        vault.beneficiary = requireValue(
          activity.beneficiary,
          activity.eventName,
          "beneficiary",
        );
        vault.balance = BigInt(0);
        vault.claimRequestedAt = null;
        vault.claimExecutableAt = null;
        vault.status = "claimed";
        break;
      case "VaultClosed":
        vault.balance = BigInt(0);
        vault.claimRequestedAt = null;
        vault.claimExecutableAt = null;
        vault.status = "closed";
        break;
    }

    vault.lastEventBlock = activity.blockNumber;
    vault.lastEventLogIndex = activity.logIndex;
  }

  return {
    vault,
    complete: vault !== null || (historyComplete && ignoredEvents === 0),
    ignoredEvents,
  };
}
