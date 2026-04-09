'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { obfuscateEmail } from '@referral/api/email'

/**
 * Server action: fetch obfuscated referee emails for a list of referral referee IDs.
 * Uses admin client to access auth.users (not available via RLS).
 * Returns a map of userId -> obfuscated email.
 */
export async function getObfuscatedRefereeEmails(
  refereeIds: string[]
): Promise<Record<string, string>> {
  if (refereeIds.length === 0) return {}

  // Auth check: verify caller is authenticated
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return {}

  // Verify caller owns these referrals: all refereeIds must belong to
  // referrals where the current user is the referrer.
  const { data: ownedReferrals, error: ownershipError } = await supabase
    .from('referrals')
    .select('referee_id')
    .eq('referrer_id', user.id)
    .in('referee_id', refereeIds)

  if (ownershipError) {
    console.error('Failed to verify referral ownership:', ownershipError.message)
    return {}
  }

  const ownedRefereeIds = new Set((ownedReferrals ?? []).map((r) => r.referee_id))
  const authorizedIds = refereeIds.filter((id) => ownedRefereeIds.has(id))

  if (authorizedIds.length === 0) return {}

  const adminClient = createAdminClient()
  const result: Record<string, string> = {}

  // Fetch emails from profiles table (has email column)
  const { data: profiles, error } = await adminClient
    .from('profiles')
    .select('id, email')
    .in('id', authorizedIds)

  if (error) {
    console.error('Failed to fetch referee emails:', error.message)
    return result
  }

  for (const profile of profiles ?? []) {
    result[profile.id] = obfuscateEmail(profile.email)
  }

  return result
}

/**
 * Server action: submit a dispute for the current user.
 * Uses cookie-based client so RLS enforces user can only insert their own rows.
 */
export async function submitDispute(formData: {
  referralId: string | null
  description: string
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  if (!formData.description || formData.description.length < 20) {
    return { success: false, error: 'Description must be at least 20 characters' }
  }

  if (formData.description.length > 1000) {
    return { success: false, error: 'Description must be at most 1000 characters' }
  }

  const { error } = await supabase.from('disputes').insert({
    user_id: user.id,
    referral_id: formData.referralId || null,
    description: formData.description,
    status: 'OPEN',
  })

  if (error) {
    console.error('Failed to submit dispute:', error.message)
    return { success: false, error: 'Failed to submit dispute. Please try again.' }
  }

  return { success: true }
}
