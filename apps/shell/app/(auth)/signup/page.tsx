'use client'

import { signupAction } from './actions'
import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function SignupForm() {
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  // Telemetry state — collected silently, never shown in UI
  const [inputCorrections, setInputCorrections] = useState(0)
  const firstFocusAt = useRef<number | null>(null)
  // Page load time approximates link click — both timestamps are client-side to avoid clock skew
  const pageLoadAt = useRef<number>(Date.now())

  useEffect(() => {
    // Capture ?ref=[CODE] from URL
    const ref = searchParams.get('ref')
    if (ref) {
      setReferralCode(ref)
    }
  }, [searchParams])

  // Track first form field focus
  const handleFieldFocus = useCallback(() => {
    if (firstFocusAt.current === null) {
      firstFocusAt.current = Date.now()
    }
  }, [])

  // Track input corrections (Backspace/Delete)
  const handleFieldKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      setInputCorrections((prev) => prev + 1)
    }
  }, [])

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setPassword(value)

    if (value.length > 0 && value.length < 8) {
      setPasswordError('Password must be at least 8 characters')
    } else {
      setPasswordError(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }

    const formData = new FormData(e.currentTarget)
    if (referralCode) {
      formData.append('referralCode', referralCode)
    }

    // Bundle telemetry into form data — all timestamps are client-side to avoid clock skew
    const now = Date.now()
    const formFillMs = firstFocusAt.current !== null ? now - firstFocusAt.current : 0
    const telemetry = JSON.stringify({
      link_click_at: new Date(pageLoadAt.current).toISOString(),
      signup_submit_at: new Date(now).toISOString(),
      form_fill_ms: formFillMs,
      input_corrections: inputCorrections,
    })
    formData.append('signupTelemetry', telemetry)

    const result = await signupAction(formData)

    if (result?.redirect) {
      router.push(result.redirect)
    } else if (result?.error) {
      setError(result.error)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 p-8">
        <div>
          <h2 className="text-center text-3xl font-bold">Sign up</h2>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                onFocus={handleFieldFocus}
                onKeyDown={handleFieldKeyDown}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={handlePasswordChange}
                onFocus={handleFieldFocus}
                onKeyDown={handleFieldKeyDown}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
              {passwordError && (
                <p className="mt-1 text-sm text-red-600">{passwordError}</p>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!!passwordError}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Sign up
          </button>
        </form>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          Loading...
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  )
}
