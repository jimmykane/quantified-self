# Stripe Subscription Handling - Design Notes

## API and ownership boundary

Custom Functions use Stripe Node `22.4.0` with API `2026-07-29.dahlia`. Dahlia exposes subscription discounts through `discounts[]`; custom renewal calculations must not reintroduce the removed singular discount shape. The Invertase Stripe extension is unchanged and remains responsible for Checkout/customer document flows and webhook synchronization.

The normal custom Stripe paths use `STRIPE_SECRET_KEY`. Admin subscription-time gifts use the separately cached `STRIPE_ADMIN_BILLING_KEY`, restricted to subscription read/write access and bound only to the preview and grant callables.

## Admin subscription-time gifts

An authenticated, App Check-verified admin can preview and grant 1–12 UTC calendar months to exactly one active or trialing Basic/Pro subscription. The target date starts from the later of the paid item-period end or existing trial end, clamps month-end dates, and must remain within Stripe's limit of two UTC calendar years from the subscription's `billing_cycle_anchor`. End-of-period cancellation through `cancel_at_period_end` is supported and must remain scheduled; a separate fixed `cancel_at` timestamp is rejected for manual review because it could end access before the gifted trial.

Grant operations persist the absolute target before Stripe, lock per user, use a deterministic Stripe idempotency key, and reconcile retries against gift metadata. The Stripe update is intentionally limited to `trial_end`, `proration_behavior: 'none'`, and namespaced gift metadata. It must not send price items, tax configuration, or cancellation fields. Ambiguous outcomes become `needs_review` and block a new operation until the same operation is reconciled. Preview returns the exact server-stored retry fields for the lock owner so reopening the admin dialog can resume that operation without constructing a new target. Audit records and locks are server-only descendants of the user and are removed by normal recursive account deletion.

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
