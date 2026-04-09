# HANDOFF — April 9, 2026

## IMMEDIATE ACTION ITEMS (in order)

### 1. Debug PR #24 (chore: merge feat/scaffold into main)
- **Status:** Open, BugBot found 3 Medium issues + merge conflicts
- **Branch:** feat/scaffold → main
- **URL:** https://github.com/PowerLaunch/referral/pull/24
- **Purpose:** Brings all PR #22 admin code from feat/scaffold into main. Without this, the admin dashboard code is stranded on feat/scaffold.
- **Cursor command ready (paste into Cursor):**

```
Read .cursorrules first. This is a code change task only — do not investigate.

=== PR #24 — chore/merge feat/scaffold into main — BugBot fix round 1 ===

On branch feat/scaffold, fix these 3 BugBot issues AND resolve all merge conflicts with main:

1. MEDIUM — Audit log pagination has overlapping rows (apps/shell/app/api/admin/audit-logs/route.ts):
   The current code uses .range(offset, offset + limit) which fetches limit + 1 rows due to inclusive bounds. Change the approach: fetch .range(offset, offset + limit) (limit + 1 rows), then slice to limit for the response, and set hasMore = allRows.length > limit.

2. MEDIUM — Logical OR prevents admin from setting zero gameplay minutes (apps/shell/app/(dashboard)/game/actions.ts):
   Change: data.min_gameplay_minutes || 10
   To: data.min_gameplay_minutes ?? 10

3. MEDIUM — Revenue dashboard shows misleading subscription revenue metric (apps/shell/app/admin/page.tsx):
   Update the label from "Net Revenue (All-Time)" to "Net Revenue (Estimate)". Add a comment: // Placeholder metric: counts current active/past_due subs × $5. Will be replaced with actual payment_events sum once payment integration exists.

4. Resolve ALL merge conflicts with main. Run: git merge origin/main
   Keep both sides in all conflicting files:
   - DECISIONS.md
   - PROGRESS.md
   - apps/shell/app/api/cron/recurring-payouts/route.ts
   - apps/shell/app/api/payout/request/route.ts
   - packages/api/src/statusDisplay.ts

After fixing, commit and push to feat/scaffold. PR #24 is already open.
```

### 2. Debug PR #21 (fix/session-diversity)
- **Status:** Open, BugBot passed clean on commit 01b069d (no code issues), but merge conflicts remain
- **Branch:** fix/session-diversity → feat/scaffold
- **URL:** https://github.com/PowerLaunch/referral/pull/21
- **Purpose:** Adds min 3 gameplay sessions requirement for referral confirmation (anti-farming)
- **Cursor command ready (paste into Cursor):**

```
Read .cursorrules first. This is a code change task only — do not investigate.

=== PR #21 — fix/session-diversity — Merge conflict resolution (final) ===

On branch fix/session-diversity, run: git merge origin/feat/scaffold

Resolve ALL merge conflicts. Specific guidance for DECISIONS.md: keep ALL three entries from both sides:
- The user dashboard entry (PRs 6-A through 6-E combined)
- The session diversity entry
- The admin foundation entry (PR #22)
Do NOT drop any rows.

For all other conflicting files, keep both sides:
- PROGRESS.md
- apps/shell/app/api/cron/confirm-referrals/route.ts
- apps/shell/app/api/payout/request/route.ts
- apps/shell/middleware.ts
- apps/shell/supabase/migrations/20260406000005_fraud_flags_idempotency.sql
- packages/api/src/fraudRules.ts
- packages/api/src/statusDisplay.ts

After resolving, commit and push to fix/session-diversity. PR #21 is already open.
```

**NOTE ON PR #21:** It targets feat/scaffold, not main. After PR #24 merges feat/scaffold into main, either change PR #21's base to main on GitHub, or merge it into feat/scaffold then do another sync.

### 3. After PR #24 merges — Run migration
Run `20260408000004_admin_foundation.sql` in Supabase SQL editor:

