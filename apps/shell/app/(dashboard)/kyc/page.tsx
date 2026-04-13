import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import KycUploadClient from './kyc-upload-client'

export default async function KycPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Check if already verified
  const { data: profile } = await supabase
    .from('profiles')
    .select('verified_kyc_hash')
    .eq('id', user.id)
    .single()

  if (profile?.verified_kyc_hash) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-4xl text-green-500">&#10003;</div>
          <h2 className="text-xl font-bold">Identity Verified</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your identity has been verified. No further action needed.
          </p>
        </div>
      </div>
    )
  }

  // Check for pending submission
  const { data: pending } = await supabase
    .from('kyc_submissions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'PENDING')
    .limit(1)
    .maybeSingle()

  if (pending) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-4xl text-yellow-500">&#9202;</div>
          <h2 className="text-xl font-bold">Under Review</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your ID is under review. This usually takes up to 72 hours.
          </p>
        </div>
      </div>
    )
  }

  return <KycUploadClient />
}
