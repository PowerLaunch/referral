-- Postgres function for Supabase Vault access (PR 4-B/4-C)
-- HMAC salt for KYC hashing is stored in Vault, never in .env or hardcoded.
-- This RPC allows service_role to read secrets from vault.decrypted_secrets.

CREATE OR REPLACE FUNCTION read_vault_secret(secret_name text)
RETURNS text AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = secret_name
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION read_vault_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION read_vault_secret(text) TO service_role;
