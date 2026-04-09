'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createInfluencerCode } from './actions'

interface InfluencerCode {
  id: string
  code: string
  payout_percentage: number
  monthly_cap: number
  instant_payout: boolean
  lock_bypass: boolean
  active: boolean
  created_at: string
}

export default function InfluencersClient() {
  const [codes, setCodes] = useState<InfluencerCode[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Create form state
  const [newCode, setNewCode] = useState('')
  const [payoutPct, setPayoutPct] = useState(40)
  const [monthlyCap, setMonthlyCap] = useState(200)
  const [instantPayout, setInstantPayout] = useState(false)
  const [lockBypass, setLockBypass] = useState(false)
  const [lockBypassConfirmed, setLockBypassConfirmed] = useState(false)

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/admin/influencers')
      if (res.ok) {
        const data = (await res.json()) as { codes: InfluencerCode[] }
        setCodes(data.codes)
      } else {
        setFetchError('Failed to load influencer codes')
      }
    } catch {
      setFetchError('Failed to load influencer codes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchCodes()
  }, [fetchCodes])

  async function handleCreate() {
    if (lockBypass && !lockBypassConfirmed) {
      setMessage({ type: 'error', text: 'Please confirm the lock bypass acknowledgment' })
      return
    }

    setActionLoading(true)
    setMessage(null)
    try {
      const result = await createInfluencerCode({
        code: newCode,
        payout_percentage: payoutPct,
        monthly_cap: monthlyCap,
        instant_payout: instantPayout,
        lock_bypass: lockBypass,
      })
      if (result.ok) {
        setMessage({ type: 'success', text: 'Influencer code created' })
        setShowCreate(false)
        setNewCode('')
        setPayoutPct(40)
        setMonthlyCap(200)
        setInstantPayout(false)
        setLockBypass(false)
        setLockBypassConfirmed(false)
        void fetchCodes()
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Create failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Influencer Codes</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {showCreate ? 'Cancel' : 'Create Influencer Code'}
        </button>
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

      {/* Create Form */}
      {showCreate && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">New Influencer Code</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Code (leave empty to auto-generate)
              </label>
              <input
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="e.g. STREAMER123"
                className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

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
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={instantPayout}
                  onChange={(e) => setInstantPayout(e.target.checked)}
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
                  className="rounded border-input"
                />
                Lock period bypass
              </label>

              {lockBypass && (
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

            <button
              onClick={() => void handleCreate()}
              disabled={actionLoading}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {actionLoading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {fetchError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {fetchError}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Payout %</th>
                <th className="px-4 py-3 font-medium">Monthly Cap</th>
                <th className="px-4 py-3 font-medium">Instant</th>
                <th className="px-4 py-3 font-medium">Lock Bypass</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : codes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No influencer codes yet
                  </td>
                </tr>
              ) : (
                codes.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/influencers/${c.id}`}
                        className="font-mono text-primary hover:underline"
                      >
                        {c.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{c.payout_percentage}%</td>
                    <td className="px-4 py-3">{c.monthly_cap}</td>
                    <td className="px-4 py-3">
                      {c.instant_payout ? (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/30">
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.lock_bypass ? (
                        <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-950/30">
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.active ? (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/30">
                          Active
                        </span>
                      ) : (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/30">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
