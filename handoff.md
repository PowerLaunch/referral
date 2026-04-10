# HANDOFF — April 10, 2026 (Session 3 complete)

## IMMEDIATE ACTION ITEM

### 1. Write and run PR E — E2E Test Setup (8-C)
This is the ONLY remaining PR. Claude writes the full Cursor command, Tony pastes it into Cursor.

| PR | Branch | Contains | Spec sections |
|----|--------|----------|---------------|
| PR E | feat/e2e-test-setup | 8-C (E2E test scripts) | Phase 8 testing |

**8-C scope:**
- Create PHASE8_TESTING.md in repo root with step-by-step manual test procedures
- TEST 1: Full referral journey (signup → refer → subscribe → gameplay → cron → confirm → payout)
- TEST 2: Maturity checkpoint (cancel mid-lock → freeze → resubscribe → resume → verify math)
- TEST 3: R7 Sybil detection (two accounts, same KYC hash → REVIEW_HOLD + CRITICAL flag)
- TEST 4: Payout failure handling (trigger payout → simulate failure → verify credit-back + E4 email + cooldown)
- TEST 5: Real $1 transaction (full flow through Transak/MoonPay in production)
- Each test includes: expected result, pass/fail criteria, what to check in admin dashboard

---

## COMPLETED THIS SESSION (Session 3)

| GitHub PR# | Scope ref | Branch | What | Status |
|------------|-----------|--------|------|--------|
| #27 | chore | chore/security-todos → main | TODO reminders for 12 security measures (5-A, 5-B, post-Phase-5) | ✅ MERGED |
| #28 | chore | chore/branch-rule → main | Enforced "branch off main" rule in .cursorrules and CLAUDE.md | ✅ MERGED |
| #29 | 7-D + 7-E | feat/admin-cashouts-fraud → main | Cashout review + fraud management (9 BugBot fix rounds) | ✅ MERGED |
| #30 | 8-A + 8-B | feat/hardening → main | Security audit + cron hardening (5 BugBot fix rounds) | ✅ MERGED |

### Migrations run this session:
1. `20260409000003_cashouts_fraud.sql` — ALTER TABLE payouts ADD COLUMN admin_notes text + REJECTED status in CHECK constraint ✅

### Key BugBot patterns caught and fixed this session:
- executePayout must use .select() after .update() to detect zero-row updates (concurrent modification)
- Status reverts on failure need atomic .eq('status', 'PROCESSING') guard to avoid overwriting concurrent rejections
- executePayout exceptions (not just { ok: false }) must also trigger status revert
- Batch approve must skip (not approve) when risk score DB query fails (fail-closed for money-out)
- Batch approve result must surface errors array to admin UI, not just counts
- Shared constants (REJECTION_REASONS) must be exported from one place, not duplicated
- CSP headers must include regional Sentry ingest domains (*.ingest.us.sentry.io, *.ingest.de.sentry.io)
- Per-cron heartbeat URLs needed (single URL masks individual cron failures)
- Fraud scan partial failures should still record heartbeat (cron ran, rules failed individually)
- Cron outer catch blocks need console.error alongside Sentry.captureException (DSN may be unset)
- riskColor display threshold must match batch approve threshold (both >= 30 = yellow/rejected)
- Successful payout retry must clear stale provider_error_code

---

## ALL MERGED PRs (complete history)

| GitHub PR# | Scope ref | Branch | What |
|------------|-----------|--------|------|
| #1 | 1-A | feat/project-setup | Monorepo, Next.js, Tailwind, Supabase client |
| #2 | 1-B | feat/database-schema | Phase 1 tables + RLS |
| #5 | 1-C | feat/auth | Supabase Auth, signup, login, middleware |
| #6 | 1-D | feat/referral-code-gen | 8-char code gen, self-referral prevention |
| #7 | 2-A | feat/referral-tracking | Click tracking, referrals table, code capture |
| #8 | 2-B+2-C | feat/shell-app + email | Shell app, heartbeat, email templates |
| #9 | 2-D | feat/lock-periods | Lock period calc, signup bonus, VPN stub |
| #10 | 3-A | feat/credit-system | Canonical credit ledger (awardCredits/deductCredits) |
| #11 | 3-B | feat/referral-confirmation | Daily cron, confirmation criteria, audit logs |
| #12 | 3-B-patch | feat/referral-confirmation-patch | Payment collateralization + credit voiding |
| #13 | 3-C | feat/maturity-checkpoint | Freeze/unfreeze RPCs, referral audit logs |
| #14 | 3-D | feat/payout-workflow | Payout request, failure handler, recurring cron |
| #15 | 4-A | feat/risk-scoring | Risk score, fraud tables, fingerprint capture |
| — | chore | chore/vercel-build-fixes | ESLint, Suspense, optional deps for Vercel |
| #16 | 4-B+4-C | feat/fraud-rules-r1-r7 | All 7 fraud rules, KYC hashing, shadow review |
| #17 | 4-D | feat/fraud-middleware | Device re-auth, chargeback handler, fraud→cron wiring |
| #18 | chore | chore/claude-code-config | CLAUDE.md + .cursorrules update |
| #19 | patch | fix/referral-honeymoon | 14-day cooldown after first referral |
| #20 | 6-A–6-E | feat/user-dashboard | Full user dashboard (combined 6-A through 6-E) |
| #21 | patch | fix/session-diversity | Min 3 gameplay sessions for referral confirmation |
| #22 | 7-A+7-B+7-I | feat/admin-foundation | Admin auth, pulse page, config editor, seed users, audit log, kill switches |
| #23 | — | (closed) | Mistaken PR direction — closed immediately |
| #24 | chore | feat/scaffold → main | Sync feat/scaffold into main |
| #25 | 7-C+7-H | feat/admin-users | User management + disputes tab |
| #26 | 7-G | feat/admin-influencers | Influencer management |
| #27 | chore | chore/security-todos | TODO reminders for 12 security measures |
| #28 | chore | chore/branch-rule | Branch-off-main rule enforcement |
| #29 | 7-D+7-E | feat/admin-cashouts-fraud | Cashout review + fraud management |
| #30 | 8-A+8-B | feat/hardening | Security audit + cron hardening |

