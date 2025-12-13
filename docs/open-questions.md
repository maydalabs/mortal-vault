# Mortal Vault – Open Questions (v1)

These are design decisions we still need to lock in.

1. Can the owner "revive" a vault after it has expired, or is expiry final and irreversible?

2. Do we introduce an explicit CLOSED state, or is a combination of flags enough?
   - Option A: explicit closed flag / enum.
   - Option B: rely on `exists`, `claimed`, and `balance` semantics only.

3. Should owner withdrawals count as "activity" / heartbeat?
   - If yes, withdrawals refresh `lastHeartbeat`.
   - If no, withdrawals do not affect expiry timing.

4. What are safe min/max bounds for the heartbeat timeout?
   - Minimum (to avoid abuse / spam).
   - Maximum (to avoid “set it to 100 years and forget” footguns).

5. Do we allow multiple vaults per owner or exactly one?
   - If one, how do we handle attempts to create again?
   - If many, how are they indexed (id, owner+nonce, etc.)?

6. What exactly happens after a vault has been claimed or closed?
   - Can the same owner immediately create a brand new vault?
   - Do we keep any historical data, or only events?

7. Do we want a grace period concept in v1 (timeout + grace window), or keep it simple with just timeout?
