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

---

## Rule
If an idea comes up mid-build that is not in the 35-PR plan:
1. Decide: is it a patch to an existing PR (small, safe) or a new PR?
2. If patch: add it to an existing branch or a new -patch branch. Log it here.
3. If new PR: add it to the PR LOG in PROGRESS.md with a new PR number.
4. Never silently add features without logging them somewhere.
