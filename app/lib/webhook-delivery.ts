import { createHmac, timingSafeEqual } from "node:crypto";

import type { ReminderDeliveryAdapter } from "./local-monitor-worker";
import type { VaultReminder } from "./vault-reminders";

export const WEBHOOK_SIGNATURE_HEADER = "x-mortal-vault-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-mortal-vault-timestamp";
export const WEBHOOK_REMINDER_ID_HEADER = "x-mortal-vault-reminder-id";
export const WEBHOOK_USER_AGENT = "mortal-vault-watchtower/0";

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

/** Bytes of an error response echoed back into the thrown message. */
const ERROR_BODY_SNIPPET = 200;

export type WebhookReminderPayload = {
  type: "mortal-vault.reminder";
  reminderId: string;
  kind: VaultReminder["kind"];
  audience: VaultReminder["audience"];
  severity: VaultReminder["severity"];
  title: string;
  message: string;
  chainId: number;
  contractAddress: string;
  vaultId: string;
  owner: string;
  beneficiary: string;
  deliverAt: number;
  /** Owner reminders carry the one-tap check-in link when a base URL is known. */
  actionUrl?: string;
};

export type WebhookDeliveryOptions = {
  url: string;
  /** Shared secret. Without one the request is unsigned and the receiver cannot authenticate it. */
  secret?: string;
  timeoutMs?: number;
  /** Base URL of the app, used to build the owner's check-in link. */
  appBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/**
 * Delivers reminders to an HTTP endpoint the vault owner controls: their own
 * service, or a chat webhook that fans out to a phone.
 *
 * This adapter is deliberately dumb about retries. The monitor outbox already
 * owns scheduling, leasing and backoff, so a failed delivery here is signalled
 * by throwing and retried by the caller on a later run.
 */
export class WebhookReminderDeliveryAdapter implements ReminderDeliveryAdapter {
  private readonly url: string;
  private readonly secret?: string;
  private readonly timeoutMs: number;
  private readonly appBaseUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor({
    url,
    secret,
    timeoutMs = DEFAULT_WEBHOOK_TIMEOUT_MS,
    appBaseUrl,
    fetchImpl = globalThis.fetch,
    now = Date.now,
  }: WebhookDeliveryOptions) {
    this.url = assertDeliverableUrl(url);
    this.secret = secret;
    this.timeoutMs = timeoutMs;
    this.appBaseUrl = appBaseUrl ? stripTrailingSlash(appBaseUrl) : undefined;
    if (typeof fetchImpl !== "function") {
      throw new Error("Webhook delivery requires a fetch implementation.");
    }
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async deliver(reminder: VaultReminder): Promise<void> {
    const body = JSON.stringify(this.buildPayload(reminder));
    const timestamp = Math.floor(this.now() / 1000);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": WEBHOOK_USER_AGENT,
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp.toString(),
      [WEBHOOK_REMINDER_ID_HEADER]: reminder.id,
    };
    if (this.secret) {
      headers[WEBHOOK_SIGNATURE_HEADER] = signWebhookPayload({
        body,
        timestamp,
        secret: this.secret,
      });
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(
        `Webhook delivery for ${reminder.id} did not complete: ${describeError(error)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Webhook delivery for ${reminder.id} failed with ${response.status}${
          await describeResponseBody(response)
        }`,
      );
    }
  }

  private buildPayload(reminder: VaultReminder): WebhookReminderPayload {
    const payload: WebhookReminderPayload = {
      type: "mortal-vault.reminder",
      reminderId: reminder.id,
      kind: reminder.kind,
      audience: reminder.audience,
      severity: reminder.severity,
      title: reminder.title,
      message: reminder.message,
      chainId: reminder.chainId,
      contractAddress: reminder.contractAddress,
      vaultId: reminder.vaultId,
      owner: reminder.owner,
      beneficiary: reminder.beneficiary,
      deliverAt: reminder.deliverAt,
    };
    if (this.appBaseUrl && reminder.audience === "owner") {
      payload.actionUrl = `${this.appBaseUrl}/?action=checkin`;
    }
    return payload;
  }
}

export type SignWebhookPayloadOptions = {
  body: string;
  timestamp: number;
  secret: string;
};

/**
 * Signs the timestamp alongside the body so a captured request cannot be
 * replayed later under a fresh timestamp.
 */
export function signWebhookPayload({
  body,
  timestamp,
  secret,
}: SignWebhookPayloadOptions): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${digest}`;
}

export type VerifyWebhookSignatureOptions = {
  body: string;
  /** Value of the timestamp header, as received. */
  timestamp: string | number;
  /** Value of the signature header, as received. */
  signature: string | null | undefined;
  secret: string;
  toleranceSeconds?: number;
  now?: () => number;
};

/**
 * Verifies a delivery. Receivers should call this before acting on a payload:
 * anyone can POST to a webhook URL, so an unverified reminder is a claim, not
 * a fact.
 */
export function verifyWebhookSignature({
  body,
  timestamp,
  signature,
  secret,
  toleranceSeconds = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  now = Date.now,
}: VerifyWebhookSignatureOptions): boolean {
  if (!signature) return false;

  const sentAt = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;

  const skewSeconds = Math.abs(Math.floor(now() / 1000) - sentAt);
  if (skewSeconds > toleranceSeconds) return false;

  const expected = Buffer.from(
    signWebhookPayload({ body, timestamp: sentAt, secret }),
  );
  const received = Buffer.from(signature);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

function assertDeliverableUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Webhook URL is not a valid URL: ${value}`);
  }

  if (parsed.protocol === "https:") return parsed.toString();

  // Reminders name a vault and its parties. That is public chain data, but
  // plaintext delivery still hands a passive observer the exact moment a vault
  // becomes claimable, so http is allowed only for local development.
  if (parsed.protocol === "http:" && isLoopback(parsed.hostname)) {
    return parsed.toString();
  }

  throw new Error(
    `Webhook URL must use https (http is allowed only for localhost): ${value}`,
  );
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? "request timed out" : error.message;
  }
  return String(error);
}

async function describeResponseBody(response: Response): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return "";
  }
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `: ${trimmed.slice(0, ERROR_BODY_SNIPPET)}`;
}
