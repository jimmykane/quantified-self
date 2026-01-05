# Stripe Subscription Handling - Design Notes

## Subscription Status Handling

### Why `past_due` is NOT included in active subscription checks

The code currently only checks for `['active', 'trialing']` status when determining if a user has an active subscription. The `past_due` status is intentionally excluded.

**Rationale:**

When a payment fails, Stripe sets the subscription status to `past_due` and begins its retry process (configured as 8 retries over 2 weeks in Stripe dashboard). During this time:

1. **Grace Period Coverage**: The 30-day grace period (`GRACE_PERIOD_DAYS`) set when no active subscription is found exceeds Stripe's 2-week retry window. This means users maintain access during payment recovery.

2. **Payment Recovery Flow**:
   - Payment fails → `past_due` → Grace period starts (30 days)
   - Stripe retries for ~2 weeks
   - If payment succeeds → `active` → Grace period cleared
   - If all retries fail → `canceled` → User still has ~16 days of grace remaining

3. **Why NOT include `past_due`**:
   - Including `past_due` as "active" would mask billing issues from the system
   - The grace period provides a better UX buffer than pretending nothing is wrong
   - Admin dashboard uses `past_due` in its query (`admin.ts`) to show accurate subscription states

### User Existence Check

As of 2026-01-02, `onSubscriptionUpdated` includes a user existence check to prevent creating orphaned subcollections when subscription webhooks fire for deleted users.

**Problem solved**: If a user is deleted but their Stripe subscription still sends webhooks (e.g., subscription canceled event), the function would previously write to `users/{uid}/system/status` creating an orphaned subcollection with no parent document.

## Related Stripe Dashboard Settings

- **Retry schedule**: 8 times within 2 weeks (Smart Retry)
- **After all retries fail**: Cancel the subscription
- **Invoice status**: Leave past-due

## Future Considerations

- [ ] Consider sending warning emails when subscription enters `past_due` state
- [ ] Consider adding `past_due` handling to show "Payment issue" banner in UI
- [ ] Consider integrating with Stripe Customer Portal for self-service payment updates
