# Mortal Vault threat model

Last updated: 2026-08-24

## Scope

This document covers the Solidity native-asset vault, its owner and beneficiary
state machine, and the browser transaction interface. It does not constitute an
independent audit. Chain consensus, wallet software, RPC providers, and user key
management are external dependencies.

## Assets and security objectives

- Preserve every recorded vault balance until an authorized withdrawal,
  closure, or matured claim succeeds.
- Prevent any caller from spending another owner's recorded balance.
- Prevent a beneficiary from claiming before owner inactivity and the full
  challenge period.
- Let owner activity cancel a pending claim before execution.
- Make `Claimed` and `Closed` terminal for the current vault version.
- Keep the contract free of administrator, upgrade, pause, and custody keys.
- Keep failed native-asset transfers atomic so state and funds roll back
  together.

## Trust boundaries

| Actor or component | Trusted capability | Not trusted for |
| --- | --- | --- |
| Owner key | Managing its own vault and cancelling pending claims | Protecting against its own compromise or loss |
| Beneficiary key | Requesting a claim and selecting its payout recipient | Acting before the contract permits a claim |
| MortalVault contract | Enforcing the published bytecode and state machine | Legal identity, death, intent, or key recovery |
| Browser app | Preparing transactions and displaying chain state | Authorization or final truth; users must verify wallet prompts |
| RPC provider | Relaying reads and transactions | Canonical state without chain confirmation |
| Block producer | Ordering transactions and choosing a bounded timestamp | Bypassing authorization or day-scale delays |

## Attack surfaces and mitigations

| Threat | Impact | Mitigation and coverage |
| --- | --- | --- |
| Unauthorized owner mutation | Theft or plan replacement | Storage is keyed by `msg.sender`; authorization and lifecycle tests cover every owner action |
| Early or unauthorized claim | Theft | Beneficiary, inactivity, request-state, and challenge-period checks; exact timestamp boundaries are fuzzed |
| Reentrant payout callback | Double spend or inconsistent state | Every state-changing external entry point is `nonReentrant`; state changes precede transfers; malicious owner and beneficiary callbacks are tested |
| Receiver rejects native asset | Locked withdrawal or claim | Failed transfers revert all state; beneficiaries can use `executeClaimTo` to select a payable recipient |
| Arithmetic or duration abuse | Broken deadlines or balances | Solidity checked arithmetic, `uint64` duration bounds, and fuzzed amount/time ranges |
| Excessive beta exposure | More value at risk than the deployment policy permits | Immutable constructor cap enforced on creation and top-up; failed over-cap deposits do not mutate heartbeat or claim state |
| Duplicate claim or terminal mutation | Double spend | Balance is zeroed and status made terminal before payout; lifecycle and invariants cover repeat attempts |
| Forced ETH via protocol mechanics | Accounting corruption | Vault accounting never derives from `address(this).balance`; forced surplus is isolated and tested |
| Frontend or RPC deception | Wrong transaction or display | Contract remains authoritative; UI displays chain and contract address; source verification is a release gate |
| Transaction ordering after claim maturity | Owner or beneficiary loses a race | This is an explicit design property: whichever valid owner-cancellation or beneficiary-execution transaction confirms first wins |

## Resolved internal findings

### MV-001: Cross-function callback reentrancy

- Severity: medium.
- Prior behavior: `closeVault` guarded direct reentry into payout functions, but
  a contract owner could call an unguarded mutation such as `createVault` from
  its receive callback. Funds were not double-spent, but final state and event
  ordering could disagree with the closure intent.
- Resolution: all state-changing external entry points now share the
  `ReentrancyGuard`; adversarial withdrawal, closure, and claim callbacks pass.

### MV-002: Smart-contract beneficiary payout denial

- Severity: medium liveness risk.
- Prior behavior: a beneficiary contract that rejected native transfers could
  leave a matured claim unexecutable while the owner was unavailable.
- Resolution: the authenticated beneficiary may call `executeClaimTo` with a
  non-zero payable recipient. Direct failed transfers still roll back fully.

### MV-003: Unbounded per-vault deposits

- Severity: release-blocking risk control.
- Prior behavior: the contract accepted any native-asset deposit, so a capped
  beta policy could be bypassed by calling the contract directly.
- Resolution: every deployment supplies a non-zero immutable balance cap.
  Creation and top-up enforce it before state mutation, and tests prove a
  rejected top-up cannot cancel a pending claim or refresh the heartbeat.

## Open and accepted risks

### Accepted: forced native-asset surplus

ETH forced into the contract without `createVault` or `deposit` is not assigned
to any vault and cannot be recovered. Adding an administrator sweep would
introduce a stronger trust risk. Recorded user balances remain solvent and
withdrawable independently of this surplus.

### Accepted: key and ordering risks

- A compromised owner can withdraw or replace the beneficiary.
- A compromised beneficiary can claim after both deadlines.
- Loss of both keys can permanently strand funds.
- Once a claim is executable, owner cancellation and beneficiary execution are
  competing transactions; chain ordering determines the winner.
- Short chain reorganizations can temporarily change displayed state. Clients
  should wait for suitable finality before treating a claim as operationally
  complete.

## Automated evidence

- TypeScript lifecycle and authorization scenarios.
- Solidity malicious receiver and transfer-rollback scenarios.
- 256 runs per fuzz property for amount and exact timestamp boundaries.
- 64 stateful invariant runs at depth 64 for accounting, solvency, deployment
  cap, identity, configuration, and terminal-state consistency.
- 100% production-contract line and statement coverage, enforced in CI.
- Solhint static analysis with zero permitted warnings on the production
  contract.

## Release requirements

- Re-run all checks against production compiler settings.
- Verify deployed source and constructor inputs on every supported chain.
- Obtain an independent review with no unresolved critical or high findings.
- Run owner and beneficiary exercises with hardware and smart-contract wallets.
