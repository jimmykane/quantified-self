# Pricing Models & Usage Limits

This document outlines the pricing structure, usage limits, and enforcement policies for the application.

## Subscription Tiers

The application defines three primary user roles based on subscription status:

### 1. Free
*   **Cost:** $0 / month
*   **Activity Limit:** 10 Activities (Events)
*   **Device Sync:** Not Available
*   **Role Key:** `free`

### 2. Basic
*   **Activity Limit:** 100 Activities (Events)
*   **Device Sync:** Not Available
*   **Role Key:** `basic`

### 3. Pro
*   **Activity Limit:** Unlimited
*   **Device Sync:** Full Access (Garmin, Suunto, COROS)
*   **Role Key:** `pro`

> **Note:** Exact pricing amounts are configured in the Stripe Dashboard and populated dynamically in the UI.

---

## Limits Enforcement

Limits are enforced through a scheduled background process (`enforceSubscriptionLimits`) that runs every 24 hours (Europe/London time).

### Activity Counters
*   If a user exceeds their tier's limit (e.g., a Free user has 15 events), the system will automatically **delete the newest events** until the count matches the limit.
*   **Deletion Policy:** Recursive deletion (removes the event and all its subcollections).

### Device Synchronization
*   Sync is exclusively a **Pro** feature.
*   If a user loses Pro status (and any grace period expires), all external service connections (Garmin, Suunto, COROS) are automatically disconnected.

---

## Grace Period Policy

To prevent immediate data loss or service interruption upon payment failure or subscription cancellation, the system implements a **30-Day Grace Period**.

### Triggers
*   **Subscription Cancellation/Expiration:** When the system detects no active or trialing subscription for a previously paid user, a grace period is started.
*   **Duration:** 30 Days from the moment the active subscription is lost.

### During Grace Period
*   The user effectively retains their previous privileges (services remain connected, data is not pruned).
*   The UI may display downgrade warnings.

### Expiration
Once the 30-day window expires:
1.  **Role Reversion:** The user's role is set to `free`.
2.  **Service Disconnection:** External APIs (Garmin, etc.) are deauthorized.
3.  **Data Pruning:** The enforcement job will reduce the user's event history to the Free limit (10 events), deleting the most recent entries first.

## User Notifications (Frontend)

The application provides visibility into the grace period status to keep the user informed:

*   **Global Banner:** If a user is currently in a grace period, a persistent banner appears at the top of the application (implemented in `AppComponent`).
    *   **Message:** "Your Pro plan has ended. You have until [DATE] before your device sync is disconnected and newest activities are deleted."
    *   **Action:** Includes a direct link to the Pricing page to "Upgrade now".
*   **Downgrade Warning:** When a Pro user explicitly chooses to downgrade in the UI, they are presented with a confirmation dialog explaining the 30-day grace period ahead of time.

---

## Technical Source of Truth

*   **Limits Definition:** `functions/src/shared/limits.ts`
*   **Enforcement Logic:** `functions/src/schedule/enforce-subscription-limits.ts`
*   **Subscription Handling:** `functions/src/stripe/subscriptions.ts`
*   **Frontend Banner Logic:** `src/app/app.component.ts` (and template)
