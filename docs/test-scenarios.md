# Mortal Vault – Test Scenarios (v1)

This file lists the core behaviours the MortalVault contract must support. Each item should map to one or more automated tests.

## Core happy paths

S1 – Owner keeps a vault alive with heartbeats  
- Owner creates a vault with a beneficiary, timeout, and initial deposit.  
- Owner sends heartbeats before timeout passes.  
- Vault remains active (not expired), and beneficiary cannot claim.  

S2 – Owner disappears, beneficiary claims after expiry  
- Owner creates a vault and funds it.  
- Time passes (no heartbeats) until now > lastHeartbeat + timeout.  
- Beneficiary calls claim and receives the full vault balance.  
- Vault is marked so it cannot silently be reused.

## Access control

S3 – Non-owner cannot modify someone else’s vault  
- A second account attempts to create/update/withdraw/heartbeat for an existing owner’s vault.  
- All such calls revert.

S4 – Non-beneficiary cannot claim a vault  
- A third account (not owner, not beneficiary) attempts to claim an expired vault.  
- Call reverts.

S5 – Beneficiary cannot claim before expiry  
- Vault is created and funded.  
- Beneficiary tries to claim while now <= lastHeartbeat + timeout.  
- Claim is rejected.

## Lifecycle edge cases

S6 – Partial owner withdrawals while alive  
- Owner withdraws part of the balance while the vault is active.  
- Balance decreases correctly, `lastHeartbeat` behaviour is defined (either treated as activity or not), and the vault remains active.

S7 – Closing / revoking while alive (if supported)  
- Owner calls a “close” or “withdraw all and close” function while the vault is active.  
- Remaining funds go back to owner.  
- Vault becomes unusable for future deposits/claims according to the chosen design.

S8 – Behaviour after claim / close  
- Once a vault is claimed or closed, further heartbeats / claims / withdrawals revert or are handled in a clearly defined way.  
- Owner may or may not be allowed to create a brand new vault, depending on the chosen model.

S9 – Multiple deposits / top-ups (if supported)  
- Owner funds the vault multiple times while active.  
- Balance accumulates correctly and does not break expiry/claim logic.
