import { resolve } from "node:path";
import { getAddress, JsonRpcProvider } from "ethers";
import { JsonFileLocalMonitorStore } from "../lib/local-monitor-store.ts";
import {
  FakeReminderDeliveryAdapter,
  runLocalMonitorOnce,
  type ReminderDeliveryAdapter,
} from "../lib/local-monitor-worker.ts";
import { WebhookReminderDeliveryAdapter } from "../lib/webhook-delivery.ts";
import {
  VAULT_REMINDER_KINDS,
  type VaultReminderKind,
} from "../lib/vault-reminders.ts";

const HELP = `Mortal Vault local monitor

Usage:
  npm run monitor -- --rpc-url <url> --chain-id <id> --contract <address> \\
    --deployment-block <block> [options]

Required:
  --rpc-url <url>             HTTP(S) JSON-RPC endpoint
  --chain-id <id>             Expected EVM chain ID
  --contract <address>        MortalVault deployment address
  --deployment-block <block>  Exact contract deployment block

Subscriptions:
  --owner <address>           Add or replace an owner subscription; repeatable
  --audience <value>          owner, beneficiary, or both (default: both)
  --unsubscribe <address>     Remove an owner's subscriptions; repeatable

Scanning and delivery:
  --state-file <path>         State file (default: .monitor/state.json)
  --confirmations <count>     Finality depth (default: 12; use 0 only locally)
  --block-range <count>       Maximum eth_getLogs block range (default: 5000)
  --reorg-lookback <count>    Reorg rollback range (default: 128)
  --delivery-limit <count>    Maximum deliveries per run (default: 25)
  --no-deliver                Scan and schedule without delivering
  --fail-kind <kind>          Simulate delivery failure; repeatable (fake only)

Webhook delivery:
  --webhook-url <url>         POST reminders here instead of printing them.
                              https only, except localhost.
  --app-base-url <url>        Public app URL; adds a check-in link to owner
                              reminders.
  --webhook-timeout <ms>      Per-request timeout (default: 10000)
  --help                      Show this help

Without --webhook-url the fake adapter prints reminders to stdout and never
contacts a user. Neither adapter holds a key or signs a transaction.

Set MORTAL_VAULT_WEBHOOK_SECRET to sign deliveries with HMAC-SHA256. The
secret is read from the environment rather than a flag so it stays out of
shell history and the process list. Receivers should verify the signature
before acting: anyone can POST to a webhook URL.
`;

const valueOptions = new Set([
  "rpc-url",
  "chain-id",
  "contract",
  "deployment-block",
  "owner",
  "audience",
  "unsubscribe",
  "state-file",
  "confirmations",
  "block-range",
  "reorg-lookback",
  "delivery-limit",
  "fail-kind",
  "webhook-url",
  "app-base-url",
  "webhook-timeout",
]);
const flagOptions = new Set(["help", "no-deliver"]);

function parseArguments(argv: string[]): Map<string, string[]> {
  const parsed = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }
    const name = argument.slice(2);
    if (flagOptions.has(name)) {
      parsed.set(name, []);
      continue;
    }
    if (!valueOptions.has(name)) throw new Error(`Unknown option: --${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option --${name} requires a value.`);
    }
    parsed.set(name, [...(parsed.get(name) ?? []), value]);
    index += 1;
  }
  return parsed;
}

function oneValue(
  options: Map<string, string[]>,
  name: string,
  required = false,
): string | undefined {
  const values = options.get(name);
  if (!values || values.length === 0) {
    if (required) throw new Error(`Missing required option: --${name}`);
    return undefined;
  }
  if (values.length > 1) throw new Error(`Option --${name} cannot be repeated.`);
  return values[0];
}

function integerOption(
  options: Map<string, string[]>,
  name: string,
  fallback?: number,
  minimum = 0,
): number {
  const raw = oneValue(options, name);
  if (raw === undefined) {
    if (fallback === undefined) {
      throw new Error(`Missing required option: --${name}`);
    }
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `Option --${name} must be an integer of at least ${minimum}.`,
    );
  }
  return value;
}

function rpcUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("--rpc-url must use HTTP or HTTPS.");
  }
  return parsed.toString();
}

function audienceOption(
  value: string | undefined,
): "owner" | "beneficiary" | "both" {
  if (value === undefined) return "both";
  if (value !== "owner" && value !== "beneficiary" && value !== "both") {
    throw new Error("--audience must be owner, beneficiary, or both.");
  }
  return value;
}

function reminderKinds(values: string[]): VaultReminderKind[] {
  return values.map((value) => {
    if (!VAULT_REMINDER_KINDS.includes(value as VaultReminderKind)) {
      throw new Error(`Unknown reminder kind for --fail-kind: ${value}`);
    }
    return value as VaultReminderKind;
  });
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.has("help")) {
    process.stdout.write(HELP);
    return;
  }

  const chainId = integerOption(options, "chain-id", undefined, 1);
  const contractAddress = getAddress(oneValue(options, "contract", true)!);
  const deploymentBlock = integerOption(options, "deployment-block");
  const provider = new JsonRpcProvider(
    rpcUrl(oneValue(options, "rpc-url", true)!),
  );
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== chainId) {
    throw new Error(
      `RPC returned chain ${network.chainId.toString()}, expected ${chainId}.`,
    );
  }
  if ((await provider.getCode(contractAddress)) === "0x") {
    throw new Error(`No contract code found at ${contractAddress}.`);
  }

  const audience = audienceOption(oneValue(options, "audience"));
  const owners = (options.get("owner") ?? []).map(getAddress);
  const unsubscribeOwners = (options.get("unsubscribe") ?? []).map(getAddress);
  const stateFile = resolve(
    oneValue(options, "state-file") ?? ".monitor/state.json",
  );
  const noDeliver = options.has("no-deliver");
  const webhookUrl = oneValue(options, "webhook-url");
  let deliveryAdapter: ReminderDeliveryAdapter | undefined;
  if (!noDeliver && webhookUrl) {
    const secret = process.env.MORTAL_VAULT_WEBHOOK_SECRET;
    if (!secret) {
      process.stderr.write(
        "Warning: MORTAL_VAULT_WEBHOOK_SECRET is unset, so deliveries are " +
          "unsigned and the receiver cannot tell them from a forgery.\n",
      );
    }
    deliveryAdapter = new WebhookReminderDeliveryAdapter({
      url: webhookUrl,
      secret,
      appBaseUrl: oneValue(options, "app-base-url"),
      timeoutMs: integerOption(options, "webhook-timeout", 10_000, 1),
    });
  } else if (!noDeliver) {
    deliveryAdapter = new FakeReminderDeliveryAdapter({
      failKinds: reminderKinds(options.get("fail-kind") ?? []),
    });
  }

  const summary = await runLocalMonitorOnce({
    provider,
    store: new JsonFileLocalMonitorStore(stateFile),
    identity: { chainId, contractAddress, deploymentBlock },
    subscriptions: owners.map((owner) => ({ owner, audience })),
    unsubscribeOwners,
    deliveryAdapter,
    confirmations: integerOption(options, "confirmations", 12),
    blockRange: integerOption(options, "block-range", 5_000, 1),
    reorgLookbackBlocks: integerOption(options, "reorg-lookback", 128, 1),
    deliveryLimit: integerOption(options, "delivery-limit", 25, 1),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        type: "mortal-vault.monitor.summary",
        stateFile,
        delivery: noDeliver ? "disabled" : "fake-stdout",
        ...summary,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Monitor failed: ${message}\n`);
  process.exitCode = 1;
});
