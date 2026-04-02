'use client'

// Game-to-backend communication via API routes only.
// Never import packages/api directly.

import { useState, useEffect } from 'react'

export function DailyPuzzle(): JSX.Element {
  const [solved, setSolved] = useState<boolean>(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Get today's date in YYYY-MM-DD format (local timezone)
  const getToday = (): string => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  useEffect(() => {
    const today = getToday()
    const key = `puzzle-solved-${today}`
    const wasSolved = localStorage.getItem(key) === 'true'
    setSolved(wasSolved)
  }, [])

  const handleChoice = (value: string): void => {
    if (solved) return

    if (value === 'Carrot') {
      setSolved(true)
      setFeedback('Correct! Come back tomorrow for a new puzzle.')
      const today = getToday()
      localStorage.setItem(`puzzle-solved-${today}`, 'true')
    } else {
      setFeedback('Not quite — try again.')
    }
  }

  const options = ['Apple', 'Banana', 'Carrot', 'Mango']

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => handleChoice(option)}
            disabled={solved}
            className={`rounded-lg border p-4 text-lg font-medium transition-colors ${
              solved
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {feedback && (
        <div className="rounded-md bg-muted p-3 text-center text-sm">
          {feedback}
        </div>
      )}

      {solved && (
        <div className="flex items-center justify-center gap-2 text-green-600">
          <span className="text-xl">✓</span>
          <span className="font-medium">Completed</span>
        </div>
      )}
    </div>
  )
}
