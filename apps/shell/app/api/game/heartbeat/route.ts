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

    // Step 4 — Rate limit check
    const { data: session } = await adminClient
      .from('gameplay_sessions')
      .select('last_heartbeat_at')
      .eq('user_id', user.id)
      .single()

    if (session && session.last_heartbeat_at) {
      const lastHeartbeat = new Date(session.last_heartbeat_at)
      const now = new Date()
      const secondsSinceLastHeartbeat =
        (now.getTime() - lastHeartbeat.getTime()) / 1000

      if (secondsSinceLastHeartbeat < 55) {
        return Response.json({ ok: false, error: 'Too soon' }, { status: 429 })
      }
    }

    // Step 5 — UPSERT gameplay session using RPC functions
    let totalMinutes = 0

    if (activity) {
      const { data, error } = await adminClient.rpc('increment_gameplay_minute', {
        p_user_id: user.id,
      })

      if (error) {
        throw error
      }

      totalMinutes = data ?? 0
    } else {
      const { data, error } = await adminClient.rpc('ping_gameplay', {
        p_user_id: user.id,
      })

      if (error) {
        throw error
      }

      totalMinutes = data ?? 0
    }

    // Step 6 — Return total_minutes
    return Response.json({ ok: true, total_minutes: totalMinutes })
  } catch (error) {
    console.error('Heartbeat error:', error)
    return Response.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    )
  }
}
