'use client'

import { useEffect, useState, useCallback } from 'react'

interface HoneypotRow {
  id: string
  email: string
  referral_code: string
  referral_count: number
  created_at: string
}

interface CanaryRow {
  id: string
  email: string
  inbound_referral_count: number
  created_at: string
}

export default function HoneypotClient() {
  const [tab, setTab] = useState<'honeypot' | 'canary'>('honeypot')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Honeypot & Canary Management</h1>

      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setTab('honeypot')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'honeypot'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Honeypot Codes
        </button>
        <button
          onClick={() => setTab('canary')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'canary'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Canary Accounts
        </button>
      </div>

      {tab === 'honeypot' ? <HoneypotTab /> : <CanaryTab />}
    </div>
  )
}

function HoneypotTab() {
  const [honeypots, setHoneypots] = useState<HoneypotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [createdCode, setCreatedCode] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHoneypots = useCallback(async (pageNum: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(pageNum), limit: '20' })
      const res = await fetch(`/api/admin/honeypot?${params.toString()}`)
      if (res.ok) {
        const data = (await res.json()) as { honeypots: HoneypotRow[]; hasMore: boolean }
        setHoneypots(data.honeypots)
        setHasMore(data.hasMore)
      } else {
        setError('Failed to load honeypot accounts')
      }
    } catch {
      setError('Failed to load honeypot accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchHoneypots(page)
  }, [fetchHoneypots, page])

  async function handleCreate() {
    setCreating(true)
    setCreatedCode(null)
    try {
      const res = await fetch('/api/admin/honeypot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const data = (await res.json()) as { referral_code: string }
        setCreatedCode(data.referral_code)
        void fetchHoneypots(page)
      } else {
        setError('Failed to create honeypot')
      }
    } catch {
      setError('Failed to create honeypot')
    } finally {
      setCreating(false)
    }
  }

  async function handleDeactivate(id: string) {
    try {
      const res = await fetch(`/api/admin/honeypot/${id}/deactivate`, { method: 'POST' })
      if (res.ok) {
        void fetchHoneypots(page)
      }
    } catch {
      // Silently fail — UI will show stale data until next refresh
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <button
          onClick={handleCreate}
          disabled={creating}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Honeypot Code'}
        </button>
        {createdCode && (
          <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm dark:border-green-800 dark:bg-green-950/30">
            Referral code: <code className="font-mono font-bold">{createdCode}</code>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Referral Code</th>
                <th className="px-4 py-3 font-medium">Referrals</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : honeypots.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No honeypot accounts
                  </td>
                </tr>
              ) : (
                honeypots.map((h) => (
                  <tr key={h.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">{h.email}</td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{h.referral_code}</code>
                    </td>
                    <td className="px-4 py-3">{h.referral_count}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(h.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDeactivate(h.id)}
                        className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                      >
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

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

function CanaryTab() {
  const [canaries, setCanaries] = useState<CanaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [seedGameplay, setSeedGameplay] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCanaries = useCallback(async (pageNum: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(pageNum), limit: '20' })
      const res = await fetch(`/api/admin/canary?${params.toString()}`)
      if (res.ok) {
        const data = (await res.json()) as { canaries: CanaryRow[]; hasMore: boolean }
        setCanaries(data.canaries)
        setHasMore(data.hasMore)
      } else {
        setError('Failed to load canary accounts')
      }
    } catch {
      setError('Failed to load canary accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchCanaries(page)
  }, [fetchCanaries, page])

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/canary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed_gameplay: seedGameplay }),
      })
      if (res.ok) {
        void fetchCanaries(page)
      } else {
        setError('Failed to create canary')
      }
    } catch {
      setError('Failed to create canary')
    } finally {
      setCreating(false)
    }
  }

  async function handleDeactivate(id: string) {
    try {
      const res = await fetch(`/api/admin/canary/${id}/deactivate`, { method: 'POST' })
      if (res.ok) {
        void fetchCanaries(page)
      }
    } catch {
      // Silently fail
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <button
          onClick={handleCreate}
          disabled={creating}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Canary Account'}
        </button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={seedGameplay}
            onChange={(e) => setSeedGameplay(e.target.checked)}
            className="rounded border-input"
          />
          Seed gameplay data
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Inbound Referrals</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : canaries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No canary accounts
                  </td>
                </tr>
              ) : (
                canaries.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">{c.email}</td>
                    <td className="px-4 py-3">{c.inbound_referral_count}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDeactivate(c.id)}
                        className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                      >
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

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
