import Link from 'next/link'
import { ReferralCalculator } from '@/app/components/referral-calculator'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-background font-sans">
      <main className="flex w-full max-w-3xl flex-col items-center gap-12 px-4 py-16 sm:px-8 sm:py-24">
        {/* Hero */}
        <div className="flex flex-col items-center gap-6 text-center">
          <h1 className="max-w-lg text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Earn Money by Inviting Friends
          </h1>
          <p className="max-w-md text-lg leading-8 text-muted-foreground">
            Refer friends to Tusok-Tusok Tycoon and earn real cash rewards.
            $2 per referral plus $1/month recurring.
          </p>
          <div className="flex gap-4">
            <Link
              href="/signup"
              className="flex h-12 items-center justify-center rounded-full bg-primary px-6 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get Started
            </Link>
            <Link
              href="/login"
              className="flex h-12 items-center justify-center rounded-full border border-border px-6 font-medium transition-colors hover:bg-muted"
            >
              Sign In
            </Link>
          </div>
        </div>

        {/* How It Works */}
        <div className="w-full">
          <h2 className="mb-6 text-center text-2xl font-bold">How It Works</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-6 text-center">
              <div className="mb-3 text-3xl font-bold text-primary">1</div>
              <h3 className="mb-1 font-semibold">Share Your Link</h3>
              <p className="text-sm text-muted-foreground">
                Get your unique referral link and share it with friends.
              </p>
            </div>
            <div className="rounded-lg border border-border p-6 text-center">
              <div className="mb-3 text-3xl font-bold text-primary">2</div>
              <h3 className="mb-1 font-semibold">Friends Subscribe</h3>
              <p className="text-sm text-muted-foreground">
                When your friends sign up and subscribe, your referral activates.
              </p>
            </div>
            <div className="rounded-lg border border-border p-6 text-center">
              <div className="mb-3 text-3xl font-bold text-primary">3</div>
              <h3 className="mb-1 font-semibold">Earn Cash</h3>
              <p className="text-sm text-muted-foreground">
                Receive $2 per referral plus $1/month recurring rewards.
              </p>
            </div>
          </div>
        </div>

        {/* Calculator */}
        <ReferralCalculator />
      </main>
    </div>
  )
}
