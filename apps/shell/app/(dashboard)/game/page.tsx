import Link from 'next/link'
import { DailyPuzzle } from './daily-puzzle'
import { GameplayTracker } from './gameplay-tracker'
import {
  getSubscriptionStatus,
  getGameConfig,
  getGameplayProgress,
} from './actions'

export default async function GamePage() {
  // Fetch all data in parallel
  const [{ isSubscribed }, { minGameplayMinutes }, { totalMinutes }] =
    await Promise.all([
      getSubscriptionStatus(),
      getGameConfig(),
      getGameplayProgress(),
    ])

  // Show subscription gate if not subscribed
  if (!isSubscribed) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="max-w-md space-y-6 p-8 text-center">
          <h1 className="text-4xl font-bold text-white">Subscribe to Play</h1>
          <p className="text-lg text-gray-300">
            Get access to daily puzzles and earn referral rewards
          </p>
          <Link
            href="/subscribe"
            className="inline-block rounded-lg bg-blue-600 px-8 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Subscribe Now
          </Link>
        </div>
      </div>
    )
  }

  // Render game content for subscribed users
  return (
    <div className="mx-auto max-w-[480px] space-y-8 px-4 py-8">
      {/* Title section */}
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Daily Puzzle</h1>
        <p className="text-muted-foreground">Which one does not belong?</p>
      </div>

      {/* Puzzle area */}
      <DailyPuzzle />

      {/* Progress tracker */}
      <GameplayTracker
        initialMinutes={totalMinutes}
        targetMinutes={minGameplayMinutes}
      />
    </div>
  )
}
