# SECURITY DOCUMENTATION

This document describes the security measures, fraud detection rules, and risk controls implemented in the referral platform.

---

## 1. Authentication & Authorization

### 1.1 User Authentication
- Supabase Auth with email verification required
- Session-based authentication with cookie rotation
- Middleware enforces auth on all protected routes
- Public paths: `/login`, `/signup`, `/verify-email`, `/auth/callback`, `/ref`, `/account-frozen`

### 1.2 API Authentication
- Webhook routes use provider-specific HMAC validation
- Cron routes use `Authorization: Bearer {CRON_SECRET}` header
- Admin operations require service role key

### 1.3 Row-Level Security (RLS)
- All database tables have RLS policies
- Users can only read/write their own data
- Admin queries use service role to bypass RLS

---

## 2. Automated Fraud Rules

Fraud rules R1-R6 run every 15 minutes via `/api/cron/fraud-scan`. R7 fires in real-time during KYC approval.

### R1 — Spike Detection
- **Trigger**: 5+ referrals created by the same referrer in the last 1 hour
- **Action**: Insert CRITICAL fraud_flag, set `payout_hold = true`, void pending referrals
- **Fires**: On 15-minute cron
- **Implemented in**: PR 4-B

### R2 — Device Cluster
- **Trigger**: 3+ distinct user_ids on the same device fingerprint_hash in last 30 days
- **Action**: Insert CRITICAL fraud_flag for all users in cluster, void pending referrals
- **Fires**: On 15-minute cron
- **Implemented in**: PR 4-B

### R3 — New Account Velocity
- **Trigger**: Accounts created in last 7 days with 10+ referrals
- **Action**: Insert WARNING fraud_flag, upgrade trust_level from CLEAN to SUSPICIOUS
- **Fires**: On 15-minute cron
- **Implemented in**: PR 4-B

### R4 — Cashout Spike (Circuit Breaker)
- **Trigger**: Current hour payout total > 3x 7-day hourly average (minimum baseline: $5 weekly)
- **Action**: Insert CRITICAL fraud_flag (user_id = null), set `cashouts_paused = true` globally
- **Fires**: On 15-minute cron
- **Implemented in**: PR 4-B

### R5 — Zero Gameplay
- **Trigger**: PENDING referrals created 3+ days ago where referee has 0 gameplay_minutes
- **Action**: Insert INFO fraud_flag only (no trust_level change, no payout_hold)
- **Fires**: On 15-minute cron
- **Implemented in**: PR 4-B

### R6 — Disposable Email
- **Trigger**: User email matches known disposable domain list
- **Action**: Insert WARNING fraud_flag (flags once per user ever, not once per day)
- **Fires**: On 15-minute cron
- **Implemented in**: PR 4-B

### R7 — Identity Cluster (Sybil Detection)
- **Trigger**: KYC hash collision (two users submit identical KYC identity)
- **Action**: Set both accounts to REVIEW_HOLD + SUSPICIOUS, insert CRITICAL fraud_flag, void pending referrals
- **Fires**: Real-time during KYC approval (PR 5-C, not from cron)
- **Implemented in**: PR 4-C

### R_GEO_MISMATCH — Geographic Mismatch
- **Trigger**: Referrer has referees from 3+ distinct countries (high geographic diversity suggests farm pattern)
- **Action**: Insert WARNING fraud_flag (rule: 'R_GEO_MISMATCH')
- **Fires**: On 15-minute cron alongside R1-R6
- **Implemented in**: PR 4-D

---

## 3. Account-Level Controls

### 3.1 Trust Levels
- **CLEAN**: Default state for all new users
- **SUSPICIOUS**: Automated upgrade by fraud rules (R3, R7) or admin action. Blocks payouts.
- **BANNED**: Admin-only action. Account frozen, all access blocked.

### 3.2 Account Status
- **ACTIVE**: Normal operation
- **REVIEW_HOLD**: Shadow review status. User sees "Verifying" but payouts are blocked. Triggered by fraud rules (R7) or admin action.
- **FROZEN**: Account temporarily suspended (e.g., subscription lapsed)
- **BANNED**: Permanent ban

### 3.3 Payout Hold
- Set by R1 spike detection
- Blocks all payout requests
- Cleared by admin in Phase 7

### 3.4 Referral Freeze
- Lock timer frozen on subscription lapse, chargebacks, or CRITICAL fraud flags
- Frozen referrals cannot mature or confirm
- Unfreeze via RPC when issue resolved

### 3.5 Circuit Breakers
- **Referral Confirmations**: `referral_confirmations_paused` in game_config (R4 cashout spike)
- **Cashouts**: `cashouts_paused` in game_config (R4 cashout spike)
- Admin-toggled in Phase 7

