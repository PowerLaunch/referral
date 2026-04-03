// Email infrastructure using Resend
// Trigger functions are called by referral engine (Phase 3), payout system (Phase 3-D/5-B), and fraud middleware (Phase 4-D).

import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

// Update this domain before launch
const FROM_EMAIL = 'noreply@yourdomain.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yourdomain.com'

/**
 * Escape HTML to prevent injection attacks
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Service role client — server-side only, never expose to client
function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables for admin client')
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Send an email using Resend
 * Never throws — returns success/error object instead
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured')
      return { success: false, error: 'RESEND_API_KEY not configured' }
    }

    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: htmlBody,
    })

    if (error) {
      console.error('Resend API error:', error.message)
      return { success: false, error: error.message }
    }

    if (!data) {
      console.error('Resend API returned no data')
      return { success: false, error: 'No data returned from Resend' }
    }

    return { success: true }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    console.error('Email send failed:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Obfuscate email for privacy
 * "john@example.com" → "j***@example.com"
 */
export function obfuscateEmail(email: string): string {
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) {
    // Invalid email, return as-is
    return email
  }

  const localPart = email.slice(0, atIndex)
  const domain = email.slice(atIndex)

  // Take first character, replace rest with ***
  const obfuscated = localPart[0] + '***'
  return obfuscated + domain
}

// ============================================================================
// Email Templates
// ============================================================================

/**
 * E1: Referee Signed Up
 */
export function templateE1(obfuscatedEmail: string): {
  subject: string
  html: string
} {
  const subject = 'Someone just used your referral link!'

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px 20px;">
    <h1 style="color: #333333; font-size: 24px; margin: 0 0 20px 0;">Great news!</h1>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
      Someone just signed up using your referral link: <strong>${obfuscatedEmail}</strong>
    </p>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
      They need to subscribe and complete the gameplay requirement before your referral is confirmed.
      We'll notify you when your $2 payout is ready.
    </p>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
      Keep sharing your link to earn more!
    </p>

    <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;">

    <p style="color: #999999; font-size: 12px; line-height: 1.4; margin: 0;">
      <a href="${APP_URL}/dashboard/settings" style="color: #999999; text-decoration: underline;">Unsubscribe from these notifications</a>
    </p>
  </div>
</body>
</html>
  `.trim()

  return { subject, html }
}

/**
 * E2: Referral Confirmed
 */
export function templateE2(): { subject: string; html: string } {
  const subject = 'Your referral is confirmed — payout ready!'

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px 20px;">
    <h1 style="color: #333333; font-size: 24px; margin: 0 0 20px 0;">Congratulations!</h1>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
      Your referral has been confirmed! <strong>$2 has been added to your cashout balance.</strong>
    </p>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
      Log in to your dashboard to request a payout anytime.
    </p>

    <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;">

    <p style="color: #999999; font-size: 12px; line-height: 1.4; margin: 0;">
      <a href="${APP_URL}/dashboard/settings" style="color: #999999; text-decoration: underline;">Unsubscribe from these notifications</a>
    </p>
  </div>
</body>
</html>
  `.trim()

  return { subject, html }
}

/**
 * E3: Payout Sent
 */
export function templateE3(
  amount: string,
  method: string
): { subject: string; html: string } {
  const subject = 'Your payout is on its way'
  const safeAmount = escapeHtml(amount)
  const safeMethod = escapeHtml(method)

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px 20px;">
    <h1 style="color: #333333; font-size: 24px; margin: 0 0 20px 0;">Payout sent!</h1>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
      We've sent <strong>${safeAmount}</strong> to your <strong>${safeMethod}</strong> account.
    </p>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
      Please allow 1-3 business days for the funds to appear in your account.
    </p>

    <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;">

    <p style="color: #999999; font-size: 12px; line-height: 1.4; margin: 0;">
      <a href="${APP_URL}/dashboard/settings" style="color: #999999; text-decoration: underline;">Unsubscribe from these notifications</a>
    </p>
  </div>
</body>
</html>
  `.trim()

  return { subject, html }
}

/**
 * E4: Payout Failed
 */
export function templateE4(
  amount: string,
  errorReason: string
): { subject: string; html: string } {
  const subject = 'Action needed: your payout failed'
  const safeAmount = escapeHtml(amount)
  const safeErrorReason = escapeHtml(errorReason)

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px 20px;">
    <h1 style="color: #333333; font-size: 24px; margin: 0 0 20px 0;">Payout failed</h1>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
      We attempted to send <strong>${safeAmount}</strong> to your account, but the payout failed.
    </p>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
      <strong>Reason:</strong> ${safeErrorReason}
    </p>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
      Please log in to your dashboard and update your payout details to try again.
    </p>

    <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;">

    <p style="color: #999999; font-size: 12px; line-height: 1.4; margin: 0;">
      <a href="${APP_URL}/dashboard/settings" style="color: #999999; text-decoration: underline;">Unsubscribe from these notifications</a>
    </p>
  </div>
</body>
</html>
  `.trim()

  return { subject, html }
}

/**
 * E5: Account Frozen
 */
