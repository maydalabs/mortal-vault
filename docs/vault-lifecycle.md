# Mortal Vault Lifecycle

Last updated: 2026-08-23

## Overview

Mortal Vault is a self-custodial continuity vault. An owner keeps full control
while active. After the owner exceeds a configured inactivity timeout, the
beneficiary may request a claim. A second delay gives the owner a final chance
to cancel before the beneficiary receives the vault balance.

There is no administrator, custody service, legal determination, or emergency
override. Losing both owner and beneficiary keys can permanently strand funds.

## Roles

- **Owner:** creates, funds, updates, checks in, withdraws from, and closes the
  vault. Owner-signed activity refreshes the heartbeat.
- **Beneficiary:** can request and execute a claim, but only after the required
  inactivity and challenge periods.
- **Observer service:** may read events and send optional reminders. It never
  signs transactions or holds keys.

## States

- `None`: no current vault exists.
- `Active`: owner controls the vault. It may be active or inactive according to
  the computed heartbeat deadline.
- `ClaimRequested`: beneficiary requested a claim after owner inactivity.
- `Claimed`: balance was transferred to the beneficiary.
- `Closed`: owner revoked the plan and recovered the remaining balance.

Inactivity is computed from time; it is not a stored terminal state.

## Lifecycle

### Create

The owner supplies a beneficiary, inactivity timeout, claim delay, and initial
native-asset deposit. The contract validates duration bounds and records the
current block timestamp as the initial heartbeat.

### Owner activity

The following actions refresh the heartbeat:

- explicit heartbeat;
- deposit;
- withdrawal;
- beneficiary or duration update.

If a claim is pending, successful owner activity cancels it and returns the
vault to `Active`.

### Request claim

The beneficiary may request a claim only when:

- the vault is `Active`;
- the caller is the configured beneficiary;
- `block.timestamp > lastHeartbeat + timeout`;
- the vault has a non-zero balance.

The request records `claimRequestedAt` and moves the vault to
`ClaimRequested`.

### Challenge period

The owner retains control during the claim delay. Any successful owner activity
cancels the request. If the owner does nothing, the beneficiary may execute the
claim when `block.timestamp >= claimRequestedAt + claimDelay`.

### Claim

Claim execution sets the balance to zero and state to `Claimed` before sending
funds to the beneficiary. Repeated claims and further mutation revert.

### Close

The owner may close an `Active` or `ClaimRequested` vault. Closure sets the
balance to zero and state to `Closed` before returning funds to the owner.

### Recreate

An owner may create a fresh vault after `Claimed` or `Closed`. The current
storage record is replaced; emitted events preserve prior history.

## Safety invariants

- Only the beneficiary can request or execute a claim.
- A claim cannot execute before both delays have elapsed.
- Any valid owner activity before execution prevents that pending claim.
- `Claimed` and `Closed` vaults cannot be reused or mutated.
- External value transfers occur only after contract state is updated.
- Duration bounds prevent timestamp-addition overflow.
- The recorded balance cannot be withdrawn or claimed more than once.

## Out of scope

- Legal enforceability or probate integration.
- Death certificates or identity attestations.
- Key recovery.
- Yield, lending, bridging, or cross-chain synchronization.
- Multiple beneficiaries, token splits, or ERC-20 assets.
