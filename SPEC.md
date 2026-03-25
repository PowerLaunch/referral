# Referral Platform & Shell App — Full Project Scope
**Version 1.1 | Global | USD | Next.js 15 + Supabase + Vercel**

> This is the single source of truth for this project.
> Always read this alongside PROGRESS.md before starting any task.

---

## 0. Document Purpose

This document defines:
1. A reusable **Referral Platform Backend** (APIs, DB, risk engine, KYC hooks, payouts)
2. A minimal **Shell App** (web client) that fully exercises the backend
3. A simple **web casual game** (quiz/clicker/puzzle) as the first real client

Later, any game studio purchasing the B2B SaaS license will integrate against the same backend APIs used by the shell app and the first-party game.

---

## 1. Business Context

### What it is
A white-label referral-as-a-service platform. Users earn credits by inviting friends who engage meaningfully with a game (level up, stay active, buy premium). Credits can be cashed out as real USD via Stripe Connect, subject to fraud checks, KYC, and caps.

### Revenue model
Game studios pay to use the platform:
- **Monthly platform fee:** $99/month per studio
- **Performance cut:** 8% of all confirmed referral credits paid out through the platform

The platform operator (you) never runs the games — only the referral infrastructure.

### Credits economy
- **Exchange rate:** 100 credits = $1 USD. Fixed at launch. Stored as a single admin-editable config value with a 30-day change notice period. Never applied retroactively.
- **Minimum cashout:** 1,000 credits ($10 USD)
- **First-win floor:** 500 credits ($5) for a user's very first cashout only
- **Currency:** USD only at launch

### Target market
Global from day one. English-language platform. KYC vendor to be selected later (scope includes vendor-agnostic hooks).

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Supabase (Postgres) |
| Auth | Supabase Auth |
| Hosting | Vercel |
| Email | Resend |
| Payouts | Stripe Connect |
| KYC | Vendor-agnostic hook (Sumsub recommended when ready) |
| Rate limiting | Upstash Redis |
| IDE | Cursor with Claude |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────┐
│         Referral Platform           │
│         (Backend / APIs)            │
│  - Users, referrals, credits        │
│  - Engagement thresholds            │
│  - Risk / fraud scoring             │
│  - KYC hooks                        │
│  - Stripe Connect payouts           │
│  - Admin panel APIs                 │
└────────────┬────────────────────────┘
             │ REST API v1
    ┌────────┴──────────┐
    │                   │
┌───▼──────┐     ┌──────▼────────┐
│ Shell App│     │ First Game    │
│ (test    │     │ (quiz/clicker)│
│ client)  │     │               │
└──────────┘     └───────────────┘
```

Future game studios integrate by:
1. Mapping their users to platform `user_id`
2. Sending standard events (level-up, daily-active, mission-complete, premium-purchased)
3. Displaying referral dashboard UI consuming platform APIs

---

## 4. Database Schema

> ⚠️ All migrations must be run MANUALLY in the Supabase SQL editor before merging any PR that includes schema changes. Cursor cannot do this automatically.

### Tables

#### `users`
```sql
id                         uuid PRIMARY KEY
email                      text UNIQUE NOT NULL
premium_status             boolean DEFAULT false
level                      integer DEFAULT 1
last_active_date           date
distinct_active_days_count integer DEFAULT 0
game_id                    text
kyc_status                 text DEFAULT 'NOT_STARTED'
  -- NOT_STARTED | PENDING | VERIFIED | REJECTED
monthly_cashout_used       integer DEFAULT 0
lifetime_cashout_used      integer DEFAULT 0
monthly_cashout_limit      integer DEFAULT 50000
lifetime_cashout_limit     integer DEFAULT 500000
risk_score                 text DEFAULT 'low'
  -- low | medium | high
tax_verified               boolean DEFAULT false
tax_id_collected           boolean DEFAULT false
first_cashout_used         boolean DEFAULT false
created_at                 timestamptz DEFAULT now()
updated_at                 timestamptz DEFAULT now()
```

#### `referrals`
```sql
id              uuid PRIMARY KEY
referrer_id     uuid REFERENCES users(id)
referee_id      uuid REFERENCES users(id)
referral_code   text NOT NULL
status          text DEFAULT 'PENDING'
  -- PENDING | CONFIRMED | REJECTED
reason          text
source_channel  text
created_at      timestamptz DEFAULT now()
updated_at      timestamptz DEFAULT now()
```

#### `credits_ledger`
```sql
id                    uuid PRIMARY KEY
user_id               uuid REFERENCES users(id)
game_id               text NOT NULL
amount                integer NOT NULL
type                  text NOT NULL
  -- REFERRAL_CASHOUT_ELIGIBLE | IN_GAME_ONLY
status                text DEFAULT 'PENDING'
  -- PENDING | CONFIRMED | CASHED_OUT
related_referral_id   uuid REFERENCES referrals(id)
created_at            timestamptz DEFAULT now()
updated_at            timestamptz DEFAULT now()
```

#### `cashout_requests`
```sql
id                uuid PRIMARY KEY
user_id           uuid REFERENCES users(id)
amount            integer NOT NULL
status            text DEFAULT 'REQUESTED'
  -- REQUESTED | UNDER_REVIEW | APPROVED | REJECTED | PAID | DELAYED