```sql
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS details jsonb;

CREATE POLICY "service_role_insert" ON admin_audit_logs FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "service_role_select" ON admin_audit_logs FOR SELECT TO service_role USING (true);

CREATE TABLE seed_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by_admin uuid NOT NULL REFERENCES profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seed_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON seed_users FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE cron_health (
  cron_name text PRIMARY KEY,
  last_success_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cron_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON cron_health FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.toggle_cashouts_paused()
RETURNS boolean AS $$
DECLARE new_value boolean;
BEGIN
  UPDATE public.game_config SET cashouts_paused = NOT cashouts_paused WHERE singleton = true RETURNING cashouts_paused INTO new_value;
  RETURN new_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.toggle_cashouts_paused() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_cashouts_paused() TO service_role;

CREATE OR REPLACE FUNCTION public.toggle_referral_confirmations_paused()
RETURNS boolean AS $$
DECLARE new_value boolean;
BEGIN
  UPDATE public.game_config SET referral_confirmations_paused = NOT referral_confirmations_paused WHERE singleton = true RETURNING referral_confirmations_paused INTO new_value;
  RETURN new_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.toggle_referral_confirmations_paused() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_referral_confirmations_paused() TO service_role;

ALTER TABLE game_config ADD COLUMN IF NOT EXISTS min_session_count integer NOT NULL DEFAULT 3;
ALTER TABLE game_config ADD COLUMN IF NOT EXISTS monthly_referral_cap integer NOT NULL DEFAULT 50;
```

Then set yourself as admin:
```sql
UPDATE profiles SET is_admin = true WHERE email = 'YOUR_EMAIL_HERE';
```

### 4. After PR #21 merges — Run migration
Run `20260408000003_session_diversity.sql` from the PR branch in Supabase SQL editor.

### 5. After BOTH PRs merge — Add "branch off main" rule
Add to both `.cursorrules` and `CLAUDE.md`: "All new branches must be based off main. Never branch from feat/scaffold or any other feature branch."

### 6. After BOTH PRs merge — Run security TODOs command
There's a ready command for `chore/security-todos` that adds TODO comments for 12 security measures. Run it based off main.

---

## OVERALL PROJECT STATUS

### Completed Phases:
- Phase 1 (Foundation) ✅
- Phase 2 (Referral Engine) ✅
- Phase 3 (Credit System) ✅
- Phase 4 (Fraud Engine) ✅
- Phase 6 (User Dashboard) ✅ — PR #20
- Phase 7 partial: 7-A, 7-B, 7-I ✅ — PR #22

### Blocked:
- Phase 5 (Payments & KYC) — blocked by provider paperwork

### 22 PRs merged to main. PR #21 and #24 open and in progress.

---

## PLAN: REMAINING PRs WITH PARALLEL EXECUTION

### Round 1 (parallel):
| PR | Branch | Contains |
|----|--------|----------|
| PR A | feat/admin-users | 7-C (user management) + 7-H (disputes tab) |
| PR C | feat/admin-influencers | 7-G (influencer management) |

### Round 2 (parallel):
| PR | Branch | Contains |
|----|--------|----------|
| PR B | feat/admin-cashouts-fraud | 7-D (cashout review) + 7-E (fraud management) |
| PR D | feat/hardening | 8-A (security audit) + 8-B (cron hardening) |

### Round 3 (solo):
| PR | Branch | Contains |
|----|--------|----------|
| PR E | feat/e2e-test-setup | 8-C (test scripts) |

7-F (KYC management) skipped until Phase 5 unblocks. All new branches MUST be based off main.

---

## WORKFLOW RULES

- Cursor commands: start with `Read .cursorrules first.`, end with commit/push instruction
- BugBot debugging: Tony pastes BugBot review from GitHub PR page + merge conflict list. That's all Claude needs.
- All BugBot issues (High/Medium/Low) resolved before merging
- Migrations run manually in Supabase SQL editor after merging
- Label every fix command with the PR number
- Two PRs in parallel: paste first → Cursor codes → push → BugBot → paste second → push → BugBot → debug both
- GitHub MCP tools available: create/close PRs, read/push files
- At end of every chat session: Claude pushes updated handoff.md to main via GitHub MCP

---

## KEY ARCHITECTURAL RULES

- awardCredits() / deductCredits() are the ONLY credit modification paths
- No SQL triggers — application-layer logic only
- SECURITY DEFINER → SET search_path = public + REVOKE/GRANT to service_role
- Append-only tables → REVOKE UPDATE/DELETE from all roles
- Cron auth: Authorization: Bearer {CRON_SECRET}
- Admin client for writes, cookie-based server client for reads
- Game never imports from packages/api — API routes only
- All dates explicit UTC
- Never use ::date cast — use CAST(timezone('UTC', x) AS date)
- All new branches based off main
