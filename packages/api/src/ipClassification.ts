// MVP: Hardcoded CIDR ranges. Replace with MaxMind GeoIP2 or IPQS API at 500+ users.

import type { SupabaseClient } from '@supabase/supabase-js'

export type IpClassification = 'RESIDENTIAL' | 'MOBILE' | 'DATACENTER' | 'VPN_PROXY' | 'UNKNOWN'

export interface IpClassificationResult {
  classification: IpClassification
  providerName: string | null
  ipRange24: string
}

// MVP: /16 precision. MaxMind GeoIP2 deferred to 500+ users.
// Each range checks first two octets: start[0].start[1] through end[0].end[1]
// CONSTRAINT: all ranges must share the same first octet (start[0] === end[0]).
// Cross-octet ranges are not supported by the matching logic.
const DATACENTER_RANGES: Array<{ start: [number, number]; end: [number, number]; provider: string }> = [
  // AWS — major /16 blocks only, not entire /8. See ip-ranges.amazonaws.com for authoritative list.
  { start: [3, 0], end: [3, 5], provider: 'AWS' },
  { start: [3, 8], end: [3, 15], provider: 'AWS' },
  { start: [3, 16], end: [3, 39], provider: 'AWS' },
  { start: [3, 48], end: [3, 55], provider: 'AWS' },
  { start: [3, 64], end: [3, 79], provider: 'AWS' },
  { start: [3, 80], end: [3, 95], provider: 'AWS' },
  { start: [3, 96], end: [3, 127], provider: 'AWS' },
  { start: [3, 128], end: [3, 191], provider: 'AWS' },
  { start: [3, 208], end: [3, 239], provider: 'AWS' },
  { start: [52, 0], end: [52, 95], provider: 'AWS' },
  // GCP
  { start: [34, 64], end: [34, 127], provider: 'GCP' },
  { start: [35, 190], end: [35, 235], provider: 'GCP' },
  // Azure
  { start: [13, 64], end: [13, 107], provider: 'Azure' },
  { start: [20, 33], end: [20, 128], provider: 'Azure' },
  { start: [40, 74], end: [40, 125], provider: 'Azure' },
  { start: [52, 96], end: [52, 255], provider: 'Azure' },
  // DigitalOcean
  { start: [64, 225], end: [64, 227], provider: 'DigitalOcean' },
  { start: [134, 122], end: [134, 122], provider: 'DigitalOcean' },
  { start: [157, 230], end: [157, 230], provider: 'DigitalOcean' },
  { start: [159, 65], end: [159, 65], provider: 'DigitalOcean' },
  { start: [165, 22], end: [165, 22], provider: 'DigitalOcean' },
  { start: [167, 71], end: [167, 71], provider: 'DigitalOcean' },
  // OVH
  { start: [51, 68], end: [51, 91], provider: 'OVH' },
  { start: [54, 36], end: [54, 39], provider: 'OVH' },
  // Linode/Akamai
  { start: [45, 33], end: [45, 33], provider: 'Linode' },
  { start: [45, 56], end: [45, 56], provider: 'Linode' },
  { start: [45, 79], end: [45, 79], provider: 'Linode' },
  { start: [139, 162], end: [139, 162], provider: 'Linode' },
  { start: [172, 104], end: [172, 104], provider: 'Linode' },
  { start: [176, 58], end: [176, 58], provider: 'Linode' },
]

// Validate at module load — crash immediately if a cross-octet range is added
for (const range of DATACENTER_RANGES) {
  if (range.start[0] !== range.end[0]) {
    throw new Error(
      `DATACENTER_RANGES: cross-octet range not supported: ${range.provider} ${range.start.join('.')} → ${range.end.join('.')}`
    )
  }
}

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

  // Check datacenter ranges by first two octets
  for (const range of DATACENTER_RANGES) {
    if (
      octets[0] === range.start[0] &&
      octets[1] >= range.start[1] &&
      octets[0] === range.end[0] &&
      octets[1] <= range.end[1]
    ) {
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
