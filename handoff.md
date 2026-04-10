# HANDOFF — April 10, 2026 (Session 4 complete)

## IMMEDIATE ACTION ITEMS

### 1. Debug PR #33 and PR #34 (running in parallel)

Both PRs are currently being built by Cursor. Tony will paste BugBot results for both.

| PR | Branch | Contains | Status |
|----|--------|----------|--------|
| #33 | feat/ip-classification | 10-B: IP infrastructure classification + R19 datacenter cluster rule | Building in Cursor |
| #34 | feat/referral-source | 10-C: Referral source attribution + R17 red source flag + admin blocklist | Building in Cursor |

**When BugBot results arrive:**
- Tony pastes both BugBot reviews into Claude
- Claude debugs both in one response
- Both PRs target main — verify before merging
- Both have migrations — run in Supabase SQL editor after each merge

**Cursor commands for both PRs are already written and pasted.** The full commands are in the conversation history of Session 4. If you need to regenerate fix commands, read PHASE10_FRAUD_HARDENING.md in the project files for the full spec.

### 2. After PR #33 merges — Run migration
Run `20260410000002_ip_classification.sql` in Supabase SQL editor. Get the exact SQL from the repo:
```
apps/shell/supabase/migrations/20260410000002_ip_classification.sql
```

### 3. After PR #34 merges — Run migration
Run `20260410000003_referral_source.sql` in Supabase SQL editor. Get the exact SQL from the repo:
```
apps/shell/supabase/migrations/20260410000003_referral_source.sql
```

### 4. After BOTH merge — Continue Phase 10 Round 3
Next round (parallel):
| PR | Branch | Contains |
|----|--------|----------|
| 10-D | feat/signup-telemetry | Signup funnel anomaly detection, trust score adjustments |
| 10-F | feat/honeypot | Honeypot referral codes, canary accounts, R_HONEYPOT |

Cursor commands for 10-D and 10-F have NOT been written yet. Claude must write them.

---

## COMPLETED THIS SESSION (Session 4)

| GitHub PR# | Scope ref | Branch | What | Status |
|------------|-----------|--------|------|--------|
| #31 | 8-C | feat/e2e-test-setup → main | Phase 8 manual test procedures (PHASE8_TESTING.md) | ✅ MERGED |
| #32 | 10-A | feat/trust-score → main | Graduated trust score system (0-1000), payout staging, dynamic caps | ✅ MERGED (7 BugBot fix rounds) |

### Migrations run this session:
1. `20260410000001_trust_score_system.sql` — trust_score/trust_tier on profiles, trust_score_events ledger, adjust_trust_score RPC, payout staging, game_config trust tier columns ✅

### Key BugBot patterns caught and fixed this session:
- STAGED payout promotion must run in 15-min fraud cron, not monthly recurring-payouts cron
- Partial unique indexes needed for EVERY idempotent trust bonus (subscription, gameplay, VIP — not just referral_longevity)
- STAGED must be included in idx_payouts_one_pending_per_user to prevent concurrent payout double-spend
- Gameplay bonus must filter by date range, not use lifetime total_minutes (gameplay_sessions has one cumulative row per user, no per-session records)
- Exported utility functions (getDynamicReferralCap, getDynamicLockPeriodDays) must be wired into actual call sites
- Admin cashout UI must include STAGED tab for visibility during staging window
- REJECTED and CANCELLED payout statuses need display mappings in statusDisplay.ts
- getDynamicReferralCap must have try/catch with fallback to static cap (deleted referrer profiles)
- adjust_trust_score RPC needs FOR UPDATE on SELECT to prevent lost concurrent updates
- adjust_trust_score RPC needs NOT FOUND check on game_config (NULL thresholds default everyone to VETERAN)
- Staging rollback must verify CANCELLED update succeeded before refunding credits
- adjustTrustScore must attach error.code to thrown Error (not just message) for 23505 duplicate detection
- CANCELLED payout status needs display mapping alongside REJECTED

---

## PHASE 10 PROGRESS

Read PHASE10_PR_PLAN.md and PHASE10_FRAUD_HARDENING.md in the project files for full details.

