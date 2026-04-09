'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  toggleVip,
  freezeAccount,
  unfreezeAccount,
  flagSuspicious,
  unflagSuspicious,
  togglePayoutHold,
} from '../actions'
import { riskColor } from '../utils'

interface Profile {
  id: string
  email: string
  trust_level: string
  status: string
  is_vip: boolean
  payout_hold: boolean
  has_kyc: boolean
  created_at: string
}

interface Referral {
  id: string
  referrer_id: string
  referee_id: string
  status: string
  referral_code: string
  created_at: string
  confirmed_at: string | null
}

interface FraudFlag {
  id: string
  rule_triggered: string
  severity: string
  details: Record<string, unknown> | null
  is_resolved: boolean
  created_at: string
}

interface CreditTransaction {
  id: string
  amount: number
  type: string
  reason: string
  created_at: string
}

interface Subscription {
  status: string
  created_at: string
}

interface UserDetail {
  profile: Profile
  subscription: Subscription | null
  referrals: Referral[]
  fraudFlags: FraudFlag[]
  creditTransactions: CreditTransaction[]
  riskScore: number
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'CRITICAL':
      return 'bg-red-100 text-red-700 dark:bg-red-950/30'
    case 'WARNING':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30'
    default:
      return 'bg-blue-100 text-blue-700 dark:bg-blue-950/30'
  }
}

export default function UserDetailClient({ userId }: { userId: string }) {
  const [data, setData] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [confirmAction, setConfirmAction] = useState<string | null>(null)

  const fetchUser = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`)
      if (res.ok) {
        const json = (await res.json()) as UserDetail
        setData(json)
      } else {
        setFetchError('Failed to load user')
      }
    } catch {
      setFetchError('Failed to load user')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void fetchUser()
  }, [fetchUser])

  async function handleAction(
    actionName: string,
    fn: () => Promise<{ ok: boolean; error?: string }>
  ) {
    setActionLoading(actionName)
    setMessage(null)
    setConfirmAction(null)
    try {
      const result = await fn()
      if (result.ok) {
        setMessage({ type: 'success', text: `${actionName} successful` })
        void fetchUser()
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Action failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">User Detail</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (fetchError || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">User Detail</h1>
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {fetchError ?? 'User not found'}
        </div>
        <Link href="/admin/users" className="text-sm text-primary hover:underline">
          Back to Users
        </Link>
      </div>
    )
  }

  const { profile, subscription, referrals, fraudFlags, creditTransactions, riskScore } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">
          Users
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">{profile.email}</h1>
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

      {/* Overview */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Trust Level</p>
          <p className="text-lg font-bold">{profile.trust_level}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Risk Score</p>
          <p className={`text-lg font-bold ${riskColor(riskScore)}`}>{riskScore}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Subscription</p>
          <p className="text-lg font-bold">{subscription?.status ?? 'none'}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">KYC</p>
          <p className="text-lg font-bold">{profile.has_kyc ? 'Verified' : 'No'}</p>
        </div>
      </div>

      {/* Admin Actions */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Admin Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void handleAction('Toggle VIP', () => toggleVip(userId))}
            disabled={!!actionLoading}
            className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              profile.is_vip
                ? 'bg-purple-600 text-white hover:bg-purple-700'
                : 'border border-border hover:bg-muted'
            }`}
          >
            {profile.is_vip ? 'Remove VIP' : 'Make VIP'}
          </button>

          <button
            onClick={() => void handleAction('Toggle Payout Hold', () => togglePayoutHold(userId))}
            disabled={!!actionLoading}
            className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              profile.payout_hold
                ? 'bg-orange-600 text-white hover:bg-orange-700'
                : 'border border-border hover:bg-muted'
            }`}
          >
            {profile.payout_hold ? 'Remove Payout Hold' : 'Set Payout Hold'}
          </button>

          {profile.trust_level === 'SUSPICIOUS' ? (
            <button
              onClick={() => void handleAction('Unflag Suspicious', () => unflagSuspicious(userId))}
              disabled={!!actionLoading}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Clear Suspicious
            </button>
          ) : profile.trust_level !== 'BANNED' ? (
            <button
              onClick={() => void handleAction('Flag Suspicious', () => flagSuspicious(userId))}
              disabled={!!actionLoading}
              className="rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
            >
              Flag Suspicious
            </button>
          ) : null}

          {profile.trust_level === 'BANNED' ? (
            confirmAction === 'unfreeze' ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">Confirm unfreeze?</span>
                <button
                  onClick={() => void handleAction('Unfreeze', () => unfreezeAccount(userId))}
                  disabled={!!actionLoading}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmAction(null)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmAction('unfreeze')}
                disabled={!!actionLoading}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Unfreeze Account
              </button>
            )
          ) : confirmAction === 'freeze' ? (
            <div className="flex items-center gap-2">
              <span className="text-sm">Confirm freeze?</span>
              <button
                onClick={() => void handleAction('Freeze', () => freezeAccount(userId))}
                disabled={!!actionLoading}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmAction(null)}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmAction('freeze')}
              disabled={!!actionLoading}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Freeze Account
            </button>
          )}
        </div>
      </div>

      {/* Referral History */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Referral History ({referrals.length})</h2>
        {referrals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No referrals</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Role</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Code</th>
                  <th className="pb-3 pr-4 font-medium">Created</th>
                  <th className="pb-3 font-medium">Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4">
                      {r.referrer_id === userId ? 'Referrer' : 'Referee'}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          r.status === 'CONFIRMED'
                            ? 'bg-green-100 text-green-700 dark:bg-green-950/30'
                            : r.status === 'VOIDED'
                              ? 'bg-red-100 text-red-700 dark:bg-red-950/30'
                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{r.referral_code}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {r.confirmed_at ? new Date(r.confirmed_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fraud Flags */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Fraud Flags ({fraudFlags.length})</h2>
        {fraudFlags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fraud flags</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Rule</th>
                  <th className="pb-3 pr-4 font-medium">Severity</th>
                  <th className="pb-3 pr-4 font-medium">Resolved</th>
                  <th className="pb-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {fraudFlags.map((f) => (
                  <tr key={f.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{f.rule_triggered}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${severityColor(f.severity)}`}>
                        {f.severity}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{f.is_resolved ? 'Yes' : 'No'}</td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(f.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Credit Ledger */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Credit Transactions ({creditTransactions.length})</h2>
        {creditTransactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Type</th>
                  <th className="pb-3 pr-4 font-medium">Amount</th>
                  <th className="pb-3 pr-4 font-medium">Reason</th>
                  <th className="pb-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {creditTransactions.map((ct) => (
                  <tr key={ct.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                        {ct.type}
                      </span>
                    </td>
                    <td className={`py-2 pr-4 font-mono ${ct.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {ct.amount >= 0 ? '+' : ''}{ct.amount}
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">{ct.reason}</td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(ct.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
