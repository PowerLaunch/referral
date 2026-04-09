-- Allow null user_id on fraud_flags (PR 4-B/4-C)
-- R4 (cashout spike) is a global system flag with no specific user

ALTER TABLE fraud_flags ALTER COLUMN user_id DROP NOT NULL;
