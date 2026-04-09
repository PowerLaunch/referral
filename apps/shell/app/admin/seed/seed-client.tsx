'use client'

import { useEffect, useState, useCallback } from 'react'
import { createSeedUser, deleteSeedUser } from '../actions'

interface SeedUserRow {
  id: string
  profile_id: string
  notes: string | null
  created_at: string
  profile: {
    email: string
    referral_code: string
  }
  subscription_status: string | null
}

function generatePassword(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => chars[byte % chars.length]).join('')
}

export default function SeedUsersClient() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(generatePassword())
  const [referrerCode, setReferrerCode] = useState('')
  const [subscriptionActive, setSubscriptionActive] = useState(true)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [seedUsers, setSeedUsers] = useState<SeedUserRow[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const fetchSeedUsers = useCallback(async () => {
    setLoadingUsers(true)
    try {
      const res = await fetch('/api/admin/seed-users')
      if (res.ok) {
        const data = (await res.json()) as { users: SeedUserRow[] }
        setSeedUsers(data.users)
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  useEffect(() => {
    void fetchSeedUsers()
  }, [fetchSeedUsers])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)

    try {
      const result = await createSeedUser({
        email,
        password,
        referrerCode,
        subscriptionActive,
        notes,
      })

      if (result.ok) {
        setMessage({ type: 'success', text: `Seed user created: ${email}` })
        setEmail('')
        setPassword(generatePassword())
        setReferrerCode('')
        setNotes('')
        void fetchSeedUsers()
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Failed to create seed user' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(profileId: string) {
    try {
      const result = await deleteSeedUser(profileId)
      if (result.ok) {
        setSeedUsers((prev) => prev.filter((u) => u.profile_id !== profileId))
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Failed to delete' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Delete failed' })
    } finally {
      setConfirmDelete(null)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Seed Users</h1>

      {/* Create Form */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Create Seed User</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Password *</label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Referrer Code (optional)</label>
              <input
                type="text"
                value={referrerCode}
                onChange={(e) => setReferrerCode(e.target.value)}
                placeholder="e.g. ABC123"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Subscription</label>
              <select
                value={subscriptionActive ? 'active' : 'inactive'}
                onChange={(e) => setSubscriptionActive(e.target.value === 'active')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. test referral chain"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Seed User'}
          </button>
        </form>

        {message && (
          <p
            className={`mt-3 text-sm ${
              message.type === 'success' ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {message.text}
          </p>
        )}
      </div>

      {/* Seed Users List */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Existing Seed Users</h2>
        {loadingUsers ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : seedUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No seed users created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Email</th>
                  <th className="pb-3 pr-4 font-medium">Referral Code</th>
                  <th className="pb-3 pr-4 font-medium">Sub Status</th>
                  <th className="pb-3 pr-4 font-medium">Notes</th>
                  <th className="pb-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {seedUsers.map((u) => (
                  <tr key={u.id} className="border-b border-border/50 last:border-0">
                    <td className="py-3 pr-4">{u.profile?.email ?? '—'}</td>
                    <td className="py-3 pr-4 font-mono text-xs">
                      {u.profile?.referral_code ?? '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={
                          u.subscription_status === 'active'
                            ? 'text-green-600'
                            : 'text-muted-foreground'
                        }
                      >
                        {u.subscription_status ?? 'none'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {u.notes ?? '—'}
                    </td>
                    <td className="py-3">
                      {confirmDelete === u.profile_id ? (
                        <span className="flex items-center gap-2">
                          <button
                            onClick={() => handleDelete(u.profile_id)}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(u.profile_id)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
