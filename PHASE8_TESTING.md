# Phase 8 — Manual Test Procedures

> These tests are run manually by the admin before launch. Each test includes step-by-step instructions, expected results, pass/fail criteria, and what to verify in the admin dashboard.
>
> Prerequisites: Admin account with is_admin = true. Access to Supabase SQL editor for direct DB queries. All Phase 1-4 and Phase 6-7 code merged. Phase 5 (payments) must be integrated before TEST 5 can run.

---

## TEST 1 — Full Referral Journey

**Purpose:** Verify the complete referral lifecycle from signup to payout eligibility.

**Steps:**
1. Create Account A (the referrer): sign up with a real email, verify email, confirm referral_code is generated in profiles table.
2. Create Account B (the referee): open an incognito/private browser window. Navigate to the referral link: `https://[domain]/ref/[Account A's referral_code]`.
3. Sign up Account B through that referral link. Verify email.
4. Confirm in Supabase: a row exists in referrals table with referrer_id = Account A, referee_id = Account B, status = PENDING.
5. Simulate subscription for Account B: in Supabase SQL editor, insert a subscriptions row with status = 'active' and user_id = Account B's ID. (Real subscription via Transak/MoonPay requires Phase 5.)
6. Simulate gameplay for Account B: either play the game for min_gameplay_minutes (check game_config for current value, default 10), OR manually update gameplay_sessions to set total_minutes >= min_gameplay_minutes and session_count >= min_session_count (default 3).
7. Trigger the referral confirmation cron: call GET /api/cron/confirm-referrals with `Authorization: Bearer {CRON_SECRET}` header.
8. Verify in Supabase: referrals row status changed from PENDING to CONFIRMED. referral_audit_logs has a CONFIRM entry. credit_transactions has a CASH_BALANCE credit of $2 for Account A.

**Expected result:** Referral moves from PENDING to CONFIRMED. Referrer receives $2 credit.

**Pass/fail criteria:**
- ✅ referrals.status = 'CONFIRMED'
- ✅ credit_transactions row exists with user_id = Account A, type = 'CASH_BALANCE', amount = 2
- ✅ referral_audit_logs has action = 'CONFIRM'
- ❌ FAIL if referral stays PENDING — check cron logs for skip reason

**Admin dashboard checks:**
- /admin/users/[Account A ID]: Credit Ledger tab shows the $2 credit
- /admin/users/[Account A ID]: Referrals tab shows Account B with CONFIRMED status
- /admin (Pulse): revenue metrics should reflect the new subscription

---

## TEST 2 — Maturity Checkpoint (Freeze/Unfreeze Timer)

**Purpose:** Verify that cancelling a referrer's subscription freezes the lock period timer, and resubscribing resumes it correctly.

**Steps:**
1. Use the referral pair from TEST 1 (or create a new one). Ensure the referral is in PENDING status with a payout_eligible_at date in the future.
2. Record the current payout_eligible_at value from the referrals table.
3. Simulate referrer subscription cancellation: update subscriptions SET status = 'cancelled' WHERE user_id = [Account A].
4. Trigger the maturity checkpoint: this runs as part of the confirm-referrals cron or a separate freeze check. Call the cron endpoint.
5. Verify in Supabase: referrals.lock_timer_frozen = true. referral_audit_logs has a FREEZE entry.
6. Wait a measurable amount of time (e.g., manually advance the clock by updating created_at, or simply note the wall-clock time).
7. Simulate referrer resubscription: update subscriptions SET status = 'active' WHERE user_id = [Account A].
8. Trigger the cron again.
9. Verify in Supabase: referrals.lock_timer_frozen = false. payout_eligible_at has been extended by the duration of the freeze. referral_audit_logs has an UNFREEZE entry.

**Expected result:** Timer freezes on cancel, resumes on resubscribe, payout_eligible_at shifts forward by the frozen duration.

**Pass/fail criteria:**
- ✅ lock_timer_frozen = true after cancellation
- ✅ lock_timer_frozen = false after resubscription
- ✅ payout_eligible_at is later than the original value by approximately the freeze duration
- ✅ referral_audit_logs has both FREEZE and UNFREEZE entries
- ❌ FAIL if payout_eligible_at does not change or timer does not freeze

**Admin dashboard checks:**
- /admin/users/[Account A ID]: Referrals tab shows freeze indicator if currently frozen

---

## TEST 3 — R7 Sybil Detection (Identity Cluster)

**Purpose:** Verify that submitting the same KYC identity on two accounts triggers REVIEW_HOLD on both and creates CRITICAL fraud flags.

**Steps:**
1. Create Account C and Account D (two separate accounts with different emails).
2. Simulate KYC approval for Account C: in Supabase SQL editor, update profiles SET verified_kyc_hash = 'test_hash_abc123' WHERE id = [Account C]. This simulates the hash that would be written during real KYC approval.
3. Simulate KYC approval for Account D with the SAME hash: call the checkIdentityCluster function (from packages/api/src/kycHash.ts) with Account D's userId and the same hash 'test_hash_abc123'. If calling the function directly is not possible, simulate it by:
   a. Attempt: UPDATE profiles SET verified_kyc_hash = 'test_hash_abc123' WHERE id = [Account D].
   b. If the UNIQUE constraint fires, that confirms the detection works at DB level.
   c. Then manually: UPDATE profiles SET trust_level = 'SUSPICIOUS' WHERE id IN ([Account C], [Account D]).
   d. INSERT into fraud_flags two rows: one for Account C, one for Account D, both with rule_triggered = 'R7_IDENTITY_CLUSTER', severity = 'CRITICAL'.
