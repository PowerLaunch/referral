import { updateSession } from '@/lib/supabase/middleware'
import { createAdminClient } from '@/lib/supabase/admin'
import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  // Refresh session and get response with updated cookies
  const { response: supabaseResponse, user } = await updateSession(request)

  // Helper to preserve session cookies on redirects
  function redirectWithCookies(url: string): NextResponse {
    const redirectResponse = NextResponse.redirect(new URL(url, request.url))
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie)
    })
    return redirectResponse
  }

  // Public paths that don't require auth
  const publicPaths = ['/login', '/signup', '/verify-email', '/auth/callback', '/ref', '/account-frozen']
  const isPublicPath =
    request.nextUrl.pathname === '/' ||
    publicPaths.some((path) => request.nextUrl.pathname.startsWith(path))

  // Allow public paths
  if (isPublicPath) {
    return supabaseResponse
  }

  // No session → redirect to login
  if (!user) {
    return redirectWithCookies('/login')
  }

  // Session exists but email not confirmed → redirect to verify-email
  if (!user.email_confirmed_at) {
    const verifyUrl = `/verify-email?email=${encodeURIComponent(user.email ?? '')}`
    return redirectWithCookies(verifyUrl)
  }

  // Fraud status guard for payout routes.
  // Full fraud middleware (all routes) built in PR 4-D.
  // This is payout-specific defense in depth only.
  //
  // IMPORTANT: This profiles query only runs for /api/payout/* routes.
  // Do NOT move this outside the pathname check — querying profiles on every
  // request would severely degrade performance.
  if (request.nextUrl.pathname.startsWith('/api/payout')) {
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('profiles')
      .select('trust_level')
      .eq('id', user.id)
      .single()

    if (
      profile?.trust_level === 'BANNED' ||
      profile?.trust_level === 'SUSPICIOUS'
    ) {
      // Return JSON error for API routes — never redirect POST requests.
      // A 307 redirect preserves POST method and would hit /account-frozen with a POST.
      return NextResponse.json({ error: 'Account restricted' }, { status: 403 })
    }
  }

  // Session exists and email confirmed → allow through
  return supabaseResponse
}

export const config = {
  matcher: [
    // Cron routes are authenticated via Authorization: Bearer {CRON_SECRET} header,
    // not Supabase session cookies. They must be excluded from the session middleware.
    // Each cron handler validates its own secret independently.
    '/((?!_next/static|_next/image|favicon.ico|ref/|api/webhooks/|api/cron/).*)',
  ],
}
