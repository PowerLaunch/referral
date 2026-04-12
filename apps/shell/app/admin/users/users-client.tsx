'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { riskColor } from './utils'

interface UserRow {
  id: string
  email: string
  trust_level: string
  trust_score: number
  trust_tier: string
  status: string
  is_vip: boolean
  payout_hold: boolean
  manual_payout_approval: boolean
  is_honeypot: boolean
  is_canary: boolean
  subscription_status: string
  referral_count: number
  risk_score: number
  fraud_flag_count: number
  created_at: string
}

function trustBadge(level: string): { text: string; className: string } {
  switch (level) {
    case 'BANNED':
      return { text: 'BANNED', className: 'bg-red-100 text-red-700 dark:bg-red-950/30' }
    case 'SUSPICIOUS':
      return { text: 'SUSPICIOUS', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30' }
    default:
      return { text: 'CLEAN', className: 'bg-green-100 text-green-700 dark:bg-green-950/30' }
  }
}

function tierLabel(tier: string): string {
  switch (tier) {
    case 'PROBATION': return 'Probation'
    case 'TRUSTED': return 'Trusted'
    case 'VETERAN': return 'Veteran'
    default: return 'Standard'
  }
}

type SortField = 'created_at' | 'trust_score' | 'trust_level'

export default function UsersClient() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [showTestAccounts, setShowTestAccounts] = useState(false)
  const [sortBy, setSortBy] = useState<SortField>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  // Track the last submitted search to avoid sending uncommitted input on sort/filter changes
  const appliedSearch = useRef('')

  const fetchUsers = useCallback(async (searchTerm: string, pageNum: number) => {
    setLoading(true)
    setFetchError(null)
    try {
      const params = new URLSearchParams()
      if (searchTerm.trim()) params.set('search', searchTerm.trim())
      params.set('page', String(pageNum))
      params.set('limit', '50')
      params.set('sortBy', sortBy)
      params.set('sortOrder', sortOrder)
      if (showTestAccounts) params.set('showTestAccounts', 'true')

      const res = await fetch(`/api/admin/users?${params.toString()}`)
      if (res.ok) {
        const data = (await res.json()) as { users: UserRow[]; hasMore: boolean }
        setUsers(data.users)
        setHasMore(data.hasMore)
      } else {
        setFetchError('Failed to load users')
      }
    } catch {
      setFetchError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [showTestAccounts, sortBy, sortOrder])

  useEffect(() => {
    void fetchUsers(appliedSearch.current, page)
  }, [fetchUsers, page, sortBy, sortOrder, showTestAccounts]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    appliedSearch.current = search
    setPage(1)
    void fetchUsers(search, 1)
  }

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
    setPage(1)
  }

  function sortIndicator(field: SortField): string {
    if (sortBy !== field) return ''
    return sortOrder === 'asc' ? ' ^' : ' v'
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">User Management</h1>

      <div className="flex items-center gap-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            placeholder="Search by email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Search
          </button>
        </form>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showTestAccounts}
            onChange={(e) => {
              setShowTestAccounts(e.target.checked)
              setPage(1)
            }}
            className="rounded border-input"
          />
          Show test accounts
        </label>
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
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th
                  className="cursor-pointer px-4 py-3 font-medium hover:text-foreground"
                  onClick={() => toggleSort('trust_level')}
                >
                  Trust Level{sortIndicator('trust_level')}
                </th>
                <th
                  className="cursor-pointer px-4 py-3 font-medium hover:text-foreground"
                  onClick={() => toggleSort('trust_score')}
                >
                  Score / Tier{sortIndicator('trust_score')}
                </th>
                <th className="px-4 py-3 font-medium">Subscription</th>
                <th className="px-4 py-3 font-medium">Referrals</th>
                <th
                  className="cursor-pointer px-4 py-3 font-medium hover:text-foreground"
                  onClick={() => toggleSort('created_at')}
                >
                  Created{sortIndicator('created_at')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const badge = trustBadge(user.trust_level)
                  return (
                    <tr key={user.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/users/${user.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {user.email}
                        </Link>
                        {user.is_vip && (
                          <span className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950/30">
                            VIP
                          </span>
                        )}
                        {user.payout_hold && (
                          <span className="ml-1 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950/30">
                            HOLD
                          </span>
                        )}
                        {user.is_honeypot && (
                          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/30">
                            HONEYPOT
                          </span>
                        )}
                        {user.is_canary && (
                          <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950/30">
                            CANARY
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={riskColor(user.risk_score)}>{user.risk_score}</span>
                        {user.fraud_flag_count > 0 && (
                          <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                            {user.fraud_flag_count}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                          {badge.text}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs">{user.trust_score}</span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          {tierLabel(user.trust_tier)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={user.subscription_status === 'active' ? 'text-green-600' : 'text-muted-foreground'}>
                          {user.subscription_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{user.referral_count}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  )
                })
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
