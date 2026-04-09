# Referral Platform — Progress Tracker
> Update this file after every completed task.
> Cursor should read this before starting any new task.

---

## Current Status
**Phase:** Phase 7 — Admin Panel (in progress)
**Last updated:** 2026-04-09
**Last Completed PR:** 7-A/7-B/7-I (feat/admin-foundation)
**Next PR:** 7-C (feat/admin-users)
**Overall Progress:** 22 / 35 PRs complete

---

## ✅ Done
- [x] Monorepo scaffold (`apps/shell`, `apps/game-1`, `packages/api`)
- [x] Next.js 15 scaffolded in `apps/shell` with TypeScript + Tailwind v4
- [x] Root `package.json` with workspace config
- [x] Root `.gitignore`
- [x] `.env.local.example` added to `apps/shell`

---

## 🔄 In Progress
- [ ] Phase 1 remaining setup

---

## 📋 Phase 0 — Pre-Launch Checklist

*(Complete before any real users see the app)*

- [ ] Domain purchased and DNS configured
- [ ] All environment variables set in production
- [ ] Payment provider agreements signed
- [ ] Legal compliance review complete

---

## PRE-PHASE 5 CHECKLIST

Complete these before starting PR 5-A:

- [ ] Domain purchased and connected to Vercel project
- [ ] NEXT_PUBLIC_APP_URL set to final domain in Vercel environment variables
- [ ] Referral link format confirmed: https://[domain]/ref/[CODE]
- [ ] Transak/MoonPay chargeback liability confirmed in writing (HD-03)
- [ ] Triple-A or XanPool GCash support confirmed in writing (HD-02)
- [ ] Off-ramp business verification complete (HD-04)

---

## 📋 Up Next (Phase 1 — Foundation)
- [ ] Connect Supabase project (create project on supabase.com)
- [ ] Fill in `.env.local` with real keys
- [ ] Deploy shell app to Vercel (empty, just to confirm pipeline works)

---

## 📋 Phase 2 — Database Schema
- [ ] `users` table
- [ ] `referral_codes` table
- [ ] `referrals` table
- [ ] `credit_ledger` table
- [ ] `cashout_requests` table
- [ ] `games` table
- [ ] `risk_flags` table
- [ ] `idempotency_keys` table
- [ ] Row Level Security (RLS) policies on all tables
- [ ] Run all migrations in Supabase SQL editor

---

## 📋 Phase 3 — Core API Routes
- [ ] `POST /api/v1/referrals/generate` — create referral code
- [ ] `POST /api/v1/referrals/track` — track referral signup
- [ ] `POST /api/v1/events` — receive engagement events from game
- [ ] `GET /api/v1/referrals/status` — check referral status
- [ ] `GET /api/v1/credits/balance` — get user credit balance
- [ ] `POST /api/v1/cashout/request` — request cashout
- [ ] `GET /api/v1/cashout/history` — cashout history

---

## 📋 Phase 4 — Shell App UI
- [ ] Landing / signup page
- [ ] User dashboard (credits, referral link, history)
- [ ] Cashout request page
- [ ] Admin panel (user list, cashout approvals, risk flags)

---

## 📋 Phase 5 — Fraud & Risk Engine
- [ ] IP rate limiting (Upstash Redis)
- [ ] Device fingerprint checks
- [ ] Risk score system
- [ ] Auto-flag high-velocity signups
- [ ] Manual review queue for high-risk cashouts

---

## 📋 Phase 6 — Payments
- [ ] Stripe Connect setup
- [ ] Cashout approval → Stripe payout flow
- [ ] Tax threshold check ($500 lifetime)
- [ ] KYC hook (vendor TBD)

---

## 📋 Phase 7 — First Game
- [ ] Scaffold `apps/game-1`
- [ ] Basic game mechanic (TBD — quiz/clicker/puzzle)
- [ ] Connect game events to referral API
- [ ] Premium purchase hook

---

## ⚠️ Known Issues / Blockers
- None yet

---

