import { SignOutButton } from '@/components/sign-out-button'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-4">Welcome, {user?.email}</p>
      <div className="mt-8">
        <SignOutButton />
      </div>
    </div>
  )
}
