// Referral link handler: /ref/[code]
// Captures the Referer header for source attribution, then redirects to /signup

import { NextRequest, NextResponse } from 'next/server'

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

  if (referer) {
    // Only capture the raw source URL — classification is done server-side in auth/callback
    src = referer.length > 500 ? referer.slice(0, 500) : referer
  }

  // Build redirect URL with referral code and raw source URL
  const redirectUrl = new URL('/signup', request.url)
  redirectUrl.searchParams.set('ref', code)
  if (src) {
    redirectUrl.searchParams.set('src', src)
  }

  return NextResponse.redirect(redirectUrl)
}
