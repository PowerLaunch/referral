-- Phase 7-C/7-H: Admin user management + disputes enhancements

-- Add manual_payout_approval override column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manual_payout_approval boolean NOT NULL DEFAULT false;

-- Add resolved_by to disputes (tracks which admin resolved it)
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES profiles(id);

-- Index for dispute status filtering (may already exist)
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_user ON disputes(user_id);
