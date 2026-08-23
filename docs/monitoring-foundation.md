# Monitoring foundation

Last updated: 2026-08-24

## Boundary

Mortal Vault reminders are an optional observer service. The monitor reads
confirmed contract events and sends informational notices. It never stores an
owner or beneficiary private key, signs a transaction, decides whether someone
is alive, or changes the contract.

The dashboard currently exposes a read-only reminder preview. Background
delivery is not enabled, and the preview must not be represented as a reliable
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

A projection is safe for reminders only when the current lifecycle's
`VaultCreated` event is present. A bounded partial history that starts later is
shown in the UI but is not treated as sufficient scheduling input.

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

The default cursor policy waits for 12 confirmations and rolls back up to 128
blocks after an anchor mismatch. Deployments may override both values based on
chain finality, but zero-confirmation delivery is inappropriate for this use
case.

## Durable storage contract

Cursor and outbox types contain only JSON-safe values. Tests verify state
round-tripping and reject unknown schema versions. This is a persistence
contract, not a production database implementation.

A hosted worker still needs:

- atomic database transactions and a canonical event table;
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
