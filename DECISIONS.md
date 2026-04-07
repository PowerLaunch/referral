# DECISIONS LOG

This file tracks mid-build additions and improvements that are outside the
original 35-PR plan but have been added to the codebase. It is NOT a replacement
for the scope document — it is a lightweight record so nothing gets lost.

## How to use this file
When you add something outside the PR plan, add a row here before merging.
Format: Date | What was added | Why | Which files changed

---

## Log

| Date | Addition | Reason | Files Changed |
|------|----------|--------|---------------|
| 2026-04-05 | PR 3-B-patch: Payment collateralization gate on confirmation cron | Prevents referral confirmation against unsettled or refundable payments | confirm-referrals/route.ts, migration 20260405000001 |
| 2026-04-05 | PR 3-B-patch: voidPendingCredits() + VOIDED referral status | Auto-voids pending referrals on CRITICAL fraud flag | packages/api/src/credits.ts, packages/api/src/fraudRules.ts, migration 20260405000001 |
| 2026-04-05 | PR 3-B-patch fix: voidPendingCredits now covers both referrer and referee roles | BugBot catch — fraudulent referee's referrer would otherwise still earn credits | packages/api/src/credits.ts |
| 2026-04-05 | PR 3-B-patch fix: confirm_referral RPC now awards credits atomically | Race condition between voidPendingCredits and confirmation cron could orphan credits | apps/shell/supabase/migrations/20260404000009_confirm_referral_rpc.sql, confirm-referrals/route.ts |
| 2026-04-06 | PRs 4-B and 4-C combined into single PR (feat/fraud-rules-r1-r7) | Both PRs implement fraud detection — combining reduces context switching and integration overhead | All R1–R7 rules in fraudRules.ts, status and trust_level are separate columns per spec |
| 2026-04-07 | PR 4-D: Device force_reauth deferred to Phase 8 | profiles.status column already exists from PR 4-B/4-C. referral_confirmations_paused and cashouts_paused columns already added in PR 4-B/4-C migration. Device re-auth via force_reauth column deferred to Phase 8; current implementation blocks SUSPICIOUS users from payout routes via middleware trust_level check. | middleware.ts, fingerprint-capture.tsx, chargebackHandler.ts, confirm-referrals/route.ts |

---

## Rule
If an idea comes up mid-build that is not in the 35-PR plan:
1. Decide: is it a patch to an existing PR (small, safe) or a new PR?
2. If patch: add it to an existing branch or a new -patch branch. Log it here.
3. If new PR: add it to the PR LOG in PROGRESS.md with a new PR number.
4. Never silently add features without logging them somewhere.
