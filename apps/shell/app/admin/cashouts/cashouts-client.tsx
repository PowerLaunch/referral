'use client'

import { useEffect, useState, useCallback } from 'react'
import { approvePayout, rejectPayout, batchApproveLowRisk, retryFailedPayout, REJECTION_REASONS } from './actions'
import { riskColor } from '../users/utils'

interface PayoutRow {
  id: string
  user_id: string
  user_email: string
  amount: number
  method: string
  status: string
  is_first_payout: boolean
  has_prior_completed: boolean
  risk_score: number
  provider_error_code: string | null
  retry_count: number
  retry_available_at: string | null
  admin_notes: string | null
  created_at: string
}

const TABS = [
  { key: 'PENDING_MANUAL_APPROVAL', label: 'Pending Review' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'PROCESSING', label: 'Processing' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'FAILED', label: 'Failed' },
] as const

export default function CashoutsClient() {
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<string>('PENDING_MANUAL_APPROVAL')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Reject dialog state
  const [rejectDialogId, setRejectDialogId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<string>(REJECTION_REASONS[0])
  const [returnCredits, setReturnCredits] = useState(true)

  // Batch selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const fetchPayouts = useCallback(async (status: string, pageNum: number) => {
    setLoading(true)
    setFetchError(null)
    try {
      const params = new URLSearchParams({
        status,
        page: String(pageNum),
        limit: '50',
      })
      const res = await fetch(`/api/admin/cashouts?${params.toString()}`)
      if (res.ok) {
        const data = (await res.json()) as { payouts: PayoutRow[]; hasMore: boolean }
        setPayouts(data.payouts)
        setHasMore(data.hasMore)
      } else {
        setFetchError('Failed to load payouts')
      }
    } catch {
      setFetchError('Failed to load payouts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setSelectedIds(new Set())
    void fetchPayouts(activeTab, page)
  }, [fetchPayouts, activeTab, page])

  function showMessage(type: 'success' | 'error', text: string) {
    setActionMessage({ type, text })
    setTimeout(() => setActionMessage(null), 4000)
  }

  async function handleApprove(payoutId: string) {
    setActionLoading(payoutId)
    try {
      const result = await approvePayout(payoutId)
      if (result.ok) {
        showMessage('success', 'Payout approved')
        void fetchPayouts(activeTab, page)
      } else {
        showMessage('error', result.error ?? 'Failed to approve')
      }
    } catch {
      showMessage('error', 'Failed to approve payout')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleReject() {
    if (!rejectDialogId) return
    setActionLoading(rejectDialogId)
    try {
      const result = await rejectPayout(rejectDialogId, rejectReason, returnCredits)
      if (result.ok) {
        showMessage('success', 'Payout rejected')
        setRejectDialogId(null)
        void fetchPayouts(activeTab, page)
      } else {
        showMessage('error', result.error ?? 'Failed to reject')
      }
    } catch {
      showMessage('error', 'Failed to reject payout')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleBatchApprove() {
    if (selectedIds.size === 0) return
    setActionLoading('batch')
    try {
      const result = await batchApproveLowRisk(Array.from(selectedIds))
      const errorMsg = result.errors?.length ? `\nErrors: ${result.errors.join(', ')}` : ''
      showMessage(
        result.ok ? 'success' : 'error',
        `Batch: ${result.approved} approved, ${result.skipped} skipped${errorMsg}`
      )
      setSelectedIds(new Set())
      void fetchPayouts(activeTab, page)
    } catch {
      showMessage('error', 'Batch approval failed')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRetry(payoutId: string) {
    setActionLoading(payoutId)
    try {
      const result = await retryFailedPayout(payoutId)
      if (result.ok) {
        showMessage('success', 'Payout retried successfully')
        void fetchPayouts(activeTab, page)
      } else {
        showMessage('error', result.error ?? 'Retry failed')
      }
    } catch {
      showMessage('error', 'Failed to retry payout')
    } finally {
      setActionLoading(null)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const showBatchButton = (activeTab === 'PENDING' || activeTab === 'PENDING_MANUAL_APPROVAL')
  const showActions = ['PENDING', 'PENDING_MANUAL_APPROVAL', 'PROCESSING'].includes(activeTab)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cashout Review</h1>

      {actionMessage && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            actionMessage.type === 'success'
              ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400'
              : 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400'
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setPage(1) }}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab.key
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Batch approve button */}
      {showBatchButton && selectedIds.size > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleBatchApprove}
            disabled={actionLoading === 'batch'}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {actionLoading === 'batch'
              ? 'Processing...'
              : `Batch Approve (${selectedIds.size} selected)`}
          </button>
          <span className="text-xs text-muted-foreground">
            Only low-risk (&lt;30), under $25, non-first payouts will be approved
          </span>
        </div>
      )}

      {fetchError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {fetchError}
        </div>
      )}

      {/* Reject dialog */}
      {rejectDialogId && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="font-semibold">Reject Payout</h3>
          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <select
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full max-w-xs"
            >
              {REJECTION_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={returnCredits}
              onChange={(e) => setReturnCredits(e.target.checked)}
            />
            Return credits to user
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleReject}
              disabled={actionLoading === rejectDialogId}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {actionLoading === rejectDialogId ? 'Rejecting...' : 'Confirm Reject'}
            </button>
            <button
              onClick={() => setRejectDialogId(null)}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                {showBatchButton && <th className="px-4 py-3 w-8" />}
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Created</th>
                {activeTab === 'FAILED' && (
                  <>
                    <th className="px-4 py-3 font-medium">Error</th>
                    <th className="px-4 py-3 font-medium">Retries</th>
                  </>
                )}
                {showActions && <th className="px-4 py-3 font-medium">Actions</th>}
                {activeTab === 'FAILED' && <th className="px-4 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : payouts.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    No payouts found
                  </td>
                </tr>
              ) : (
                payouts.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                    {showBatchButton && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className="font-medium">{p.user_email}</span>
                      {(p.is_first_payout && !p.has_prior_completed) && (
                        <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950/30">
                          FIRST PAYOUT
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      ${(p.amount / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">{p.method}</td>
                    <td className="px-4 py-3">
                      <span className={riskColor(p.risk_score)}>{p.risk_score}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(p.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC
                    </td>
                    {activeTab === 'FAILED' && (
                      <>
                        <td className="px-4 py-3 text-red-600 text-xs">
                          {p.provider_error_code ?? '-'}
                        </td>
                        <td className="px-4 py-3">{p.retry_count}</td>
                      </>
                    )}
                    {showActions && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {activeTab !== 'PROCESSING' && (
                            <button
                              onClick={() => handleApprove(p.id)}
                              disabled={actionLoading === p.id}
                              className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              Approve
                            </button>
                          )}
                          <button
                            onClick={() => { setRejectDialogId(p.id); setRejectReason(REJECTION_REASONS[0]); setReturnCredits(true) }}
                            disabled={actionLoading === p.id}
                            className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    )}
                    {activeTab === 'FAILED' && (
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleRetry(p.id)}
                          disabled={actionLoading === p.id}
                          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {actionLoading === p.id ? 'Retrying...' : 'Retry'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
