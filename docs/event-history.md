# Event-backed activity history

Last updated: 2026-08-24

## Purpose

The app reconstructs activity from confirmed MortalVault logs rather than
keeping browser-session state. The contract remains the source of truth, and a
page refresh or another browser can recover the same history from the selected
chain.

## Filters

- Owner history queries all nine MortalVault event signatures with the owner
  address in indexed topic 1.
- Beneficiary history queries `VaultCreated`, `VaultUpdated`,
  `ClaimRequested`, and `Claimed` with the beneficiary in indexed topic 2.
- Loaded-owner history queries all events for the owner entered in the claim
  workspace. This is the complete lifecycle view and includes events such as
  `ClaimCancelled` that do not index the beneficiary.

Logs are decoded into one typed activity representation, deduplicated by
transaction hash and log index, timestamped from their blocks, and sorted
newest first. Removed logs are ignored.

## RPC boundaries

Queries are sequential and use inclusive ranges of at most 5,000 blocks. This
avoids unbounded `eth_getLogs` calls and reduces public RPC rejection and rate
limit risk.

Every public deployment should configure its exact deployment block through
the matching `NEXT_PUBLIC_MORTAL_VAULT_DEPLOYMENT_BLOCK_*` variable. If that
value is absent, the app scans only the latest 50,000 blocks and visibly marks
the result as partial. It never silently scans from genesis.

An RPC range failure is reported only inside the history panel. Wallet
connection, contract reads, and transaction controls remain usable. Block
timestamp failures degrade to displaying the block number.

## Reminder foundation

The event parser and role filters define the inputs needed by a future reminder
worker: current owner configuration, latest heartbeat, pending claim, claim
cancellation, and terminal state. A worker must add durable cursors, finality
confirmation, reorg handling, and notification delivery; the browser history
does not claim to be an indexer or monitoring service.
