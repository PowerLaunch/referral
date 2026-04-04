// Stub webhook for subscription lifecycle events.
// In PR 5-A, this will be replaced by the real Transak/MoonPay webhook
// with proper signature validation. For now, it accepts a simple JSON body
// for testing the freeze/unfreeze flow.

import {
  freezeReferralsForUser,
  unfreezeReferralsForUser,
} from '@referral/api/maturityCheckpoint'

export async function POST(request: Request): Promise<Response> {
  try {
    // TODO PR 5-A: Validate webhook signature (HMAC-SHA256) from payment provider.
    // For now, this endpoint accepts any POST. Do NOT deploy this to production
    // without signature validation.
    const signature = request.headers.get('x-webhook-signature')
    if (!signature) {
      console.warn('Webhook received without signature — stub mode, proceeding')
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
