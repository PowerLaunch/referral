# Shadow Review Status Mapping

When building user-facing dashboard components (Phase 6), ALWAYS use:
- `getDisplayStatus(profile.status)` for profile status display
- `getDisplayPayoutStatus(payout.status, profile.status)` for payout status display

Import from `'@referral/api/statusDisplay'`.

NEVER expose raw status values (REVIEW_HOLD, FROZEN, PENDING_MANUAL_APPROVAL) to users.

See spec Section 6.2.

## Shadow Review Principles

1. **REVIEW_HOLD** → Always displays as "Verifying"
   - User never sees "Under Review", "Flagged", or fraud language
   - E5 email fires ONLY when status = BANNED, not on REVIEW_HOLD

2. **FROZEN** → Displays as "Verifying"
   - Same as REVIEW_HOLD — hides the freeze from user

3. **PENDING_MANUAL_APPROVAL** → Always displays as "Processing"
   - Hides the manual approval step from users
   - First-time payouts require manual approval, but users see "Processing"

4. **Payout status override**
   - If user.status is REVIEW_HOLD or FROZEN, payout status ALWAYS shows "Verifying"
   - This prevents leaking information about fraud review state

## Example Usage

```typescript
import { getDisplayStatus, getDisplayPayoutStatus } from '@referral/api/statusDisplay'

// In a dashboard component or API response:
const profile = await getProfile(userId)
const payout = await getPayout(payoutId)

return {
  profile: {
    status: getDisplayStatus(profile.status), // User sees: Active, Verifying, or Frozen
    // ... other fields
  },
  payout: {
    status: getDisplayPayoutStatus(payout.status, profile.status),
    // User sees: Processing, Completed, Failed, or Verifying (if under review)
    // ... other fields
  }
}
```

## Implementation Checklist

Before launching Phase 6 dashboard to users:

- [ ] All profile status displays use `getDisplayStatus()`
- [ ] All payout status displays use `getDisplayPayoutStatus()`
- [ ] No raw status values exposed in API responses
- [ ] No raw status values rendered in UI components
- [ ] E5 email template only triggers on BANNED status (not REVIEW_HOLD or FROZEN)
