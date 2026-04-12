'use client'

import { useState } from 'react'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png']

export default function KycUploadClient() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const selected = e.target.files?.[0]
    if (!selected) return

    if (!ALLOWED_TYPES.includes(selected.type)) {
      setError('Only JPEG and PNG images are accepted.')
      setFile(null)
      return
    }

    if (selected.size > MAX_FILE_SIZE) {
      setError('File must be under 5MB.')
      setFile(null)
      return
    }

    setFile(selected)
  }

  async function handleSubmit() {
    if (!file) return
    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/kyc/upload', {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        setSubmitted(true)
      } else {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? 'Upload failed. Please try again.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-4xl text-green-500">&#10003;</div>
          <h2 className="text-xl font-bold">Submitted</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your ID has been submitted. Review takes up to 72 hours.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-12">
      <div>
        <h1 className="text-2xl font-bold">Verify Your Identity</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload a clear photo of your government-issued ID (passport, national ID, or driver&apos;s license).
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">
            ID Document (JPEG or PNG, max 5MB)
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileChange}
            className="w-full text-sm"
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={() => void handleSubmit()}
          disabled={!file || uploading}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : 'Submit for Review'}
        </button>
      </div>
    </div>
  )
}
