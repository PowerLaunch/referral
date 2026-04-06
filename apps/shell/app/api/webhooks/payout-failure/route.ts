// Stub webhook handler for payout failure events from payment provider.
// Full integration built in PR 5-B (feat/offramp).
// This stub ensures handlePayoutFailure is reachable and testable now.

import { NextRequest, NextResponse } from 'next/server'
import { handlePayoutFailure } from '@referral/api/payoutFailure'

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Verify stub secret (real provider HMAC validation added in PR 5-B)
  const secret = request.headers.get('x-webhook-secret')
  if (!secret || secret !== process.env.PAYOUT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { payoutId, errorCode, isTransient } = await request.json() as {
      payoutId: string
      errorCode: string
      isTransient: boolean
    }

    if (!payoutId || !errorCode) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    await handlePayoutFailure(payoutId, errorCode, isTransient ?? false)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Payout failure webhook error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
