# Mortal Vault Revival Roadmap

Last updated: 2026-08-24

## Release objective

Ship a public, testnet-first continuity vault with a complete owner and
beneficiary journey. A capped EVM mainnet beta is allowed only after an
independent security review finds no unresolved critical or high-severity
issues.

## MVP scope

- One owner and one beneficiary per vault.
- One native chain asset per vault.
- Bounded inactivity and claim-delay periods.
- Owner deposit, withdrawal, configuration update, check-in, and closure.
- Beneficiary claim request followed by a challenge period.
- Any owner activity during the challenge period cancels the claim.
- Shareable beneficiary claim URL.
- Optional reminders that never hold keys or submit owner transactions.
- Independent deployments per chain; no bridges or shared cross-chain state.

## Explicitly deferred

- Multiple beneficiaries and percentage splits.
- ERC-20 support.
- Encrypted time capsules.
- Legal document generation or death-certificate verification.
- Yield, lending, or other DeFi integrations.
- Protocol token.
- Uncapped mainnet deposits.

## Eight-week delivery

| Week | Deliverable | Exit gate |
| --- | --- | --- |
| 1 | Reproducible builds, CI, decision log, baseline security tests | App builds; real lifecycle tests pass |
| 2 | Hardened V2 contract and complete state machine | No known fund-locking path |
| 3 | Network configuration and beneficiary claim portal | Owner and beneficiary flows pass on testnet |
| 4 | Event-backed activity and optional reminders | Five external users complete both flows |
| 5 | Fuzzing, invariants, static analysis, threat model | No unresolved internal critical/high findings |
| 6 | Closed testnet beta and grant package | Twenty vaults and five simulated claims |
| 7 | Capped EVM mainnet candidate and Starknet Sepolia port | Independent review approves EVM candidate |
| 8 | Public beta, monitoring, verified source, and applications | Reproducible release and support runbook |

## Current engineering status

- Week 1 and Week 2 repository gates are complete.
- The local owner and beneficiary journeys are implemented; external testnet
  validation remains open.
- Week 3 repository work is complete: Ethereum Sepolia, Base Sepolia, and BSC
  Testnet configurations, reproducible constructor inputs, verification
  commands, release manifests, and UI deployment-cap disclosure are present.
- Week 4 event-history engineering is complete: all contract events are parsed,
  owner and beneficiary filters use bounded RPC ranges, and confirmed history
  survives browser refreshes. Deterministic reminder rules, finalized cursors,
  reorg rollback planning, and a durable outbox state model are implemented;
  hosted delivery and external-user exercises remain open.
- Week 5 repository security work is complete: adversarial tests, fuzzing,
  stateful invariants, static analysis, threat model, and enforced coverage.
- Mainnet remains blocked by independent review, external wallet exercises,
  monitoring, and demonstrated beta demand.

## Release gates

Mainnet deployment is blocked until all of the following are true:

- Lifecycle, authorization, boundary, and reentrancy tests pass.
- Fuzz and invariant tests cover balance and terminal-state safety.
- Contract source is verified and deployment inputs are reproducible.
- An independent reviewer has resolved all critical and high findings.
- The UI clearly labels chain, contract address, beta status, and deposit cap.
- Owner and beneficiary recovery instructions have been tested by real users.

## Chain sequence

1. Local Hardhat network.
2. Ethereum Sepolia and a low-cost EVM testnet.
3. Capped low-cost EVM mainnet beta.
4. BNB Smart Chain testnet as an additional EVM deployment.
5. Starknet Sepolia using a separate Cairo implementation.
6. Ethereum and Starknet mainnet only after review and demonstrated demand.
