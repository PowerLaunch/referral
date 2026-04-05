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
