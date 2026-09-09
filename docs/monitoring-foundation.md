# Monitoring foundation

Last updated: 2026-08-24

## Boundary

Mortal Vault reminders are an optional observer service. The monitor reads
confirmed contract events and sends informational notices. It never stores an
owner or beneficiary private key, signs a transaction, decides whether someone
is alive, or changes the contract.

The dashboard exposes a read-only reminder preview. The repository also has a
single-process local worker with two delivery adapters: a fake one that prints
to stdout, and a webhook adapter that POSTs to an endpoint the operator
supplies. Nothing is hosted. A worker that only runs when someone starts it is
not a reliable notification service and may not be described as one.

## Implemented primitives

The repository now contains four deterministic layers:

1. `vault-projection.ts` orders confirmed events and reconstructs the latest
   lifecycle, including pending claims, terminal states, and recreation.
2. `vault-reminders.ts` produces stable, JSON-safe reminder schedules for owner
   heartbeat deadlines, beneficiary claim availability, claim challenges, and
   executable claims.
3. `monitor-state.ts` plans finalized block scans, verifies a stored block-hash
   anchor, and returns a bounded rollback range when it detects a reorg.
4. The same monitor-state layer reconciles a deduplicated outbox, cancels stale
   unsent reminders, leases due work to prevent concurrent delivery, records
   delivery idempotently, and applies capped exponential retry delays.
5. `local-monitor-store.ts` validates and atomically replaces a private JSON
   state file containing canonical events, subscriptions, cursors, and outbox
   entries.
6. `local-monitor-worker.ts` executes one complete scan transaction and the
   `npm run monitor` CLI runs it against an HTTP(S) JSON-RPC endpoint.
7. `webhook-delivery.ts` posts a reminder to an operator-supplied endpoint,
   signs it so the receiver can authenticate it, and throws on any non-2xx
   response so the outbox owns every retry decision.

A projection is safe for reminders only when the current lifecycle's
`VaultCreated` event is present. A bounded partial history that starts later is
shown in the UI but is not treated as sufficient scheduling input.

## Run locally

Start the local node, deploy the contract, and create at least one vault as
described in [`local-dev.md`](local-dev.md). Use the contract's exact deployment
block, then run from `app/`:

```bash
npm run monitor -- \
  --rpc-url http://127.0.0.1:8545 \
  --chain-id 31337 \
  --contract 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  --deployment-block 1 \
  --owner 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --audience both \
  --confirmations 0
```

The first run adds or replaces that owner's opt-in local subscription. Repeat
the command without `--owner` to scan and deliver from existing state. The
default state file is `app/.monitor/state.json`, which is gitignored and written
with `0600` permissions.

Useful local controls to append to the full command above:

- `--no-deliver` builds state and schedules without printing or acknowledging
  deliveries.
- `--fail-kind owner-heartbeat-overdue` exercises retry handling.
- `--unsubscribe 0xOwnerAddress --no-deliver` removes every subscription for
  one owner on this deployment.

Run `npm run monitor -- --help` for every option. The default confirmation depth
is 12; zero confirmations are only appropriate for disposable local testing.
The worker uses the finalized block timestamp as its reminder clock.

The fake adapter writes one JSON object per due reminder to stdout. It sends no
email or message, stores no contact details, and signs no transaction.

## Webhook delivery

`--webhook-url` swaps the fake adapter for one that POSTs each due reminder as
JSON. The endpoint belongs to whoever runs the worker: their own service, or a
chat webhook that ends up on a phone. The repository ships no hosted receiver
and no provider account.

```bash
npm run monitor -- \
  --rpc-url http://127.0.0.1:8545 \
  --chain-id 31337 \
  --contract 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  --deployment-block 1 \
  --owner 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --confirmations 0 \
  --webhook-url https://hooks.example.com/mortal-vault \
  --app-base-url https://vault.example
```

The URL must be `https`, except on localhost. Reminder contents are public
chain data, but plaintext delivery still tells a passive observer exactly when
a vault becomes claimable.

Each request carries three headers:

| Header | Purpose |
| --- | --- |
| `x-mortal-vault-timestamp` | Unix seconds, signed alongside the body |
| `x-mortal-vault-signature` | `sha256=<hex>` HMAC, present only when a secret is set |
| `x-mortal-vault-reminder-id` | Stable id, so a receiver can dedupe independently |

