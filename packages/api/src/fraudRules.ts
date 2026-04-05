// Fraud rules stub for PR 3-B-patch
// Fraud rules R1-R6 are built in PR 4-B.
// This hook auto-voids pending referrals when a CRITICAL fraud flag fires.

import { voidPendingCredits } from './credits'

/**
 * Hook called when a CRITICAL fraud flag is triggered
 * Automatically voids all PENDING referrals for the flagged user
 *
 * @param userId - User ID who triggered the fraud flag
 * @param ruleTriggered - Fraud rule identifier (e.g., "R1", "R2")
 */
export async function onCriticalFraudFlag(
  userId: string,
  ruleTriggered: string
): Promise<void> {
  try {
    const result = await voidPendingCredits(
      userId,
      `Auto-voided: CRITICAL fraud flag ${ruleTriggered}`
    )
    if (result.voided > 0) {
      console.log(
        `Voided ${result.voided} pending referrals for user ${userId} ` +
          `due to CRITICAL flag ${ruleTriggered}`
      )
    }
  } catch (err) {
    console.error(`Failed to void credits for ${userId}:`, err)
  }
}

// TODO PR 4-B: Wire this into insertFraudFlag() for CRITICAL severity flags.
