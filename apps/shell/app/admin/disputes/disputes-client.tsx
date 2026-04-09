'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface DisputeRow {
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

const TABS = ['OPEN', 'UNDER_REVIEW', 'RESOLVED'] as const

export default function DisputesClient() {
  const [disputes, setDisputes] = useState<DisputeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>('OPEN')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const fetchDisputes = useCallback(async (status: string, pageNum: number) => {
    setLoading(true)
    setFetchError(null)
    try {
      const params = new URLSearchParams({
        status,
        page: String(pageNum),
        limit: '50',
      })

      const res = await fetch(`/api/admin/disputes?${params.toString()}`)
      if (res.ok) {
        const data = (await res.json()) as { disputes: DisputeRow[]; hasMore: boolean }
        setDisputes(data.disputes)
        setHasMore(data.hasMore)
      } else {
        setFetchError('Failed to load disputes')
      }
    } catch {
      setFetchError('Failed to load disputes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchDisputes(activeTab, page)
  }, [fetchDisputes, activeTab, page])

  function switchTab(tab: string) {
    setActiveTab(tab)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Disputes</h1>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.replace('_', ' ')}
          </button>
        ))}
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {fetchError}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Referral</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : disputes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No {activeTab.toLowerCase().replace('_', ' ')} disputes
                  </td>
                </tr>
              ) : (
                disputes.map((d) => (
                  <tr key={d.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${d.user_id}`}
                        className="text-primary hover:underline"
                      >
                        {d.user_email}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {d.referral_id ? d.referral_id.slice(0, 8) + '...' : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/disputes/${d.id}`}
                        className="text-primary hover:underline"
                      >
                        {d.description.length > 80
                          ? d.description.slice(0, 80) + '...'
                          : d.description}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(d.created_at).toLocaleDateString()}
                    </td>
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
