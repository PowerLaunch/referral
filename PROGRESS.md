# Referral Platform — Progress Tracker
> Update this file after every completed task.
> Cursor should read this before starting any new task.

---

## Current Status
**Phase:** Phase 1 — Foundation (in progress)
**Last updated:** 2026-03-25

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

## 🔧 Environment & Config Notes
- **GitHub repo:** https://github.com/PowerLaunch/referral.git
- **Monorepo path:** See your local clone
