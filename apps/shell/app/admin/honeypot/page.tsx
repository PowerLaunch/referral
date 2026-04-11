import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import HoneypotClient from './honeypot-client'

export default async function AdminHoneypotPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) notFound()

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) notFound()

  return <HoneypotClient />
}
