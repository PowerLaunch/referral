// Admin access is set manually in DB. No self-service admin creation.
// Returns 404 (not 403) to avoid revealing admin panel existence.

import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { TimezoneToggle } from './components/timezone-toggle'
import { TimezoneProvider } from './components/timezone-context'

const NAV_ITEMS = [
  { href: '/admin', label: 'Pulse' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/cashouts', label: 'Cashouts' },
  { href: '/admin/fraud', label: 'Fraud' },
  { href: '/admin/disputes', label: 'Disputes' },
  { href: '/admin/influencers', label: 'Influencers' },
  { href: '/admin/honeypot', label: 'Honeypot' },
  { href: '/admin/seed', label: 'Seed Users' },
  { href: '/admin/config', label: 'Config' },
  { href: '/admin/audit', label: 'Audit Log' },
]

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    notFound()
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    notFound()
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-border bg-card">
        <div className="border-b border-border p-4">
          <h1 className="text-lg font-bold">Admin Panel</h1>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <nav className="flex-1 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-4">
          <Link
            href="/dashboard"
            className="text-xs text-muted-foreground hover:underline"
          >
            Back to Dashboard
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <TimezoneProvider>
        <main className="flex-1 overflow-auto">
          <header className="flex items-center justify-between border-b border-border px-6 py-3">
            <span className="text-sm text-muted-foreground">Admin Dashboard</span>
            <TimezoneToggle />
          </header>
          <div className="p-6">{children}</div>
        </main>
      </TimezoneProvider>
    </div>
  )
}
