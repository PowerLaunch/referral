import { getDisplayReferralStatus } from '@referral/api/statusDisplay'
import { Pause } from 'lucide-react'
import { formatDate } from '../utils'

interface ReferralRow {
  id: string
  referee_id: string
  status: string
  payout_eligible_at: string | null
  lock_timer_frozen: boolean
  created_at: string
}

interface ReferralTableProps {
  referrals: ReferralRow[]
  refereeEmails: Record<string, string>
}

export function ReferralTable({ referrals, refereeEmails }: ReferralTableProps) {
  if (referrals.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Your Referrals</h2>
        <p className="text-sm text-muted-foreground">
          No referrals yet. Share your link to get started!
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Your Referrals</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-3 pr-4 font-medium">Referee</th>
              <th className="pb-3 pr-4 font-medium">Status</th>
              <th className="pb-3 pr-4 font-medium">Est. Payout Date</th>
              <th className="pb-3 font-medium">Frozen</th>
            </tr>
          </thead>
          <tbody>
            {referrals.map((ref) => {
              // Shadow review: status mapped via statusDisplay per spec v5 Section 6.2
              const displayStatus = getDisplayReferralStatus(ref.status)
              const statusColor =
                displayStatus === 'Confirmed'
                  ? 'text-green-600'
                  : displayStatus === 'Rejected'
                    ? 'text-red-600'
                    : 'text-amber-600'

              return (
                <tr key={ref.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 pr-4">
                    {refereeEmails[ref.referee_id] ?? '***@***'}
                  </td>
                  <td className={`py-3 pr-4 font-medium ${statusColor}`}>
                    {displayStatus}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {ref.payout_eligible_at ? formatDate(ref.payout_eligible_at) : '—'}
                  </td>
                  <td className="py-3">
                    {ref.lock_timer_frozen && (
                      <Pause className="h-4 w-4 text-amber-500" />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
