# Mortal Vault app

The Next.js owner and beneficiary workspace for Mortal Vault.

## Run locally

Start a Hardhat node and deploy the contract first. See
[`../docs/local-dev.md`](../docs/local-dev.md).

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The local chain ID is
`31337`; the default local contract address is configured in `.env.example`.

## Verify

```bash
npm run lint
npm run build
```

Only public contract addresses belong in `NEXT_PUBLIC_*` variables. Never put a
wallet private key in this app.
