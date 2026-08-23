# Deployment manifests

This directory contains the reviewable release record for each public
deployment. Hardhat Ignition's resumable state remains ignored because it is
large and environment-specific; the manifest exporter reads that state and
writes the security-relevant subset here.

Generate a manifest only from a clean, committed release candidate:

```bash
npm run manifest:sepolia
npm run manifest:base-sepolia
npm run manifest:bsc-testnet
```

After source verification succeeds, append `-- --verified`. The exporter fails
if the chain ID or constructor cap in Ignition's journal differs from the
checked-in network parameter file.

`--allow-dirty` exists only for local exporter testing. A public release
manifest with `gitDirty: true` is invalid release evidence.
