// Daily cron: deletes KYC document images 7 days after approval.
// HMAC hash in profiles.verified_kyc_hash is NEVER deleted — permanent Sybil prevention.
// Runs at 04:00 UTC via Vercel Cron.

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordCronSuccess } from '@referral/api/cronHealth'
import * as Sentry from '@sentry/nextjs'

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const authHeader = request.headers.get('authorization')
    const expectedSecret = process.env.CRON_SECRET

    if (!expectedSecret) {
      console.error('CRON_SECRET not configured')
      return Response.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
    }

    if (authHeader !== `Bearer ${expectedSecret}`) {
      console.error('Unauthorized cron attempt')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Find approved submissions with stored files where approval was 7+ days ago.
    // Uses reviewed_at (approval date), not created_at (submission date), so documents
    // that sat in PENDING for a while don't get purged immediately on approval.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: submissions, error: fetchErr } = await adminClient
      .from('kyc_submissions')
      .select('id, storage_path')
      .eq('status', 'APPROVED')
      .not('storage_path', 'is', null)
      .lt('reviewed_at', sevenDaysAgo)
      .limit(500)

    if (fetchErr) {
      console.error('KYC cleanup fetch failed:', fetchErr)
      return Response.json({ error: 'Failed to fetch submissions' }, { status: 500 })
    }

    let cleaned = 0
    let errors = 0

    for (const sub of submissions ?? []) {
      const path = sub.storage_path as string
      if (!path) continue

      // Delete file from storage
      const { error: deleteErr } = await adminClient.storage
        .from('kyc-documents')
        .remove([path])

      if (deleteErr) {
        console.error(`Failed to delete KYC file ${path}:`, deleteErr)
        errors++
        continue
      }

      // Clear storage_path on the record
      const { error: updateErr } = await adminClient
        .from('kyc_submissions')
        .update({ storage_path: null })
        .eq('id', sub.id)

      if (updateErr) {
        console.error(`Failed to clear storage_path for ${sub.id}:`, updateErr)
        errors++
        continue
      }

      cleaned++
    }

    await recordCronSuccess('kyc-cleanup', adminClient, process.env.BETTERSTACK_HEARTBEAT_KYC_CLEANUP)

    return Response.json({ cleaned, errors })
  } catch (error) {
    console.error('KYC cleanup cron error:', error)
    Sentry.captureException(error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
