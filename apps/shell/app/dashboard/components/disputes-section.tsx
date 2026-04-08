import { AlertCircle } from 'lucide-react'

interface DisputeRow {
  id: string
  status: string
  created_at: string
  resolved_at: string | null
}

interface DisputesSectionProps {
  disputes: DisputeRow[]
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function DisputesSection({ disputes }: DisputesSectionProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Disputes</h2>
        <a
          href="/dashboard/dispute"
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <AlertCircle className="h-4 w-4" />
          Submit a dispute
        </a>
      </div>

      {disputes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No disputes submitted.</p>
      ) : (
        <div className="space-y-2">
          {disputes.map((dispute) => {
            const statusColor =
              dispute.status === 'RESOLVED'
                ? 'text-green-600'
                : dispute.status === 'UNDER_REVIEW'
                  ? 'text-blue-600'
                  : 'text-amber-600'

            const statusLabel =
              dispute.status === 'UNDER_REVIEW'
                ? 'Under Review'
                : dispute.status === 'RESOLVED'
                  ? 'Resolved'
                  : 'Open'

            return (
              <div
                key={dispute.id}
                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">
                  {formatDate(dispute.created_at)}
                </span>
                <span className={`font-medium ${statusColor}`}>{statusLabel}</span>
                {dispute.resolved_at && (
                  <span className="text-xs text-muted-foreground">
                    Resolved {formatDate(dispute.resolved_at)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
