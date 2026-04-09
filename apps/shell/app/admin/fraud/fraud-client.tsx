'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { resolveFraudFlag } from './actions'
import { KillSwitches } from '../components/kill-switches'

// --- Types ---

interface FraudFlag {
  id: string
  user_id: string | null
  rule_triggered: string
  severity: string
  details: Record<string, unknown> | null
  is_resolved: boolean
  created_at: string
}

interface DeviceCluster {
  fingerprint_hash: string
  user_ids: string[]
  user_count: number
}

interface SybilCluster {
  verified_kyc_hash: string
  user_ids: string[]
  user_count: number
}

interface PaymentEvent {
  id: string
  event_type: string
  status: string
  amount: number
  created_at: string
}

// --- Helpers ---

function severityBadge(severity: string): { text: string; className: string } {
  switch (severity) {
    case 'CRITICAL':
      return { text: 'CRITICAL', className: 'bg-red-100 text-red-700 dark:bg-red-950/30' }
    case 'WARNING':
      return { text: 'WARNING', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30' }
    default:
      return { text: 'INFO', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30' }
  }
}

const TABS = [
  { key: 'flags', label: 'Fraud Flags' },
  { key: 'devices', label: 'Device Clusters' },
  { key: 'sybil', label: 'Sybil Clusters' },
  { key: 'circuit', label: 'Circuit Breakers' },
  { key: 'webhooks', label: 'Webhook Log' },
] as const

export default function FraudClient() {
  const [activeTab, setActiveTab] = useState<string>('flags')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Fraud Management</h1>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
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

      {activeTab === 'flags' && <FraudFlagsTab />}
      {activeTab === 'devices' && <DeviceClustersTab />}
      {activeTab === 'sybil' && <SybilClustersTab />}
      {activeTab === 'circuit' && <CircuitBreakersTab />}
      {activeTab === 'webhooks' && <WebhookLogTab />}
    </div>
  )
}

// --- Fraud Flags Tab ---

function FraudFlagsTab() {
  const [flags, setFlags] = useState<FraudFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [severityFilter, setSeverityFilter] = useState('')
  const [ruleFilter, setRuleFilter] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchFlags = useCallback(async (pageNum: number, severity: string, rule: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tab: 'flags', page: String(pageNum), limit: '50' })
      if (severity) params.set('severity', severity)
      if (rule) params.set('rule', rule)

      const res = await fetch(`/api/admin/fraud?${params.toString()}`)
      if (res.ok) {
        const data = (await res.json()) as { flags: FraudFlag[]; hasMore: boolean }
        setFlags(data.flags)
        setHasMore(data.hasMore)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchFlags(page, severityFilter, ruleFilter)
  }, [fetchFlags, page, severityFilter, ruleFilter])

  async function handleResolve(flagId: string) {
    setActionLoading(flagId)
    try {
      const result = await resolveFraudFlag(flagId)
      if (result.ok) {
        setMessage({ type: 'success', text: 'Flag resolved' })
        void fetchFlags(page, severityFilter, ruleFilter)
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Failed to resolve' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to resolve flag' })
    } finally {
      setActionLoading(null)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`rounded-lg border p-3 text-sm ${
          message.type === 'success'
            ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400'
            : 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400'
        }`}>{message.text}</div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setPage(1) }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">All Severities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="WARNING">WARNING</option>
          <option value="INFO">INFO</option>
        </select>
        <input
          type="text"
          placeholder="Filter by rule..."
          value={ruleFilter}
          onChange={(e) => { setRuleFilter(e.target.value); setPage(1) }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm w-48"
        />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Details</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading...</td>
                </tr>
              ) : flags.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No fraud flags found</td>
                </tr>
              ) : (
                flags.map((flag) => {
                  const badge = severityBadge(flag.severity)
                  return (
                    <tr key={flag.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-3 font-mono text-xs">{flag.rule_triggered}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                          {badge.text}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {flag.user_id ? (
                          <Link href={`/admin/users/${flag.user_id}`} className="text-primary hover:underline font-mono text-xs">
                            {flag.user_id.slice(0, 8)}...
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">System</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-xs truncate">
                        {flag.details ? JSON.stringify(flag.details).slice(0, 100) : '-'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(flag.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC
                      </td>
                      <td className="px-4 py-3">
                        {flag.is_resolved ? (
                          <span className="text-green-600 text-xs font-medium">Resolved</span>
                        ) : (
                          <span className="text-red-600 text-xs font-medium">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!flag.is_resolved && (
                          <button
                            onClick={() => handleResolve(flag.id)}
                            disabled={actionLoading === flag.id}
                            className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {actionLoading === flag.id ? 'Resolving...' : 'Resolve'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
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

// --- Device Clusters Tab ---

function DeviceClustersTab() {
  const [clusters, setClusters] = useState<DeviceCluster[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/fraud?tab=devices&page=1&limit=50')
        if (res.ok) {
          const data = (await res.json()) as { clusters: DeviceCluster[] }
          setClusters(data.clusters)
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  if (loading) return <p className="text-muted-foreground">Loading device clusters...</p>
  if (clusters.length === 0) return <p className="text-muted-foreground">No device clusters found (shared fingerprints appear here)</p>

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Fingerprint Hash</th>
              <th className="px-4 py-3 font-medium">Users</th>
              <th className="px-4 py-3 font-medium">User IDs</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <tr key={c.fingerprint_hash} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs">
                  {c.fingerprint_hash.slice(0, 12)}...
                </td>
                <td className="px-4 py-3 font-bold">{c.user_count}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {c.user_ids.map((uid) => (
                      <Link
                        key={uid}
                        href={`/admin/users/${uid}`}
                        className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-primary hover:underline"
                      >
                        {uid.slice(0, 8)}
                      </Link>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// --- Sybil Clusters Tab ---

function SybilClustersTab() {
  const [clusters, setClusters] = useState<SybilCluster[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/fraud?tab=sybil&page=1&limit=50')
        if (res.ok) {
          const data = (await res.json()) as { clusters: SybilCluster[] }
          setClusters(data.clusters)
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  if (loading) return <p className="text-muted-foreground">Loading Sybil clusters...</p>
  if (clusters.length === 0) return <p className="text-muted-foreground">No Sybil clusters found (matching KYC hashes appear here)</p>

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">KYC Hash</th>
              <th className="px-4 py-3 font-medium">Users</th>
              <th className="px-4 py-3 font-medium">User IDs</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <tr key={c.verified_kyc_hash} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs">
                  {c.verified_kyc_hash.slice(0, 12)}...
                </td>
                <td className="px-4 py-3 font-bold">{c.user_count}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {c.user_ids.map((uid) => (
                      <Link
                        key={uid}
                        href={`/admin/users/${uid}`}
                        className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-primary hover:underline"
                      >
                        {uid.slice(0, 8)}
                      </Link>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// --- Circuit Breakers Tab ---

function CircuitBreakersTab() {
  const [config, setConfig] = useState<{ cashouts_paused: boolean; referral_confirmations_paused: boolean } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/config')
        if (res.ok) {
          const data = (await res.json()) as { config: { cashouts_paused: boolean; referral_confirmations_paused: boolean } }
          setConfig(data.config)
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  if (loading) return <p className="text-muted-foreground">Loading circuit breaker state...</p>
  if (!config) return <p className="text-muted-foreground">Failed to load circuit breaker state</p>

  return (
    <KillSwitches
      cashoutsPaused={config.cashouts_paused}
      referralConfirmationsPaused={config.referral_confirmations_paused}
    />
  )
}

// --- Webhook Log Tab ---

function WebhookLogTab() {
  const [events, setEvents] = useState<PaymentEvent[]>([])
  const [placeholder, setPlaceholder] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/fraud?tab=webhooks')
        if (res.ok) {
          const data = (await res.json()) as { events: PaymentEvent[] | null; placeholder: boolean }
          if (data.placeholder) {
            setPlaceholder(true)
          } else {
            setEvents(data.events ?? [])
          }
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  if (loading) return <p className="text-muted-foreground">Loading webhook log...</p>

  if (placeholder) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">
          Payment events will appear here after payment integration is configured.
        </p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">No payment events recorded yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Event Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs">{e.event_type}</td>
                <td className="px-4 py-3">{e.status}</td>
                <td className="px-4 py-3">${(e.amount / 100).toFixed(2)}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {new Date(e.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
