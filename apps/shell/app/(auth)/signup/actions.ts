'use server'

import { createClient } from '@/lib/supabase/server'

export async function signupAction(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const referralCode = formData.get('referralCode') as string | null
  const signupTelemetry = formData.get('signupTelemetry') as string | null
  const supabase = await createClient()

  // Build user_metadata with referral code and telemetry
  // Referral source is stored in httpOnly cookie — never in client-writable user_metadata
  const metadata: Record<string, string> = {}
  if (referralCode) metadata.referral_code = referralCode
  if (signupTelemetry) metadata.signup_telemetry = signupTelemetry

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: Object.keys(metadata).length > 0
      ? { data: metadata }
      : undefined,
  })

  if (error) {
    // Generic error for genuine failures (network, rate limiting, etc.)
    // Supabase handles email enumeration prevention server-side
    return { error: 'Something went wrong. Please try again.' }
  }

  // Pass email through URL for resend functionality
  return { redirect: `/verify-email?email=${encodeURIComponent(data.user?.email || email)}` }
}
