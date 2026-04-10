// Referral source classification (PR 10-C)
// Classifies referral sources as GREEN (known social), YELLOW (unknown), or RED (blocklisted)

import type { SupabaseClient } from '@supabase/supabase-js'

export type SourceClassification = 'GREEN' | 'YELLOW' | 'RED'

// Known legitimate social platforms
const GREEN_DOMAINS: string[] = [
  'facebook.com', 'fb.com', 'fb.me', 'l.facebook.com',
  'tiktok.com', 'vm.tiktok.com',
  'instagram.com', 'l.instagram.com',
  'twitter.com', 'x.com', 't.co',
  'youtube.com', 'youtu.be',
  'reddit.com', 'old.reddit.com',
  'whatsapp.com', 'wa.me',
  'messenger.com', 'm.me',
  'telegram.org', 't.me', 'web.telegram.org',
  'discord.com', 'discord.gg',
  'linkedin.com', 'lnkd.in',
  'pinterest.com',
  'snapchat.com',
  'viber.com',
  'line.me',
]

/**
 * Extract the hostname from a URL string, stripping 'www.' prefix.
 * Returns null on empty/invalid input.
 */
export function extractDomain(referer: string): string | null {
  if (!referer || referer.trim().length === 0) return null

  try {
    // Prepend https:// if no protocol present (bare domains like "facebook.com/path")
    const urlStr = referer.includes('://') ? referer : `https://${referer}`
    const url = new URL(urlStr)
    let hostname = url.hostname.toLowerCase()
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4)
    }
    return hostname || null
  } catch {
    return null
  }
}

/**
 * Classify a referral source URL.
 * GREEN = known social platform, RED = admin-blocklisted domain, YELLOW = everything else.
 */
export async function classifyReferralSource(
  adminClient: SupabaseClient,
  referer: string | null
): Promise<{ source: string | null; classification: SourceClassification }> {
  if (!referer || referer.trim().length === 0) {
    return { source: null, classification: 'YELLOW' }
  }

  const domain = extractDomain(referer)
  // Truncate source to 500 chars for DB safety
  const source = referer.length > 500 ? referer.slice(0, 500) : referer

  if (!domain) {
    return { source, classification: 'YELLOW' }
  }

  // Admin blocklist takes priority over hardcoded GREEN list
  try {
    const { data: blockedDomains, error } = await adminClient
      .from('source_blocklist')
      .select('domain')

    if (!error && blockedDomains) {
      for (const row of blockedDomains) {
        const blocked = row.domain as string
        // Match exact domain or subdomain (e.g., forums.beermoney.ph matches beermoney.ph)
        if (domain === blocked || domain.endsWith(`.${blocked}`)) {
          return { source, classification: 'RED' }
        }
      }
    }
  } catch {
    // Blocklist lookup failure → default to YELLOW (fail open)
  }

  // Check GREEN domains — match domain itself or parent domain
  for (const greenDomain of GREEN_DOMAINS) {
    if (domain === greenDomain || domain.endsWith(`.${greenDomain}`)) {
      return { source, classification: 'GREEN' }
    }
  }

  return { source, classification: 'YELLOW' }
}
