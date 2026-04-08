import { createClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'

/**
 * Shared admin auth check for admin API routes.
 * Creates cookie-based server client, verifies session, checks is_admin.
 * @returns { admin: User } on success, or a 404 Response on failure.
 */
export async function requireAdmin(): Promise<{ admin: User } | Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  return { admin: user }
}
