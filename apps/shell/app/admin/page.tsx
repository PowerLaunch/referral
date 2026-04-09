import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { KillSwitches } from './components/kill-switches'
import { FraudAlertsFeed } from './components/fraud-alerts-feed'
import { CronHealth } from './components/cron-health'

export const dynamic = 'force-dynamic'

export default async function AdminPulsePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) notFound()

  const admin = createAdminClient()

  // Parallel queries for dashboard data
  const [
    activeSubsResult,
    paidSubsResult,
    pendingPayoutsResult,
    totalUsersResult,
    creditTxResult,
    completedPayoutsResult,
    fraudFlagsResult,
    gameConfigResult,
    cronHealthResult,
    seedUsersResult,
  ] = await Promise.all([
    // Active subscribers count (for MRR)
    admin
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    // Only count active/past_due subscriptions as revenue. Cancelled/refunded excluded.
    // Placeholder until payment_events table exists.
    admin
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .in('status', ['active', 'past_due']),
    // Pending payouts
    // PostgREST default limit is 1000 — explicit limit prevents silent truncation.
    // TODO: replace with DB-level SUM aggregate for scale.
    admin
      .from('payouts')
      .select('amount')
      .in('status', ['PENDING', 'PENDING_MANUAL_APPROVAL'])
      .limit(10000),
    // Total registered users
    admin
      .from('profiles')
      .select('*', { count: 'exact', head: true }),
    // Total credits awarded (positive CASH_BALANCE transactions = earnings)
    // PostgREST default limit is 1000 — explicit limit prevents silent truncation.
    // TODO: replace with DB-level SUM aggregate for scale.
    admin
      .from('credit_transactions')
      .select('amount')
      .eq('type', 'CASH_BALANCE')
      .gt('amount', 0)
      .limit(10000),
    // Completed payouts total
    // PostgREST default limit is 1000 — explicit limit prevents silent truncation.
    // TODO: replace with DB-level SUM aggregate for scale.
    admin
      .from('payouts')
      .select('amount')
      .eq('status', 'COMPLETED')
      .limit(10000),
    // Last 20 CRITICAL fraud flags
    admin
      .from('fraud_flags')
      .select('id, user_id, rule_triggered, severity, details, created_at')
      .eq('severity', 'CRITICAL')
      .order('created_at', { ascending: false })
      .limit(20),
    // Game config for kill switches
    admin
      .from('game_config')
      .select('cashouts_paused, referral_confirmations_paused')
      .limit(1)
      .single(),
    // Cron health
    admin
      .from('cron_health')
      .select('cron_name, last_success_at'),
    // Seed users count
    admin
      .from('seed_users')
      .select('*', { count: 'exact', head: true }),
  ])

  const activeSubscribers = activeSubsResult.count ?? 0
  const paidSubscriptions = paidSubsResult.count ?? 0
  const pendingPayouts = pendingPayoutsResult.data ?? []
  const totalUsers = totalUsersResult.count ?? 0
  const creditTx = creditTxResult.data ?? []
  const completedPayouts = completedPayoutsResult.data ?? []
  const fraudFlags = fraudFlagsResult.data ?? []
  const gameConfig = gameConfigResult.data
  const cronHealthData = cronHealthResult.data ?? []
  const seedUsersCount = seedUsersResult.count ?? 0

  // Revenue calculations (all-time, apples-to-apples comparison)
  // Placeholder: replace with SUM of actual payment_events once payment integration exists.
  const subscriptionRevenue = paidSubscriptions * 500 // active/past_due subs x $5
  const totalPayoutsAmount = completedPayouts.reduce((sum, p) => sum + (p.amount as number), 0)
  const netRevenue = subscriptionRevenue - totalPayoutsAmount
  const totalLiability = creditTx.reduce((sum, tx) => sum + (tx.amount as number), 0) - totalPayoutsAmount
  const mrr = activeSubscribers * 500 // $5 per currently active sub

  const pendingPayoutCount = pendingPayouts.length
  const pendingPayoutAmount = pendingPayouts.reduce((sum, p) => sum + (p.amount as number), 0)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Pulse</h1>

      {/* Revenue Dashboard */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Net Revenue (All-Time)"
          value={`$${(netRevenue / 100).toFixed(2)}`}
          sub={`$${(subscriptionRevenue / 100).toFixed(2)} subs - $${(totalPayoutsAmount / 100).toFixed(2)} payouts`}
        />
        <MetricCard
          label="MRR"
          value={`$${(mrr / 100).toFixed(2)}`}
          sub={`${activeSubscribers} active subs x $5`}
        />
        <MetricCard
          label="Total Liability"
          value={`$${(totalLiability / 100).toFixed(2)}`}
          sub="Credits awarded minus paid out"
        />
        <MetricCard label="Seed Users" value={String(seedUsersCount)} sub="Admin-created test accounts" />
      </div>

      {/* System Health */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Active Users" value={String(activeSubscribers)} />
        <MetricCard
          label="Pending Payouts"
          value={`${pendingPayoutCount} ($${(pendingPayoutAmount / 100).toFixed(2)})`}
        />
        <MetricCard label="Total Registered" value={String(totalUsers)} />
      </div>

      {/* Cron Health */}
      <CronHealth entries={cronHealthData as Array<{ cron_name: string; last_success_at: string }>} />

      {/* Kill Switches */}
      <KillSwitches
        cashoutsPaused={gameConfig?.cashouts_paused ?? false}
        referralConfirmationsPaused={gameConfig?.referral_confirmations_paused ?? false}
      />

      {/* Fraud Alerts */}
      <FraudAlertsFeed
        flags={fraudFlags as Array<{
          id: string
          user_id: string | null
          rule_triggered: string
          severity: string
          details: Record<string, unknown> | null
          created_at: string
        }>}
      />
    </div>
  )
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}
