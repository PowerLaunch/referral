// Game-to-backend communication via API routes only.
// Never import packages/api directly.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function POST(request: Request): Promise<Response> {
  try {
    // Step 1 — Authenticate
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json(
        { ok: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Step 2 — Parse body
    const body = (await request.json()) as { activity?: boolean }
    const { activity } = body

    if (typeof activity !== 'boolean') {
      return Response.json(
        { ok: false, error: 'Invalid body' },
        { status: 400 }
      )
    }

    // Step 3 — Check subscription
    const adminClient = createAdminClient()
    const { data: subscription, error: subError } = await adminClient
      .from('subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .single()

    if (subError || !subscription) {
      return Response.json(
        { ok: false, error: 'No active subscription' },
        { status: 403 }
      )
    }

    // Step 4 — Call RPC (rate limit check is now inside the RPC)
    const rpcName = activity ? 'increment_gameplay_minute' : 'ping_gameplay'
    const { data, error } = await adminClient.rpc(rpcName, {
      p_user_id: user.id,
    })

    if (error) {
      throw error
    }

    // RPC returns jsonb: { ok: boolean, total_minutes: number, error?: string }
    const result = data as { ok: boolean; total_minutes: number; error?: string }

    if (!result.ok && result.error === 'Too soon') {
      return Response.json(
        { ok: false, error: 'Too soon', total_minutes: result.total_minutes },
        { status: 429 }
      )
    }

    // Step 5 — Return total_minutes
    return Response.json({ ok: true, total_minutes: result.total_minutes })
  } catch (error) {
    console.error('Heartbeat error:', error)
    return Response.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    )
  }
}
