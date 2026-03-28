'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signupAction(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    // Generic error for genuine failures (network, rate limiting, etc.)
    // Supabase handles email enumeration prevention server-side
    return { error: 'Something went wrong. Please try again.' }
  }

  // Pass email through URL for resend functionality
  return { redirect: `/verify-email?email=${encodeURIComponent(data.user?.email || email)}` }
}
