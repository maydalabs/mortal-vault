# Mortal Vault – Vault Lifecycle (v1)

## 1. Overview

Mortal Vault is a self-custody “dead-man switch” for crypto. The owner locks funds into a vault and must periodically prove they are still alive and in control by sending on-chain heartbeats. If they stop heartbeating for long enough, the vault is treated as expired and the designated beneficiary can claim the funds.

There is no admin, no legal layer, and no third party that can override the rules. If both owner and beneficiary lose keys, the funds are effectively lost.

---

## 2. Roles and core concepts

**Owner**  
The address that creates and controls a vault while it is “alive”. Only the owner can fund, update, heartbeat, or (optionally) close the vault while it is active.

**Beneficiary**  
The address that can claim the vault *after* it has expired. Beneficiary has no power while the vault is alive.

**Vault**  
A record that tracks:
- `owner`
- `beneficiary`
- `timeout` (heartbeat interval in seconds or days)
- `lastHeartbeat` (timestamp of the last heartbeat / activity)
- `balance` (funds assigned to this vault)
- status flags (e.g. exists, claimed, maybe closed)

**Heartbeat**  
An explicit on-chain action from the owner that refreshes `lastHeartbeat`. As long as heartbeats keep coming in before `now > lastHeartbeat + timeout`, the vault stays “alive”.

**Timeout / expiry**  
If `now > lastHeartbeat + timeout`, the vault is considered expired. Once expired, we treat it as if the owner has disappeared and only the beneficiary is allowed to move funds.

**Claim**  
The on-chain action where the beneficiary withdraws funds from an expired vault and we mark the vault as used so it cannot silently be reused.

---

## 3. Conceptual states

We think about each owner’s vault in these high-level states:

- **None** – No vault exists yet for this owner.
- **Active** – Vault exists, has a beneficiary and timeout, and has not expired.
- **Expired** – Timeout has passed without a heartbeat; vault is eligible for beneficiary claim.
- **Claimed** – Beneficiary has claimed funds from an expired vault.
- **Closed** (optional) – Owner has explicitly closed the vault while still alive (funds withdrawn, vault no longer usable).

These states might be represented with booleans/fields in storage rather than a single enum, but behaviour must match this mental model.

---

## 4. Normal flow – owner alive and heartbeating

1. Owner calls `createVault` (or equivalent) with:
   - beneficiary address
   - timeout (heartbeat interval)
   - initial deposit

2. Contract stores:
   - `owner` = msg.sender
   - `beneficiary`
   - `timeout`
   - `lastHeartbeat` = current block timestamp
   - `balance` = amount deposited
   - status flags so this vault is considered **Active**.

3. While the vault is Active:
   - Owner can:
     - send **heartbeats** to refresh `lastHeartbeat`
     - optionally **top up** the vault balance
     - optionally **update** beneficiary or timeout within safe bounds
   - Beneficiary can do nothing yet.
   - Vault should **not** be considered expired as long as
     `now <= lastHeartbeat + timeout`.

4. If the owner keeps heartbeating on time, the vault should stay Active indefinitely and the owner should be able to withdraw funds back (depending on product decision).

---

## 5. Expiry flow – owner disappears, beneficiary claims

1. If the owner stops heartbeating and **no heartbeat arrives before `now > lastHeartbeat + timeout`**, the vault becomes **Expired**.

2. Once Expired:
   - Owner is treated as gone and should not be able to:
     - heartbeat
     - withdraw
     - change beneficiary or timeout
   - Beneficiary **can** call `claim` (or equivalent) to withdraw the vault balance.

3. On successful claim:
   - Funds are transferred to the beneficiary.
   - The vault must be marked so it cannot be reused silently:
     - e.g. `claimed = true`, `balance = 0`, and/or move to a **Claimed** state.

4. After claim, any further attempts by owner or beneficiary should either:
   - revert, or
   - be handled under a clearly defined “post-claim” rule (e.g. owner can create a brand new vault, but not mutate the old one).

---

## 6. Closing / revoking while alive (optional v1 behaviour)

We need to decide if Mortal Vault supports an explicit “close while alive” operation:

- If **yes**:
  - Owner can call a `closeVault` / `ownerWithdrawAll` when the vault is Active.
  - Contract withdraws remaining funds to the owner.
  - Vault moves to a **Closed** state where:
    - No more deposits or heartbeats are allowed.
    - Beneficiary cannot claim.
    - Owner can potentially create a brand new vault from scratch.

- If **no**:
  - There is no special Closed state.
  - Owner can only withdraw partially and keep the vault alive, or leave it to eventually expire and be claimed.
  - This is simpler but less flexible.

For now, this is left as an open design decision and must be reflected in `docs/open-questions.md`.

---

## 7. Assumptions and out-of-scope

- No legal guarantees: Mortal Vault is a technical tool, not a legal will.
- No key recovery: if owner or beneficiary lose their keys, the contract cannot help.
- No yield or external integrations: the contract just holds funds; it doesn’t invest or lend them.
- No admin backdoor: there is no privileged address that can move funds or change timeouts once deployed.
- Time is based purely on on-chain timestamps; we do not try to correct for miner manipulation beyond standard EVM assumptions.
