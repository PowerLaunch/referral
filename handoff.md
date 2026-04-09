# HANDOFF — April 9, 2026 (Session 2 complete)

## IMMEDIATE ACTION ITEMS (in order)

### 1. Add "branch off main" rule
Write a Cursor command to add this rule to both `.cursorrules` and `CLAUDE.md`:
"All new branches must be based off main. Never branch from feat/scaffold or any other feature branch."

### 2. Run security TODOs command
There's a ready-to-go command for `chore/security-todos` that adds TODO comments for 12 security measures. It's independent and touches different files. Run it based off main.

### 3. Write and run Round 2 Cursor commands (PR B + PR D)
See the ROUND 2 PLAN section below. Claude should write the full Cursor commands for both PRs at the start of the next session, then Tony pastes them into two Cursor windows in parallel.

---

## COMPLETED THIS SESSION (Session 2)

| PR# | Branch | What | Status |
|-----|--------|------|--------|
| #21 | fix/session-diversity → main | Session diversity (min 3 sessions for referral confirmation) | ✅ MERGED |
| #24 | feat/scaffold → main | Sync feat/scaffold into main (admin dashboard code) | ✅ MERGED (6 BugBot rounds) |
| #25 | feat/admin-users → main | User management (7-C) + Disputes tab (7-H) | ✅ MERGED (10 BugBot rounds) |
| #26 | feat/admin-influencers → main | Influencer management (7-G) | ✅ MERGED (6 BugBot rounds) |

### Migrations run this session:
1. `20260408000003_session_diversity.sql` ✅
2. `20260408000004_admin_foundation.sql` ✅
3. `UPDATE profiles SET is_admin = true WHERE email = '...'` ✅
4. `20260409000001_admin_users_disputes.sql` (ALTER TABLE profiles ADD COLUMN is_vip) ✅
5. `20260409000002_influencer_codes.sql` (influencer_codes table + referrals.influencer_code_id FK) ✅

### Key BugBot patterns caught and fixed:
- TOCTOU race conditions on dispute resolution → atomic `.neq('status', 'RESOLVED')` guards
- N+1 DB queries in cron → join queries with `!inner`
- Missing state guards on server actions (e.g. unflagSuspicious could downgrade BANNED → SUSPICIOUS)
- NaN bypassing numeric validation → `Number.isFinite()` + `Number.isInteger()` checks
- Triplicated utility functions → shared imports
- Unvalidated UUID path params in PostgREST `.or()` → regex validation
- Partial failure handling → audit log before returning error
- requireAdmin() must always be first call in server actions (before input validation)

---

## OVERALL PROJECT STATUS

### Completed Phases:
- Phase 1 (Foundation) ✅
- Phase 2 (Referral Engine) ✅
- Phase 3 (Credit System) ✅
- Phase 4 (Fraud Engine) ✅
- Phase 6 (User Dashboard) ✅ — PR #20
- Phase 7: 7-A ✅, 7-B ✅, 7-C ✅, 7-G ✅, 7-H ✅, 7-I ✅ — PRs #22, #25, #26

### Blocked:
- Phase 5 (Payments & KYC) — blocked by provider paperwork (Transak/Triple-A not contacted)

### Skipped:
- 7-F (KYC management) — depends on Phase 5

### 26 PRs merged to main. No open PRs.

---

## ROUND 2 PLAN — Next session (parallel)

Tony runs two Cursor windows in parallel. Claude writes both mega-commands at the start of the session.

| Window | PR | Branch | Contains | Spec sections |
|--------|----|--------|----------|---------------|
| 1 | **PR B** | feat/admin-cashouts-fraud | 7-D (cashout review) + 7-E (fraud management) | Sections 5.3, 5.4, 6.5, 6.6 |
| 2 | **PR D** | feat/hardening | 8-A (security audit) + 8-B (cron hardening) | Phase 8 hardening |

### PR B — Cashout Review + Fraud Management (7-D + 7-E)
**Why combined:** Both share fraud/risk score display patterns and depend on the user management table from PR #25.

