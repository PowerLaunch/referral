'use client'

import { useState } from 'react'

export function ReferralCalculator() {
  const [referrals, setReferrals] = useState(5)

  const oneTime = referrals * 2
  const recurringCapped = Math.min(referrals, 15)
  const recurring = recurringCapped * 1

  return (
    <div className="w-full rounded-lg border border-border bg-card p-6">
      <h3 className="mb-4 text-lg font-semibold">Earnings Calculator</h3>

      <div className="mb-4">
        <label htmlFor="referral-slider" className="mb-2 block text-sm font-medium">
          How many friends will you refer?
        </label>
        <input
          id="referral-slider"
          type="range"
          min={1}
          max={50}
          value={referrals}
          onChange={(e) => setReferrals(Number(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>1</span>
          <span className="text-base font-bold text-foreground">{referrals}</span>
          <span>50</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-md bg-muted/50 p-4">
        <div className="text-center">
          <p className="text-2xl font-bold">${oneTime}</p>
          <p className="text-sm text-muted-foreground">One-time bonus</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold">${recurring}/mo</p>
          <p className="text-sm text-muted-foreground">Recurring monthly</p>
          {referrals > 15 && (
            <p className="mt-1 text-xs text-muted-foreground">Recurring capped at $15/mo</p>
          )}
        </div>
      </div>

      {/* Mandatory regulatory disclaimer */}
      <p className="mt-4 text-sm text-muted-foreground" style={{ fontSize: '14px' }}>
        Referral bonuses are not guaranteed income. Payouts require successful
        subscription and lock period completion. See Terms of Service for full details.
      </p>
    </div>
  )
}
