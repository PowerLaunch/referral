import { getDisplayReferralStatus } from '@referral/api/statusDisplay'
import { Check, Clock, Pause } from 'lucide-react'

interface ReferralForStepper {
  id: string
  status: string
  payout_eligible_at: string | null
  lock_timer_frozen: boolean
}

interface EarningsStepperProps {
  totalReferrals: number
  subscribedReferrals: number
  pendingReferrals: ReferralForStepper[]
  confirmedReferrals: number
}

function StepIndicator({
  step,
  label,
  count,
  active,
}: {
  step: number
  label: string
  count: number
  active: boolean
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold ${
          count > 0
            ? 'border-primary bg-primary text-primary-foreground'
            : active
              ? 'border-primary text-primary'
              : 'border-muted-foreground/30 text-muted-foreground/50'
        }`}
      >
        {count > 0 ? <Check className="h-5 w-5" /> : step}
      </div>
      <span className="mt-2 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-bold">{count}</span>
    </div>
  )
}

export function EarningsStepper({
  totalReferrals,
  subscribedReferrals,
  pendingReferrals,
  confirmedReferrals,
}: EarningsStepperProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Earnings Progress</h2>

      {/* 5-step stepper */}
      <div className="flex items-start justify-between gap-2 overflow-x-auto">
        <StepIndicator step={1} label="Link Clicked" count={totalReferrals} active />
        <div className="mt-5 flex-1 border-t border-border" />
        <StepIndicator step={2} label="Account Created" count={totalReferrals} active={totalReferrals > 0} />
        <div className="mt-5 flex-1 border-t border-border" />
        <StepIndicator step={3} label="Subscribed" count={subscribedReferrals} active={totalReferrals > 0} />
        <div className="mt-5 flex-1 border-t border-border" />
        <StepIndicator step={4} label="Lock Period" count={pendingReferrals.length} active={subscribedReferrals > 0} />
        <div className="mt-5 flex-1 border-t border-border" />
        <StepIndicator step={5} label="Payout Ready" count={confirmedReferrals} active={pendingReferrals.length > 0} />
      </div>

      {/* Lock period details for PENDING referrals */}
      {pendingReferrals.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Lock Period Status</h3>
          {pendingReferrals.map((ref) => {
            // Shadow review: status mapped via statusDisplay per spec v5 Section 6.2
            const displayStatus = getDisplayReferralStatus(ref.status)
            const eligibleDate = ref.payout_eligible_at
              ? new Date(ref.payout_eligible_at)
              : null
            const now = new Date()
            const daysLeft = eligibleDate
              ? Math.max(0, Math.ceil((eligibleDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
              : null

            return (
              <div
                key={ref.id}
                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {ref.lock_timer_frozen ? (
                    <Pause className="h-4 w-4 text-amber-500" />
                  ) : (
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span>Referral #{ref.id.slice(0, 8)}</span>
                </span>
                <span className="text-muted-foreground">
                  {ref.lock_timer_frozen
                    ? 'Paused — resubscribe to resume'
                    : daysLeft !== null && daysLeft > 0
                      ? `${daysLeft} days left`
                      : displayStatus}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