**7-D scope (cashout review):**
- Cashout review page at app/admin/cashouts/page.tsx
- Tabs: Pending Review | Delayed | Approved | Completed | Rejected | Failed
- Per payout row: user email, amount, method, risk score (color coded), FIRST PAYOUT badge, created_at, retry count
- Actions: Approve (calls executePayout — stub for now, Phase 5 dependency), Reject with reason dropdown (Fraud Suspected / Wrong Details / Policy Violation / Other) + optional notes + credit return via awardCredits(), Batch approve for low-risk (score < 30) under $25
- Failed payouts tab: provider error code, retry count, retry_available_at, manual retry button
- All actions logged to admin_audit_logs

**7-E scope (fraud management):**
- Fraud flags feed at app/admin/fraud/page.tsx with severity color coding (red=CRITICAL, orange=WARNING, blue=INFO), filter by severity and rule type
- Device fingerprint cluster view: group by fingerprint_hash where user count > 1, show truncated hash + user IDs + flag count
- Sybil cluster view: group by verified_kyc_hash where count > 1, show user IDs only (NO emails — spec Section 5.4)
- Circuit breaker controls: pause cashouts + pause referral confirmations toggles (RPCs already exist from PR #24)
- Webhook log viewer: last 50 payment_events

### PR D — Security Audit + Cron Hardening (8-A + 8-B)
**Why combined:** Both are small non-UI hardening tasks, independent of Phase 7.

**8-A scope (security audit):**
- RLS verification across all tables
- Verify service role key never exposed on client side
- Verify no API routes without auth
- Webhook signature validation stubs
- CSP headers

**8-B scope (cron hardening):**
- All cron endpoints protected with Authorization: Bearer {CRON_SECRET}
- BetterStack monitoring setup (stubs/config)
- Sentry error monitoring setup (stubs/config)
- Cron schedule verification in vercel.json

### After Round 2 — Round 3 (solo):
| PR | Branch | Contains |
|----|--------|----------|
| **PR E** | feat/e2e-test-setup | 8-C (E2E test scripts) — depends on PR D |

---

## WORKFLOW RULES

- **Cursor commands:** start with `Read .cursorrules first. This is a code change task only — do not investigate.`, end with commit/push instruction
- **BugBot debugging:** Tony pastes BugBot review from GitHub PR page + whether there are merge conflicts. That's all Claude needs.
- **All BugBot issues (High/Medium/Low) must be resolved before merging**
- **Migrations:** Run manually in Supabase SQL editor after merging. Always paste the full SQL contents directly — never refer to a document or file path unless it's a file in the repo's migrations folder.
- **Label every fix command with the PR number** so Tony knows which PR the feedback is for
- **Two PRs in parallel:** paste first command → Cursor codes → push → BugBot starts → paste second command → push → BugBot starts → debug both as results come in
- **All new branches MUST be based off main**

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
- All new branches based off main (NOT feat/scaffold)
- Package name: `@referral/api`
- requireAdmin() must be the FIRST call in every admin server action (before input validation)
- Use atomic DB-level guards (e.g. `.neq('status', 'RESOLVED')`) for state transitions — don't rely on JS-level checks alone
- Validate UUID format on all path params before interpolating into PostgREST `.or()` filters
- Always guard NaN with `Number.isFinite()` before numeric range checks

---

## KEY BUGBOT LESSONS (apply to all future commands)

These patterns were caught repeatedly in this session. Include them in Cursor commands to avoid repeat BugBot rounds:

1. **requireAdmin() first:** Always the first line in server actions, before any input validation
2. **Atomic state guards:** Use `.neq('status', 'RESOLVED')` in UPDATE queries, check row count after — never rely on a separate SELECT then UPDATE
3. **NaN validation:** `typeof x !== 'number' || !Number.isFinite(x)` before range checks
4. **Integer validation:** `!Number.isInteger(x)` for credit amounts
5. **State transition guards:** Every action that changes trust_level must check current value first (e.g. can't flag BANNED as SUSPICIOUS)
6. **Partial failure handling:** If operation A succeeds but operation B fails, write an audit log entry before returning error
7. **No N+1 queries in crons:** Use joins with `!inner` to filter at DB level
8. **Deduplicate utilities:** Extract shared functions (riskColor, requireAdmin, risk score calc) into shared files
9. **UUID validation:** Regex check path params before interpolating into `.or()` filters
10. **Shared timestamps:** Capture `new Date().toISOString()` once and reuse across related queries
