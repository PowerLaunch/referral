# CLAUDE.md — PowerLaunch Referral App

> **This is the canonical rules file for this codebase.**
> Read this file completely before making any code change.
> Every rule here is non-negotiable unless Tony explicitly overrides it in a prompt.

---

## 1. WHAT THIS PROJECT IS

A single-tier referral platform attached to a web-based daily puzzle game.
Users pay $5/month to access the game. Subscribers get a referral link.
When someone they refer subscribes and stays active through a lock period,
the referrer earns $2 one-time + $1/month recurring cash credit.

**Target markets:** Philippines (primary), Malaysia, Pakistan.
**Target scale:** ~30,000 subscribers. Lifestyle business, not venture-scale.
**Regulatory framing:** The subscription pays for game access — not referral rights.
Single-tier structure + skill-based game = defense against pyramid scheme classification.
Official language uses "referral bonus" — never "earn income" or "business opportunity."

**Payment flow:** Users pay in local currency (PHP, MYR, PKR). Payments use USDC on
Solana as an invisible internal rail. Users never see or interact with crypto.
On-ramp: Transak or MoonPay. Off-ramp: Triple-A or XanPool (GCash, GoPay, bank).
Escrow = Supabase DB entry, not a smart contract.

---

## 2. TECH STACK

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), TypeScript strict, Tailwind CSS v4, shadcn/ui |
| Database & Auth | Supabase (PostgreSQL + RLS + Auth + Vault) |
| Hosting | Vercel (team: diviscocoding) |
| Email | Resend (5 transactional templates) |
| On-ramp | Transak or MoonPay (fiat → USDC on Solana) |
| Off-ramp | Triple-A or XanPool (USDC → GCash/GoPay/bank/PayPal) |
| Device fingerprinting | FingerprintJS |
| On-chain monitoring | Helius (Solana) |
| Cron | Vercel Cron (UTC) |
| Monorepo | Turborepo: `apps/shell` + `packages/api` (`@referral/api`) |
| Repo | github.com/PowerLaunch/referral |

---

## 3. MONOREPO STRUCTURE

```
referral/
├── apps/shell/              ← The game (Next.js app)
│   ├── app/
│   │   ├── (dashboard)/     ← User-facing pages
│   │   ├── admin/           ← Admin dashboard pages
│   │   ├── api/             ← API routes (cron, payout, fingerprint, admin, etc.)
│   │   └── auth/            ← Auth callback
│   ├── lib/supabase/        ← admin.ts (service role), server.ts (cookie client)
│   ├── middleware.ts         ← Auth + frozen account guards
│   └── supabase/migrations/ ← SQL migration files
├── packages/api/            ← Shared backend logic (@referral/api)
│   └── src/
│       ├── credits.ts       ← awardCredits() / deductCredits() — THE credit functions
│       ├── fraudRules.ts    ← R1–R22 fraud rule implementations
│       ├── riskScore.ts     ← Risk score calculation
│       ├── trustScore.ts    ← Trust score system
│       ├── ipClassification.ts
│       ├── lockPeriod.ts
│       ├── statusDisplay.ts ← Maps internal states to user-facing labels
│       ├── email.ts         ← Email trigger functions
│       └── kycHash.ts       ← KYC ID hashing (HMAC-SHA256 via Vault)
├── CLAUDE.md                ← This file
├── .cursorrules             ← References this file
├── PROGRESS.md              ← PR status tracker
├── DECISIONS.md             ← Mid-build additions log
├── SECURITY.md              ← All security measures documented
└── HANDOFF.md               ← Session continuity document
```

---

## 4. ARCHITECTURAL RULES — NON-NEGOTIABLE

Violating any of these will cause BugBot flags or production bugs.

### 4.1 Credits — The Cardinal Rule

`awardCredits()` and `deductCredits()` in `packages/api/src/credits.ts` are the
**ONLY** way to modify credit balances. No direct writes to `user_credits` or
`credit_transactions` from anywhere else. No exceptions. Ever.

Credit operations are idempotent via reason string + partial unique index
(e.g., `referral_confirmed:{referral.id}`). This prevents double-pay on retry.

### 4.2 No SQL Triggers

Application-layer logic only. Never create database triggers. Triggers are
invisible to code review tools, hard to debug with Supabase RLS, and impossible
to test in isolation. If you're tempted to add a trigger, use an RPC function instead.

### 4.3 SECURITY DEFINER Functions

Every `SECURITY DEFINER` function MUST include all three of these:
```sql
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.function_name() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.function_name() TO service_role;
```

