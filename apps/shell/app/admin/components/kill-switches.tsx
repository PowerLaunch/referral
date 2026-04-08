'use client'

import { useState } from 'react'
import { toggleCashoutsPaused, toggleReferralConfirmationsPaused } from '../actions'

interface KillSwitchesProps {
  cashoutsPaused: boolean
  referralConfirmationsPaused: boolean
}

export function KillSwitches({
  cashoutsPaused: initialCashoutsPaused,
  referralConfirmationsPaused: initialRefPaused,
}: KillSwitchesProps) {
  const [cashoutsPaused, setCashoutsPaused] = useState(initialCashoutsPaused)
  const [refPaused, setRefPaused] = useState(initialRefPaused)
  const [loading, setLoading] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<string | null>(null)

  async function handleToggleCashouts() {
    setLoading('cashouts')
    try {
      const result = await toggleCashoutsPaused()
      setCashoutsPaused(result.paused)
    } catch {
      // Silently fail — admin can retry
    } finally {
      setLoading(null)
      setConfirmAction(null)
    }
  }

  async function handleToggleRef() {
    setLoading('ref')
    try {
      const result = await toggleReferralConfirmationsPaused()
      setRefPaused(result.paused)
    } catch {
      // Silently fail — admin can retry
    } finally {
      setLoading(null)
      setConfirmAction(null)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Kill Switches</h2>
      <div className="flex flex-wrap gap-4">
        {/* Cashouts Kill Switch */}
        {confirmAction === 'cashouts' ? (
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {cashoutsPaused ? 'Resume all payouts?' : 'Pause ALL payouts?'}
            </span>
            <button
              onClick={handleToggleCashouts}
              disabled={loading === 'cashouts'}
              className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground"
            >
              {loading === 'cashouts' ? 'Saving...' : 'Confirm'}
            </button>
            <button
              onClick={() => setConfirmAction(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmAction('cashouts')}
            className={`rounded-md px-4 py-2 text-sm font-bold ${
              cashoutsPaused
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            {cashoutsPaused ? 'RESUME PAYOUTS' : 'PAUSE ALL PAYOUTS'}
          </button>
        )}

        {/* Referral Confirmations Kill Switch */}
        {confirmAction === 'ref' ? (
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {refPaused ? 'Resume confirmations?' : 'Pause ALL confirmations?'}
            </span>
            <button
              onClick={handleToggleRef}
              disabled={loading === 'ref'}
              className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground"
            >
              {loading === 'ref' ? 'Saving...' : 'Confirm'}
            </button>
            <button
              onClick={() => setConfirmAction(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmAction('ref')}
            className={`rounded-md px-4 py-2 text-sm font-bold ${
              refPaused
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            {refPaused ? 'RESUME REFERRAL CONFIRMATIONS' : 'PAUSE ALL REFERRAL CONFIRMATIONS'}
          </button>
        )}
      </div>
    </div>
  )
}
