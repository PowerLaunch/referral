'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Submission {
  id: string
  user_id: string
  user_email: string
  status: string
  admin_notes: string | null
  created_at: string
  reviewed_at: string | null
}

interface SubmissionDetail {
  id: string
  user_id: string
  user_email: string
  storage_path: string | null
  status: string
  admin_notes: string | null
  created_at: string
  reviewed_at: string | null
  signed_url: string | null
}

const TABS = ['PENDING', 'APPROVED', 'REJECTED'] as const
const REJECT_REASONS = ['Blurry Image', 'Wrong Document', 'Unreadable', 'Suspected Fake'] as const

export default function KycClient() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>('PENDING')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  // Detail view state
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Approve form
  const [idNumber, setIdNumber] = useState('')
  // Reject form
  const [rejectReason, setRejectReason] = useState<string>(REJECT_REASONS[0])
  const [rejectNotes, setRejectNotes] = useState('')

  const fetchSubmissions = useCallback(async (status: string, pageNum: number) => {
    setLoading(true)
    setFetchError(null)
    try {
      const params = new URLSearchParams({ status, page: String(pageNum), limit: '50' })
      const res = await fetch(`/api/admin/kyc?${params.toString()}`)
      if (res.ok) {
        const data = (await res.json()) as { submissions: Submission[]; hasMore: boolean }
        setSubmissions(data.submissions)
        setHasMore(data.hasMore)
      } else {
        setFetchError('Failed to load submissions')
      }
    } catch {
      setFetchError('Failed to load submissions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchSubmissions(activeTab, page)
  }, [fetchSubmissions, activeTab, page])

  async function openDetail(id: string) {
    setDetailLoading(true)
    setMessage(null)
    setIdNumber('')
    setRejectNotes('')
    try {
      const res = await fetch(`/api/admin/kyc/${id}`)
      if (res.ok) {
        const data = (await res.json()) as { submission: SubmissionDetail }
        setDetail(data.submission)
      }
    } catch {
      // Silently fail
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleApprove(submissionId: string) {
    if (!idNumber.trim()) {
      setMessage({ type: 'error', text: 'ID number is required' })
      return
    }
    setActionLoading(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/kyc/${submissionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', id_number: idNumber.trim() }),
      })
      const data = (await res.json()) as { success?: boolean; sybil_detected?: boolean; matched_user_id?: string; error?: string }
      if (data.success) {
        if (data.sybil_detected) {
          setMessage({
            type: 'error',
            text: `CRITICAL: Sybil detected! Both accounts placed in REVIEW_HOLD. Matched user: ${data.matched_user_id ?? 'unknown'}`,
          })
        } else {
          setMessage({ type: 'success', text: 'KYC approved successfully' })
        }
        setDetail(null)
        void fetchSubmissions(activeTab, page)
      } else {
        setMessage({ type: 'error', text: data.error ?? 'Approval failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReject(submissionId: string) {
    setActionLoading(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/kyc/${submissionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason: rejectReason, notes: rejectNotes || undefined }),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (data.success) {
        setMessage({ type: 'success', text: 'KYC rejected' })
        setDetail(null)
        void fetchSubmissions(activeTab, page)
      } else {
        setMessage({ type: 'error', text: data.error ?? 'Rejection failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">KYC Submissions</h1>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setPage(1); setDetail(null) }}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {message && (
        <div className={`rounded-lg border p-3 text-sm ${message.type === 'success' ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {fetchError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{fetchError}</div>
      )}

      {/* Detail View */}
      {detail && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Review Submission</h2>
            <button onClick={() => setDetail(null)} className="text-sm text-muted-foreground hover:underline">Close</button>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">User: </span>
              <Link href={`/admin/users/${detail.user_id}`} className="text-primary hover:underline">{detail.user_email}</Link>
            </div>
            <div>
              <span className="text-muted-foreground">Submitted: </span>
              {new Date(detail.created_at).toLocaleString()}
            </div>
          </div>

          {detail.signed_url && (
            <div className="rounded-lg border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={detail.signed_url} alt="KYC document" className="max-h-96 rounded" />
            </div>
          )}

          {detail.status === 'PENDING' && (
            <div className="grid grid-cols-2 gap-4">
              {/* Approve */}
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
                <h3 className="font-medium text-green-800">Approve</h3>
                <div>
                  <label className="mb-1 block text-sm font-medium">ID Number (from document)</label>
                  <input type="text" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Enter ID number" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                </div>
                <button onClick={() => void handleApprove(detail.id)} disabled={actionLoading || !idNumber.trim()} className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
                  {actionLoading ? 'Processing...' : 'Approve'}
                </button>
              </div>

              {/* Reject */}
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
                <h3 className="font-medium text-red-800">Reject</h3>
                <div>
                  <label className="mb-1 block text-sm font-medium">Reason</label>
                  <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
                  <textarea value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                </div>
                <button onClick={() => void handleReject(detail.id)} disabled={actionLoading} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                  {actionLoading ? 'Processing...' : 'Reject'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {activeTab !== 'PENDING' && <th className="px-4 py-3 font-medium">Reviewed</th>}
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={activeTab === 'PENDING' ? 4 : 5} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : submissions.length === 0 ? (
                <tr><td colSpan={activeTab === 'PENDING' ? 4 : 5} className="px-4 py-8 text-center text-muted-foreground">No {activeTab.toLowerCase()} submissions</td></tr>
              ) : (
                submissions.map((s) => (
                  <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/users/${s.user_id}`} className="text-primary hover:underline">{s.user_email}</Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                        s.status === 'APPROVED' ? 'bg-green-100 text-green-700' : s.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>{s.status}</span>
                    </td>
                    {activeTab !== 'PENDING' && (
                      <td className="px-4 py-3 text-muted-foreground">{s.reviewed_at ? new Date(s.reviewed_at).toLocaleDateString() : '—'}</td>
                    )}
                    <td className="px-4 py-3">
                      <button onClick={() => void openDetail(s.id)} disabled={detailLoading} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">
                        Review
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">Previous</button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={!hasMore} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">Next</button>
        </div>
      </div>
    </div>
  )
}
