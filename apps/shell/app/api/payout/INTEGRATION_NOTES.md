# Payout Circuit Breaker Integration

After this PR merges, add this guard to `/api/payout/request/route.ts`
BEFORE the existing guards:

```typescript
const { data: config } = await adminClient
  .from('game_config')
  .select('cashouts_paused')
  .limit(1)
  .single()

if (config?.cashouts_paused) {
  return Response.json({ error: 'Payouts temporarily paused' }, { status: 503 })
}
```

## Why Not Included in This PR

This PR (4-B/4-C) implements the fraud rules that SET `cashouts_paused = true` (R4).
The payout request route already exists from PR 3-D.

To avoid cross-PR dependencies and keep this PR focused on fraud detection,
the circuit breaker CHECK is left as a follow-up integration task.

## When to Add

Add this guard in one of these scenarios:
1. PR 5-A (payment integration) — when wiring real payment provider
2. PR 4-D (fraud dashboard) — when building admin circuit breaker reset UI
3. Standalone patch PR — if fraud rules go live before PR 5-A

## Placement

Add immediately after Step 1 (authentication) and before Step 2 (body parsing).

This ensures the circuit breaker is checked BEFORE any heavy validation logic runs,
minimizing load during a fraud spike event.
