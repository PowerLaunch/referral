// Timezone conversion is display-only. DB stores UTC always.
'use client'

import { useEffect, useState } from 'react'

const TZ_KEY = 'admin_tz'

export function TimezoneToggle() {
  const [tz, setTz] = useState<'UTC' | 'PHT'>('UTC')

  useEffect(() => {
    const stored = localStorage.getItem(TZ_KEY)
    if (stored === 'PHT') setTz('PHT')
  }, [])

  function toggle() {
    const next = tz === 'UTC' ? 'PHT' : 'UTC'
    setTz(next)
    localStorage.setItem(TZ_KEY, next)
  }

  return (
    <button
      onClick={toggle}
      className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
    >
      {tz === 'UTC' ? 'UTC' : 'PHT (UTC+8)'}
    </button>
  )
}

export function formatAdminDate(dateStr: string): string {
  const date = new Date(dateStr)
  const stored = typeof window !== 'undefined' ? localStorage.getItem(TZ_KEY) : null
  if (stored === 'PHT') {
    return date.toLocaleString('en-US', { timeZone: 'Asia/Manila', dateStyle: 'short', timeStyle: 'short' })
  }
  return date.toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }) + ' UTC'
}
