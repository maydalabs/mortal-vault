# Mortal Vault

Mortal Vault is a self-custodial continuity vault for native crypto assets. An
owner remains in control while they check in periodically. If they become
inactive, a designated beneficiary can start a delayed claim that the owner can
cancel by proving they are still active.

This repository is under active development. The contracts are not audited and
must not be used with meaningful funds.

## Repository

- `contracts/` - Solidity contracts, Hardhat deployment modules, and tests.
- `app/` - Next.js dashboard for owners and beneficiaries.
- `docs/` - Product, lifecycle, testing, and delivery decisions.

## Requirements

- Node.js 22.20.0 (see `.nvmrc`)
- npm
- An injected EVM wallet such as MetaMask for browser testing

## Verify locally

```bash
cd contracts
npm ci
npm test

cd ../app
npm ci
npm run lint
npm run build
```

## Current delivery target

The first public beta targets an EVM testnet and a capped low-cost EVM mainnet
deployment. Ethereum mainnet and Starknet mainnet are post-audit milestones.
Starknet requires a separate Cairo implementation and is tracked as an
independent port, not as a Solidity deployment.

See [docs/revival-roadmap.md](docs/revival-roadmap.md) for the current scope and
release gates.
