# Auth Integration Notes

## Post-PR 2-C Integration Tasks

After PR 2-C (feat/email-templates) is merged, the following integration is required:

### Email Preferences Initialization

In the auth signup handler, add a call to initialize email preferences for new users:

```typescript
import { createEmailPreferences } from '@/../../packages/api/src/email'

// TODO: call createEmailPreferences(userId) here after PR 2-C is merged
// This should be called after successful profile creation in the signup flow
// Example:
// await createEmailPreferences(user.id)
```

**Location:** The signup handler where new user profiles are created (typically in the auth callback route or signup API route)

**Timing:** Call `createEmailPreferences` immediately after the user profile is successfully created in the database

**Error Handling:** The function uses ON CONFLICT DO NOTHING, so it's safe to call multiple times and won't fail if preferences already exist

---

## Why Not a Database Trigger?

Per project rules, we use application logic instead of database triggers for the following reasons:
- Triggers are invisible to Cursor and hard to debug
- Application code is more testable and maintainable
- Easier to add logging and error handling
- Clearer execution flow for developers

---

## Future Email Trigger Integration

The following email trigger functions are available in `packages/api/src/email.ts` but not yet wired:

- `triggerE1(referrerId, refereeEmail)` - Called by referral engine (Phase 3)
- `triggerE2(referrerId)` - Called by referral engine (Phase 3)
- `triggerE3(referrerId, amount, method)` - Called by payout system (Phase 3-D/5-B)
- `triggerE4(referrerId, amount, errorReason)` - Called by payout system (Phase 3-D/5-B)
- `triggerE5(userId)` - Called by fraud middleware (Phase 4-D)

These will be integrated in their respective phases.
