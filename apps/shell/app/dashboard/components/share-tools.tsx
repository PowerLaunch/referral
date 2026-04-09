'use client'

import { useState } from 'react'
import { Copy, Check, MessageCircle, Send } from 'lucide-react'

interface ShareToolsProps {
  referralCode: string
  appUrl: string
  signupBonusAmount: number
  signupBonusLabel: string
}

export function ShareTools({
  referralCode,
  appUrl,
  signupBonusAmount,
  signupBonusLabel,
}: ShareToolsProps) {
  const [copied, setCopied] = useState(false)
  const referralLink = `${appUrl}/ref/${referralCode}`

  const message =
    signupBonusAmount > 0
      ? `Join me on Tusok-Tusok Tycoon! Use my link to get ${signupBonusAmount} free ${signupBonusLabel} when you sign up: ${referralLink}`
      : `Join me on Tusok-Tusok Tycoon! Sign up with my link: ${referralLink}`

  // Telegram auto-appends the url param, so exclude the link from text
  const telegramMessage =
    signupBonusAmount > 0
      ? `Join me on Tusok-Tusok Tycoon! Use my link to get ${signupBonusAmount} free ${signupBonusLabel} when you sign up!`
      : `Join me on Tusok-Tusok Tycoon! Sign up with my link!`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text in a temp input
      const input = document.createElement('input')
      input.value = referralLink
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(telegramMessage)}`

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Share Your Link</h2>

      {/* Referral link with copy button */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex-1 overflow-hidden rounded-md border border-input bg-muted/50 px-3 py-2">
          <p className="truncate text-sm font-mono">{referralLink}</p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Share buttons */}
      <div className="flex flex-wrap gap-2">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </a>
        <a
          href={telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <Send className="h-4 w-4" />
          Telegram
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <Copy className="h-4 w-4" />
          Copy for Messenger
        </button>
      </div>
    </div>
  )
}