payout_method_id  uuid REFERENCES payout_methods(id)
stripe_transfer_id text
reason            text
reviewed_by       uuid REFERENCES admin_users(id)
reviewed_at       timestamptz
created_at        timestamptz DEFAULT now()
updated_at        timestamptz DEFAULT now()
```

#### `payout_methods`
```sql
id              uuid PRIMARY KEY
user_id         uuid REFERENCES users(id)
type            text NOT NULL   -- STRIPE_CONNECT
details         jsonb
eligible_at     timestamptz     -- now() + 72 hours after adding
created_at      timestamptz DEFAULT now()
```

#### `device_fingerprints`
```sql
id              uuid PRIMARY KEY
user_id         uuid REFERENCES users(id)
fingerprint_id  text NOT NULL
confidence      text
  -- high | medium | low
ip_address      text
asn             text
last_seen_at    timestamptz DEFAULT now()
```
Auto-delete after 90 days.

#### `risk_logs`
```sql
id            uuid PRIMARY KEY
user_id       uuid REFERENCES users(id)
referral_id   uuid REFERENCES referrals(id)
metric        text
  -- HIGH_VELOCITY | NEAR_THRESHOLD_CLUSTER | VPN_IP | BOT_PATTERN | etc.
value         text
created_at    timestamptz DEFAULT now()
```

#### `idempotency_keys`
```sql
id              uuid PRIMARY KEY
key             text UNIQUE NOT NULL
endpoint        text NOT NULL
user_id         uuid REFERENCES users(id)
response_body   jsonb
created_at      timestamptz DEFAULT now()
expires_at      timestamptz   -- created_at + 24 hours
```
Duplicate requests within 24h return cached response without re-executing.

#### `admin_audit_logs`
```sql
id              uuid PRIMARY KEY
admin_user_id   uuid REFERENCES admin_users(id)
action          text NOT NULL
  -- CASHOUT_APPROVED | CASHOUT_REJECTED | CASHOUT_DELAYED | CONFIG_CHANGED |
  -- RISK_SCORE_OVERRIDE | USER_FROZEN | USER_UNFROZEN
target_type     text NOT NULL
target_id       text NOT NULL
before_value    jsonb
after_value     jsonb
reason          text NOT NULL   -- mandatory
created_at      timestamptz DEFAULT now()
```

#### `admin_users`
```sql
id          uuid PRIMARY KEY
email       text UNIQUE NOT NULL
role        text NOT NULL
  -- super_admin | ops_admin | read_only
created_at  timestamptz DEFAULT now()
```

#### `platform_config`
```sql
key         text PRIMARY KEY
value       text NOT NULL
updated_at  timestamptz DEFAULT now()
updated_by  uuid REFERENCES admin_users(id)
change_note text
```
Stores: `credits_per_usd`, `min_cashout_credits`, `first_cashout_min_credits`, `refund_lock_days`, `platform_fee_pct`, `high_value_cashout_threshold`, `high_value_review_delay_hours`.

#### `missions`
```sql
id              uuid PRIMARY KEY
game_id         text NOT NULL
title           text NOT NULL
description     text
target_value    integer NOT NULL
reward_credits  integer NOT NULL
active          boolean DEFAULT true
```

#### `user_missions`
```sql
id            uuid PRIMARY KEY
user_id       uuid REFERENCES users(id)
mission_id    uuid REFERENCES missions(id)
progress      integer DEFAULT 0
completed_at  timestamptz
```

#### `notifications`
```sql
id          uuid PRIMARY KEY
user_id     uuid REFERENCES users(id)
type        text
  -- REFERRAL_CONFIRMED | REFERRAL_REJECTED | CASHOUT_APPROVED | CASHOUT_REJECTED
sent_at     timestamptz
created_at  timestamptz DEFAULT now()
```

#### `data_deletion_requests`
```sql
id            uuid PRIMARY KEY
user_id       uuid REFERENCES users(id)
requested_at  timestamptz DEFAULT now()
completed_at  timestamptz
status        text DEFAULT 'PENDING'
  -- PENDING | COMPLETED
```

#### `webhook_subscriptions`
```sql
id              uuid PRIMARY KEY
game_id         text NOT NULL
url             text NOT NULL
secret_key      text NOT NULL
enabled_events  text[]
  -- referral.confirmed | referral.rejected | cashout.paid
