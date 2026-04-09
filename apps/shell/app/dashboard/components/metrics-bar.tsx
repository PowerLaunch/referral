import { DollarSign, TrendingUp, MousePointerClick, Users } from 'lucide-react'

interface MetricsBarProps {
  totalEarned: number // in cents
  pendingRewards: number // in cents
  totalReferrals: number
  confirmedReferrals: number
  activeRecurring: number
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  )
}

export function MetricsBar({
  totalEarned,
  pendingRewards,
  totalReferrals,
  confirmedReferrals,
  activeRecurring,
}: MetricsBarProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        icon={<DollarSign className="h-4 w-4" />}
        label="Total Earned"
        value={`$${(totalEarned / 100).toFixed(2)}`}
      />
      <MetricCard
        icon={<TrendingUp className="h-4 w-4" />}
        label="Pending Rewards"
        value={`$${(pendingRewards / 100).toFixed(2)}`}
      />
      <MetricCard
        icon={<MousePointerClick className="h-4 w-4" />}
        label="Click → Conversion"
        value={`${totalReferrals} referrals / ${confirmedReferrals} conversions`}
      />
      <MetricCard
        icon={<Users className="h-4 w-4" />}
        label="Active Recurring"
        value={String(activeRecurring)}
      />
    </div>
  )
}
