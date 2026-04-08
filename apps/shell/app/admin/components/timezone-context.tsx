'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

type Tz = 'UTC' | 'PHT'

interface TimezoneContextValue {
  tz: Tz
  toggle: () => void
}

const TimezoneContext = createContext<TimezoneContextValue>({
  tz: 'UTC',
  toggle: () => {},
})

const TZ_KEY = 'admin_tz'

export function TimezoneProvider({ children }: { children: ReactNode }) {
  const [tz, setTz] = useState<Tz>('UTC')

  useEffect(() => {
    const stored = localStorage.getItem(TZ_KEY)
    if (stored === 'PHT') setTz('PHT')
  }, [])

  const toggle = useCallback(() => {
    setTz((prev) => {
      const next = prev === 'UTC' ? 'PHT' : 'UTC'
      localStorage.setItem(TZ_KEY, next)
      return next
    })
  }, [])

  return (
    <TimezoneContext.Provider value={{ tz, toggle }}>
      {children}
    </TimezoneContext.Provider>
  )
}

export function useTimezone(): TimezoneContextValue {
  return useContext(TimezoneContext)
}

export function formatAdminDate(dateStr: string, tz: Tz): string {
  const date = new Date(dateStr)
  if (tz === 'PHT') {
    return date.toLocaleString('en-US', { timeZone: 'Asia/Manila', dateStyle: 'short', timeStyle: 'short' })
  }
  return date.toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }) + ' UTC'
}
