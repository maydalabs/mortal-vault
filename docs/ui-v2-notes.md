# Mortal Vault UI v2

Last updated: 2026-08-24

## Implemented direction

- Single-page owner and beneficiary workspace.
- Two-column desktop layout and overflow-free mobile layout.
- Explicit wallet, chain, contract address, and native balance context.
- Owner create/update, deposit, withdrawal, heartbeat, and closure controls.
- Beneficiary lookup, delayed claim request, and recipient-directed execution.
- Shareable claim URLs containing checksummed owner and target chain values.
- Wallet network switching with wallet-add metadata where public official RPCs
  are available.
- Wallet-approval and on-chain confirmation stages with explorer links.
- Human-readable messages for known wallet and contract errors.
- Session-only confirmation history; chain state remains authoritative.

## Deferred UI work

- Event-backed history across browser sessions.
- Reminder configuration and delivery status.
- Guided hardware-wallet and smart-account exercises.
- Accessibility review with assistive technology.
- Localization and non-technical onboarding content.
- Multiple vaults or beneficiaries.
