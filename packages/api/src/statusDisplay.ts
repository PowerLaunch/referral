// Shadow review status mapping per spec Section 6.2.
// REVIEW_HOLD → 'Verifying' always. User never sees 'Under Review', 'Flagged', or fraud language.
// PENDING_MANUAL_APPROVAL → 'Processing' for all users (hides the manual approval step).
// E5 email fires ONLY when status = BANNED, not on REVIEW_HOLD or FROZEN.

/**
 * Map internal profile status to user-facing display string.
 * Shadow review: REVIEW_HOLD and FROZEN both display as 'Verifying'.
 * @param actualStatus - Internal status from profiles.status column
 * @returns User-facing status string
 */
export function getDisplayStatus(
  actualStatus: string
): 'Active' | 'Verifying' | 'Frozen' {
  switch (actualStatus) {
    case 'ACTIVE':
      return 'Active'
    case 'REVIEW_HOLD':
      return 'Verifying'
    case 'FROZEN':
      return 'Verifying'
    case 'BANNED':
      return 'Frozen'
    default:
      return 'Active' // Fallback for unknown status
  }
}

/**
 * Map internal referral status to user-facing display string.
 * Shadow review: VOIDED displays as 'Rejected' (no fraud language).
 * @param actualStatus - Internal status from referrals.status column
 * @returns User-facing referral status string
 */
export function getDisplayReferralStatus(actualStatus: string): string {
  switch (actualStatus) {
    case 'PENDING':
      return 'Pending'
    case 'CONFIRMED':
      return 'Confirmed'
    case 'REJECTED':
      return 'Rejected'
    case 'VOIDED':
      return 'Rejected' // Shadow: hide voiding from user
    default:
      return 'Pending'
  }
}

/**
 * Map internal payout status to user-facing display string.
 * If user is under shadow review (REVIEW_HOLD or FROZEN), always return 'Verifying'
 * regardless of actual payout status.
 *
 * @param actualPayoutStatus - Internal status from payouts.status column
 * @param userStatus - Internal status from profiles.status column
 * @returns User-facing payout status string
 */
export function getDisplayPayoutStatus(
  actualPayoutStatus: string,
  userStatus: string
): string {
  // Shadow review override: if user is REVIEW_HOLD or FROZEN, always show 'Verifying'
  if (userStatus === 'REVIEW_HOLD' || userStatus === 'FROZEN') {
    return 'Verifying'
  }

  // Otherwise, map payout status normally
  switch (actualPayoutStatus) {
    case 'PENDING':
      return 'Processing'
    case 'PENDING_MANUAL_APPROVAL':
      return 'Processing' // Hide manual approval from user
    case 'PROCESSING':
      return 'Processing'
    case 'COMPLETED':
      return 'Completed'
    case 'FAILED':
      return 'Failed'
    case 'VOIDED':
      return 'Cancelled'
    default:
      return 'Processing' // Fallback for unknown status
  }
}
