// KYC identity hashing for Sybil detection.
// HMAC-SHA256 with salt read from Supabase Vault via read_vault_secret() RPC.
// Salt is NEVER in .env, never hardcoded.
// Raw ID number is NEVER logged, stored in plaintext, or returned to any client.
//
// VAULT SETUP (one-time manual step before testing):
//   1. Generate salt: openssl rand -hex 32
//   2. In Supabase SQL editor: SELECT vault.create_secret('<output>', 'kyc_hmac_salt');

import { createHmac } from 'crypto'
import { getAdminClient } from './credits'

/**
 * Hash a KYC identity document number using HMAC-SHA256 with Vault-stored salt.
 * The salt is read from Supabase Vault via the read_vault_secret() RPC.
 * Raw ID number is NEVER logged anywhere — not in console.log, not in error messages.
 *
 * @param idNumber - Raw identity document number (e.g., passport number, SSN)
 * @returns HMAC-SHA256 hex digest
 * @throws Error if idNumber is empty or if Vault access fails
 */
export async function hashKycId(idNumber: string): Promise<string> {
  // Validate input (do not log the actual value)
  if (!idNumber || idNumber.trim().length === 0) {
    throw new Error('KYC ID number cannot be empty')
  }

  const adminClient = getAdminClient()

  // Read HMAC salt from Supabase Vault
  const { data: salt, error } = await adminClient.rpc('read_vault_secret', {
    secret_name: 'kyc_hmac_salt',
  })

  if (error || !salt) {
    // Do NOT log the error details — they might leak secret names or Vault structure.
    // Log only a generic failure message.
    console.error('KYC hash failed: Vault access error')
    throw new Error('Failed to retrieve KYC hashing salt from Vault')
  }

  // Generate HMAC-SHA256 digest
  const hmac = createHmac('sha256', salt)
  hmac.update(idNumber.trim())
  const hash = hmac.digest('hex')

  // Never log idNumber or salt anywhere

  return hash
}