export function templateE5(): { subject: string; html: string } {
  const subject = 'Your account has been frozen'

  // E5 is transactional/legal — no unsubscribe per spec Section 7
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px 20px;">
    <h1 style="color: #333333; font-size: 24px; margin: 0 0 20px 0;">Account frozen</h1>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
      Your account has been frozen pending review due to suspicious activity.
    </p>

    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
      If you believe this is an error, please contact our support team for assistance.
    </p>
  </div>
</body>
</html>
  `.trim()

  return { subject, html }
}

// ============================================================================
// Trigger Functions
// ============================================================================

/**
 * E1 Trigger: Referee Signed Up
 * Notifies referrer that someone used their link
 */
export async function triggerE1(
  referrerId: string,
  refereeEmail: string
): Promise<void> {
  try {
    const adminClient = createAdminClient()

    // Look up referrer's email
    const { data: referrerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', referrerId)
      .single()

    if (profileError || !referrerProfile?.email) {
      console.error('Failed to fetch referrer profile:', profileError)
      return
    }

    // Check email preferences
    const { data: prefs, error: prefsError } = await adminClient
      .from('email_preferences')
      .select('referral_updates')
      .eq('user_id', referrerId)
      .single()

    if (prefsError) {
      console.error('Failed to fetch email preferences:', prefsError)
      // If preferences don't exist, default to sending (opt-out, not opt-in)
    }

    if (prefs && prefs.referral_updates === false) {
      // User has opted out of referral updates
      return
    }

    // Send email
    const obfuscated = obfuscateEmail(refereeEmail)
    const { subject, html } = templateE1(obfuscated)
    await sendEmail(referrerProfile.email, subject, html)
  } catch (error) {
    console.error('triggerE1 failed:', error)
  }
}

/**
 * E2 Trigger: Referral Confirmed
 * Notifies referrer that their payout is ready
 */
export async function triggerE2(referrerId: string): Promise<void> {
  try {
    const adminClient = createAdminClient()

    // Look up referrer's email
    const { data: referrerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', referrerId)
      .single()

    if (profileError || !referrerProfile?.email) {
      console.error('Failed to fetch referrer profile:', profileError)
      return
    }

    // Check email preferences
    const { data: prefs, error: prefsError } = await adminClient
      .from('email_preferences')
      .select('payout_notifications')
      .eq('user_id', referrerId)
      .single()

    if (prefsError) {
      console.error('Failed to fetch email preferences:', prefsError)
    }

    if (prefs && prefs.payout_notifications === false) {
      return
    }

    // Send email
    const { subject, html } = templateE2()
    await sendEmail(referrerProfile.email, subject, html)
  } catch (error) {
    console.error('triggerE2 failed:', error)
  }
}

/**
 * E3 Trigger: Payout Sent
 * Notifies user their payout was sent successfully
 */
export async function triggerE3(
  referrerId: string,
  amount: string,
  method: string
): Promise<void> {
  try {
    const adminClient = createAdminClient()

    // Look up referrer's email
    const { data: referrerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', referrerId)
      .single()

    if (profileError || !referrerProfile?.email) {
      console.error('Failed to fetch referrer profile:', profileError)
      return
    }

    // Check email preferences
    const { data: prefs, error: prefsError } = await adminClient
      .from('email_preferences')
      .select('payout_notifications')
      .eq('user_id', referrerId)
      .single()

    if (prefsError) {
      console.error('Failed to fetch email preferences:', prefsError)
    }

    if (prefs && prefs.payout_notifications === false) {
      return
    }

    // Send email
    const { subject, html } = templateE3(amount, method)
    await sendEmail(referrerProfile.email, subject, html)
  } catch (error) {
    console.error('triggerE3 failed:', error)
  }
}

/**
 * E4 Trigger: Payout Failed
 * Notifies user their payout failed and action is needed
 */
export async function triggerE4(
  referrerId: string,
  amount: string,
  errorReason: string
): Promise<void> {
  try {
    const adminClient = createAdminClient()

    // Look up referrer's email
    const { data: referrerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', referrerId)
      .single()

    if (profileError || !referrerProfile?.email) {
      console.error('Failed to fetch referrer profile:', profileError)
      return
    }

    // Check email preferences
    const { data: prefs, error: prefsError } = await adminClient
      .from('email_preferences')
      .select('payout_notifications')
      .eq('user_id', referrerId)
      .single()

    if (prefsError) {
      console.error('Failed to fetch email preferences:', prefsError)
    }

    if (prefs && prefs.payout_notifications === false) {
      return
    }

    // Send email
    const { subject, html } = templateE4(amount, errorReason)
    await sendEmail(referrerProfile.email, subject, html)
  } catch (error) {
    console.error('triggerE4 failed:', error)
  }
}

/**
 * E5 Trigger: Account Frozen
 * Notifies user their account has been frozen
 * Always sends regardless of preferences — transactional/legal email
 */
export async function triggerE5(userId: string): Promise<void> {
  try {
    const adminClient = createAdminClient()

    // Look up user's email
    const { data: userProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single()

    if (profileError || !userProfile?.email) {
      console.error('Failed to fetch user profile:', profileError)
      return
    }

    // E5 always sends regardless of preferences — transactional/legal email

    // Send email
    const { subject, html } = templateE5()
    await sendEmail(userProfile.email, subject, html)
  } catch (error) {
    console.error('triggerE5 failed:', error)
  }
}

// ============================================================================
// Email Preferences Initialization
// ============================================================================

/**
 * Create email preferences for a new user
 * Safe to call multiple times (uses ON CONFLICT DO NOTHING)
 */
export async function createEmailPreferences(userId: string): Promise<void> {
  try {
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('email_preferences')
      .insert({ user_id: userId })
      .select()

    if (error && error.code !== '23505') {
      // Ignore duplicate key errors (23505), log others
      console.error('Failed to create email preferences:', error)
    }
  } catch (error) {
    console.error('createEmailPreferences failed:', error)
  }
}
