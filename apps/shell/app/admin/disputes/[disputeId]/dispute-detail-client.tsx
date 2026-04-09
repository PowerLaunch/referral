'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  markUnderReview,
  upholdFlag,
  restoreReferral,
  adjustPayout,
} from '../actions'

interface Dispute {
  id: string
  user_id: string
  user_email: string
  referral_id: string | null
  description: string
  status: string
  admin_notes: string | null
  created_at: string
  resolved_at: string | null
}

interface AuditLog {
  id: string
  action: string
  admin_user_id: string | null
  before_value: string | null
  after_value: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export default function DisputeDetailClient({ disputeId }: { disputeId: string }) {
  const [dispute, setDispute] = useState<Dispute | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state for actions
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [adminNotes, setAdminNotes] = useState('')
  const [adjustAmount, setAdjustAmount] = useState(100)

  const fetchDispute = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/admin/disputes/${disputeId}`)
      if (res.ok) {
        const data = (await res.json()) as { dispute: Dispute; auditLogs: AuditLog[] }
        setDispute(data.dispute)
        setAuditLogs(data.auditLogs)
      } else {
        setFetchError('Failed to load dispute')
      }
    } catch {
      setFetchError('Failed to load dispute')
    } finally {
      setLoading(false)
    }
  }, [disputeId])

  useEffect(() => {
    void fetchDispute()
  }, [fetchDispute])

  async function handleAction(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setActionLoading(true)
    setMessage(null)
    try {
      const result = await fn()
      if (result.ok) {
        setMessage({ type: 'success', text: 'Action completed successfully' })
        setActiveAction(null)
        setAdminNotes('')
        void fetchDispute()
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Action failed' })
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
        <h1 className="text-2xl font-bold">Dispute Detail</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (fetchError || !dispute) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dispute Detail</h1>
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {fetchError ?? 'Dispute not found'}
        </div>
        <Link href="/admin/disputes" className="text-sm text-primary hover:underline">
          Back to Disputes
        </Link>
      </div>
    )
  }

  const isResolved = dispute.status === 'RESOLVED'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/disputes" className="text-sm text-muted-foreground hover:underline">
          Disputes
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Dispute #{dispute.id.slice(0, 8)}</h1>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            dispute.status === 'RESOLVED'
              ? 'bg-green-100 text-green-700 dark:bg-green-950/30'
              : dispute.status === 'UNDER_REVIEW'
                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-950/30'
          }`}
        >
          {dispute.status.replace('_', ' ')}
        </span>
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

      {/* Dispute Info */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">User: </span>
            <Link href={`/admin/users/${dispute.user_id}`} className="text-primary hover:underline">
              {dispute.user_email}
            </Link>
          </div>
          <div>
            <span className="text-muted-foreground">Created: </span>
            {new Date(dispute.created_at).toLocaleString()}
          </div>
          {dispute.referral_id && (
            <div>
              <span className="text-muted-foreground">Referral: </span>
              <span className="font-mono text-xs">{dispute.referral_id}</span>
            </div>
          )}
          {dispute.resolved_at && (
            <div>
              <span className="text-muted-foreground">Resolved: </span>
              {new Date(dispute.resolved_at).toLocaleString()}
            </div>
          )}
        </div>

        <h3 className="mb-2 font-semibold">Description</h3>
        <p className="whitespace-pre-wrap text-sm">{dispute.description}</p>

        {dispute.admin_notes && (
          <>
            <h3 className="mb-2 mt-4 font-semibold">Admin Notes</h3>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{dispute.admin_notes}</p>
          </>
        )}
      </div>

      {/* Resolution Actions */}
      {!isResolved && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Resolution Actions</h2>

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setActiveAction('under_review')}
              disabled={actionLoading || dispute.status === 'UNDER_REVIEW'}
              className="rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
            >
              Mark Under Review
            </button>
            <button
              onClick={() => setActiveAction('uphold')}
              disabled={actionLoading}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Uphold Flag
            </button>
            {dispute.referral_id && (
              <button
                onClick={() => setActiveAction('restore')}
                disabled={actionLoading}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Restore Referral
              </button>
            )}
            <button
              onClick={() => setActiveAction('adjust')}
              disabled={actionLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Adjust Payout
            </button>
          </div>

          {activeAction && (
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <h3 className="mb-3 font-medium capitalize">
                {activeAction.replace('_', ' ')}
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Admin Notes (required)
                  </label>
                  <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Enter resolution notes..."
                  />
                </div>

                {activeAction === 'adjust' && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Credit Amount (credit units, 100 = $1)
                    </label>
                    <input
                      type="number"
                      value={adjustAmount}
                      onChange={(e) => setAdjustAmount(Number(e.target.value))}
                      min={1}
                      className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (activeAction === 'under_review') {
                        void handleAction(() => markUnderReview(disputeId, adminNotes))
                      } else if (activeAction === 'uphold') {
                        void handleAction(() => upholdFlag(disputeId, adminNotes))
                      } else if (activeAction === 'restore') {
                        void handleAction(() => restoreReferral(disputeId, adminNotes))
                      } else if (activeAction === 'adjust') {
                        void handleAction(() => adjustPayout(disputeId, adminNotes, adjustAmount))
                      }
                    }}
                    disabled={actionLoading || !adminNotes.trim()}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {actionLoading ? 'Processing...' : 'Submit'}
                  </button>
                  <button
                    onClick={() => {
                      setActiveAction(null)
                      setAdminNotes('')
                    }}
                    className="rounded-md border border-border px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Audit Logs */}
      {auditLogs.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Related Audit Logs</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Action</th>
                  <th className="pb-3 pr-4 font-medium">Before</th>
                  <th className="pb-3 pr-4 font-medium">After</th>
                  <th className="pb-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{log.action}</td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">
                      {log.before_value ? String(log.before_value).slice(0, 50) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">
                      {log.after_value ? String(log.after_value).slice(0, 50) : '—'}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
