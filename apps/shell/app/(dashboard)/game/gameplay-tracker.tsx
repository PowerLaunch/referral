'use client'

// Game-to-backend communication via API routes only.
// Never import packages/api directly.

import { useState, useEffect, useRef } from 'react'

interface GameplayTrackerProps {
  initialMinutes: number
  targetMinutes: number
}

export function GameplayTracker({
  initialMinutes,
  targetMinutes,
}: GameplayTrackerProps): JSX.Element {
  const [minutes, setMinutes] = useState<number>(initialMinutes)
  const activityDetected = useRef<boolean>(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Activity tracking handlers
    const handleActivity = (): void => {
      activityDetected.current = true
    }

    // Add event listeners
    document.addEventListener('mousemove', handleActivity)
    document.addEventListener('touchstart', handleActivity)

    // Heartbeat interval - every 60 seconds
    intervalRef.current = setInterval(async () => {
      const activity = activityDetected.current
      activityDetected.current = false // Reset BEFORE the fetch

      try {
        const response = await fetch('/api/game/heartbeat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ activity }),
        })

        if (response.ok) {
          const data = (await response.json()) as {
            ok: boolean
            total_minutes?: number
          }
          if (data.ok && typeof data.total_minutes === 'number') {
            setMinutes(data.total_minutes)
          }
        }
      } catch {
        // Silently ignore errors
      }
    }, 60_000)

    // Cleanup
    return () => {
      document.removeEventListener('mousemove', handleActivity)
      document.removeEventListener('touchstart', handleActivity)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  const progress = Math.min(100, (minutes / targetMinutes) * 100)
  const isComplete = minutes >= targetMinutes

  return (
    <div className="space-y-2">
      <div className="w-full overflow-hidden rounded-full bg-muted h-3">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-sm text-center text-muted-foreground">
        {isComplete ? (
          <span className="font-medium text-green-600">
            ✓ Gameplay requirement met!
          </span>
        ) : (
          <span>
            {minutes} / {targetMinutes} minutes of active play
          </span>
        )}
      </div>
    </div>
  )
}
