# Deployment manifests

This directory contains the reviewable release record for each public
deployment. Hardhat Ignition's resumable state remains ignored because it is
large and environment-specific; the manifest exporter reads that state and
writes the security-relevant subset here.

Schema-v2 manifests include the deployment block hash and exact runtime
bytecode hash so the release can be checked independently against a live RPC.
Generate a manifest only from a clean, committed release candidate:

```bash
npm run manifest:sepolia
npm run manifest:base-sepolia
npm run manifest:bsc-testnet
```

After source verification succeeds, append `-- --verified`. The exporter fails
if the chain ID, constructor cap, production compiler profile, receipt address,
or bytecode in Ignition's journal differs from the checked-in release inputs.

Audit the checked-in manifest against the live deployment before configuring
the app:

```bash
npm run audit:sepolia -- --app-env ../app/.env.local
npm run audit:base-sepolia -- --app-env ../app/.env.local
npm run audit:bsc-testnet -- --app-env ../app/.env.local
```

The auditor requires verified source and 12 confirmations for public networks.
It reads the RPC URL from the matching environment variable or `--rpc-url`,
and it never needs the deployer private key.

`--allow-dirty` exists only for local exporter testing. A public release
manifest with `gitDirty: true` is invalid release evidence.
