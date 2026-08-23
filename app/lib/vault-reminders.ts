import { getAddress } from "ethers";
import type { ProjectedVault } from "./vault-projection";

export const DEFAULT_HEARTBEAT_NOTICE_SECONDS = 7 * 86_400;

export type VaultReminderKind =
  | "owner-heartbeat-upcoming"
  | "owner-heartbeat-overdue"
  | "beneficiary-claim-available"
  | "owner-claim-challenge"
  | "beneficiary-claim-ready";

export type VaultReminderAudience = "owner" | "beneficiary";
export type VaultReminderSeverity = "info" | "warning" | "urgent";

export type VaultReminder = {
  id: string;
  kind: VaultReminderKind;
  audience: VaultReminderAudience;
  severity: VaultReminderSeverity;
  title: string;
  message: string;
  chainId: number;
  contractAddress: string;
  vaultId: string;
  owner: string;
  beneficiary: string;
  deliverAt: number;
};

export type ScheduleVaultRemindersOptions = {
  chainId: number;
  contractAddress: string;
  now: number;
  heartbeatNoticeSeconds?: number;
};

function safeTimestamp(value: bigint, label: string): number {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`${label} must fit a non-negative JavaScript timestamp.`);
  }
  return timestamp;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function reminder(
  vault: ProjectedVault,
  context: { chainId: number; contractAddress: string },
  values: Pick<
    VaultReminder,
    "kind" | "audience" | "severity" | "title" | "message" | "deliverAt"
  >,
): VaultReminder {
  const id = [
    context.chainId,
    context.contractAddress,
    vault.id,
    values.audience,
    values.kind,
    values.deliverAt,
  ].join(":");

  return {
    id,
    chainId: context.chainId,
    contractAddress: context.contractAddress,
    vaultId: vault.id,
    owner: getAddress(vault.owner),
    beneficiary: getAddress(vault.beneficiary),
    ...values,
  };
}

export function scheduleVaultReminders(
  vault: ProjectedVault,
  {
    chainId,
    contractAddress,
    now,
    heartbeatNoticeSeconds = DEFAULT_HEARTBEAT_NOTICE_SECONDS,
  }: ScheduleVaultRemindersOptions,
): VaultReminder[] {
  positiveInteger(chainId, "Chain ID");
  positiveInteger(now, "Current timestamp");
  positiveInteger(heartbeatNoticeSeconds, "Heartbeat notice");
  const context = {
    chainId,
    contractAddress: getAddress(contractAddress),
  };

  if (vault.status === "claimed" || vault.status === "closed") return [];

  if (vault.status === "claim-requested") {
    if (vault.claimRequestedAt === null || vault.claimExecutableAt === null) {
      throw new Error("A projected claim request is missing its timestamps.");
    }
    const requestedAt = safeTimestamp(
      vault.claimRequestedAt,
      "Claim request timestamp",
    );
    const executableAt = safeTimestamp(
      vault.claimExecutableAt,
      "Claim executable timestamp",
    );
    if (executableAt < requestedAt) {
      throw new Error("Claim execution cannot precede its request.");
    }

    return [
      reminder(vault, context, {
        kind: "owner-claim-challenge",
        audience: "owner",
        severity: "urgent",
        title: "A claim is pending",
        message:
          "Check in before execution if you are still active; owner activity cancels the pending claim.",
        deliverAt: requestedAt,
      }),
      reminder(vault, context, {
        kind: "beneficiary-claim-ready",
        audience: "beneficiary",
        severity: "urgent",
        title: "Claim can be executed",
        message:
          "The challenge period has ended. Recheck the vault on-chain before executing the claim.",
        deliverAt: executableAt,
      }),
    ];
  }

  if (vault.lastHeartbeat === null) {
    throw new Error("An active projected vault is missing its heartbeat.");
  }
  const heartbeat = safeTimestamp(vault.lastHeartbeat, "Heartbeat timestamp");
  const timeout = safeTimestamp(vault.timeout, "Inactivity timeout");
  const inactivityDeadline = heartbeat + timeout;
  if (!Number.isSafeInteger(inactivityDeadline)) {
    throw new Error("Inactivity deadline exceeds the supported timestamp range.");
  }
  const claimAvailableAt = inactivityDeadline + 1;
  const scheduled: VaultReminder[] = [];

  if (now <= inactivityDeadline) {
    scheduled.push(
      reminder(vault, context, {
        kind: "owner-heartbeat-upcoming",
        audience: "owner",
        severity: "warning",
        title: "Heartbeat deadline approaching",
        message:
          "Check in before the inactivity deadline to keep the beneficiary claim path locked.",
        deliverAt: Math.max(heartbeat, inactivityDeadline - heartbeatNoticeSeconds),
      }),
    );
  }

  scheduled.push(
    reminder(vault, context, {
      kind: "owner-heartbeat-overdue",
      audience: "owner",
      severity: "urgent",
      title: "Heartbeat is overdue",
      message:
        "The beneficiary can request a claim. Check in now if you are still active.",
      deliverAt: claimAvailableAt,
    }),
    reminder(vault, context, {
      kind: "beneficiary-claim-available",
      audience: "beneficiary",
      severity: "info",
      title: "Claim request is available",
      message:
        "The owner has exceeded the inactivity timeout. Verify the vault before requesting a claim.",
      deliverAt: claimAvailableAt,
    }),
  );

  return scheduled;
}

export function isReminderDue(reminder: VaultReminder, now: number): boolean {
  return reminder.deliverAt <= now;
}
