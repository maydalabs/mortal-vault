# Local development

## Prerequisites

- Node.js 22.20.0 (`nvm use` from the repository root)
- npm
- MetaMask or another injected EVM wallet

## 1. Start the chain

```bash
cd contracts
npm ci
npm run node
```

Keep this terminal running. Hardhat prints funded development accounts and
their private keys. These keys are public test credentials and must never hold
real assets.

## 2. Deploy Mortal Vault

In a second terminal:

```bash
cd contracts
npm run deploy:local
```

On a fresh chain the deployment address is expected to be
`0x5FbDB2315678afecb367f032d93F642f64180aa3`. If it differs, set
`NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_LOCAL` in `app/.env.local` to the address
printed by Ignition. The local parameter file sets an immutable 1,000 ETH
per-vault development cap.

## 3. Start the app

In a third terminal:

```bash
cd app
cp -n .env.example .env.local
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 4. Add Hardhat to MetaMask

- Network name: `Hardhat Local`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`

Import two of the accounts printed by `npm run node`. Use `Account #0` as the
owner and `Account #1` as the beneficiary.

## 5. Smoke test

1. Connect the owner, enter the beneficiary address, use a 1-day inactivity
   timeout and 1-day challenge period, then create the vault with a small test
   deposit.
2. Confirm the vault shows `Active`, then deposit, withdraw, and check in.
3. Switch to the beneficiary and load the owner's address in the beneficiary
   workspace. Claim request is intentionally unavailable until the timeout.
4. Refresh the page and confirm owner history is restored from on-chain events;
   compare the beneficiary and loaded-owner filters.
5. Run `npm test` in `contracts/` for automated time-travel coverage of request,
   cancellation, and execution.

Restarting the Hardhat node resets all local chain state. Redeploy before using
the app again.

## Run the local reminder worker

After deployment and vault creation, open another terminal and follow the
command in [`monitoring-foundation.md`](monitoring-foundation.md). A typical
fresh local Ignition deployment is block 1, but verify rather than assuming the
deployment block if the node was already used.

The worker scans finalized events, stores canonical local state under
`app/.monitor/`, and prints fake reminder deliveries as JSON. It does not need a
wallet key and must never be given one.
