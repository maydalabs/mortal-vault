# Mortal Vault — test scenarios

Every behaviour the contract must have, and the test that holds it in place.

This file previously described an earlier design in which a beneficiary called
`claim` and received the balance immediately. That is not the contract, and the
difference is the entire product: a claim is a *request* that starts a
challenge period, during which any owner activity cancels it. A reader who
believed the old version would have concluded the design was unsafe.

Names below match the test source exactly, so a scenario with no test is
visible as one. Run `npm test` in `contracts/` for all of them.

## The lifecycle

`None → Active → ClaimRequested → Claimed`, with `Closed` reachable from either
live state, and a fresh vault permitted from either terminal state.

## Core paths

**S1 — An owner keeps a vault alive.** Creating a vault records the beneficiary,
the timeout and the challenge period within their bounds; heartbeats refresh
the clock and keep the beneficiary out.
`creates an active vault with bounded configuration`,
`does not permit a claim request before owner inactivity`

**S2 — An owner goes quiet and the beneficiary claims, but only through the
challenge period.** After the timeout the beneficiary may *request* a claim,
which starts the challenge period; execution before it elapses is rejected;
after it elapses the full balance transfers.
`starts a challenge period after owner inactivity`,
`blocks execution during the challenge period`,
`transfers the full balance after the challenge period`,
`testFuzz_ClaimBoundaryIsStrictAndDelayIsInclusive`

**S3 — The owner can always veto.** A heartbeat cancels a pending claim, and so
does any other owner activity, because the point of the delay is that a living
owner can always take it back.
`lets an owner heartbeat cancel a pending claim`,
`treats deposit, withdrawal, and update as claim-cancelling activity`,
`does not cancel a pending claim when a deposit exceeds the limit`

**S4 — A beneficiary who cannot receive ether is not trapped.** The beneficiary
may name a different recipient at execution; nobody else may.
`test_RejectingBeneficiaryCanSelectSafeRecipient`,
`test_OnlyBeneficiaryCanSelectClaimRecipient`

## Access control

**S5 — Only the owner may operate their own vault**, and only the named
beneficiary may request or execute a claim.
`allows only the configured beneficiary to request a claim`,
`rejects owner operations when no vault exists`,
`test_ClaimRequestGuardBranches`

**S6 — No owner may reach another owner's funds.** Every vault's ether sits in
one pooled contract balance, so this is the property the product rests on: one
owner emptying, closing, or losing their vault leaves every other balance
untouched and still spendable.
`leaves a bystander whole when another owner empties and closes`,
`leaves a bystander whole when another owner's claim executes`,
`invariant_SumOfTrackedBalancesIsSolvent`,
`invariant_EachVaultMatchesItsOwnModel`

## Money

**S7 — Accounting is exact.** Deposits and withdrawals move the tracked balance
and the contract balance together, and ether forced in by other means never
inflates a vault.
`accumulates deposits and refreshes owner activity`,
`withdraws a partial balance and rejects invalid amounts`,
`testFuzz_DepositWithdrawPreservesAccounting`,
`test_ForcedEtherDoesNotInflateTrackedVaultBalance`,
`invariant_TrackedBalanceMatchesModel`, `invariant_ContractRemainsSolvent`

**S8 — The deployment cap is immutable and enforced** at creation and on every
deposit.
`requires a non-zero immutable vault balance limit`,
`enforces the balance limit on creation and deposits`,
`test_EnforcesImmutableVaultBalanceLimit`, `test_RejectsZeroVaultBalanceLimit`,
`invariant_TrackedBalanceNeverExceedsDeploymentLimit`

**S9 — A reentrant caller gains nothing.** Withdrawal, closure and claim
execution all resist reentry, and a failed transfer rolls the state back rather
than leaving a vault drained on paper.
`test_ReentrantOwnerCannotWithdrawTwice`,
`test_ReentrantOwnerCannotCreateDuringClose`,
`test_ReentrantBeneficiaryCannotClaimTwice`,
`test_FailedOwnerTransfersRollBackState`

## Lifecycle edges

**S10 — An owner may close at any live moment**, including during a pending
claim, and take everything back.
`closes a vault and permits a fresh vault`,
`allows closure during a pending claim`

**S11 — Terminal states are terminal**, and a fresh vault is permitted
afterwards.
`prevents duplicate claims and terminal-state mutation`,
`permits a new vault after a completed claim`,
`prevents replacing an active vault`,
`invariant_StatusFieldsRemainConsistent`

**S12 — An empty vault cannot be claimed**, and the view helpers agree with the
lifecycle they report.
`test_EmptyActiveVaultCannotBeClaimed`,
`test_ViewHelpersFollowLifecycleBoundaries`,
`invariant_IdentityAndConfigurationRemainValid`

**S13 — Reconfiguration is bounded.** Updating the beneficiary or the durations
is subject to the same validation as creation, including while a claim is
pending, and a rejected update changes nothing — not the plan, and not the
pending claim it would otherwise have cancelled as owner activity.
`updates the beneficiary and timing bounds`,
`rejects unsafe creation configuration`,
`rejects unsafe reconfiguration and leaves the plan untouched`,
`rejects unsafe reconfiguration during a pending claim too`

## Fuzz and invariant coverage

256 runs per fuzz property; 64 invariant runs at depth 64, driving three
independent owners against one pooled balance. `failOnRevert` is disabled, so
`test_HandlerGuardsAdmitEveryLifecycleTransition` asserts deterministically
that every handler guard still admits the transition it is meant to, and a
campaign cannot quietly shrink to deposits and withdrawals while passing.
