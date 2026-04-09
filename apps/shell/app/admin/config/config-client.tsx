'use client'

import { useEffect, useState, useCallback } from 'react'
import { updateGameConfig } from '../actions'

interface GameConfig {
  min_gameplay_minutes: number
  min_session_count: number | null
  signup_bonus_amount: number
  signup_bonus_label: string
  cashouts_paused: boolean
  referral_confirmations_paused: boolean
}

export default function ConfigClient() {
  const [config, setConfig] = useState<GameConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [minGameplayMinutes, setMinGameplayMinutes] = useState(10)
  const [minSessionCount, setMinSessionCount] = useState(3)
  const [signupBonusAmount, setSignupBonusAmount] = useState(0)
  const [signupBonusLabel, setSignupBonusLabel] = useState('credits')

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/config')
      if (res.ok) {
        const data = (await res.json()) as { config: GameConfig }
        setConfig(data.config)
        setMinGameplayMinutes(data.config.min_gameplay_minutes)
        setMinSessionCount(data.config.min_session_count ?? 3)
        setSignupBonusAmount(data.config.signup_bonus_amount)
        setSignupBonusLabel(data.config.signup_bonus_label)
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchConfig()
  }, [fetchConfig])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const result = await updateGameConfig({
        min_gameplay_minutes: minGameplayMinutes,
        min_session_count: minSessionCount,
        signup_bonus_amount: signupBonusAmount,
        signup_bonus_label: signupBonusLabel,
      })

      if (result.ok) {
        setMessage({ type: 'success', text: 'Config updated successfully' })
        void fetchConfig()
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Failed to update config' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Config Settings</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Config Settings</h1>

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Game Config</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Min Gameplay Minutes
              </label>
              <input
                type="number"
                value={minGameplayMinutes}
                onChange={(e) => setMinGameplayMinutes(Number(e.target.value))}
                min={0}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Min Session Count
              </label>
              <input
                type="number"
                value={minSessionCount}
                onChange={(e) => setMinSessionCount(Number(e.target.value))}
                min={0}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Signup Bonus Amount
              </label>
              <input
                type="number"
                value={signupBonusAmount}
                onChange={(e) => setSignupBonusAmount(Number(e.target.value))}
                min={0}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Signup Bonus Label
              </label>
              <input
                type="text"
                value={signupBonusLabel}
                onChange={(e) => setSignupBonusLabel(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Read-only circuit breakers */}
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              Circuit Breakers (controlled from Pulse page)
            </p>
            <div className="flex gap-4 text-sm">
              <span>
                Cashouts Paused:{' '}
                <span className={config?.cashouts_paused ? 'font-bold text-red-600' : 'text-green-600'}>
                  {config?.cashouts_paused ? 'YES' : 'No'}
                </span>
              </span>
              <span>
                Confirmations Paused:{' '}
                <span className={config?.referral_confirmations_paused ? 'font-bold text-red-600' : 'text-green-600'}>
                  {config?.referral_confirmations_paused ? 'YES' : 'No'}
                </span>
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Config'}
          </button>
        </form>

        {message && (
          <p
            className={`mt-3 text-sm ${
              message.type === 'success' ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  )
}
