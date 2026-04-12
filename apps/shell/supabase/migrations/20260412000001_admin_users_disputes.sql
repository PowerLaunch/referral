-- Phase 7-C/7-H: Admin user management + disputes enhancements

-- Add manual_payout_approval override column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manual_payout_approval boolean NOT NULL DEFAULT false;

-- Add resolved_by to disputes (tracks which admin resolved it)
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES profiles(id);

-- Note: idx_disputes_status and idx_disputes_user_id already exist from migration 20260408000002.
-- Not re-creating them here to avoid duplicate index warnings.
