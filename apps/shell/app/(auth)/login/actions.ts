'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function loginAction(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    // Handle unconfirmed email specifically
    if (error.code === 'email_not_confirmed') {
      return { redirect: `/verify-email?email=${encodeURIComponent(email)}` }
    }
    // Generic error message — never reveal which field is wrong
    return { error: 'Invalid email or password' }
  }

  // Check if email is verified
  if (data.user && !data.user.email_confirmed_at) {
    return { redirect: `/verify-email?email=${encodeURIComponent(email)}` }
  }

  redirect('/dashboard')
}
