'use server'

// Server actions for game page. These run server-side only.
// Game reads use the cookie-based server client (respects RLS).
// Game writes go through API routes which use the admin client.

import { createClient } from '@/lib/supabase/server'

export async function getGameConfig(): Promise<{ minGameplayMinutes: number }> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('game_config')
      .select('min_gameplay_minutes')
      .limit(1)
      .single()

    if (error || !data) {
      return { minGameplayMinutes: 10 }
    }

    // || not ?? — guards against 0 as well as null/undefined
    return { minGameplayMinutes: data.min_gameplay_minutes || 10 }
  } catch {
    return { minGameplayMinutes: 10 }
  }
}

export async function getGameplayProgress(): Promise<{ totalMinutes: number }> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { totalMinutes: 0 }
    }

    const { data, error } = await supabase
      .from('gameplay_sessions')
      .select('total_minutes')
      .eq('user_id', user.id)
      .single()

    if (error || !data) {
      return { totalMinutes: 0 }
    }

    return { totalMinutes: data.total_minutes ?? 0 }
  } catch {
    return { totalMinutes: 0 }
  }
}

export async function getSubscriptionStatus(): Promise<{ isSubscribed: boolean }> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { isSubscribed: false }
    }

    const { data, error } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .single()

    if (error || !data) {
      return { isSubscribed: false }
    }

    return { isSubscribed: data.status === 'active' }
  } catch {
    return { isSubscribed: false }
  }
}
