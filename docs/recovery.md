# Operating a vault without this project

The README says nothing here depends on a third party staying in business. This
page is what makes that true rather than merely stated: every action either
party can take, performed directly against the contract, with no website, no
server, and nothing from us.

Read it once while everything works. That is the only time it is easy.

> **These contracts are not audited.** Keep only test funds in them.

## What you need

- The **contract address** and its chain. The app footer shows both, and the
  release manifest in `contracts/deployments/` records them for each network.
- A wallet holding the relevant key: the **owner's** key for owner actions, the
  **beneficiary's** key to claim.
- A block explorer with a "Write Contract" tab (Etherscan and its equivalents),
  or any tool that can send a transaction to a known address.

Verified source is what makes the explorer's contract tabs work at all, which
is why the release process treats verification as a gate rather than a nicety.

## Reading the vault

`getVault(address owner)` is free to call and returns, in this order:

| # | Field | Meaning |
| ---: | --- | --- |
| 1 | `vaultOwner` | The owner. Zero when no vault exists. |
| 2 | `beneficiary` | The only address that may claim. |
| 3 | `timeout` | Quiet period, **in seconds**. |
| 4 | `claimDelay` | Challenge period, **in seconds**. |
| 5 | `lastHeartbeat` | Unix time of the owner's last activity. |
| 6 | `claimRequestedAt` | Unix time a claim began; `0` if none is pending. |
| 7 | `balance` | Wei held for this vault. |
| 8 | `status` | `0` none, `1` active, `2` claim requested, `3` claimed, `4` closed. |
| 9 | `inactive` | The quiet period has elapsed. |
| 10 | `claimable` | The challenge period has elapsed; the claim can execute. |

The deadline that matters is `lastHeartbeat + timeout`. Once a claim is pending,
the one that matters is `claimRequestedAt + claimDelay`.

`isInactive(owner)` and `isClaimable(owner)` answer the same two questions
directly.

## If you are the owner

Connect the owner's wallet. Every call below is sent to the contract address.

**Check in — the one that matters.** Call `heartbeat()`. No arguments, no value.
It resets the quiet period, and if a claim is pending it cancels it outright.
This is the whole product; if you learn one call, learn this one.

**Add funds.** Call `deposit()` and send the amount as the transaction's value.

**Take funds out.** Call `withdraw(uint256 amount)`, where `amount` is **in
wei**, not ether. One ether is `1000000000000000000`.

**Change the plan.** Call `updateVault(address beneficiary, uint64 timeout,
uint64 claimDelay)`. Both durations are **in seconds**: 180 days is `15552000`,
60 days is `5184000`. The contract accepts a timeout between 1 and 1825 days,
and a claim delay between 1 and 180 days.

**End it and take everything back.** Call `closeVault()`. The full balance
returns to you and the vault becomes inert. You may create a new one afterwards.

Every one of these also counts as activity, so any of them cancels a pending
claim. You do not have to remember which.

## If you are the beneficiary

Connect the wallet at the beneficiary address — no other wallet can do this,
and nobody can change that for you.

1. **Confirm the owner is actually overdue.** Call `isInactive(owner)`. If it
   returns false, nothing can proceed, and that is the protection working.
2. **Start the claim.** Call `requestClaim(address owner)`. This begins the
   challenge period. The owner can still cancel it by checking in, which is
   deliberate.
3. **Wait.** Call `isClaimable(owner)` until it returns true.
4. **Complete it.** Call `executeClaim(address owner)` to receive the balance at
   your own address, or `executeClaimTo(address owner, address recipient)` to
   send it elsewhere — useful if your address cannot receive ether directly.

Before doing any of this, read the warnings in the printed guide the owner left
you. Claiming from an owner who is alive may be theft where you live, and may
be taxed as a gift.

## If the owner's wallet cannot receive ether

`withdraw` and `closeVault` both pay to the caller, so an owner address that
rejects incoming ether cannot be paid out — the transaction reverts and the
funds stay in the vault rather than being lost. There is no owner-side
equivalent of `executeClaimTo`.

The escape is the inheritance path itself: let the quiet period elapse and have
the beneficiary claim to a working address. It costs the full quiet period plus
the challenge period and needs the beneficiary's cooperation, which is why the
setup wizard warns against naming an address you cannot prove you control.

## If you have lost the beneficiary's key

Call `updateVault` with a new beneficiary while you still can. This is the
reason to check the plan yearly rather than only at setup.

## If you have lost the owner's key

The vault is no longer yours to operate, and nobody can restore it. What is
left is the design working as intended: stop checking in, and after the quiet
period and the challenge period the beneficiary receives the balance. If that
beneficiary is someone you trust, this is a slow recovery rather than a loss.

Nobody — not the beneficiary, not the developers, not anyone holding this
document — can shorten either period.