**Total: 30 PRs merged. 0 open. 1 remaining (PR E: 8-C).**

---

## PHASE COMPLETION STATUS

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 (Foundation) | ✅ Complete | PRs #1–#6 |
| Phase 2 (Referral Engine) | ✅ Complete | PRs #7–#9 |
| Phase 3 (Credit System) | ✅ Complete | PRs #10–#14 |
| Phase 4 (Fraud Engine) | ✅ Complete | PRs #15–#17 |
| Phase 5 (Payments & KYC) | ❌ BLOCKED | Provider paperwork not started (Transak/Triple-A) |
| Phase 6 (User Dashboard) | ✅ Complete | PR #20 |
| Phase 7 (Admin Dashboard) | ✅ Complete (except 7-F) | 7-A✅ 7-B✅ 7-C✅ 7-D✅ 7-E✅ 7-F❌blocked 7-G✅ 7-H✅ 7-I✅ |
| Phase 8 (Hardening) | 🔶 In progress | 8-A✅ 8-B✅ 8-C remaining |

**7-F (KYC management) skipped — depends on Phase 5 provider paperwork.**

---

## WHAT REMAINS AFTER PR E

Once PR E (8-C) merges, all buildable phases are complete. The project is then blocked on:

1. **Phase 0 paperwork:** Contact Transak, MoonPay, Triple-A, XanPool. Get chargeback liability confirmation and off-ramp business verification.
2. **Phase 5 (Payments & KYC):** PRs 5-A through 5-D. Cannot start until Phase 0 completes.
3. **7-F (KYC management admin):** Depends on Phase 5.
4. **Game development:** Current shell game is a placeholder. Daily puzzle suite (NYT Games model) is planned but not yet designed.
5. **Phase 8 dry-run week:** Manual admin-supervised testing with real $1 transactions. Requires Phase 5.

---

## WORKFLOW RULES

- **Cursor commands:** start with `Read .cursorrules first. This is a code change task only — do not investigate.`, end with commit/push instruction. Always include `Create branch [name] from main.`
- **BugBot debugging:** Tony pastes BugBot review from GitHub PR page + whether there are merge conflicts. That's all Claude needs.
- **All BugBot issues (High/Medium/Low) must be resolved before merging**
- **Migrations:** Run manually in Supabase SQL editor after merging. Always paste the full SQL directly — never refer to a file path.
- **All new branches MUST be based off main** (enforced in .cursorrules and CLAUDE.md)
- **Before any merge advice:** Claude must verify the PR's base branch. If it targets feat/scaffold, retarget to main first (pencil icon → Edit title → change base).
- **Before giving status updates:** Claude must check past conversations or ask Tony, not assume.

---

## KEY ARCHITECTURAL RULES (never deviate)

- `awardCredits()` / `deductCredits()` are the ONLY credit modification paths
- No SQL triggers — application-layer logic only
- SECURITY DEFINER → SET search_path = public + REVOKE/GRANT to service_role only
- Append-only tables → REVOKE UPDATE/DELETE from all roles
- Cron auth: `Authorization: Bearer {CRON_SECRET}`
- Admin client for writes, cookie-based server client for reads
- Game never imports from packages/api — API routes only
- All dates explicit UTC
- Never use `::date` cast — use `CAST(timezone('UTC', x) AS date)`
- All new branches based off main
- Package name: `@referral/api`
- requireAdmin() must be the FIRST call in every admin server action
- Use atomic DB-level guards for state transitions
- Validate UUID format on path params before interpolating into PostgREST `.or()` filters
- Guard NaN with `Number.isFinite()` before numeric range checks
- executePayout must use .select() after .update() to detect zero-row updates
- Status reverts need atomic .eq('status', 'PROCESSING') guard
- Batch money-out operations: fail-closed on DB errors (skip, don't approve)
- Per-cron BetterStack heartbeat URLs (not one shared URL)
