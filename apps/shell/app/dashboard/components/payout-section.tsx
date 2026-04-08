'use client'

import { useState } from 'react'

interface PayoutMethod {
  id: string
  label: string
  minDollars: number
  feePercent: number
}

const PAYOUT_METHODS: PayoutMethod[] = [
  { id: 'gcash', label: 'GCash', minDollars: 5, feePercent: 1.5 },
  { id: 'gopay', label: 'GoPay', minDollars: 5, feePercent: 1.5 },
  { id: 'ovo', label: 'OVO', minDollars: 5, feePercent: 1.5 },
  { id: 'grabpay', label: 'GrabPay', minDollars: 5, feePercent: 1.5 },
  { id: 'bank_transfer', label: 'Bank Transfer', minDollars: 25, feePercent: 2 },
  { id: 'paypal', label: 'PayPal', minDollars: 15, feePercent: 3.5 },
]

interface PayoutSectionProps {
  cashBalance: number // in cents
  kycVerified: boolean
  userStatus: string
  payoutHold: boolean
}

export function PayoutSection({
  cashBalance,
  kycVerified,
  userStatus,
  payoutHold,
}: PayoutSectionProps) {
  const [selectedMethod, setSelectedMethod] = useState<string>('gcash')
  const [amount, setAmount] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const defaultMethod: PayoutMethod = { id: 'gcash', label: 'GCash', minDollars: 5, feePercent: 1.5 }
  const method = PAYOUT_METHODS.find((m) => m.id === selectedMethod) ?? defaultMethod
  const amountDollars = Number(amount) || 0
  const feeAmount = amountDollars * (method.feePercent / 100)
  const youReceive = amountDollars - feeAmount
  const isValid =
    amountDollars >= method.minDollars && amountDollars * 100 <= cashBalance

  async function handleSubmit() {
    if (!isValid || submitting) return
    setSubmitting(true)
    setMessage(null)

    try {
      const res = await fetch('/api/payout/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(amountDollars * 100),
          method: selectedMethod,
        }),
      })

      if (res.ok) {
        setMessage({ type: 'success', text: 'Payout requested!' })
        setAmount('')
        // Refresh page after short delay to show updated data
        setTimeout(() => window.location.reload(), 1500)
      } else {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        setMessage({ type: 'error', text: data.error || 'Request failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  const payoutBlocked =
    userStatus === 'REVIEW_HOLD' || userStatus === 'FROZEN' || userStatus === 'BANNED' || payoutHold

  if (payoutBlocked) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Request Payout</h2>
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">Cashout-eligible balance</p>
          <p className="text-2xl font-bold">${(cashBalance / 100).toFixed(2)}</p>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Payouts are temporarily unavailable while your account is being verified.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Request Payout</h2>

      {/* Current balance */}
      <div className="mb-4">
        <p className="text-sm text-muted-foreground">Cashout-eligible balance</p>
        <p className="text-2xl font-bold">${(cashBalance / 100).toFixed(2)}</p>
      </div>

      {/* KYC badge */}
      <div className="mb-4">
        {kycVerified ? (
          <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
            KYC Verified
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            Not Verified —{' '}
            <a href="/kyc" className="underline">
              Complete KYC to enable payouts
            </a>
          </span>
        )}
      </div>

      {/* Method selector */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium">Payout Method</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PAYOUT_METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelectedMethod(m.id)}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                selectedMethod === m.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Minimum: ${method.minDollars} | Fee: {method.feePercent}%
        </p>
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label htmlFor="payout-amount" className="mb-2 block text-sm font-medium">
          Amount (USD)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            $
          </span>
          <input
            id="payout-amount"
            type="number"
            min={method.minDollars}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(method.minDollars)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 pl-7 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Fee transparency */}
      {amountDollars > 0 && (
        <div className="mb-4 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span>${amountDollars.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Fee ({method.feePercent}%)
            </span>
            <span>-${feeAmount.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-border pt-1 font-medium">
            <span>You receive</span>
            <span>${youReceive.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Submit button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isValid || submitting}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Request Payout'}
      </button>

      {/* Feedback message */}
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
  )
}