4. Verify in Supabase: both accounts have trust_level = 'SUSPICIOUS'. fraud_flags has CRITICAL R7 entries for both.

**Expected result:** Both accounts flagged. Neither is auto-banned — admin reviews.

**Pass/fail criteria:**
- ✅ UNIQUE constraint on verified_kyc_hash prevents duplicate
- ✅ Both accounts have trust_level = 'SUSPICIOUS' (or REVIEW_HOLD status)
- ✅ fraud_flags has 2 rows with rule_triggered = 'R7_IDENTITY_CLUSTER', severity = 'CRITICAL'
- ❌ FAIL if second account gets the same hash without triggering detection

**Admin dashboard checks:**
- /admin/fraud: Sybil cluster view shows both Account C and Account D grouped under the same hash
- /admin/fraud: Fraud flags feed shows two CRITICAL R7 entries
- /admin/users/[Account C]: Fraud Flags tab shows the R7 flag
- /admin/users/[Account D]: Fraud Flags tab shows the R7 flag

---

## TEST 4 — Payout Failure Handling

**Purpose:** Verify that a failed payout credits funds back to the user, sends notification, and enforces cooldown.

**Steps:**
1. Use Account A from TEST 1 (should have $2 credit from the confirmed referral).
2. Ensure Account A meets payout prerequisites: account age >= 7 days (update created_at if needed), active subscription, verified KYC hash (set a dummy hash).
3. Create a payout request: INSERT into payouts (user_id, amount, method, status) VALUES ([Account A], 2, 'gcash', 'PROCESSING').
4. Simulate payout failure by calling handlePayoutFailure (from packages/api or the payout workflow) with the payout ID, an error code like 'PROVIDER_ERROR', and isTransient = false. If the function is not directly callable, simulate:
   a. UPDATE payouts SET status = 'FAILED', provider_error_code = 'PROVIDER_ERROR' WHERE id = [payout ID].
   b. Call awardCredits(Account A, 2, 'CASH_BALANCE', 'payout_failed:[payout ID]') to credit funds back.
   c. Set retry_available_at = NOW() + interval '24 hours' on the payout row.
5. Verify in Supabase: payout status = 'FAILED'. credit_transactions has a credit-back entry. retry_available_at is 24 hours from now.
6. Attempt retry before cooldown expires: go to /admin/cashouts, find the failed payout, click retry. Should be rejected (cooldown active).
7. To test successful retry: UPDATE payouts SET retry_available_at = NOW() - interval '1 hour'. Then retry from admin dashboard.

**Expected result:** Funds credited back immediately. 24-hour cooldown enforced. Admin can retry after cooldown.

**Pass/fail criteria:**
- ✅ payout.status = 'FAILED' with provider_error_code set
- ✅ credit_transactions has a credit-back row for the full payout amount
- ✅ retry_available_at is approximately 24 hours in the future
- ✅ Retry before cooldown fails with appropriate error
- ✅ Retry after cooldown proceeds to PROCESSING
- ❌ FAIL if funds are not credited back or cooldown is not enforced

**Admin dashboard checks:**
- /admin/cashouts: Failed tab shows the payout with error code and retry count
- /admin/users/[Account A]: Credit Ledger shows both the original credit and the credit-back

---

## TEST 5 — Real $1 Transaction (Requires Phase 5)

**Purpose:** End-to-end test with real money through the full payment flow.

**WARNING: DO NOT RUN THIS TEST until Phase 5 (payment integration) is complete and the on-ramp provider (Transak/MoonPay) is configured in production mode.**

**Steps:**
1. Create a fresh test account with a real email.
2. Navigate to the subscription page.
3. Initiate a $1 payment through Transak/MoonPay hosted checkout.
4. Complete the payment with a real payment method.
5. Wait for the webhook callback. Monitor payment_events table for the incoming event.
6. Verify: payment_events row created with correct transaction ID and amount.
7. Verify: subscriptions row created or updated with status = 'active'.
8. Verify: if this account was referred, the referrer's referral row is unaffected (payment alone does not confirm referral — gameplay is still required).
9. Generate a referral link from this account. Create a second test account via the link. Pay $1 on the second account.
10. Simulate gameplay on the second account (or play the actual game).
11. Trigger the confirm-referrals cron.
12. Verify: referral confirmed, $2 credit awarded to first account.
13. Request a payout from the first account. Since this is the first payout, it should go to PENDING_MANUAL_APPROVAL.
14. In admin dashboard, approve the payout.
15. Verify: payout completes through the off-ramp (Triple-A/XanPool) to the specified e-wallet or bank.

**Expected result:** $1 in -> subscription active -> referral confirmed -> $2 credit -> payout succeeds.

**Pass/fail criteria:**
- ✅ payment_events row with correct amount and provider transaction ID
- ✅ Subscription activated on webhook receipt
- ✅ Referral confirmed after gameplay + cron
- ✅ Credit awarded to referrer
- ✅ First payout requires manual approval
- ✅ Payout completes to e-wallet/bank
- ❌ FAIL if any step does not produce the expected database state

**Admin dashboard checks:**
- /admin (Pulse): revenue metrics reflect the $1 payments
- /admin/cashouts: Pending tab shows the first payout requiring approval
- /admin/users: both test accounts visible with correct statuses

---

## POST-TEST CLEANUP

After all tests pass:
1. Delete test accounts from auth.users (cascades to profiles via FK).
2. Verify cascade deleted: referrals, credit_transactions, fraud_flags, gameplay_sessions for those users.
3. Any seed users created via /admin/seed should be deleted through the admin seed user interface.
4. Set game_config values to production values (min_gameplay_minutes, signup_bonus_amount, signup_bonus_label) via /admin/config.