### 3.6 Fraud Scoring
- Risk score = sum of fraud_flag severity points (CRITICAL: 50, WARNING: 30, INFO: 10)
- **CRITICAL (100+)**: Skip referral confirmation entirely
- **HIGH (61-99)**: Skip confirmation, leave PENDING for manual review (no tracking flag inserted to avoid score inflation)
- **MEDIUM (31-60)**: Allow confirmation
- **LOW (0-30)**: Allow confirmation
- Note: A single CRITICAL flag (50 points) yields MEDIUM category. Two CRITICAL flags or one CRITICAL + one WARNING (80 points) yields HIGH. The CRITICAL category (100+) requires multiple flags, ensuring no single rule instantly blocks confirmation without corroboration.

### 3.7 Credit Voiding
- CRITICAL fraud flags auto-void all PENDING referrals (both as referrer and referee)
- Voided referrals set to status = 'VOIDED', never confirm

### 3.8 Middleware Fraud Guards
- Queries profiles for trust_level and status on every authenticated request
- Redirects BANNED/FROZEN users to `/account-frozen`
- Blocks payout routes for REVIEW_HOLD or SUSPICIOUS users (403 error)
- Sets defense-in-depth headers (x-user-trust-level, x-user-status) for route handlers

### 3.9 Chargeback Handling
- **First chargeback**: REVIEW_HOLD + SUSPICIOUS, freeze all referrals (referrer-side and referee-side)
- **Second chargeback**: PERMANENT_BAN, freeze all referrals
- Implemented in: PR 4-D

### 3.10 Referral Link Rate Limiting
- /ref/[CODE] endpoint rate-limited to 10 requests per IP per 60 seconds
- In-memory Map per serverless instance (best-effort, not global)
- Prevents bot-driven click flooding
- Implemented in: PR 4-D

---

## 4. Payment & Payout Security

### 4.1 Payout Guards
- **Guard A**: Trust level must be CLEAN (SUSPICIOUS/BANNED blocked)
- **Guard B**: Payout hold check (R1 sets this)
- **Guard C**: Active subscription required
- **Guard D**: KYC verification required (stub in MVP, enforced in PR 5-C)
- **Guard E**: Account age >= 7 days
- **Guard F**: Minimum balance by method (GCash/GoPay/OVO: $5, PayPal: $15, Bank: $25)
- **Guard G**: Balance check (only CASH_BALANCE, not GAME_CREDITS)
- **Guard H-pre**: No concurrent in-flight payouts (PENDING/PENDING_MANUAL_APPROVAL/PROCESSING)
- **Guard H**: Cooldown (30 days first-to-second, 14 days thereafter)
- **Guard I**: Credit type enforcement (only CASH_BALANCE is cashable)

### 4.2 Payout Statuses
- **PENDING**: Automated payout (not first), queued for execution
- **PENDING_MANUAL_APPROVAL**: First payout, requires admin approval
- **PROCESSING**: Funds being sent to provider
- **COMPLETED**: Payout succeeded
- **FAILED**: Payout failed (balance restored)
- **VOIDED**: Admin-cancelled before execution

### 4.3 Payout Failure Handling
- Failed payouts restore credits via credit_ledger insert (type: PAYOUT_REVERSAL)
- Webhook handler at `/api/webhooks/payout-failure` (provider-specific HMAC validation)
- Idempotency via `transaction_id` deduplication

### 4.4 Credit Ledger Atomicity
- All credit operations use RPC functions (award_credits, deduct_credits, create_payout)
- Prevents race conditions and double-spends
- Deduction failure rolls back entire payout creation

### 4.5 Referral Confirmation Collateralization
- Referrals cannot confirm until linked payment_event is COMPLETED and past 48-hour refund window
- Prevents confirmation against unsettled or refundable payments
- Implemented in: PR 3-B-patch

### 4.6 Fraud Scoring Before Confirmation
- Confirmation cron checks referee risk score before confirming
- CRITICAL (100+) or HIGH (61-99) risk scores skip confirmation
- Referrals stay PENDING until score drops (flags resolved)

### 4.7 Subscription Maturity Checkpoint
- Referrals freeze when referee subscription lapses
- Unfreeze webhook at `/api/webhooks/subscription` (stub HMAC validation, replace in PR 5-A)
- Prevents confirmation against lapsed subscriptions

### 4.8 Chargeback Circuit Breaker
- First chargeback freezes all referrals (referrer-side and referee-side), sets REVIEW_HOLD
- Second chargeback triggers PERMANENT_BAN
- Prevents earning credits from disputed payments

### 4.9 Monthly Referral Cap
- 50 confirmed referrals per referrer per calendar month
- Scoped to confirmed_at timestamp (not created_at)
- Enforced by confirmation cron

