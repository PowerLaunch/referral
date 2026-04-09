import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import UserDetailClient from './user-detail-client'

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params

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

  return <UserDetailClient userId={userId} />
}
