# Mortal Vault – UI v2 direction

- Layout: single-page dashboard, 2-column on desktop, stacked on mobile.
- Top shell: product name, environment (Hardhat localhost), connection state, wallet balance.
- Left column: owner controls (create/update vault, heartbeat, withdraw).
- Right column: activity timeline (local only for now, later on-chain events).
- Tone: “serious but friendly” — inheritance / death topic but approachable.
- Future:
  - Multiple vaults per owner → list + detail pattern.
  - Inline “simulation” controls (jump time forward, simulate death).
  - Real event feed (VaultCreated, Heartbeat, Withdrawn, Claimed).
