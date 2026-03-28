'use client'

import { signoutAction } from '@/app/(auth)/signout/actions'

export function SignOutButton() {
  return (
    <button
      onClick={() => signoutAction()}
      className="rounded-md bg-red-600 px-4 py-2 text-white hover:bg-red-700"
    >
      Sign out
    </button>
  )
}
