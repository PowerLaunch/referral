// Stub webhook for subscription lifecycle events.
// In PR 5-A, this will be replaced by the real Transak/MoonPay webhook
// with proper signature validation. For now, it accepts a simple JSON body
// for testing the freeze/unfreeze flow.

// TODO PR 5-A: Add payment method diversity flag — if 3+ of a referrer's referees pay from same card (brand + last 4) or same e-wallet, insert CRITICAL fraud_flag (R_PAYMENT_CLUSTER)
// TODO PR 5-A: Add email domain clustering — if 5+ referees share same non-whitelisted email domain, flag referrer. Whitelist: gmail.com, yahoo.com, outlook.com, hotmail.com, icloud.com, protonmail.com, proton.me
// TODO PR 5-A: Add email plus-addressing normalization — strip everything between + and @ before storing/comparing emails (e.g., user+ref1@gmail.com → user@gmail.com). Apply at signup and in email clustering checks.

import {
  freezeReferralsForUser,
  unfreezeReferralsForUser,
} from '@referral/api/maturityCheckpoint'
import { safeCompare } from '@/lib/crypto'

export async function POST(request: Request): Promise<Response> {
  try {
    // TODO PR 5-A: Replace with real provider HMAC signature validation.
    // For now, use a simple shared secret for internal testing.
    const secret = request.headers.get('x-webhook-secret')
    const expectedSecret = process.env.SUBSCRIPTION_WEBHOOK_SECRET

    if (!expectedSecret) {
      console.error('SUBSCRIPTION_WEBHOOK_SECRET not configured')
      return Response.json(
        { ok: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    if (!secret || !safeCompare(secret, expectedSecret)) {
      console.error('Unauthorized webhook attempt')
      return Response.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Parse body
    const body = (await request.json()) as { event: string; userId: string }

    // Validate event and userId are strings
    if (typeof body.event !== 'string' || typeof body.userId !== 'string') {
      return Response.json(
        { ok: false, error: 'Invalid request body: event and userId must be strings' },
        { status: 400 }
      )
    }

    // Route event
    switch (body.event) {
      case 'cancelled':
      case 'past_due': {
        const freezeResult = await freezeReferralsForUser(
          body.userId,
          `Subscription ${body.event}`
        )
        return Response.json({ ok: true, ...freezeResult })
      }

      case 'reactivated': {
        const unfreezeResult = await unfreezeReferralsForUser(body.userId)
        return Response.json({ ok: true, ...unfreezeResult })
      }

      default:
        return Response.json({ ok: true, event: 'ignored' })
    }
  } catch (error) {
    console.error('Subscription webhook error:', error)
    return Response.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    )
  }
}
