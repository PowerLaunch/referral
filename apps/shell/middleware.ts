import { updateSession } from '@/lib/supabase/middleware'
import { type NextRequest, NextResponse } from 'next/server'

// Rate limit state for /ref/* routes. Module-level Map persists within
// a single serverless instance. Each Vercel instance has its own Map.
// This is best-effort — not a global rate limiter — but stops simple
// bot scripts from flooding a single edge node.
const refRateLimit = new Map<string, { count: number; windowStart: number }>()

export async function middleware(request: NextRequest) {
  // Refresh session and get response with updated cookies
  const { response: supabaseResponse, user, supabase } = await updateSession(request)

  // --- Rate limit for /ref/* referral redirect routes ---
  // Prevents bot-driven click flooding. 10 requests per IP per 60 seconds.
  // Uses module-level Map (persists within a single serverless instance).
  // Memory is bounded: stale entries cleaned on every request.
  if (request.nextUrl.pathname.startsWith('/ref/')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const now = Date.now()
    const windowMs = 60_000 // 1 minute
    const maxRequests = 10

    // Clean stale entries (older than windowMs)
    for (const [key, entry] of refRateLimit.entries()) {
      if (now - entry.windowStart > windowMs) {
        refRateLimit.delete(key)
      }
    }

    const existing = refRateLimit.get(ip)
    if (existing && now - existing.windowStart < windowMs) {
      existing.count++
      if (existing.count > maxRequests) {
        return new NextResponse('Too many requests', { status: 429 })
      }
    } else {
      refRateLimit.set(ip, { count: 1, windowStart: now })
    }
  }

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
  // Performance: This DB query runs for ALL authenticated routes EXCEPT webhooks/crons.
  // The cookie-based Supabase client is Edge Runtime compatible (no Node.js crypto).
  //
  // Scale note: at >1000 users, consider caching trust_level in a short-TTL
  // cookie (5 min) refreshed on trust_level change.

  // Skip fraud check only for routes that don't use Supabase session auth
  // (webhooks and crons use their own auth: HMAC signatures or Bearer tokens)
  const skipFraudCheck =
    request.nextUrl.pathname.startsWith('/_next/') ||
    request.nextUrl.pathname.startsWith('/api/webhooks/') ||
    request.nextUrl.pathname.startsWith('/api/cron/')

  if (!skipFraudCheck) {
    // Query profiles for fraud status using the same Supabase client
    // from updateSession — shares cookie management, prevents session
    // desynchronization from a second independent client.

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
        const blockedResponse = NextResponse.json(
          { error: 'Payout temporarily unavailable' },
          { status: 403 }
        )
        // Preserve session cookies so auth tokens are not lost
        supabaseResponse.cookies.getAll().forEach((cookie) => {
          blockedResponse.cookies.set(cookie)
        })
        return blockedResponse
      }

      // Set headers for downstream API routes (defense-in-depth)
      // These headers are read by route handlers as secondary validation.
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-user-trust-level', profile.trust_level || 'CLEAN')
      requestHeaders.set('x-user-status', profile.status || 'ACTIVE')
      if (profile.status === 'REVIEW_HOLD') {
        requestHeaders.set('x-user-review-hold', 'true')
      }

      // Pass modified headers to route handlers, preserving session cookies
      const nextResponse = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      })
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        nextResponse.cookies.set(cookie)
      })
      return nextResponse
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
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks/|api/cron/).*)',
  ],
}
