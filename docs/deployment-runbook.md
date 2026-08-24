# EVM testnet deployment runbook

Last updated: 2026-08-24

## Scope

This runbook covers reproducible deployments to Ethereum Sepolia, Base
Sepolia, and BNB Smart Chain Testnet. It deliberately contains no mainnet
command. Mortal Vault is unaudited and must not hold meaningful funds.

Each deployment is independent. There is no bridge, administrator, proxy, or
cross-chain state. The constructor permanently fixes a maximum recorded
balance for each vault on that deployment.

## Checked-in deployment inputs

| npm command | Hardhat network | Chain ID | Native asset | Per-vault test cap |
| --- | --- | ---: | --- | ---: |
| `deploy:sepolia` | `sepolia` | 11155111 | Sepolia ETH | 10 |
| `deploy:base-sepolia` | `baseSepolia` | 84532 | Sepolia ETH | 10 |
| `deploy:bsc-testnet` | `bscTestnet` | 97 | tBNB | 100 |

The values live in `contracts/ignition/parameters/`. These are test-network
limits, not statements of economic safety. A future mainnet cap requires a new
reviewed parameter file and an explicit release decision.

## 1. Prepare a release candidate

Use Node.js 22.20.0 and deploy only a committed, clean revision.

```bash
nvm use
cd contracts
npm ci
npm run lint
npm test
npm run test:release
npm run test:release:smoke
npm run test:production
npm run test:gas
npm run test:coverage
git status --short
```

The final command must print nothing. Record the gas report and investigate
unexpected increases before deploying.

## 2. Configure secrets and RPCs

Use a dedicated, low-value testnet deployer. Never use a seed phrase or a key
that controls production assets. Hardhat's encrypted keystore is preferred:

```bash
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set BASE_SEPOLIA_RPC_URL
npx hardhat keystore set BSC_TESTNET_RPC_URL
```

For an ephemeral local shell, copy `contracts/.env.example`, populate it, and
load it explicitly because Hardhat reads environment variables rather than the
file itself:

```bash
cp .env.example .env
set -a
source .env
set +a
```

`.env` is ignored. Before continuing, verify the deployer address and fund it
only with the selected network's faucet asset.

## 3. Deploy one network

Run exactly one command and review the network name, address, and transaction
in the output:

```bash
npm run deploy:sepolia
# or
npm run deploy:base-sepolia
# or
npm run deploy:bsc-testnet
```

Ignition state is stored under `contracts/ignition/deployments/<deployment-id>`
and can resume an interrupted deployment. Do not use `--reset` after a
transaction may have been broadcast without first inspecting the explorer and
Ignition journal.

## 4. Verify source and constructor inputs

After the deployment transaction confirms:

```bash
npm run verify:sepolia
# or the matching verify:base-sepolia / verify:bsc-testnet command
```

The configuration attempts Etherscan-compatible verification and Sourcify.
Open the explorer page and confirm all of the following:

- contract name is `MortalVault`;
- compiler is Solidity 0.8.28 with optimization enabled and 200 runs;
- constructor `maxVaultBalance` matches the checked-in parameter file;
- source is verified and readable;
- there is no proxy or implementation indirection.

## 5. Write the release manifest

Generate the checked-in release record after verification:

```bash
npm run manifest:sepolia -- --verified
# or the matching manifest:base-sepolia / manifest:bsc-testnet command
```

The schema-v2 exporter refuses a dirty repository and checks the chain ID,
constructor cap, production optimizer profile, receipt address, block hash,
and bytecode against Ignition's journal. Review and commit the generated file
in `contracts/deployments/`.

## 6. Audit the live deployment

Wait for at least 12 confirmations, then independently compare the manifest,
current production artifact, and live chain:

```bash
npm run audit:sepolia
# or the matching audit:base-sepolia / audit:bsc-testnet command
```

If the RPC URL exists only in the Hardhat keystore, pass the public endpoint
explicitly with `-- --rpc-url https://...`; the auditor does not read private
keystore values.

The auditor is read-only and requires no private key. It rejects a wrong RPC
chain, missing or changed receipt, insufficient confirmations, unexpected
runtime bytecode, mismatched immutable cap, unverified manifest, dirty release
evidence, or source/build mismatch.

## 7. Configure and verify the app

After the audit passes, write the corresponding address and deployment block
to `app/.env.local` without changing unrelated variables:

```bash
npm run audit:sepolia -- --app-env ../app/.env.local
```

The resulting entries use this format:

```text
NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_SEPOLIA=0x...
NEXT_PUBLIC_MORTAL_VAULT_DEPLOYMENT_BLOCK_SEPOLIA=123456
NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_BASE_SEPOLIA=0x...
NEXT_PUBLIC_MORTAL_VAULT_DEPLOYMENT_BLOCK_BASE_SEPOLIA=123456
NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_BSC_TESTNET=0x...
NEXT_PUBLIC_MORTAL_VAULT_DEPLOYMENT_BLOCK_BSC_TESTNET=123456
```

Only set addresses through a passing release audit. Build the app, then verify
that it displays the expected chain ID, contract address, immutable vault cap,
and complete event history. Without a deployment block the UI intentionally
queries only a bounded recent window and labels the result as partial.

## 8. Testnet smoke exercise

Use separate owner and beneficiary wallets with no production assets:

1. Create a small vault and confirm the explorer event and displayed cap.
2. Deposit and withdraw; confirm the recorded and contract balances remain
   consistent.
3. Attempt a deposit above the remaining cap; the UI and contract must reject
   it without refreshing the heartbeat.
4. Update beneficiary and timing, then perform an explicit heartbeat.
5. Use a short test configuration to request, cancel, request again, and
   execute a claim to a selected recipient.
6. Repeat with a smart-contract recipient before treating that network as
   beta-ready.

Record transaction links and defects in the beta log. Testnet deployment alone
does not satisfy the real-user, hardware-wallet, monitoring, or audit gates.

## Failure and replacement

Mortal Vault is immutable and non-upgradeable. If a deployment has a bad cap,
unverified source, wrong chain, or suspected defect, do not attempt to repair
it in place. Mark it unsupported, deploy a new reviewed instance with a new
deployment ID, publish a new manifest, and update the app address. Existing
vault owners must withdraw or close from the old contract themselves.
