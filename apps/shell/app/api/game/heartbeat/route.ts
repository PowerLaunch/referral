// Game-to-backend communication via API routes only.
// Never import packages/api directly.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
    const rpcResult = data as { ok: boolean; total_minutes?: number; error?: string }

    if (!rpcResult.ok) {
      if (rpcResult.error === 'Too soon') {
        return Response.json(
          { ok: false, error: 'Too soon', total_minutes: rpcResult.total_minutes ?? 0 },
          { status: 429 }
        )
      }
      // Any other RPC failure — log and return 500
      console.error('Heartbeat RPC failed:', rpcResult.error)
      return Response.json(
        { ok: false, error: 'Internal error' },
        { status: 500 }
      )
    }

    return Response.json({ ok: true, total_minutes: rpcResult.total_minutes })
  } catch (error) {
    console.error('Heartbeat error:', error)
    return Response.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    )
  }
}
