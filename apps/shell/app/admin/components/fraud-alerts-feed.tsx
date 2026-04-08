'use client'

import { formatAdminDate } from './timezone-toggle'

interface FraudFlag {
  id: string
  user_id: string | null
  rule_triggered: string
  severity: string
  details: Record<string, unknown> | null
  created_at: string
}

export function FraudAlertsFeed({ flags }: { flags: FraudFlag[] }) {
  if (flags.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Fraud Alerts (CRITICAL)</h2>
        <p className="text-sm text-muted-foreground">No critical fraud flags.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Fraud Alerts (CRITICAL)</h2>
      <div className="space-y-2">
        {flags.map((flag) => (
          <div
            key={flag.id}
            className="flex items-start justify-between rounded-md bg-red-50 px-3 py-2 text-sm dark:bg-red-950/20"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-red-600">
                  {flag.rule_triggered}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatAdminDate(flag.created_at)}
                </span>
              </div>
              {flag.details && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {summarizeDetails(flag.details)}
                </p>
              )}
            </div>
            {flag.user_id && (
              <a
                href={`/admin/users/${flag.user_id}`}
                className="ml-2 text-xs font-medium text-primary hover:underline"
              >
                View User
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function summarizeDetails(details: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}: ${String(value)}`)
    }
  }
  return parts.join(' | ') || JSON.stringify(details)
}
