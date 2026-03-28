'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signupAction(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    // Never reveal if email already exists — prevent enumeration
    // Always show same message to avoid leaking account existence
    return { error: 'Check your email for a confirmation link' }
  }

  redirect('/verify-email')
}
