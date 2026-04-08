'use client'

import { useState } from 'react'
import { submitDispute } from '@/app/dashboard/actions'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function DisputePage() {
  const [selectedReferral, setSelectedReferral] = useState<string>('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setResult(null)

    const response = await submitDispute({
      referralId: selectedReferral || null,
      description,
    })

    setResult(response)
    if (response.success) {
      setDescription('')
      setSelectedReferral('')
    }
    setSubmitting(false)
  }

  if (result?.success) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <h2 className="text-lg font-semibold text-green-800">Dispute Submitted</h2>
          <p className="mt-2 text-sm text-green-700">
            Your dispute has been submitted. We aim to respond within 72 hours.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="mb-4 text-xl font-semibold">Submit a Dispute</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          If you believe a referral was incorrectly rejected or you have an issue
          with your account, describe the problem below.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Optional referral selector */}
          <div>
            <label htmlFor="referral-select" className="mb-2 block text-sm font-medium">
              Affected Referral (optional)
            </label>
            <input
              id="referral-select"
              type="text"
              value={selectedReferral}
              onChange={(e) => setSelectedReferral(e.target.value)}
              placeholder="Paste referral ID if applicable"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="mb-2 block text-sm font-medium">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              minLength={20}
              maxLength={1000}
              rows={5}
              required
              placeholder="Describe the issue in detail (at least 20 characters)..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {description.length}/1000 characters
            </p>
          </div>

          {/* Error message */}
          {result?.error && (
            <p className="text-sm text-red-600">{result.error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || description.length < 20}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Dispute'}
          </button>
        </form>
      </div>
    </div>
  )
}
