// MVP: Hardcoded CIDR ranges. Replace with MaxMind GeoIP2 or IPQS API at 500+ users.

import type { SupabaseClient } from '@supabase/supabase-js'

export type IpClassification = 'RESIDENTIAL' | 'MOBILE' | 'DATACENTER' | 'VPN_PROXY' | 'UNKNOWN'

export interface IpClassificationResult {
  classification: IpClassification
  providerName: string | null
  ipRange24: string
}

// Datacenter /8 ranges (first octet match)
const DATACENTER_SLASH_8: Array<{ firstOctet: number; provider: string }> = [
  // AWS
  { firstOctet: 3, provider: 'AWS' },
  { firstOctet: 13, provider: 'AWS' },
  { firstOctet: 15, provider: 'AWS' },
  { firstOctet: 18, provider: 'AWS' },
  { firstOctet: 54, provider: 'AWS' },
  // GCP
  { firstOctet: 34, provider: 'GCP' },
  { firstOctet: 35, provider: 'GCP' },
  // Azure
  { firstOctet: 20, provider: 'Azure' },
  { firstOctet: 40, provider: 'Azure' },
  // AWS + Azure overlap on 52
  { firstOctet: 52, provider: 'AWS/Azure' },
]

// Datacenter /16 ranges (first two octets match)
const DATACENTER_SLASH_16: Array<{ firstOctet: number; secondOctet: number; provider: string }> = [
  // DigitalOcean
  { firstOctet: 104, secondOctet: 131, provider: 'DigitalOcean' },
  { firstOctet: 138, secondOctet: 68, provider: 'DigitalOcean' },
  { firstOctet: 139, secondOctet: 59, provider: 'DigitalOcean' },
  { firstOctet: 142, secondOctet: 93, provider: 'DigitalOcean' },
  { firstOctet: 157, secondOctet: 245, provider: 'DigitalOcean' },
  { firstOctet: 164, secondOctet: 90, provider: 'DigitalOcean' },
  { firstOctet: 167, secondOctet: 71, provider: 'DigitalOcean' },
  { firstOctet: 167, secondOctet: 172, provider: 'DigitalOcean' },
  // OVH
  { firstOctet: 51, secondOctet: 38, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 68, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 75, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 77, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 79, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 81, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 83, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 89, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 91, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 161, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 178, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 195, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 210, provider: 'OVH' },
  { firstOctet: 51, secondOctet: 222, provider: 'OVH' },
  { firstOctet: 54, secondOctet: 37, provider: 'OVH' },
  { firstOctet: 54, secondOctet: 38, provider: 'OVH' },
  // Linode/Akamai
  { firstOctet: 45, secondOctet: 33, provider: 'Linode' },
  { firstOctet: 45, secondOctet: 56, provider: 'Linode' },
  { firstOctet: 45, secondOctet: 79, provider: 'Linode' },
  { firstOctet: 50, secondOctet: 116, provider: 'Linode' },
  { firstOctet: 66, secondOctet: 175, provider: 'Linode' },
  { firstOctet: 69, secondOctet: 164, provider: 'Linode' },
  { firstOctet: 72, secondOctet: 14, provider: 'Linode' },
  { firstOctet: 74, secondOctet: 207, provider: 'Linode' },
  { firstOctet: 96, secondOctet: 126, provider: 'Linode' },
  { firstOctet: 97, secondOctet: 107, provider: 'Linode' },
  { firstOctet: 172, secondOctet: 104, provider: 'Linode' },
  { firstOctet: 172, secondOctet: 105, provider: 'Linode' },
  { firstOctet: 173, secondOctet: 255, provider: 'Linode' },
  { firstOctet: 192, secondOctet: 155, provider: 'Linode' },
  { firstOctet: 198, secondOctet: 58, provider: 'Linode' },
  { firstOctet: 198, secondOctet: 74, provider: 'Linode' },
]

/**
 * Extract the /24 range from an IPv4 address.
 * e.g., "1.2.3.45" → "1.2.3.0/24"
 * For IPv6 or invalid IPs, returns the raw IP string.
 */
export function getIpRange24(ip: string): string {
  const parts = ip.split('.')
  if (parts.length !== 4) return ip

  const octets = parts.map(Number)
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return ip

  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
}

/**
 * Parse an IPv4 address into its numeric octets.
 * Returns null for invalid or non-IPv4 addresses.
 */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null

  const octets = parts.map(Number)
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return null

  return octets as [number, number, number, number]
}

/**
 * Classify an IP address as datacenter, VPN, or unknown.
 * Uses hardcoded CIDR ranges for MVP — to be replaced with MaxMind GeoIP2 at 500+ users.
 */
export function classifyIp(ip: string): IpClassificationResult {
  const ipRange24 = getIpRange24(ip)
  const octets = parseIpv4(ip)

  if (!octets) {
    return { classification: 'UNKNOWN', providerName: null, ipRange24 }
  }

  // Check /16 ranges first (more specific)
  for (const range of DATACENTER_SLASH_16) {
    if (octets[0] === range.firstOctet && octets[1] === range.secondOctet) {
      return { classification: 'DATACENTER', providerName: range.provider, ipRange24 }
    }
  }

  // Check /8 ranges
  for (const range of DATACENTER_SLASH_8) {
    if (octets[0] === range.firstOctet) {
      return { classification: 'DATACENTER', providerName: range.provider, ipRange24 }
    }
  }

  // MVP: hardcoded CIDR ranges only detect DATACENTER. VPN_PROXY detection requires MaxMind GeoIP2 or similar — deferred to 500+ users. See TODO in SECURITY.md.
  return { classification: 'UNKNOWN', providerName: null, ipRange24 }
}

/**
 * Record an IP classification in the database and return the result.
 * Best-effort: insert errors are logged but do not throw.
 */
export async function recordAndClassifyIp(
  adminClient: SupabaseClient,
  userId: string,
  ip: string,
  context: 'SIGNUP' | 'SESSION'
): Promise<IpClassificationResult> {
  const result = classifyIp(ip)

  const { error } = await adminClient
    .from('ip_classifications')
    .insert({
      user_id: userId,
      ip_address: ip,
      ip_range_24: result.ipRange24,
      classification: result.classification,
      provider_name: result.providerName,
      context,
    })

  if (error) {
    console.error(`Failed to record IP classification for user ${userId}:`, error.message)
  }

  return result
}