active          boolean DEFAULT true
created_at      timestamptz DEFAULT now()
```

---

## 5. Engagement & Threshold Rules

### Referral confirmation requires ALL of the following:
1. Referee has reached **level 5** minimum
2. Referee has **7 distinct active days**
3. Referee has purchased **premium**
4. **30 days have elapsed** since premium purchase
5. No refund or chargeback on the premium payment
6. Referee's risk score is **not high**

All thresholds stored in `platform_config` — never hardcoded.

### KYC tiers (lifetime cashout)
| Lifetime cashout | KYC required |
|---|---|
| Under $20 | None |
| $20 – $150 | Email + phone verification |
| Above $150 | Full ID verification |

---

## 6. API Endpoints (v1)

All endpoints prefixed `/api/v1/`. Auth required unless noted.

### Auth & User
- `POST /api/v1/auth/signup-with-referral` — create user, attach referral
- `POST /api/v1/auth/login`
- `GET /api/v1/users/me`

### Events (Game/Engagement)
Rate limits via Upstash Redis:
- `level-up`: max 1/min per user
- `daily-active`: max 1/calendar day per user
- `mission-complete`: max 10/hour per user

Endpoints:
- `POST /api/v1/events/level-up`
- `POST /api/v1/events/daily-active`
- `POST /api/v1/events/mission-complete`
- `POST /api/v1/events/premium-purchased`

### Referrals & Dashboard
- `GET /api/v1/referrals/my-code`
- `GET /api/v1/referrals/dashboard`
- `POST /api/v1/referrals/simulate-signup` (sandbox only)

### Credits & Cashout
- `GET /api/v1/credits/balance`
- `POST /api/v1/cashout/request` (requires `Idempotency-Key` header)
- `GET /api/v1/cashout/history`
- `POST /api/v1/payout-methods/add`

### KYC
- `POST /api/v1/kyc/start`
- `POST /api/v1/kyc/callback`

### Tax
- `POST /api/v1/tax/start`
- `POST /api/v1/tax/callback`

### Webhooks (Studio-facing)
- `POST /api/v1/webhooks/subscribe`
- `DELETE /api/v1/webhooks/:id`

### Admin (role-protected)
| Endpoint | super_admin | ops_admin | read_only |
|---|---|---|---|
| `GET /api/v1/admin/users/:id` | ✅ | ✅ | ✅ |
| `POST /api/v1/admin/users/:id/freeze` | ✅ | ✅ | ❌ |
| `POST /api/v1/admin/cashouts/:id/approve` | ✅ | ✅ | ❌ |
| `POST /api/v1/admin/cashouts/:id/reject` | ✅ | ✅ | ❌ |
| `PUT /api/v1/admin/config` | ✅ | ❌ | ❌ |
| `GET /api/v1/admin/audit-logs` | ✅ | ✅ | ✅ |

All admin write actions require a mandatory `reason` string. Missing `reason` returns 400.

---

## 7. Risk & Fraud Engine

| Signal | Action |
|---|---|
| >5 accounts from same device_id | Flag HIGH_VELOCITY, raise risk_score to high |
| >5 accounts sharing same fingerprint_id | Flag HIGH_VELOCITY, block new referral creation |
| >10 signups from same IP in 24h | Flag HIGH_VELOCITY, block new referral creation |
| VPN/datacenter IP detected | Flag VPN_IP, require KYC before cashout |
| Event timestamps perfectly regular | Flag BOT_PATTERN, raise risk_score to high |
| Referrer concentration >80% same geo/device | Flag HIGH_CONCENTRATION, manual review for payouts >$50 |
| Refund or chargeback on premium payment | Void pending credits, raise referrer risk_score |
| lifetime_cashout_used >= $500 and tax_verified=false | Lock all cashouts |
| Single cashout >= 10,000 credits ($100) | Force UNDER_REVIEW, mandatory 24-hour hold |

### Risk score effects
- **low:** Normal flow
- **medium:** Manual review for cashouts >$100
- **high:** All cashouts go to UNDER_REVIEW

---

## 8. Notification System

Channel: Email only (Resend)

| Event | Trigger |
|---|---|
| Referral confirmed | Referee meets all thresholds |
| Referral rejected | Admin rejects or fraud detected |
| Cashout approved | Admin approves payout |
| Cashout rejected | Admin rejects request |

---

## 9. Data, Privacy & Compliance

- GDPR/CCPA: `data_deletion_requests` table handles right-to-erasure
- Device fingerprints: auto-deleted after 90 days
- Idempotency keys: expire after 24 hours (add `pg_cron` cleanup job)
- Tax: W-9 (US) or W-8BEN (non-US) required at $500 lifetime cashout via Stripe Tax
- No PII in URL parameters

---

## 10. Build Order (Recommended)

> Build simple, then layer in complexity.

1. **Phase 1:** Monorepo scaffold, Next.js shell app, Supabase connection, Vercel deploy
2. **Phase 2:** Database schema + migrations
3. **Phase 3:** Auth (signup, login, user profile)
4. **Phase 4:** Core referral flow (generate code, track signup, confirm referral)
5. **Phase 5:** Credits ledger + cashout request
6. **Phase 6:** Admin panel (approve/reject cashouts, view users)
7. **Phase 7:** Fraud/risk engine basics (IP rate limiting, manual review)
8. **Phase 8:** Stripe Connect payouts
9. **Phase 9:** Email notifications (Resend)
10. **Phase 10:** KYC + tax compliance hooks
11. **Phase 11:** First game (`apps/game-1`)
12. **Phase 12:** Multi-tenant / B2B SaaS features