### 4.10 Device Fingerprinting
- SHA-256 hash of browser fingerprint (UserAgent, screen, timezone, hardware, language)
- Captured once per session via client-side component
- R2 device cluster rule flags multi-accounting
- Cookie set for middleware access (30-day expiry)

### 4.11 24-Hour Payout Staging Window
- Payouts sit in PENDING/PENDING_MANUAL_APPROVAL for at least 24 hours before executePayout() fires
- The 15-minute fraud cron runs multiple times in this window, catching issues before money leaves
- Implemented in: PR 4-D (stub), PR 5-B (enforcement)

---

## 5. Database Security

### 5.1 Admin Client (Service Role)
- Write operations use service role key (bypasses RLS)
- Never exposed to client-side code
- Used in API routes and crons only

### 5.2 RLS Policies
- All tables enforce RLS
- Users can only access their own data
- Admin queries use service role to bypass

### 5.3 Unique Indexes
- fraud_flags: unique per user+rule+day (prevents duplicate flags)
- device_fingerprints: unique per user+fingerprint (prevents duplicate fingerprints)
- profiles.verified_kyc_hash: unique (R7 Sybil detection)
- payouts: unique per user where status IN ('PENDING','PENDING_MANUAL_APPROVAL','PROCESSING') (prevents concurrent payout submissions)

### 5.4 Idempotency
- payment_events.transaction_id unique index (prevents duplicate payment processing)
- fraud_flags deduplication (unique index on user_id, rule_triggered, DATE(created_at))
- RPC functions handle concurrent calls safely

---

## 6. Cron & Webhook Security

### 6.1 Cron Authentication
- All cron routes protected by `Authorization: Bearer {CRON_SECRET}` header
- Unauthorized requests return 401
- Secret stored in environment variables

### 6.2 Webhook Authentication
- Subscription webhook: provider-specific HMAC validation (stub in MVP, replace in PR 5-A)
- Payout failure webhook: provider-specific HMAC validation (stub in MVP, replace in PR 5-B)
- Chargeback webhook: provider-specific HMAC validation (stub in MVP, replace in PR 5-B)

### 6.3 Cron Error Isolation
- Each fraud rule runs in try/catch block
- One rule failure does not abort others
- Failed rules logged with error message

---

## 7. Admin Audit Trail

### 7.1 admin_audit_logs Table
- All trust_level and status changes logged
- All payout approvals/voids logged
- All circuit breaker activations logged
- Tracks: adminUserId (null for automated), action, targetType, targetId, beforeValue, afterValue, reason

### 7.2 Logged Actions
- UPDATE_TRUST_LEVEL (R3, R7, admin manual)
- UPDATE_STATUS (R7, admin manual)
- CIRCUIT_BREAKER_TRIGGERED (R4)
- CHARGEBACK_AUTO_FREEZE (first chargeback)
- CHARGEBACK_PERMANENT_BAN (second chargeback)
- APPROVE_PAYOUT (admin approval, Phase 7)
- VOID_PAYOUT (admin void, Phase 7)

---

## 8. Future Enhancements

### 8.1 Device Re-Auth (Phase 8)
- Force re-auth when R2 device cluster detected
- profiles.force_reauth column (deferred from PR 4-D)
- Requires user to re-login from same device

### 8.2 KYC Integration (PR 5-C)
- Real KYC vendor integration
- verified_kyc_hash set on approval
- R7 Sybil detection enforced at KYC approval

### 8.3 Real Payment Provider HMAC (PR 5-A, 5-B)
- Replace stub HMAC validation with real provider-specific validation
- Transak/MoonPay/Triple-A/XanPool webhook signatures

### 8.4 Admin Dashboard (Phase 7)
- Fraud flag review queue
- Payout approval/void interface
- Circuit breaker toggles
- Trust level override

---

## Summary

This platform implements defense-in-depth security:
- **7 automated fraud rules** catching velocity, device clustering, Sybil attacks, disposables, zero-gameplay, cashout spikes, and geo-mismatches
- **Trust levels and status columns** enabling granular access control
- **Payout guards** enforcing KYC, account age, subscription, and cooldown requirements
- **Referral freeze and void mechanisms** preventing credit award on fraudulent accounts
- **Atomic credit operations** via RPC functions preventing race conditions
- **Middleware fraud checks** enforcing trust_level/status on every request
- **24-hour payout staging window** allowing fraud detection before execution
- **Chargeback escalation** with automatic bans on repeat offenses
- **Rate limiting on referral links** preventing bot flooding
- **Comprehensive audit logging** tracking all security events

No user-facing security measure is silently bypassable. Every control layer is logged and auditable.
