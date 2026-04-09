import { requireAdmin } from '../../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ codeId: string }> }
): Promise<Response> {
  const result = await requireAdmin()
  if (result instanceof Response) return result

  const { codeId } = await params

  const admin = createAdminClient()

  const { data: code, error } = await admin
    .from('influencer_codes')
    .select('*')
    .eq('id', codeId)
    .single()

  if (error || !code) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  return Response.json({ code })
}
