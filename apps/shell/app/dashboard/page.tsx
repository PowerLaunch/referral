import { SignOutButton } from '@/components/sign-out-button'
import { createClient } from '@/lib/supabase/server'
import { getObfuscatedRefereeEmails } from './actions'
import { MetricsBar } from './components/metrics-bar'
import { EarningsStepper } from './components/earnings-stepper'
import { ReferralTable } from './components/referral-table'
import { PayoutSection } from './components/payout-section'
import { PayoutHistory } from './components/payout-history'
import { ShareTools } from './components/share-tools'
import { DisputesSection } from './components/disputes-section'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="p-8">
        <p>Please log in to view your dashboard.</p>
      </div>
    )
  }

  // Fetch all dashboard data in parallel
  const [
    profileResult,
    referralsResult,
    creditsResult,
    payoutsResult,
    gameConfigResult,
    disputesResult,
    creditTxResult,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('referral_code, trust_level, status, verified_kyc_hash, payout_hold')
      .eq('id', user.id)
      .single(),
    supabase
      .from('referrals')
      .select('id, referee_id, status, payout_eligible_at, lock_timer_frozen, created_at')
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('user_credits')
      .select('amount, type')
      .eq('user_id', user.id),
    supabase
      .from('payouts')
      .select('id, amount, method, status, provider_error_code, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('game_config')
      .select('signup_bonus_amount, signup_bonus_label')
      .limit(1)
      .single(),
    supabase
      .from('disputes')
      .select('id, status, created_at, resolved_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('credit_transactions')
      .select('amount, type')
      .eq('user_id', user.id)
      .eq('type', 'CASH_BALANCE')
      .gt('amount', 0),
  ])

  const profile = profileResult.data
  const referrals = referralsResult.data ?? []
  const credits = creditsResult.data ?? []
  const payouts = payoutsResult.data ?? []
  const gameConfig = gameConfigResult.data
  const disputes = disputesResult.data ?? []
  const creditTx = creditTxResult.data ?? []

  // Compute metrics
  const cashBalance =
    credits.find((c) => c.type === 'CASH_BALANCE')?.amount ?? 0
  // Total earned = sum of all positive CASH_BALANCE credit_transactions (actual earnings)
  const totalEarned = creditTx.reduce((sum, tx) => sum + tx.amount, 0)
  const confirmedReferrals = referrals.filter((r) => r.status === 'CONFIRMED').length
  const pendingReferrals = referrals.filter((r) => r.status === 'PENDING')
  const totalReferrals = referrals.length

  // Count referrals with active subscriber referees
  // We can't join subscriptions from cookie client across users (RLS),
  // so we use referral count as a proxy for "subscribed" in the stepper.
  // The subscription count would need admin client — acceptable trade-off for MVP.
  const subscribedReferrals = referrals.filter(
    (r) => r.status === 'CONFIRMED' || r.status === 'PENDING'
  ).length
  const activeRecurring = confirmedReferrals

  // Fetch obfuscated referee emails
  const refereeIds = referrals.map((r) => r.referee_id)
  const refereeEmails = await getObfuscatedRefereeEmails(refereeIds)

  const userStatus = profile?.status ?? 'ACTIVE'
  const kycVerified = !!profile?.verified_kyc_hash
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome, {user.email}</p>
        </div>
        <SignOutButton />
      </div>

      {/* Share Tools */}
      <ShareTools
        referralCode={profile?.referral_code ?? ''}
        appUrl={appUrl}
        signupBonusAmount={gameConfig?.signup_bonus_amount ?? 0}
        signupBonusLabel={gameConfig?.signup_bonus_label ?? 'credits'}
      />

      {/* Metrics Bar */}
      <MetricsBar
        totalEarned={totalEarned}
        pendingRewards={cashBalance}
        totalReferrals={totalReferrals}
        confirmedReferrals={confirmedReferrals}
        activeRecurring={activeRecurring}
      />

      {/* Earnings Stepper */}
      <EarningsStepper
        totalReferrals={totalReferrals}
        subscribedReferrals={subscribedReferrals}
        pendingReferrals={pendingReferrals}
        confirmedReferrals={confirmedReferrals}
      />

      {/* Referral Table */}
      <ReferralTable referrals={referrals} refereeEmails={refereeEmails} />

      {/* Payout Section + History */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PayoutSection
          cashBalance={cashBalance}
          kycVerified={kycVerified}
          userStatus={userStatus}
        />
        <PayoutHistory payouts={payouts} userStatus={userStatus} />
      </div>

      {/* Disputes */}
      <DisputesSection disputes={disputes} />
    </div>
  )
}
