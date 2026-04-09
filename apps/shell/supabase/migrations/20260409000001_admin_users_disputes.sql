-- PR 7-C/7-H: Admin user management + disputes support
-- payout_hold already exists (20260405000005)
-- disputes table already exists (20260408000002)
-- admin_audit_logs already exists (20260405000004)

-- Add is_vip flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false;
