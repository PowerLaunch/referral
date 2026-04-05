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

  // Trust level enforcement for payout routes is handled in the route handler
  // (Guard A and Guard B in /api/payout/request/route.ts). Middleware runs on
  // Edge Runtime where the service-role admin client is not compatible.

  // Redirect BANNED users to /account-frozen for all non-public routes.
  // Uses cookie-based supabase client only (Edge Runtime compatible).
  // trust_level is read from the user's JWT metadata if available,
  // otherwise skip this check — route handlers enforce it with admin client.
  const trustLevel = user.user_metadata?.trust_level as string | undefined
  if (trustLevel === 'BANNED') {
    const frozenUrl = new URL('/account-frozen', request.url)
    return NextResponse.redirect(frozenUrl)
  }
  // Note: trust_level in JWT metadata is only reliable if updated on every
  // trust_level change (PR 4-D wires this). For now this is best-effort.
  // Route-level guards are the authoritative enforcement layer.
  // Full middleware enforcement added in PR 4-D (fraud middleware).

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
