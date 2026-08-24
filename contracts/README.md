# Mortal Vault contracts

Hardhat project for the Solidity implementation of Mortal Vault.

## Verify

```bash
npm ci
npm run compile
npm run lint
npm test
npm run test:release
npm run test:release:smoke
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

## Testnet release

Configure the RPC URL and a funded deployer key using Hardhat's encrypted
keystore, then deploy with a persistent deployment ID:

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
npm run deploy:sepolia
npm run verify:sepolia
npm run manifest:sepolia -- --verified
npm run audit:sepolia -- --app-env ../app/.env.local
```

The final command independently checks the RPC chain, deployment transaction,
block hash, optimized runtime bytecode, immutable vault cap, and source-tree
build identity before updating the app's public address and deployment block.
It requires 12 confirmations by default.

Do not deploy to mainnet before an independent security audit and explicit
release review.
