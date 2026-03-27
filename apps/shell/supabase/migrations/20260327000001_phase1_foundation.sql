-- Phase 1 Foundation Tables
-- Creates core user profiles, subscriptions, credits, and game config

-- profiles
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  referral_code TEXT UNIQUE NOT NULL,
  verified_kyc_hash TEXT UNIQUE,
  device_fingerprint TEXT,
  trust_level TEXT NOT NULL DEFAULT 'CLEAN'
    CHECK (trust_level IN ('CLEAN', 'SUSPICIOUS', 'BANNED')),
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due')),
  current_period_end TIMESTAMPTZ,
  transak_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);

-- user_credits (one row per user per credit type)
CREATE TABLE user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  type TEXT NOT NULL CHECK (type IN ('CASH_BALANCE', 'GAME_CREDITS')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, type)
);

-- credit_transactions (append-only ledger — no UPDATE or DELETE ever)
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('CASH_BALANCE', 'GAME_CREDITS')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);

-- game_config (single row, seeded with defaults)
CREATE TABLE game_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE,
  min_gameplay_minutes INTEGER NOT NULL DEFAULT 10,
  signup_bonus_amount INTEGER NOT NULL DEFAULT 0,
  signup_bonus_label TEXT NOT NULL DEFAULT 'credits',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id)
);

INSERT INTO game_config (min_gameplay_minutes, signup_bonus_amount, signup_bonus_label)
VALUES (10, 0, 'credits');

-- Comment: Self-referral prevention (CHECK referrer_id != referee_id)
-- will be added to the referrals table in Phase 2 PR 2-A.
