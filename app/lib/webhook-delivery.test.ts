import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import type { VaultReminder } from "./vault-reminders";
import {
  WEBHOOK_REMINDER_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WebhookReminderDeliveryAdapter,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./webhook-delivery";

const SECRET = "watchtower-secret";

const REMINDER: VaultReminder = {
  id: "owner-heartbeat-overdue:0xf39Fd6:1790000000",
  kind: "owner-heartbeat-overdue",
  audience: "owner",
  severity: "urgent",
  title: "Your quiet period has passed",
  message: "Check in to keep your vault out of reach.",
  chainId: 31337,
  contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  vaultId: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  beneficiary: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  deliverAt: 1790000000,
};

type Received = {
  body: string;
  headers: IncomingMessage["headers"];
};

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  const closing = server;
  server = undefined;
  await new Promise<void>((resolve) => closing.close(() => resolve()));
});

/** Starts a throwaway receiver and returns its URL plus everything it saw. */
async function startReceiver(
  respond: (received: Received) => { status: number; body?: string } = () => ({
    status: 204,
  }),
): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  const created = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry: Received = {
        body: Buffer.concat(chunks).toString("utf8"),
        headers: request.headers,
      };
      received.push(entry);
      const reply = respond(entry);
      response.writeHead(reply.status, { "content-type": "text/plain" });
      response.end(reply.body ?? "");
    });
  });

  server = created;
  await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
  const address = created.address();
  if (address === null || typeof address === "string") {
    throw new Error("Receiver did not bind to a port.");
  }
  return { url: `http://127.0.0.1:${address.port}/hook`, received };
}

describe("WebhookReminderDeliveryAdapter", () => {
  it("delivers a signed payload the receiver can verify", async () => {
    const { url, received } = await startReceiver();
    const adapter = new WebhookReminderDeliveryAdapter({ url, secret: SECRET });

    await adapter.deliver(REMINDER);

    expect(received).toHaveLength(1);
    const [entry] = received;
    expect(JSON.parse(entry.body)).toMatchObject({
      type: "mortal-vault.reminder",
      reminderId: REMINDER.id,
      kind: "owner-heartbeat-overdue",
      severity: "urgent",
      owner: REMINDER.owner,
      chainId: 31337,
    });
    expect(
      verifyWebhookSignature({
        body: entry.body,
        timestamp: entry.headers[WEBHOOK_TIMESTAMP_HEADER] as string,
        signature: entry.headers[WEBHOOK_SIGNATURE_HEADER] as string,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("sends the reminder id as a header so receivers can dedupe", async () => {
    const { url, received } = await startReceiver();
    const adapter = new WebhookReminderDeliveryAdapter({ url });

    await adapter.deliver(REMINDER);

    expect(received[0].headers[WEBHOOK_REMINDER_ID_HEADER]).toBe(REMINDER.id);
    expect(received[0].headers[WEBHOOK_SIGNATURE_HEADER]).toBeUndefined();
  });

  it("gives owner reminders a check-in link and beneficiaries none", async () => {
    const { url, received } = await startReceiver();
    const adapter = new WebhookReminderDeliveryAdapter({
      url,
      appBaseUrl: "https://vault.example/",
    });

    await adapter.deliver(REMINDER);
    await adapter.deliver({
      ...REMINDER,
      id: "beneficiary-claim-available:1",
      kind: "beneficiary-claim-available",
      audience: "beneficiary",
    });

    expect(JSON.parse(received[0].body).actionUrl).toBe(
      "https://vault.example/?action=checkin",
    );
    expect(JSON.parse(received[1].body).actionUrl).toBeUndefined();
  });

  it("throws on a rejected delivery so the outbox retries it", async () => {
    const { url } = await startReceiver(() => ({
      status: 500,
      body: "receiver exploded",
    }));
    const adapter = new WebhookReminderDeliveryAdapter({ url });

    await expect(adapter.deliver(REMINDER)).rejects.toThrow(
      /failed with 500: receiver exploded/,
    );
  });

  it("throws when the endpoint cannot be reached", async () => {
    const adapter = new WebhookReminderDeliveryAdapter({
      // Port 1 is reserved and never listening.
      url: "http://127.0.0.1:1/hook",
    });

    await expect(adapter.deliver(REMINDER)).rejects.toThrow(
      /did not complete/,
    );
  });

  it("refuses plaintext delivery to anywhere but localhost", () => {
    expect(
      () => new WebhookReminderDeliveryAdapter({ url: "http://example.com/h" }),
    ).toThrow(/must use https/);
    expect(
      () => new WebhookReminderDeliveryAdapter({ url: "not-a-url" }),
    ).toThrow(/not a valid URL/);
    expect(
      () => new WebhookReminderDeliveryAdapter({ url: "https://example.com/h" }),
    ).not.toThrow();
  });
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ hello: "vault" });
  const timestamp = 1790000000;
  const now = () => timestamp * 1000;
  const signature = signWebhookPayload({ body, timestamp, secret: SECRET });

  it("accepts a signature it just produced", () => {
    expect(
      verifyWebhookSignature({ body, timestamp, signature, secret: SECRET, now }),
    ).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, and a missing signature", () => {
    expect(
      verifyWebhookSignature({
        body: JSON.stringify({ hello: "attacker" }),
        timestamp,
        signature,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        body,
        timestamp,
        signature,
        secret: "wrong-secret",
        now,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ body, timestamp, signature: null, secret: SECRET, now }),
    ).toBe(false);
  });

  it("rejects a replayed request once it falls outside the tolerance", () => {
    const later = () => (timestamp + 400) * 1000;
    expect(
      verifyWebhookSignature({ body, timestamp, signature, secret: SECRET, now: later }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        body,
        timestamp,
        signature,
        secret: SECRET,
        toleranceSeconds: 600,
        now: later,
      }),
    ).toBe(true);
  });

  it("rejects a non-numeric timestamp header", () => {
    expect(
      verifyWebhookSignature({
        body,
        timestamp: "not-a-number",
        signature,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });
});
