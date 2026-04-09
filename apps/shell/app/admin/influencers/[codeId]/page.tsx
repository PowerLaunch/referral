import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import EditInfluencerClient from './edit-influencer-client'

export default async function AdminEditInfluencerPage({
  params,
}: {
  params: Promise<{ codeId: string }>
}) {
  const { codeId } = await params

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

  return <EditInfluencerClient codeId={codeId} />
}
