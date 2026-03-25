# Pricing Models & Usage Limits

This document outlines the pricing structure, usage limits, and enforcement policies for the application.

## Subscription Tiers

The application defines three primary user roles based on subscription status:

### 1. Free
*   **Cost:** $0 / month
*   **Activity Limit:** 100 Activities (Events)
*   **Device Sync:** Not Available
*   **Role Key:** `free`

### 2. Basic
*   **Activity Limit:** 1,000 Activities (Events)
*   **Device Sync:** Not Available
*   **Role Key:** `basic`

### 3. Pro
*   **Activity Limit:** Unlimited
*   **Device Sync:** Full Access (Garmin, Suunto, COROS)
*   **Role Key:** `pro`

> **Note:** Exact pricing amounts are configured in the Stripe Dashboard and populated dynamically in the UI.
> Activity-count limits are defined in `shared/limits.ts` and reused by backend enforcement and frontend plan messaging.

---

## Limits Enforcement

Limits are enforced through a scheduled background process (`enforceSubscriptionLimits`) that runs every 24 hours (Europe/London time).

### Activity Counters
*   If a user is at their tier's limit, future uploads are blocked by upload-time limit checks.
*   Existing event history is retained; there is no automatic event pruning on grace-period expiry.

### Device Synchronization
*   Sync is exclusively a **Pro** feature.
*   If a user loses Pro status (and any grace period expires), all external service connections (Garmin, Suunto, COROS) are automatically disconnected.

---

## Grace Period Policy

To prevent immediate service interruption upon payment failure or subscription cancellation, the system implements a **30-Day Grace Period**.

### Triggers
*   **Subscription Cancellation/Expiration:** When the system detects no active or trialing subscription for a previously paid user, a grace period is started.
*   **Duration:** 30 Days from the moment the active subscription is lost.

### During Grace Period
*   The user effectively retains their previous privileges (services remain connected, existing data is retained).
*   The UI may display downgrade warnings.

### Expiration
Once the 30-day window expires:
1.  **Role Reversion:** The user's role is set to `free`.
2.  **Service Disconnection:** External APIs (Garmin, etc.) are deauthorized.
3.  **Limit Enforcement:** Plan limits continue to apply to future uploads; historical events are retained.

## User Notifications (Frontend)

The application provides visibility into the grace period status to keep the user informed:

*   **Global Banner:** If a user is currently in a grace period, a persistent banner appears at the top of the application (implemented in `AppComponent`).
    *   **Message:** "Your Pro plan has ended. You have until [DATE] before your device sync is disconnected and plan limits apply to new uploads."
    *   **Action:** Includes a direct link to the Pricing page to "Upgrade now".
*   **Downgrade Warning:** When a Pro user explicitly chooses to downgrade in the UI, they are presented with a confirmation dialog explaining the 30-day grace period ahead of time.

---

## Technical Source of Truth

*   **Limits Definition:** `shared/limits.ts`
*   **Enforcement Logic:** `functions/src/schedule/enforce-subscription-limits.ts`
*   **Subscription Handling:** `functions/src/stripe/subscriptions.ts`
*   **Frontend Banner Logic:** `src/app/app.component.ts` (and template)