## 🗒️ Notes & Decisions
- Building single-tenant first (one game), multi-tenant later
- No KYC vendor selected yet — hooks will be vendor-agnostic
- USD only at launch
- Exchange rate: 100 credits = $1 USD (admin-editable, 30-day change notice)

---

## KEY DECISIONS & OPEN ITEMS

| ID | Decision / Question | Status |
|----|---------------------|--------|
| OQ-06 | Domain name: get a real domain before marketing, Vercel subdomain fine for testing | OPEN |
| OQ-07 | Referral link base URL: update NEXT_PUBLIC_APP_URL in .env.local before Phase 5 — links must use final domain before any real users see them | OPEN |
| REMINDER | Set SUBSCRIPTION_WEBHOOK_SECRET in Vercel env vars before PR 5-A. Also add real provider HMAC validation to replace stub in /api/webhooks/subscription. | Blocking Phase 5 |

---

## 🔧 Environment & Config Notes
- **GitHub repo:** https://github.com/PowerLaunch/referral.git
- **Monorepo path:** See your local clone

---

## PR LOG

| PR ID | Branch | GitHub PR# | Status | Date | Description |
|-------|--------|-----------|--------|------|-------------|
| 1-A | feat/project-setup | — | COMPLETE | 2026-03-27 | Turborepo monorepo setup |
| 1-B | feat/database-schema | — | COMPLETE | 2026-03-27 | Phase 1 tables + RLS + indexes |
| 1-C | feat/auth | — | COMPLETE | 2026-03-28 | Auth, signup, login, email verification, middleware |
| 2-B | feat/shell-app | — | COMPLETE | 2026-04-02 | Shell game: daily puzzle, heartbeat, gameplay tracking |
| 3-D | feat/payout-workflow | — | COMPLETE | 2026-04-05 | Payout request, failure handler, recurring cron, frozen guard |
| 4-A | feat/risk-scoring | — | COMPLETE | 2026-04-05 | Risk scoring, fingerprint capture, fraud_flags/admin_audit tables |
| 4-B | feat/fraud-rules-r1-r7 | — | COMPLETE | 2026-04-06 | Fraud rules R1–R6, 15-min cron (combined with 4-C) |
| 4-C | feat/fraud-rules-r1-r7 | — | COMPLETE | 2026-04-06 | KYC hashing, R7 Sybil detection, shadow review (combined with 4-B) |
| 4-D | feat/fraud-middleware | — | COMPLETE | 2026-04-07 | Fraud middleware, chargeback handler, fraud scoring in confirmation cron |
| 6-A | feat/user-dashboard | #20 | COMPLETE | 2026-04-08 | Earnings progress stepper & metrics bar (combined into 6-A–6-E) |
| 6-B | feat/user-dashboard | #20 | COMPLETE | 2026-04-08 | Payout section with method selector, fee transparency, history |
| 6-C | feat/user-dashboard | #20 | COMPLETE | 2026-04-08 | Share tools: referral link copy, WhatsApp, Telegram deep links |
| 6-D | feat/user-dashboard | #20 | COMPLETE | 2026-04-08 | Dispute form + disputes table migration |
| 6-E | feat/user-dashboard | #20 | COMPLETE | 2026-04-08 | Landing page referral earnings calculator |
| — | fix/session-diversity | #21 | OPEN | 2026-04-08 | Session diversity: min 3 gameplay sessions for referral confirmation |
| 7-A/7-B/7-I | feat/admin-foundation | #22 | OPEN | 2026-04-08 | Admin foundation: auth guard, pulse dashboard, kill switches, config editor, audit log, seed users |

---

## SESSION LOG

*(Auto-updated by GitHub Actions on every PR merge)*