The `SET search_path = public` prevents search path injection attacks.
The REVOKE/GRANT ensures only server-side admin client can call the function.
BugBot catches missing REVOKE/GRANT as HIGH severity.

### 4.4 Append-Only Tables

These tables must never have rows updated or deleted:
- `credit_transactions`
- `referral_audit_logs`
- `admin_audit_logs`
- `trust_score_events`

Pattern (include `service_role` in the revoke):
```sql
REVOKE UPDATE, DELETE ON table_name FROM PUBLIC, anon, authenticated, service_role;
```

### 4.5 Cron Authentication

Vercel cron jobs authenticate with:
```typescript
const authHeader = request.headers.get('Authorization');
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Never use `x-cron-secret` or any other header name.
Cron routes must be excluded from middleware session check via the matcher config.

### 4.6 Admin Client vs Cookie Client

Two Supabase clients exist:
- **`createAdminClient()`** (`apps/shell/lib/supabase/admin.ts`): Uses
  `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS. Use for **all writes** and admin operations.
- **`createClient()`** (`apps/shell/lib/supabase/server.ts`): Cookie-based,
  respects RLS. Use for **reads** in server components and for checking user session.

Decision tree:
- Writing data? → Admin client
- Reading data that should respect user-level RLS? → Cookie client
- Reading data in an admin context? → Admin client (admin reads bypass RLS)
- Getting the current user session? → Cookie client
- Never import admin client in any client component.

### 4.7 Game ↔ API Boundary

The game (`apps/shell`) never imports from `packages/api` directly. All
communication goes through API routes (`/api/*`). This makes swapping games possible.

```typescript
// ❌ FORBIDDEN — direct import from packages/api in apps/shell component
import { awardCredits } from '@referral/api/credits';

// ✅ CORRECT — call an API route
const res = await fetch('/api/credits/award', { method: 'POST', body: ... });
```

The `@referral/api` package IS imported in API route handlers (those live in
`apps/shell/app/api/`). The boundary is: client/server components in `apps/shell`
must not import `@referral/api` — only API routes can.

### 4.8 TypeScript Strict Mode

- No `any` types
- No `ts-ignore` or `ts-expect-error`
- No explicit JSX return type annotations (Next.js 15 infers them)
- All function parameters and return types must be typed

### 4.9 Nullish Coalescing

Always `??` (nullish coalescing), never `||` (logical OR) for defaults:
```typescript
data.min_gameplay_minutes || 10  // ❌ Prevents setting zero
data.min_gameplay_minutes ?? 10  // ✅ Only falls back on null/undefined
```

### 4.10 Date Handling

- All date math uses explicit UTC: `timezone('UTC', now())`
- Never use bare `now()` in date calculations
- Never use `::date` cast in SQL — use `CAST(timezone('UTC', x) AS date)`
  (Supabase SQL editor does not support `::date` syntax)
- Monthly cap boundaries use `date_trunc('month', now())` — not rolling 30 days
- Monthly cap calculations use `Date.UTC()` not local timezone in TypeScript

### 4.11 game_config Runtime Values

Never hardcode values that exist in `game_config`. Always read from the table.
This includes: `min_gameplay_minutes`, `signup_bonus_amount`, `signup_bonus_label`,
`cashouts_paused`, `referral_confirmations_paused`, `min_session_count`,
`monthly_referral_cap`.

If you see a hardcoded `10` for gameplay minutes or `3` for session count, it's wrong.

### 4.12 Atomic Operations

Multi-step database operations that must succeed or fail together always use
a single Postgres RPC function with `pg_advisory_xact_lock` — never two separate
Supabase JS calls. This prevents race conditions and partial state.

State transitions need atomic status guards: `.eq('status', 'EXPECTED_STATUS')`.

### 4.13 Idempotency

All one-time operations use either:
- Partial unique index on `credit_transactions` (reason string pattern)
- `INSERT ... ON CONFLICT DO NOTHING` with appropriate unique index
- Application-level check before write

Running any operation twice must not double-insert, double-pay, or double-flag.

### 4.14 Secure Random

No `Math.random()` anywhere security-relevant. Use:
- `crypto.randomBytes()` (server)
- `crypto.getRandomValues()` (client)

### 4.15 Pagination

Supabase `.range(start, end)` is inclusive on both ends.
Pattern: fetch `limit + 1` rows, slice to `limit`, set `hasMore = fetched.length > limit`.

### 4.16 Admin Auth

`requireAdmin` helper returns 404 (not 401/403) for non-admins. This prevents
information leakage about the existence of admin routes.

