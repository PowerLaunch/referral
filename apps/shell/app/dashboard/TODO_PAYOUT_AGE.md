# TODO: Payout Age Requirement

Phase 3 dependency: enforce 7-day minimum account age
(profiles.created_at + 7 days) before payout eligibility.

Do not implement here — this check belongs in the payout
request route (PR 3-D).

Implementation notes:
- Check: `profiles.created_at + INTERVAL '7 days' <= NOW()`
- Return error: "Account must be at least 7 days old to request payout"
- This prevents abuse via rapid signup → payout cycles