Set `MORTAL_VAULT_WEBHOOK_SECRET` in the environment to sign deliveries. It is
read from the environment rather than a flag so it stays out of shell history
and the process list. Anyone can POST to a webhook URL, so **a receiver must
verify the signature before acting on a reminder**; `verifyWebhookSignature`
in `app/lib/webhook-delivery.ts` does this, and rejects a replayed request once
its timestamp falls outside a 300-second tolerance.

When `--app-base-url` is set, owner reminders carry an `actionUrl` pointing at
`?action=checkin`, which performs one check-in as soon as the wallet and vault
are ready. Beneficiary reminders never carry an action link.

Delivery failure is normal and handled by the outbox, not the adapter: any
non-2xx response, timeout, or unreachable host marks the item `failed` and
schedules a retry with capped exponential backoff, starting at 60 seconds. That
clock is the finalized chain timestamp, so on an idle local chain a retry only
becomes due once a block is mined.

One worker at a time. `load()` is a plain read and `save()` an atomic rename
with nothing between them, so two processes on one state file interleave and
the second silently discards the first's advanced cursor and delivered marks —
resurfacing a sent reminder, or rewinding the scan. A lock file beside the
state file prevents that; a lock whose owner has died, or which is older than
fifteen minutes, is taken over rather than blocking the machine forever. To
watch a second deployment, give it its own `--state-file`.

The subscription list is the one thing in that file the chain cannot rebuild:
it is written from `--owner` and exists nowhere else. A run that ends up
watching nobody, without having been asked to change subscriptions, therefore
exits non-zero and says so — otherwise a deleted state file leaves a monitor
that starts cleanly, scans happily, reports success and warns no one.

The run reports what actually happened rather than what was requested. The
summary's `delivery` field names the adapter that was built — `disabled`,
`fake-stdout`, `webhook (signed)` or `webhook (unsigned)` — and every failure
is printed with its reason. A run with any failed delivery exits non-zero, so
a run in which nobody was reached cannot look like a healthy one to whatever
is supervising it.

## Worker transaction

A production worker should execute one deployment scan as an atomic state
transition:

1. Load the deployment cursor and canonical stored events.
2. Read the latest block and verify the cursor's anchor block hash.
3. Exclude the configured confirmation depth and compute the scan range.
4. If the anchor changed, invalidate stored events from the returned rollback
   block before inserting replacement canonical events.
5. Query logs in bounded ranges and deduplicate by chain, contract,
   transaction hash, and log index.
6. Rebuild affected owner projections and reminder schedules.
7. Reconcile the outbox so owner activity cancels obsolete unsent reminders.
8. Persist events, outbox changes, and the new cursor atomically.
9. Deliver due outbox items only after that commit, then record success or
   retry state.

The local worker implements this sequence. The default cursor policy waits for
12 confirmations and rolls back up to 128
blocks after an anchor mismatch. Deployments may override both values based on
chain finality, but zero-confirmation delivery is inappropriate for this use
case.

## Durable storage contract

The local state store contains only JSON-safe values. Tests verify event and
state round-tripping, event-specific field requirements, duplicate rejection,
unknown schema rejection, private file permissions, and atomic replacement.
It is a development persistence implementation, not a production database.
Only one local monitor process should use a state file at a time; atomic rename
does not provide cross-process transaction isolation.

A hosted worker still needs:

- atomic database transactions, leases, and a canonical event table;
- a scheduler or continuously running process;
- provider failover and operational metrics;
- encrypted, opt-in contact records stored separately from public vault data;
- an email or Telegram adapter, and a hosted receiver for the webhook one;
- unsubscribe, abuse prevention, retention, and privacy handling;
- per-chain confirmation policies and alerting for stalled cursors.

Reorg confirmation and outbox deduplication reduce duplicate or stale notices,
but a message already delivered cannot be recalled. Notifications must always
ask the recipient to verify current on-chain state before acting.

## Security requirements

- Never accept or store seed phrases or private keys.
- Never submit heartbeats or claim transactions for a user.
- Never place contact details or delivery credentials in `NEXT_PUBLIC_*`
  variables.
- Treat RPC responses, persisted state, and delivery-provider errors as
  untrusted input.
- Require an exact deployment block before enabling hosted monitoring.
- Keep monitoring failure isolated from contract and dashboard availability.
