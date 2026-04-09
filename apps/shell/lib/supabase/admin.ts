import { createClient } from '@supabase/supabase-js'

// SECURITY: This file creates a service_role client that bypasses RLS.
// Only import in: API routes (app/api/**), admin server actions, packages/api.
// Never import in client components or non-server files.

export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables for admin client')
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
