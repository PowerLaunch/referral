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

    // djb2 hash (simple, deterministic, no external library)
    function djb2(str: string): string {
      let hash = 5381
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff
      }
      // Convert to unsigned hex string
      return (hash >>> 0).toString(16)
    }

    const fingerprintHash = djb2(raw)

    // Send to server (fire and forget — never await in a way that blocks)
    fetch('/api/fingerprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprintHash }),
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
