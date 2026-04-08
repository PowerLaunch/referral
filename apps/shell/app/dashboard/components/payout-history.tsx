import { getDisplayPayoutStatus } from '@referral/api/statusDisplay'
import { formatDate } from '../utils'

interface PayoutRow {
  id: string
  amount: number
  method: string
  status: string
  provider_error_code: string | null
  created_at: string
}

interface PayoutHistoryProps {
  payouts: PayoutRow[]
  userStatus: string
}

const ERROR_CODE_MAP: Record<string, string> = {
  invalid_account: 'Invalid account number',
  insufficient_funds: 'Insufficient funds',
  provider_unavailable: 'Provider unavailable',
  account_closed: 'Account closed',
  invalid_routing: 'Invalid routing number',
}

function formatMethod(method: string): string {
  const labels: Record<string, string> = {
    gcash: 'GCash',
    gopay: 'GoPay',
    ovo: 'OVO',
    grabpay: 'GrabPay',
    bank_transfer: 'Bank Transfer',
    paypal: 'PayPal',
  }
  return labels[method] ?? method
}

export function PayoutHistory({ payouts, userStatus }: PayoutHistoryProps) {
  if (payouts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Payout History</h2>
        <p className="text-sm text-muted-foreground">No payouts yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Payout History</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-3 pr-4 font-medium">Date</th>
              <th className="pb-3 pr-4 font-medium">Amount</th>
              <th className="pb-3 pr-4 font-medium">Method</th>
              <th className="pb-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((payout) => {
              // Shadow review: status mapped via statusDisplay per spec v5 Section 6.2
              const displayStatus = getDisplayPayoutStatus(payout.status, userStatus)
              const statusColor =
                displayStatus === 'Completed'
                  ? 'text-green-600'
                  : displayStatus === 'Failed'
                    ? 'text-red-600'
                    : displayStatus === 'Verifying'
                      ? 'text-amber-600'
                      : 'text-blue-600'

              const failedReason =
                payout.status === 'FAILED' && displayStatus === 'Failed'
                  ? (payout.provider_error_code && ERROR_CODE_MAP[payout.provider_error_code]) ||
                    'Processing error — please try again'
                  : null

              return (
                <tr key={payout.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 pr-4 text-muted-foreground">
                    {formatDate(payout.created_at)}
                  </td>
                  <td className="py-3 pr-4 font-medium">
                    ${(payout.amount / 100).toFixed(2)}
                  </td>
                  <td className="py-3 pr-4">{formatMethod(payout.method)}</td>
                  <td className="py-3">
                    <span className={`font-medium ${statusColor}`}>{displayStatus}</span>
                    {failedReason && (
                      <p className="text-xs text-muted-foreground">{failedReason}</p>
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
