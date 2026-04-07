'use client'

// Silent background component that captures a basic browser fingerprint
// and sends it to the server once per session. Mounted in the dashboard layout.
// Game-to-backend communication via API routes only.
// Never import packages/api directly.

import { useEffect } from 'react'

export default function FingerprintCapture() {
  useEffect(() => {
    // Check sessionStorage to avoid re-posting on every page navigation within a session.
    // Using sessionStorage (not localStorage) so the fingerprint is re-captured on each
    // new browser session. This catches users who change browsers or clear cookies.
    if (sessionStorage.getItem('fp-sent') === 'true') return

    // Generate fingerprint hash
    const raw = [
      navigator.userAgent,
      String(screen.width),
      String(screen.height),
      String(screen.colorDepth),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      String(navigator.hardwareConcurrency ?? ''),
      navigator.language,
    ].join('|')

    // SHA-256 via Web Crypto API. 256-bit output prevents birthday-paradox collisions at scale.
    // djb2 (32-bit) was replaced because ~77K users would hit ~50% collision rate, causing R2 false positives.
    async function hashFingerprint(input: string): Promise<string> {
      const encoder = new TextEncoder()
      const data = encoder.encode(input)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    // Send to server (fire and forget — never await in a way that blocks)
    hashFingerprint(raw)
      .then((fingerprintHash) => {
        // Set fingerprint cookie for middleware access (PR 4-D)
        // Not HttpOnly because it's set from JS. Value is a hash, not sensitive.
        // 30-day expiry matches device re-auth grace period.
        // TODO Phase 8: Use force_reauth column on profiles for R2-specific
        // device re-auth. Current implementation blocks SUSPICIOUS users from
        // payout routes via middleware trust_level check.
        document.cookie = `device-fp=${fingerprintHash};path=/;max-age=${60 * 60 * 24 * 30};samesite=strict`

        return fetch('/api/fingerprint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fingerprintHash }),
        })
      })
      .then((res) => {
        if (res.ok) {
          sessionStorage.setItem('fp-sent', 'true')
        }
        // Only mark sent on 200 OK. On 400/401, allow retry next navigation.
      })
      .catch(() => {
        // Silent failure. Never crash the page for fingerprint errors.
      })
  }, [])

  return null
}
