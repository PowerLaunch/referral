import { createAdminClient } from '@/lib/supabase/admin'
import { KillSwitches } from './components/kill-switches'
import { FraudAlertsFeed } from './components/fraud-alerts-feed'
import { CronHealth } from './components/cron-health'

export const dynamic = 'force-dynamic'

export default async function AdminPulsePage() {
  const admin = createAdminClient()

  // Parallel queries for dashboard data
  const [
    activeSubsResult,
    pendingPayoutsResult,
    totalUsersResult,
    creditTxResult,
    completedPayoutsResult,
    fraudFlagsResult,
    gameConfigResult,
    cronHealthResult,
  ] = await Promise.all([
    // Active subscribers count
    admin
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    // Pending payouts
    admin
      .from('payouts')
      .select('amount')
      .in('status', ['PENDING', 'PENDING_MANUAL_APPROVAL']),
    // Total registered users
    admin
      .from('profiles')
      .select('*', { count: 'exact', head: true }),
    // Total credits awarded (positive CASH_BALANCE transactions = earnings)
    admin
      .from('credit_transactions')
      .select('amount')
      .eq('type', 'CASH_BALANCE')
      .gt('amount', 0),
    // Completed payouts total
    admin
      .from('payouts')
      .select('amount')
      .eq('status', 'COMPLETED'),
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
  ])

  const activeSubscribers = activeSubsResult.count ?? 0
  const pendingPayouts = pendingPayoutsResult.data ?? []
  const totalUsers = totalUsersResult.count ?? 0
  const creditTx = creditTxResult.data ?? []
  const completedPayouts = completedPayoutsResult.data ?? []
  const fraudFlags = fraudFlagsResult.data ?? []
  const gameConfig = gameConfigResult.data
  const cronHealthData = cronHealthResult.data ?? []

  // Revenue calculations
  // Subscription revenue proxy: active subs * $5
  const subscriptionRevenue = activeSubscribers * 500 // in cents
  const totalPayoutsAmount = completedPayouts.reduce((sum, p) => sum + (p.amount as number), 0)
  const netRevenue = subscriptionRevenue - totalPayoutsAmount
  const totalLiability = creditTx.reduce((sum, tx) => sum + (tx.amount as number), 0) - totalPayoutsAmount
  const mrr = activeSubscribers * 500 // $5 per active sub

  const pendingPayoutCount = pendingPayouts.length
  const pendingPayoutAmount = pendingPayouts.reduce((sum, p) => sum + (p.amount as number), 0)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Pulse</h1>

      {/* Revenue Dashboard */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Net Revenue"
          value={`$${(netRevenue / 100).toFixed(2)}`}
          sub="Subscriptions minus payouts"
        />
        <MetricCard
          label="Total Liability"
          value={`$${(totalLiability / 100).toFixed(2)}`}
          sub="Credits awarded minus paid out"
        />
        <MetricCard
          label="MRR"
          value={`$${(mrr / 100).toFixed(2)}`}
          sub={`${activeSubscribers} active subs x $5`}
        />
        <MetricCard label="Churn Rate" value="—" sub="Pending subscription history" />
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
