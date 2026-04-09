import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import DisputeDetailClient from './dispute-detail-client'

export default async function AdminDisputeDetailPage({
  params,
}: {
  params: Promise<{ disputeId: string }>
}) {
  const { disputeId } = await params

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

  return <DisputeDetailClient disputeId={disputeId} />
}