| PR | Branch | Status | GitHub PR# | Notes |
|----|--------|--------|------------|-------|
| 10-A | feat/trust-score | ✅ MERGED | #32 | Foundation — 7 fix rounds |
| 10-B | feat/ip-classification | 🔶 BUILDING | #33 | Round 2 parallel with 10-C |
| 10-C | feat/referral-source | 🔶 BUILDING | #34 | Round 2 parallel with 10-B |
| 10-D | feat/signup-telemetry | NOT STARTED | — | Round 3 (after 10-B/C merge) |
| 10-F | feat/honeypot | NOT STARTED | — | Round 3 parallel with 10-D |
| 10-E | feat/graph-topology | NOT STARTED | — | Round 4 solo (heaviest PR) |
| 10-G | feat/payout-profiling | BLOCKED | — | Needs Phase 5 |
| 10-H | feat/proof-of-humanity | BLOCKED | — | Needs Phase 5 |
| 10-I | feat/timing-correlation | BLOCKED | — | Needs Phase 5 |
| 10-J | feat/economic-sanity | BLOCKED | — | Needs Phase 5 |
| 10-K | feat/behavioral-fingerprint | DEFERRED | — | Post-launch |
| 10-L | feat/admin-fraud-intel | DEFERRED | — | Post-launch |

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
| #22 | 7-A+7-B+7-I | feat/admin-foundation | Admin auth, pulse page, config editor, seed users |
| #23 | — | (closed) | Mistaken PR — closed immediately |
| #24 | chore | feat/scaffold → main | Sync feat/scaffold into main |
| #25 | 7-C+7-H | feat/admin-users | User management + disputes tab |
| #26 | 7-G | feat/admin-influencers | Influencer management |
| #27 | chore | chore/security-todos | TODO reminders for 12 security measures |
| #28 | chore | chore/branch-rule | Branch-off-main rule enforcement |
| #29 | 7-D+7-E | feat/admin-cashouts-fraud | Cashout review + fraud management |
| #30 | 8-A+8-B | feat/hardening | Security audit + cron hardening |
| #31 | 8-C | feat/e2e-test-setup | Phase 8 manual test procedures |
| #32 | 10-A | feat/trust-score | Graduated trust score system |

**Total: 32 PRs merged. 2 building (#33, #34). Phase 10 Round 2 in progress.**

---

## PHASE COMPLETION STATUS

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 (Foundation) | ✅ Complete | PRs #1–#6 |
| Phase 2 (Referral Engine) | ✅ Complete | PRs #7–#9 |
| Phase 3 (Credit System) | ✅ Complete | PRs #10–#14 |
| Phase 4 (Fraud Engine) | ✅ Complete | PRs #15–#17 |
| Phase 5 (Payments & KYC) | ❌ BLOCKED | Provider paperwork not started |
| Phase 6 (User Dashboard) | ✅ Complete | PR #20 |
| Phase 7 (Admin Dashboard) | ✅ Complete (except 7-F) | 7-F blocked on Phase 5 |
| Phase 8 (Hardening) | ✅ Complete | PRs #30, #31 |
| Phase 10 (Fraud Hardening) | 🔶 In progress | 10-A✅, 10-B/C building |

---

## WORKFLOW RULES

- Cursor commands: start with `Read .cursorrules first. This is a code change task only — do not investigate.`, end with commit/push instruction
- BugBot debugging: Tony pastes BugBot review from GitHub PR page. That's all Claude needs.
- All BugBot issues (High/Medium/Low) must be resolved before merging
- Migrations: Run manually in Supabase SQL editor after merging. Always get exact SQL from the repo via GitHub MCP — never paste from memory.
- All new branches MUST be based off main
- Before any merge advice: verify PR targets main (not feat/scaffold). Retarget via pencil icon if needed.
- Two PRs in parallel: paste first → Cursor builds → push → BugBot → paste second → push → BugBot → debug both
- GitHub MCP tools available for reading files from repo

---

## KEY ARCHITECTURAL RULES (never deviate)

- `awardCredits()` / `deductCredits()` are the ONLY credit modification paths
- No SQL triggers — application-layer logic only
- SECURITY DEFINER → SET search_path = public + REVOKE/GRANT to service_role only
- Append-only tables → REVOKE UPDATE/DELETE from all roles
- Cron auth: `Authorization: Bearer {CRON_SECRET}`
- Admin client for writes, cookie-based server client for reads
- Game never imports from packages/api — API routes only
- All dates explicit UTC, never use `::date` cast
- All new branches based off main
- Package name: `@referral/api`
- requireAdmin() must be the FIRST call in every admin server action
- adjustTrustScore must attach error.code to thrown Error for 23505 detection
- Staging rollback must verify update succeeded before refunding credits
- adjust_trust_score RPC uses FOR UPDATE to prevent lost concurrent updates
- Per-cron BetterStack heartbeat URLs (not one shared URL)

---

## PROJECT FILES TO READ

- **PHASE10_PR_PLAN.md** — The Phase 10 build plan with round-by-round execution order
- **PHASE10_FRAUD_HARDENING.md** — Full Phase 10 spec with all Cursor commands, fraud rules R16-R22, table definitions
- **handoff.md** (this file) — Current state and next steps
- **SECURITY.md** — All security measures and fraud rules
- **referral_app_scope_v5.docx** — Original product scope (Phases 0-8)
- **referral_app_pr_plan.docx** — Original PR plan (Phases 0-8)
- **PROGRESS.md** — STALE, do not trust. Use this handoff.md instead.