| Date | Branch | Action | Notes |
|------|--------|--------|-------|
| —    | —      | Project initialized | PROGRESS.md created |
| 2026-03-27 | feat/scaffold | PR #2 merged | chore: complete project scaffold |
| 2026-03-27 | feat/project-setup | PR #3 merged | feat: set up Turborepo monorepo with build pipeline |
| 2026-03-27 | feat/database-schema | PR 1-B merged | Phase 1 tables + RLS + indexes merged |
| 2026-03-28 | feat/database-schema | PR #4 merged | feat: add Phase 1 database schema and RLS policies |
| 2026-03-28 | feat/auth | PR 1-C merged | Auth, signup, login, email verification, middleware merged |
| 2026-04-02 | chore/vercel-build-fixes | PR #6 merged | chore: fix Vercel build issues |
| 2026-04-02 | feat/shell-app | PR 2-B | Shell game: dummy puzzle, heartbeat, gameplay tracking |
| 2026-04-03 | feat/shell-app | PR 2-B merged | Shell game: dummy puzzle, heartbeat, gameplay tracking, security fixes |
| 2026-04-03 | feat/shell-app | PR #7 merged | feat: add minimal daily puzzle shell game (PR 2-B) |
| 2026-04-03 | feat/email-templates | PR #8 merged | feat: add Resend email infrastructure and 5 transactional templates |
| 2026-04-04 | feat/lock-periods | PR #9 merged | feat: lock period calculation and signup bonus (PR 2-D) |
| 2026-04-04 | feat/credit-system | PR #10 merged | PR 3-A: Canonical credit ledger system |
| 2026-04-04 | feat/referral-confirmation | PR 3-B | Referral confirmation cron, audit logs, cap check |
| 2026-04-04 | feat/referral-confirmation | PR #11 merged | feat: Referral confirmation cron job (PR 3-B) |
| 2026-04-04 | feat/maturity-checkpoint | PR 3-C | Maturity checkpoint: freeze/unfreeze RPCs, webhook stub |
| 2026-04-04 | feat/maturity-checkpoint | PR #12 merged | PR 3-C: Maturity checkpoint (freeze/unfreeze referral lock timers) |
| 2026-04-05 | feat/referral-confirmation-patch | PR 3-B-patch | Payment collateral check, voidPendingCredits, fraud void hook |
| 2026-04-05 | feat/referral-confirmation-patch | PR #13 merged | PR 3-B-patch: Payment collateralization and credit voiding |
| 2026-04-05 | feat/payout-workflow | PR 3-D | Payout request, failure handler, recurring cron, frozen guard |
| 2026-04-05 | feat/risk-scoring | PR 4-A | Risk scoring, fingerprint capture, fraud_flags/admin_audit tables |
| 2026-04-06 | feat/fraud-rules-r1-r7 | PR 4-B/4-C (combined) | All fraud rules R1–R7, KYC hashing, shadow review status mapping, 15-min fraud scan cron |
| 2026-04-07 | feat/fraud-rules-r1-r7 | PR #16 merged | feat: Fraud rules R1-R7, KYC hashing, shadow review (PR 4-B/4-C combined) |
| 2026-04-07 | feat/fraud-middleware | PR 4-D | Fraud middleware, chargeback handler, fraud scoring in confirmation cron, circuit breaker check |
| 2026-04-07 | feat/fraud-middleware | PR #17 merged | feat: fraud middleware integration (PR 4-D) |
| 2026-04-07 | chore/claude-code-config | PR #18 merged | chore: add CLAUDE.md and update .cursorrules |
| 2026-04-08 | fix/referral-honeymoon | PR #19 merged | feat: 14-day honeymoon cooldown after first referral |
| 2026-04-08 | feat/user-dashboard | PR 6-A–6-E | Combined user dashboard PR |
| 2026-04-08 | feat/user-dashboard | PR #20 merged | feat: complete user dashboard (PR 6-A through 6-E) |
| 2026-04-09 | fix/session-diversity | PR #21 merged | feat: session diversity for referral confirmation |
| 2026-04-09 | feat/scaffold | PR #24 merged | chore: merge feat/scaffold into main |
| 2026-04-09 | feat/admin-influencers | PR #26 merged | feat: influencer code management (PR 7-G) |
