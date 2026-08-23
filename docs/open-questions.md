# Mortal Vault Decision Log

Last updated: 2026-08-23

The original prototype left several lifecycle choices open. These decisions are
locked for the public-beta contract so implementation and tests have one source
of truth.

## Resolved decisions

1. **Can an inactive vault be revived?**

   Yes. Inactivity makes a vault eligible for a beneficiary claim request, but
   does not immediately transfer control. Any owner activity before claim
   execution cancels a pending claim and refreshes the heartbeat.

2. **Is there an explicit closed state?**

   Yes. `Closed` is a terminal state for a vault version. Closing returns all
   funds to the owner, and the owner may then create a new vault.

3. **What counts as owner activity?**

   Heartbeat, deposit, withdrawal, and configuration update all prove control,
   refresh `lastHeartbeat`, and cancel a pending claim.

4. **What are the duration bounds?**

   - Inactivity timeout: minimum 1 day, maximum 5 years.
   - Claim delay: minimum 1 day, maximum 180 days.

   The frontend may recommend safer defaults, but the contract enforces these
   absolute bounds to prevent overflow and obvious configuration mistakes.

5. **How many vaults can an owner have?**

   One current vault per owner. Historical versions are represented by events.
   A new vault can be created only after the previous one is `Claimed` or
   `Closed`.

6. **What happens after claim or closure?**

   The terminal vault cannot be mutated. The owner may create a new vault,
   replacing the current storage record while prior events remain available.

7. **Is there a grace period?**

   Yes. The beneficiary first requests a claim after inactivity. Funds can be
   transferred only after the configured claim delay, giving the owner time to
   cancel by proving activity.

## Deferred decisions

- Multiple vaults and beneficiaries.
- ERC-20 asset handling.
- Smart-account or Safe module integration.
- Encrypted time capsules.
- Legal or identity verification integrations.
