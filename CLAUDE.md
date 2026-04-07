# Referral App — Claude Code Instructions

Read PROGRESS.md before every task. Read SPEC.md and SECURITY.md when the task touches those areas.

@./SPEC.md
@./SECURITY.md
@./DECISIONS.md

## Project Structure

referral/
├── apps/shell/        — Next.js 15 App Router (subscription + referral engine)
├── packages/api/      — Shared backend: referral engine, payments, fraud, auth
├── SPEC.md            — Full product specification
├── PROGRESS.md        — Current build status (update after every PR)
├── DECISIONS.md       — Mid-build additions outside the 35-PR plan
├── SECURITY.md        — Anti-fraud & security measures
├── CLAUDE.md          — This file (Claude Code extension reads this)
└── .cursorrules       — Kept for backward compatibility

## Non-Negotiable Rules

- TypeScript strict mode. No `any` types, no `ts-ignore`.
- Never hardcode secrets — environment variables only.
- SUPABASE_SERVICE_ROLE_KEY is server-only. Never in client-side files.
- App Router only (never pages/).
- API routes: apps/shell/app/api/
- Shared backend: packages/api/src/
- Package name: @referral/api via transpilePackages in next.config.ts
- The game NEVER imports from packages/api — API routes only.
- All email sending via trigger functions in packages/api/src/email.ts
- After every PR merge, update PROGRESS.md and DECISIONS.md if applicable.

## Locked Architectural Rules

### Credits
- awardCredits() and deductCredits() in packages/api/src/credits.ts are the ONLY way to modify credit balances. No direct writes to user_credits or credit_transactions from anywhere else.

### Database
- No SQL triggers — application-layer logic only.
- SECURITY DEFINER functions: must include SET search_path = public, explicit REVOKE/GRANT restricted to service_role.
- Append-only tables (credit_transactions, referral_audit_logs, admin_audit_logs): REVOKE UPDATE and DELETE from ALL roles including service_role.
- Atomic operations: always use Postgres RPC functions for multi-step operations. Never two separate Supabase JS calls for operations that must succeed or fail together.
- UTC explicit in all date calculations: timezone('UTC', now()), never bare now() in date math.
- Always handle "no row exists yet" case in upserts.
- Monthly cap: date_trunc('month', now()) calendar month boundaries, not rolling 30 days.
- Idempotency: reason string referral_confirmed:{referral.id} with partial unique index.
- Never use ::date cast in migrations — use CAST(timezone('UTC', x) AS date).

### Auth & Middleware
- Cron auth: Authorization: Bearer {CRON_SECRET} — NOT x-cron-secret.
- Cron routes excluded from middleware session checks via matcher config.
- Middleware DB queries scoped to protected routes only.
- Admin Supabase client (service role) for writes; cookie-based server client for reads (RLS).

### Migrations
- SQL migrations run MANUALLY in Supabase SQL editor after merging, in timestamp order.
- Never use supabase db push.
- When a PR includes migrations, list them in the PR description.

## Pre-Commit Checklist

Before committing, verify every applicable item:

1. No direct writes to user_credits or credit_transactions outside awardCredits/deductCredits
2. No SQL triggers created
3. SECURITY DEFINER functions have SET search_path = public
4. Append-only tables have REVOKE UPDATE, DELETE
5. Multi-step DB operations use a single RPC/transaction
6. Cron routes check Authorization header, not x-cron-secret
7. Cron routes excluded from middleware matcher
8. No SUPABASE_SERVICE_ROLE_KEY in client-side files
9. No hardcoded values that belong in game_config
10. No `any` types or `ts-ignore`
11. All date math uses explicit UTC
12. Migration files use CAST() not ::date
13. No console.log with sensitive data

## BugBot Self-Repair

After opening a PR, if BugBot leaves review comments:

1. Read the BugBot review on the PR using git tools
2. Fix ALL issues — High, Medium, and Low severity
3. For each fix, verify it does not violate any Locked Architectural Rule above
4. Run the Pre-Commit Checklist again
5. Commit fixes to the same branch and push — do NOT open a new PR
6. If a BugBot comment conflicts with a Locked Architectural Rule, follow the locked rule and leave a PR comment explaining why

### Common BugBot Patterns

- "Missing error handling" → try/catch, log error, return appropriate HTTP status
- "Race condition" → Postgres RPC for atomicity
- "Unused import" → remove it
- "Type assertion" → add Zod schema or runtime check
- "Missing null check" → guard clause
- "Hardcoded value" → game_config or env var
- "Missing auth check" → session verification at top of route

## Git Workflow

- All git operations handled by the agent — zero manual steps from the developer
- Branch naming: feat/[short-description], fix/[short-description], chore/[short-description]
- Commit messages: concise, imperative mood
- One PR per feature/fix