All admin write actions log to `admin_audit_logs` with before/after values.
Use Zod validation on all request bodies.

### 4.17 Branch Rules

All new branches MUST be based off `main`. Never branch from `feat/scaffold`
or any other feature branch.

---

## 5. MIGRATION PATTERNS

Migrations run manually in Supabase SQL editor after merging — never via `supabase db push`.

### File Naming
`apps/shell/supabase/migrations/YYYYMMDDHHMMSS_description.sql`
Always check existing migrations and use the next sequential timestamp.

### New Table Template
```sql
CREATE TABLE new_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- columns here
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- For user-accessible tables:
CREATE POLICY "select_own" ON new_table FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON new_table FROM anon, authenticated;

-- For admin-only tables:
CREATE POLICY "service_role_all" ON new_table FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### SECURITY DEFINER RPC Template
```sql
CREATE OR REPLACE FUNCTION public.do_something(p_param uuid)
RETURNS jsonb AS $$
DECLARE result jsonb;
BEGIN
  -- logic here
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.do_something(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.do_something(uuid) TO service_role;
```

### Append-Only Table Template
```sql
REVOKE UPDATE, DELETE ON table_name FROM PUBLIC, anon, authenticated, service_role;
```

---

## 6. BUGBOT PATTERNS — COMMON CATCHES

These are patterns BugBot has actually flagged on this project. Preemptively
avoid them in every PR:

1. **SECURITY DEFINER without REVOKE/GRANT** (HIGH) — See section 4.3.
2. **TOCTOU race conditions** (MEDIUM) — Check-then-act must be a single RPC with `FOR UPDATE`.
3. **Logical OR for defaults** (MEDIUM) — `||` → `??` when zero is valid. See section 4.9.
4. **Pagination off-by-one** (MEDIUM) — Use `limit + 1` pattern. See section 4.15.
5. **Middleware root path match** (HIGH) — `startsWith('/')` matches everything. Use negative matcher patterns.
6. **Redirect discards session cookies** (MEDIUM) — Forward `supabaseResponse` cookies from `updateSession()`.
7. **Unnecessary RLS INSERT policy** (LOW) — SECURITY DEFINER functions bypass RLS. Don't add `FOR INSERT WITH CHECK (true)`.
8. **Explicit JSX return types** (BUILD FAILURE) — Don't annotate with `: JSX.Element`. Let TS infer.
9. **Hardcoded game_config values** (MEDIUM) — See section 4.11.
10. **Insecure random** (MEDIUM) — See section 4.14.
11. **Missing atomic status guard** (MEDIUM) — State transitions need `.eq('status', 'EXPECTED_STATUS')`.
12. **Redundant API calls** (LOW) — Don't call the same function twice for the same data.
13. **Dead code** (LOW) — Remove unused functions/types.
14. **Missing idempotency guard** (MEDIUM) — See section 4.13.

When BugBot flags something intentionally designed that way, add a clear code comment
explaining WHY. BugBot accepts well-documented intentional decisions on re-review.

---

## 7. FRAUD ENGINE CONTEXT

### Automated Rules
- R1–R6, R10–R15 run on 15-minute cron (`/api/cron/fraud-scan`)
- R7 fires in real-time during KYC approval
- R8 fires in real-time during payout request
- R9 is post-MVP
- R12 fires on subscription payment webhook
- R16–R22 are Phase 10 advanced fraud hardening rules

**Never auto-ban from automated rules alone. Flag and review.**

### Risk Score
- INFO flag = +10, WARNING = +30, CRITICAL = +50
- Disposable email = +50 additional
- Bands: LOW (0-30), MEDIUM (31-60), HIGH (61-100), CRITICAL (100+)

### Trust Levels
- `CLEAN` — Normal user
- `SUSPICIOUS` — Under monitoring, payouts blocked
- `REVIEW_HOLD` — Pending admin review
- `FROZEN` — Admin-frozen, all actions blocked
- `BANNED` — Permanent ban

### Shadow Review UX (CRITICAL — user-facing language rules)
- Database `REVIEW_HOLD` → display "Verifying"
- Database `FROZEN` → display "Verifying" (until ban email fires)
- Database `BANNED` → show "Account frozen" notice
- NEVER show "Under Review", "Flagged", "Suspicious", or any fraud language to users

### Chargeback Handling
One chargeback = permanent ban across all linked identifiers (email, device, IP, KYC hash).
Transak webhook auto-freezes accounts on dispute.

### Influencer / VIP Exceptions
`lock_bypass` on influencer accounts bypasses only the `payout_eligible_at` wait period.
It NEVER bypasses gameplay checks or payment verification checks.
Admin must check a UI confirmation checkbox before enabling `lock_bypass`.
All VIP exceptions logged to `admin_audit_logs`.

---

## 8. KEY BUSINESS LOGIC

### Referral Flow
1. Referrer shares link → referee clicks → 302 redirect with click logging
2. Referee signs up → referral record created as PENDING
3. Referee subscribes → instant non-cash in-game bonus to referrer (GAME_CREDITS)
4. Lock period passes (60 days PH) + referee active + min gameplay + min 3 sessions → CONFIRMED
5. Referrer gets $2 one-time CASH_BALANCE credit
6. Each subsequent month referee stays active → referrer gets $1 recurring

### Referral Caps
- Standard user: 50 confirmed/month, max 5 pending, max 15 active recurring
- Influencer: 200/month, max 20 pending, max 50 active recurring

### Payout Flow
- First payout: always requires manual admin approval
- Subsequent payouts: auto-process if account is clean
- Failure: mark FAILED → refund credits → 24hr cooldown → one auto-retry
- 3 consecutive failures → flag for manual review
- Partial unique index enforces one pending payout per user

### Escrow / Lock Period
Lock period = 60 days (Philippines). Timer freezes if referrer's subscription lapses.
Payout eligibility = referee month 2 payment + 10-day grace period.

---

## 9. PR WORKFLOW

### For Claude Code CLI

When given a task:
1. Read this file (CLAUDE.md) completely
2. Read `.cursorrules` if it exists
3. Create a feature branch off `main`: `feat/[short-description]`
4. Make all code changes
5. Update `PROGRESS.md` with PR status
6. Update `DECISIONS.md` if adding functionality outside the original plan
7. Commit with conventional commit message: `feat:`, `fix:`, `chore:`
8. Push and open a PR targeting `main`

### BugBot Fix Rounds

After BugBot reviews:
1. Read all BugBot comments — filter to the latest commit SHA only
2. Fix ALL issues (High, Medium, Low) in a single commit
3. If merge conflicts exist, resolve them in the same commit
4. Push to the same branch
5. Never create a new branch or PR for fixes

### Commit Messages
```
feat: add user management admin tab
fix: resolve pagination off-by-one in audit logs
chore: update PROGRESS.md after PR #35 merge
```

### PR Descriptions
Include:
- What changed (brief)
- Which spec sections are covered
- Migration instructions (if applicable)
- Any DECISIONS.md additions

---

## 10. GUARD RAILS — NEVER DO THESE

These are mistakes that would normally be caught by an architect reviewing your work.
Claude Code CLI must self-enforce these:

1. **NEVER** write directly to `user_credits` or `credit_transactions` — use awardCredits/deductCredits
2. **NEVER** create SQL triggers
3. **NEVER** auto-ban users from automated fraud rules — flag and review only
4. **NEVER** show fraud-related language to users (see Shadow Review UX in section 7)
5. **NEVER** hardcode values that exist in `game_config`
6. **NEVER** use `Math.random()` for security-relevant operations
7. **NEVER** import `@referral/api` directly in `apps/shell` components — API routes only
8. **NEVER** use `||` for defaults where `0` or `""` could be valid values
9. **NEVER** use `::date` cast in SQL — use `CAST(timezone('UTC', x) AS date)`
10. **NEVER** use `x-cron-secret` header — only `Authorization: Bearer`
11. **NEVER** branch from anything other than `main`
12. **NEVER** use `supabase db push` — migrations run manually in SQL editor
13. **NEVER** add `any` types or `ts-ignore`
14. **NEVER** introduce multi-level/downstream referral commissions
15. **NEVER** expose the Supabase service role key in client-side code
16. **NEVER** push partial BugBot fixes — fix ALL issues in one commit
17. **NEVER** skip the REVOKE/GRANT pattern on SECURITY DEFINER functions
18. **NEVER** use two separate Supabase calls when atomicity is needed — use a single RPC

---

## 11. DOCUMENTATION UPDATES

### PROGRESS.md
Update after every PR with status (IN PROGRESS / MERGED / etc.) and GitHub PR number.

### DECISIONS.md
Add a row whenever you implement functionality not in the original 35-PR plan:
```
| PR #XX | Short description | Why it was added |
```

### HANDOFF.md
At the end of a work session, update with:
- What was just completed
- What's immediately next
- Any blockers or open questions

---

## 12. KEY FILE LOCATIONS

| What | Where |
|------|-------|
| Admin Supabase client | `apps/shell/lib/supabase/admin.ts` |
| Cookie Supabase client | `apps/shell/lib/supabase/server.ts` |
| Credit functions | `packages/api/src/credits.ts` |
| Fraud rules | `packages/api/src/fraudRules.ts` |
| Risk score | `packages/api/src/riskScore.ts` |
| Trust score | `packages/api/src/trustScore.ts` |
| IP classification | `packages/api/src/ipClassification.ts` |
| Lock period | `packages/api/src/lockPeriod.ts` |
| Email triggers | `packages/api/src/email.ts` |
| Status display mapping | `packages/api/src/statusDisplay.ts` |
| KYC hash | `packages/api/src/kycHash.ts` |
| Cron jobs | `apps/shell/app/api/cron/*/route.ts` |
| Middleware | `apps/shell/middleware.ts` |
| Auth callback | `apps/shell/app/auth/callback/route.ts` |
| Migrations | `apps/shell/supabase/migrations/` |
| Game pages | `apps/shell/app/(dashboard)/game/` |
| Admin pages | `apps/shell/app/admin/` |
| Config files | `.cursorrules`, `CLAUDE.md`, `PROGRESS.md`, `DECISIONS.md`, `SECURITY.md` |

---

## 13. DATABASE SCHEMA REFERENCE

### Core Tables
- **profiles** — id, email, referral_code (unique), verified_kyc_hash, device_fingerprint, trust_level (CLEAN/SUSPICIOUS/BANNED), is_admin, trust_score, trust_tier, created_at
- **subscriptions** — id, user_id, status (active/cancelled/past_due), current_period_end, transak_subscription_id, created_at
- **user_credits** — id, user_id, amount (CHECK >= 0), type (CASH_BALANCE/GAME_CREDITS), updated_at
- **credit_transactions** — id, user_id, amount, type, reason, created_at (APPEND-ONLY)
- **game_config** — singleton row with all configurable values

### Referral Tables
- **referrals** — id, referrer_id, referee_id, status (PENDING/ACTIVE/CONFIRMED/FROZEN/REJECTED/VOIDED), payout_eligible_at, lock_timer_frozen, frozen_at, month_2_payment_at, country_code, referral_source, source_classification, created_at
- **referral_audit_logs** — id, referral_id, action, reason, triggered_by, created_at (APPEND-ONLY)
- **referral_clicks** — id, referral_code, ip_address, user_agent, created_at
- **gameplay_sessions** — id, user_id (unique), total_minutes, session_count, last_heartbeat_at, updated_at

### Payout Tables
- **payouts** — id, user_id, amount, method, status, provider_error_code, retry_count, created_at

### Fraud Tables
- **fraud_flags** — id, user_id, rule_triggered, severity, details (jsonb), created_at
- **device_fingerprints** — id, user_id, fingerprint_hash, ip_address, created_at
- **trust_score_events** — append-only ledger of trust score changes
- **ip_classifications** — IP → infrastructure type cache
- **source_blocklist** — admin-managed red-flagged referral source domains

### Admin Tables
- **admin_audit_logs** — id, admin_id, action, target_type, target_id, before_value, after_value, details (jsonb), created_at (APPEND-ONLY)
- **seed_users** — id, profile_id, created_by_admin, notes, created_at
- **cron_health** — cron_name (PK), last_success_at
- **disputes** — id, user_id, referral_id, description, status, admin_notes, created_at, resolved_at
- **influencer_codes** — id, code, admin_created_by, payout_percentage, monthly_cap, instant_payout, lock_bypass, created_at

### KYC & Payment Tables (Phase 5 — not yet built)
- **kyc_submissions** — id, user_id, id_hash_hmac, status, admin_notes, created_at
- **payment_events** — id, user_id, transak_transaction_id (unique), event_type, amount, created_at

---

## 14. ENVIRONMENT VARIABLES

These must be set in Vercel (and locally in `.env.local` for development):

| Variable | Used By | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | NEVER expose client-side |
| `CRON_SECRET` | Cron routes | Bearer token for Vercel cron |
| `RESEND_API_KEY` | Email | Resend API key |
| `KYC_HMAC_SALT` | KYC hash | Stored in Supabase Vault, not .env |

---

## 15. SUPABASE SQL EDITOR WORKAROUNDS

The Supabase SQL editor has specific limitations:
- Does NOT support `::date` cast syntax — use `CAST(timezone('UTC', x) AS date)`
- Does NOT support `::int` shorthand reliably — use `CAST(x AS integer)`
- Always test migration SQL in the SQL editor before committing if possible

---

*Last updated: April 11, 2026 — Expanded for Claude Code CLI compatibility*
