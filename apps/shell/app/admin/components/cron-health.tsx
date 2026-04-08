'use client'

import { formatAdminDate } from './timezone-toggle'

interface CronEntry {
  cron_name: string
  last_success_at: string
}

export function CronHealth({ entries }: { entries: CronEntry[] }) {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Cron Health</h2>
        <p className="text-sm text-muted-foreground">
          No cron health data yet. Crons will report here on first successful run.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Cron Health</h2>
      <div className="space-y-2">
        {entries.map((entry) => {
          const stale = Date.now() - new Date(entry.last_success_at).getTime() > TWO_HOURS_MS
          return (
            <div
              key={entry.cron_name}
              className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
            >
              <span className="font-mono">{entry.cron_name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {formatAdminDate(entry.last_success_at)}
                </span>
                {stale && (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    STALE
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
