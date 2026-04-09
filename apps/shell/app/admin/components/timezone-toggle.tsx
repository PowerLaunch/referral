// Timezone conversion is display-only. DB stores UTC always.
'use client'

import { useTimezone } from './timezone-context'

export function TimezoneToggle() {
  const { tz, toggle } = useTimezone()

  return (
    <button
      onClick={toggle}
      className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
    >
      {tz === 'UTC' ? 'UTC' : 'PHT (UTC+8)'}
    </button>
  )
}
