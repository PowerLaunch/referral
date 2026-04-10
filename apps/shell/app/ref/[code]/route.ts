// Referral link handler: /ref/[code]
// Captures the Referer header for source attribution, then redirects to /signup

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { classifyReferralSource } from '@referral/api/sourceClassification'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
): Promise<Response> {
  const { code } = await params

  if (!code || code.trim().length === 0) {
    return NextResponse.redirect(new URL('/signup', request.url))
  }

  // Capture Referer header for source attribution
  const referer = request.headers.get('referer')

  let src = ''
  let sc = ''

  if (referer) {
    try {
      const adminClient = createAdminClient()
      const result = await classifyReferralSource(adminClient, referer)
      if (result.source) {
        src = result.source.slice(0, 500)
      }
      sc = result.classification
    } catch {
      // Source classification failure must not block referral redirect
      sc = 'YELLOW'
    }
  }

  // Build redirect URL with referral code and source attribution
  const redirectUrl = new URL('/signup', request.url)
  redirectUrl.searchParams.set('ref', code)
  if (src) {
    redirectUrl.searchParams.set('src', src)
  }
  if (sc) {
    redirectUrl.searchParams.set('sc', sc)
  }

  return NextResponse.redirect(redirectUrl)
}
