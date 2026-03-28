'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'

export default function VerifyEmailPage() {
  const [resending, setResending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)

  const handleResend = async () => {
    setResending(true)
    setMessage(null)

    const supabase = createClient()

    // Get current user email from session
    const { data: { user } } = await supabase.auth.getUser()

    if (!user?.email) {
      setMessage('No email found. Please sign up again.')
      setResending(false)
      return
    }

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: user.email,
    })

    if (error) {
      setMessage('Failed to resend email. Please try again.')
    } else {
      setMessage('Verification email sent! Check your inbox.')
      // Start 60-second countdown
      setCountdown(60)
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }

    setResending(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 p-8 text-center">
        <div>
          <h2 className="text-3xl font-bold">Check your email</h2>
          <p className="mt-4 text-gray-600">
            We've sent you a verification link. Click the link in your email to
            verify your account.
          </p>
        </div>

        {message && (
          <div className="rounded-md bg-blue-50 p-4">
            <p className="text-sm text-blue-800">{message}</p>
          </div>
        )}

        <button
          onClick={handleResend}
          disabled={resending || countdown > 0}
          className="w-full rounded-md bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300 disabled:opacity-50"
        >
          {countdown > 0
            ? `Resend in ${countdown}s`
            : resending
            ? 'Sending...'
            : 'Resend verification email'}
        </button>
      </div>
    </div>
  )
}
