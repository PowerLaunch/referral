import { updateSession } from '@/lib/supabase/middleware'
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

  // PR 4-D: Fraud middleware — Query profiles table for trust_level and status.
  // Performance: This DB query runs ONLY for authenticated users on protected routes.
  // It does NOT run for: static assets, webhooks, crons, or public paths.
  // The cookie-based Supabase client is Edge Runtime compatible (no Node.js crypto).
  //
  // Scale note: at >1000 users, consider caching trust_level in a short-TTL
  // cookie (5 min) refreshed on trust_level change.

  // Skip DB query for API routes (crons, webhooks) — they authenticate via Bearer token
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const isStaticAsset = request.nextUrl.pathname.startsWith('/_next/')

  if (!isApiRoute && !isStaticAsset) {
    // Query profiles for fraud status
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('trust_level, status')
      .eq('id', user.id)
      .single()

    if (profileError) {
      // On query error, fail safe: allow through and let route handlers enforce.
      // Log error but don't block user — transient DB errors should not freeze access.
      console.error('Middleware: profiles query failed:', profileError.message)
    } else if (profile) {
      // Redirect BANNED or FROZEN users to /account-frozen
      if (
        profile.trust_level === 'BANNED' ||
        profile.status === 'FROZEN' ||
        profile.status === 'BANNED'
      ) {
        return redirectWithCookies('/account-frozen')
      }

      // Block payout routes for users under review or marked suspicious
      const isPayoutRoute = request.nextUrl.pathname.startsWith('/api/payout')
      if (
        isPayoutRoute &&
        (profile.status === 'REVIEW_HOLD' || profile.trust_level === 'SUSPICIOUS')
      ) {
        return NextResponse.json(
          { error: 'Payout temporarily unavailable' },
          { status: 403 }
        )
      }

      // Set headers for downstream API routes (defense-in-depth)
      // These headers are read by route handlers as secondary validation.
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-user-trust-level', profile.trust_level || 'CLEAN')
      requestHeaders.set('x-user-status', profile.status || 'ACTIVE')
      if (profile.status === 'REVIEW_HOLD') {
        requestHeaders.set('x-user-review-hold', 'true')
      }

      // Pass modified headers to route handlers
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      })
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
    // Webhook routes (including /api/webhooks/payout-failure) use provider-specific HMAC.
    '/((?!_next/static|_next/image|favicon.ico|ref/|api/webhooks/|api/cron/).*)',
  ],
}
