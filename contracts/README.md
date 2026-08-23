# Mortal Vault contracts

Hardhat project for the Solidity implementation of Mortal Vault.

## Verify

```bash
npm ci
npm run compile
npm run lint
npm test
npm run test:production
npm run test:coverage
```

Coverage is enforced at 100% of instrumented production-contract lines. The
security suite includes malicious callbacks, transfer rollback, fuzz tests, and
stateful invariants. See [`../docs/threat-model.md`](../docs/threat-model.md).

## Local deployment

In one terminal:

```bash
npm run node
```

In another terminal:

```bash
npm run deploy:local
```

The first deployment to a fresh Hardhat node is expected at
`0x5FbDB2315678afecb367f032d93F642f64180aa3`.

## Sepolia deployment

Configure the RPC URL and a funded deployer key using Hardhat's encrypted
keystore, then deploy with a persistent deployment ID:

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
npm run deploy:sepolia
```

Do not deploy to mainnet before an independent security audit and explicit
release review.
