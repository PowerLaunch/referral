import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png'])

export async function POST(request: Request): Promise<Response> {
  // Auth check
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  // Check if already verified
  const { data: profile } = await adminClient
    .from('profiles')
    .select('verified_kyc_hash')
    .eq('id', user.id)
    .single()

  if (profile?.verified_kyc_hash) {
    return Response.json({ error: 'Already verified' }, { status: 400 })
  }

  // Check for existing pending submission
  const { data: existing } = await adminClient
    .from('kyc_submissions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'PENDING')
    .limit(1)
    .maybeSingle()

  if (existing) {
    return Response.json({ error: 'Submission already pending' }, { status: 400 })
  }

  // Parse multipart form data
  const formData = await request.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof File)) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: 'Only JPEG and PNG images are accepted' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: 'File must be under 5MB' }, { status: 400 })
  }

  // Generate submission ID first for storage path
  const submissionId = crypto.randomUUID()
  const ext = file.type === 'image/png' ? 'png' : 'jpg'
  const storagePath = `${user.id}/${submissionId}.${ext}`

  // Upload to Supabase Storage
  const fileBuffer = await file.arrayBuffer()
  const { error: uploadError } = await adminClient.storage
    .from('kyc-documents')
    .upload(storagePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    console.error('KYC file upload failed:', uploadError)
    return Response.json({ error: 'File upload failed. Please try again.' }, { status: 500 })
  }

  // Insert submission record
  const { error: insertError } = await adminClient
    .from('kyc_submissions')
    .insert({
      id: submissionId,
      user_id: user.id,
      storage_path: storagePath,
      status: 'PENDING',
    })

  if (insertError) {
    // Cleanup uploaded file on insert failure
    await adminClient.storage.from('kyc-documents').remove([storagePath])

    if (insertError.code === '23505') {
      return Response.json({ error: 'Submission already pending' }, { status: 400 })
    }
    console.error('KYC submission insert failed:', insertError)
    return Response.json({ error: 'Failed to create submission' }, { status: 500 })
  }

  return Response.json({ id: submissionId }, { status: 201 })
}
