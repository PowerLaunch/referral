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

  // Build redirect URL with referral code only — link click time is captured client-side
  // to avoid server/client clock skew in fast-signup detection
  const redirectUrl = new URL('/signup', request.url)
  redirectUrl.searchParams.set('ref', code)

  const response = NextResponse.redirect(redirectUrl)

  // Store referral source in httpOnly cookie — prevents client-side forgery
  response.cookies.set('__ref_src', src, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 3600, // 1 hour — must outlast email verification flow
  })

  return response
}
