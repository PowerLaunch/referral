-- RLS Verification Script
-- Run this in Supabase SQL editor. If any table appears, RLS needs to be enabled.
-- This is a manual audit tool — NOT a migration. Do not run via supabase db push.

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false;
