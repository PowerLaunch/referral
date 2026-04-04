# Referral Platform — Progress Tracker
> Update this file after every completed task.
> Cursor should read this before starting any new task.

---

## Current Status
**Phase:** Phase 3 — Referral Engine (in progress)
**Last updated:** 2026-04-04
**Last Completed PR:** 3-B (feat/referral-confirmation)
**Next PR:** 3-C (feat/maturity-checkpoint)
**Overall Progress:** 8 / 35 PRs complete

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

---

## 🔧 Environment & Config Notes
- **GitHub repo:** https://github.com/PowerLaunch/referral.git
- **Monorepo path:** See your local clone

---

## PR LOG

| PR ID | Branch | Status | Date | Description |
|-------|--------|--------|------|-------------|
| 1-A | feat/project-setup | COMPLETE | 2026-03-27 | Turborepo monorepo setup |
| 1-B | feat/database-schema | COMPLETE | 2026-03-27 | Phase 1 tables + RLS + indexes |
| 1-C | feat/auth | COMPLETE | 2026-03-28 | Auth, signup, login, email verification, middleware |
| 2-B | feat/shell-app | COMPLETE | 2026-04-02 | Shell game: daily puzzle, heartbeat, gameplay tracking |

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
