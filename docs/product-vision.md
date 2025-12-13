# Mortal Vault – Product Vision (v1)

## 1. One-liner

Mortal Vault is a self-custody “dead-man switch” for crypto: while you prove you’re still alive with periodic heartbeats, you keep full control over your funds; if you disappear long enough, your chosen beneficiary can step in and claim them.

No bank, no lawyer, no third-party admin – just on-chain rules and keys.

---

## 2. Who it’s for

- Crypto-native users who:
  - Self-custody meaningful amounts.
  - Worry about “what happens if I get hit by a bus?”
  - Don’t want to trust centralized exchanges, custodians, or legal-tech startups with their inheritance plan.

- People who are comfortable:
  - Using MetaMask / hardware wallets.
  - Reading simple on-chain instructions (“send heartbeat once every X days”).

Not for:
- People who want legal guarantees, probate integrations, or fiat rails.
- People who are not comfortable managing private keys.

---

## 3. Core concept: Vaults + Time Capsules

**Vaults**  
- Hold funds and define who can do what, and when:
  - Owner: full control while alive and heartbeating.
  - Beneficiary: can only claim after timeout/expiry.
- On-chain logic is simple, auditable, and focused on safety.

**Time Capsules (future layer)**  
- Encrypted messages or “letters” that are tied to a vault’s lifecycle.
- Unlock when:
  - A vault expires and/or
  - A beneficiary successfully claims.

Examples:
- A note explaining how to handle funds.
- Instructions for accessing off-chain assets (password hints, location of seed backups, etc.).
- Personal messages to family.

Capsules are **off-chain encrypted blobs** referenced on-chain (hashes/metadata), not raw data stored in the contract.

---

## 4. Bitcoin brain, EVM body

- **Bitcoin brain**:
  - Minimalism: no yield farming, no rehypothecation, no unnecessary complexity.
  - Self-custody first: smart contract is a tool, not a custodian.
  - No admin “god mode” keys.

- **EVM body** (v1):
  - Built and shipped on Ethereum-style chains (Hardhat localhost → Sepolia → maybe mainnet).
  - Uses standard tooling (Solidity, Hardhat, Next.js, ethers) for faster iteration.
  - Later, we explore Bitcoin-native equivalents (time locks, script templates) once we have product/UX clarity.

---

## 5. V1 scope

What **v1** of Mortal Vault should focus on:

- Single-asset vault (one chain, one asset type per deployment).
- Single owner, single beneficiary per vault.
- Simple heartbeat + timeout mechanism.
- Clear, safe states: Active, Expired, Claimed (and maybe Closed).
- Straightforward UI:
  - Connect wallet.
  - Set beneficiary + timeout.
  - Fund vault.
  - See status (alive / expired / claimed).
  - Owner actions: heartbeat, withdraw.
  - Beneficiary action: claim after expiry.

No v1 features:
- No complex multi-beneficiary logic.
- No legal document generation.
- No yield integrations.
- No multi-chain bridge magic.

---

## 6. Longer-term ideas (beyond v1)

- Multiple beneficiaries and programmable splits (e.g. 50/30/20).
- Support for multiple assets or vault “buckets” per owner.
- Richer Time Capsule UX:
  - Multiple messages with different unlock conditions.
  - “Only unlock if X days after expiry” grace periods.
- Bitcoin-native implementation using:
  - Timelocks.
  - Miniscript / script templates.
  - PSBT workflows for inheritance flows.
- Optional integrations:
  - Notarisation / proof-of-existence for wills or documents (hashes only).
  - “Ping services” that remind owners to heartbeat (email/Telegram/etc. without ever touching keys).
