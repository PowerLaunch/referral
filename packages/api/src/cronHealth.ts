import type { SupabaseClient } from '@supabase/supabase-js'

export async function recordCronSuccess(cronName: string, adminClient: SupabaseClient) {
  try {
    await adminClient.from('cron_health').upsert(
      { cron_name: cronName, last_success_at: new Date().toISOString() },
      { onConflict: 'cron_name' }
    )
  } catch { /* cron_health table may not exist yet */ }
  if (process.env.BETTERSTACK_HEARTBEAT_URL) {
    await fetch(process.env.BETTERSTACK_HEARTBEAT_URL).catch(() => {})
  }
}
