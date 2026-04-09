'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTimezone, formatAdminDate } from '../components/timezone-context'

interface AuditLogEntry {
  id: string
  admin_user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  before_value: string | null
  after_value: string | null
  reason: string | null
  details: Record<string, unknown> | null
  created_at: string
  admin_email: string | null
}

const PAGE_SIZE = 50

export default function AuditLogClient() {
  const { tz } = useTimezone()
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const fetchPage = useCallback(async (pageNum: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/audit-logs?page=${pageNum}&limit=${PAGE_SIZE}`)
      if (res.ok) {
        const data = (await res.json()) as { entries: AuditLogEntry[]; hasMore: boolean }
        setEntries(data.entries)
        setHasMore(data.hasMore)
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPage(page)
  }, [page, fetchPage])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit Log</h1>

      <div className="rounded-lg border border-border bg-card p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit log entries.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Timestamp</th>
                    <th className="pb-3 pr-4 font-medium">Action</th>
                    <th className="pb-3 pr-4 font-medium">Target</th>
                    <th className="pb-3 pr-4 font-medium">Admin</th>
                    <th className="pb-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/50 last:border-0">
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {formatAdminDate(entry.created_at, tz)}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs font-medium">
                        {entry.action}
                      </td>
                      <td className="py-3 pr-4 text-xs">
                        {entry.target_type && (
                          <span className="text-muted-foreground">
                            {entry.target_type}
                            {entry.target_id && `: ${entry.target_id.slice(0, 8)}...`}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {entry.admin_email ?? (entry.admin_user_id ? 'System' : 'Auto')}
                      </td>
                      <td className="py-3 text-xs">
                        {entry.before_value && entry.after_value ? (
                          <span className="text-muted-foreground">
                            {truncate(entry.before_value, 30)} → {truncate(entry.after_value, 30)}
                          </span>
                        ) : entry.details ? (
                          <span className="text-muted-foreground">
                            {truncate(JSON.stringify(entry.details), 60)}
                          </span>
                        ) : entry.reason ? (
                          <span className="text-muted-foreground">{truncate(entry.reason, 60)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-30"
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground">Page {page + 1}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
                className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str
}
