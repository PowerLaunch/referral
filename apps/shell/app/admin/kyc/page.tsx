import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import KycClient from './kyc-client'

export default async function AdminKycPage() {
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

  return <KycClient />
}
