# Monitoring foundation

Last updated: 2026-08-24

## Boundary

Mortal Vault reminders are an optional observer service. The monitor reads
confirmed contract events and sends informational notices. It never stores an
owner or beneficiary private key, signs a transaction, decides whether someone
is alive, or changes the contract.

The dashboard exposes a read-only reminder preview. The repository also has a
single-process local worker with a fake stdout delivery adapter. External
delivery is not enabled, and neither surface may be represented as a reliable
notification service.

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
- email, Telegram, or another delivery adapter;
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
