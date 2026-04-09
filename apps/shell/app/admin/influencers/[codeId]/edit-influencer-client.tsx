'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { updateInfluencerCode, deactivateInfluencerCode } from '../actions'

interface InfluencerCode {
  id: string
  code: string
  payout_percentage: number
  monthly_cap: number
  instant_payout: boolean
  lock_bypass: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export default function EditInfluencerClient({ codeId }: { codeId: string }) {
  const [code, setCode] = useState<InfluencerCode | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [payoutPct, setPayoutPct] = useState(40)
  const [monthlyCap, setMonthlyCap] = useState(200)
  const [instantPayout, setInstantPayout] = useState(false)
  const [lockBypass, setLockBypass] = useState(false)
  const [lockBypassConfirmed, setLockBypassConfirmed] = useState(false)

  const fetchCode = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/admin/influencers/${codeId}`)
      if (res.ok) {
        const data = (await res.json()) as { code: InfluencerCode }
        setCode(data.code)
        setPayoutPct(data.code.payout_percentage)
        setMonthlyCap(data.code.monthly_cap)
        setInstantPayout(data.code.instant_payout)
        setLockBypass(data.code.lock_bypass)
        setLockBypassConfirmed(data.code.lock_bypass)
      } else {
        setFetchError('Failed to load influencer code')
      }
    } catch {
      setFetchError('Failed to load influencer code')
    } finally {
      setLoading(false)
    }
  }, [codeId])

  useEffect(() => {
    void fetchCode()
  }, [fetchCode])

  async function handleSave() {
    if (lockBypass && !lockBypassConfirmed) {
      setMessage({ type: 'error', text: 'Please confirm the lock bypass acknowledgment' })
      return
    }

    setActionLoading(true)
    setMessage(null)
    try {
      const result = await updateInfluencerCode(codeId, {
        payout_percentage: payoutPct,
        monthly_cap: monthlyCap,
        instant_payout: instantPayout,
        lock_bypass: lockBypass,
      })
      if (result.ok) {
        setMessage({ type: 'success', text: 'Updated successfully' })
        void fetchCode()
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Update failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDeactivate() {
    setActionLoading(true)
    setMessage(null)
    try {
      const result = await deactivateInfluencerCode(codeId)
      if (result.ok) {
        setMessage({ type: 'success', text: 'Code deactivated' })
        void fetchCode()
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Deactivate failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Edit Influencer Code</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (fetchError || !code) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Edit Influencer Code</h1>
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {fetchError ?? 'Influencer code not found'}
        </div>
        <Link href="/admin/influencers" className="text-sm text-primary hover:underline">
          Back to Influencer Codes
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/influencers" className="text-sm text-muted-foreground hover:underline">
          Influencer Codes
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold font-mono">{code.code}</h1>
        {code.active ? (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/30">
            Active
          </span>
        ) : (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/30">
            Inactive
          </span>
        )}
      </div>

      {message && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            message.type === 'success'
              ? 'border-green-300 bg-green-50 text-green-700'
              : 'border-red-300 bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-4 text-sm text-muted-foreground">
          Created: {new Date(code.created_at).toLocaleString()} | Last updated: {new Date(code.updated_at).toLocaleString()}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Payout % (1-100)
              </label>
              <input
                type="number"
                value={payoutPct}
                onChange={(e) => setPayoutPct(Number(e.target.value))}
                min={1}
                max={100}
                disabled={!code.active}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Monthly Cap (1-500)
              </label>
              <input
                type="number"
                value={monthlyCap}
                onChange={(e) => setMonthlyCap(Number(e.target.value))}
                min={1}
                max={500}
                disabled={!code.active}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={instantPayout}
                onChange={(e) => setInstantPayout(e.target.checked)}
                disabled={!code.active}
                className="rounded border-input"
              />
              Instant payout
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={lockBypass}
                onChange={(e) => {
                  setLockBypass(e.target.checked)
                  if (!e.target.checked) setLockBypassConfirmed(false)
                }}
                disabled={!code.active}
                className="rounded border-input"
              />
              Lock period bypass
            </label>

            {lockBypass && !lockBypassConfirmed && (
              <div className="ml-6 rounded-md border border-yellow-300 bg-yellow-50 p-3">
                <label className="flex items-start gap-2 text-sm text-yellow-800">
                  <input
                    type="checkbox"
                    checked={lockBypassConfirmed}
                    onChange={(e) => setLockBypassConfirmed(e.target.checked)}
                    className="mt-0.5 rounded border-input"
                  />
                  I confirm this bypasses the fraud lock period for referrals using this code.
                </label>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {code.active && (
              <>
                <button
                  onClick={() => void handleSave()}
                  disabled={actionLoading}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={() => void handleDeactivate()}
                  disabled={actionLoading}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Deactivate
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
