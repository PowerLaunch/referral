// Lock period calculation for referral payouts
// Country tiers from scope Section 2.6. Add new countries to the appropriate tier map — do not scatter country codes elsewhere.

// Country risk tier maps — typed as Record<string, number> for type safety
const LOW_RISK_COUNTRIES: Record<string, number> = {
  US: 30,
  GB: 30,
  CA: 30,
  DE: 30,
  AU: 30,
  JP: 30,
  SG: 30,
  NO: 30,
  SE: 30,
}

const MEDIUM_RISK_COUNTRIES: Record<string, number> = {
  ES: 45,
  IT: 45,
  KR: 45,
  AE: 45,
  PL: 45,
  IE: 45,
}

const HIGH_RISK_COUNTRIES: Record<string, number> = {
  PH: 60,
  ID: 60,
  VN: 60,
  IN: 60,
  BR: 60,
  NG: 60,
  PK: 60,
  TR: 60,
}

/**
 * Calculate lock period in days based on country and VPN detection
 * @param countryCode ISO 3166-1 alpha-2 country code (e.g., "US", "PH") or null
 * @param vpnDetected Whether VPN/datacenter IP was detected
 * @returns Lock period in days (30, 45, or 60 base + 30 if VPN detected)
 */
export function getLockPeriodDays(
  countryCode: string | null,
  vpnDetected: boolean
): number {
  let baseDays = 60 // Default to high-risk tier

  if (countryCode) {
    // Normalize to uppercase for lookup
    const normalized = countryCode.toUpperCase()

    // Check each tier
    if (normalized in LOW_RISK_COUNTRIES) {
      baseDays = LOW_RISK_COUNTRIES[normalized]!
    } else if (normalized in MEDIUM_RISK_COUNTRIES) {
      baseDays = MEDIUM_RISK_COUNTRIES[normalized]!
    } else if (normalized in HIGH_RISK_COUNTRIES) {
      baseDays = HIGH_RISK_COUNTRIES[normalized]!
    }
    // If not found in any tier, default to 60 days (already set)
  }

  // Add VPN penalty if detected
  if (vpnDetected) {
    baseDays += 30
  }

  return baseDays
}

/**
 * Get country code from IP address using geolocation service
 * @param ip IP address to lookup
 * @returns ISO 3166-1 alpha-2 country code or null
 */
export function getCountryFromIp(ip: string): string | null {
  // TODO: replace with real IP geolocation service in Phase 4. Returning null defaults to 60-day high-risk tier.
  return null
}

/**
 * Detect if IP address belongs to a VPN/datacenter
 * @param ipAddress IP address to check
 * @returns true if datacenter/VPN detected, false otherwise
 */
export function isVpnDetected(ipAddress: string): boolean {
  // TODO: replace with datacenter CIDR list check in Phase 4.
  return false
}
