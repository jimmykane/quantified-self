/**
 * @fileoverview Stripe Subscription Firestore Triggers Module
 *
 * Contains Firestore triggers that respond to subscription document changes.
 * This module is the central orchestrator for subscription state changes,
 * coordinating claims updates, grace periods, and email notifications.
 *
 * ## Architecture Overview
 * ```
 * Stripe Webhook → firestore-stripe-payments extension → customers/{uid}/subscriptions/{id}
 *                                                                    ↓
 *                                                        onSubscriptionUpdated (this module)
 *                                                                    ↓
 *                                          ┌─────────────────────────┼─────────────────────────┐
 *                                          ↓                         ↓                         ↓
 *                                   reconcileClaims()        Grace Period Mgmt      checkAndSendSubscriptionEmails()
 *                                   (claims.ts)              (users/{uid}/system/status)    (email-triggers.ts)
 * ```
 *
 * ## Grace Period System
 * When a user's subscription becomes inactive, they are granted a grace period
 * (defined by `GRACE_PERIOD_DAYS`) before losing access to premium features.
 * This allows time for:
 * - Payment method issues to be resolved
 * - Subscription renewal decisions
 * - Data export before downgrade
 *
 * Grace period data is stored in `users/{uid}/system/status`:
 * - `gracePeriodUntil`: Timestamp when grace period expires
 * - `lastDowngradedAt`: Timestamp of when the downgrade was detected
 *
 * ## Orphan Prevention
 * The trigger checks if the user document exists before processing. This prevents
 * creating orphaned subcollections when Stripe webhooks arrive for deleted users.
 *
 * @module stripe/subscriptions
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { reconcileClaims } from './claims';
import { checkAndSendSubscriptionEmails } from './email-triggers';
import { GRACE_PERIOD_DAYS } from '../shared/limits';

/**
 * Firestore Trigger: onSubscriptionUpdated
 *
 * Triggered whenever a subscription document is created, updated, or deleted
 * in the `customers/{uid}/subscriptions/{subscriptionId}` collection.
 *
 * ## Trigger Path
 * `customers/{uid}/subscriptions/{subscriptionId}`
 *
 * ## Responsibilities
 * 1. **User Validation**: Verifies the user still exists to prevent orphaned data
 * 2. **Claims Sync**: Calls `reconcileClaims()` to update Firebase Auth custom claims
 * 3. **Grace Period Management**:
 *    - Sets `gracePeriodUntil` when no active subscriptions remain
 *    - Clears grace period when an active subscription is found
 * 4. **Email Notifications**: Delegates to `checkAndSendSubscriptionEmails()` for
 *    welcome, upgrade, downgrade, and cancellation emails
 *
 * ## Processing Flow
 * ```
 * Document Change Detected
 *         ↓
 * Check if user exists → No → Exit (prevent orphans)
 *         ↓ Yes
 * Call reconcileClaims()
 *         ↓
 * Query for active subscriptions
 *         ↓
 * ┌───────┴───────┐
 * ↓               ↓
 * Found        Not Found
 * ↓               ↓
 * Clear Grace    Set Grace Period
 * Period         (if not already set)
 * ↓               ↓
 * └───────┬───────┘
 *         ↓
 * Send Email Notifications
 * ```
 *
 * ## Error Handling
 * - **User Not Found**: Logs warning and exits gracefully
 * - **No Active Subscription**: Sets grace period and role to 'free'
 * - **Other Errors**: Logged but don't crash the function
 *
 * ## Configuration
 * - **Region**: europe-west3
 * - **Document Path**: customers/{uid}/subscriptions/{subscriptionId}
 *
 * @see reconcileClaims - Updates Firebase Auth custom claims
 * @see checkAndSendSubscriptionEmails - Handles email notifications
 * @see GRACE_PERIOD_DAYS - Configuration for grace period duration
 */
export const onSubscriptionUpdated = onDocumentWritten({
    document: 'customers/{uid}/subscriptions/{subscriptionId}',
    region: 'europe-west3'
}, async (event) => {
    const uid = event.params.uid;

    logger.info(`[onSubscriptionUpdated] Change detected for user ${uid}. Reconciling claims...`);

    // Check if the user document exists before proceeding
    // This prevents creating orphaned subcollections when a user has been deleted
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
        logger.warn(`[onSubscriptionUpdated] User ${uid} no longer exists in Firestore. Skipping to prevent orphaned subcollections.`);
        return;
    }

    try {
        await reconcileClaims(uid);

        // If the role is now 'free' (no active sub found in reconcileClaims), 
        // find if they WERE pro/basic and set the grace period.
        // Actually, reconcileClaims throws NOT_FOUND if no active sub.
        // Let's refine the logic here.

        // If we are here, at least one sub was written. 
        // If the NEW state is that no ACTIVE sub exists, we set gracePeriodUntil.

        const subscriptionsRef = admin.firestore().collection(`customers/${uid}/subscriptions`);
        const activeSnapshot = await subscriptionsRef
            .where('status', 'in', ['active', 'trialing'])
            .limit(1)
            .get();

        if (activeSnapshot.empty) {
            logger.info(`[onSubscriptionUpdated] No active subscriptions for ${uid}. Checking for previous paid state...`);

            // Check if user already has a grace period set to avoid overwriting or extending it unfairly
            const systemDoc = await admin.firestore().doc(`users/${uid}/system/status`).get();
            const systemData = systemDoc.data();

            // If they don't have a grace period yet, set it to 30 days from now
            if (!systemData?.gracePeriodUntil) {
                const gracePeriodUntil = admin.firestore.Timestamp.fromDate(
                    new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
                );
                logger.info(`[onSubscriptionUpdated] Setting gracePeriodUntil: ${gracePeriodUntil.toDate().toISOString()} for user ${uid}`);
                await admin.firestore().doc(`users/${uid}/system/status`).set({
                    gracePeriodUntil,
                    lastDowngradedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
        } else {
            // User has an active sub. Clear grace period if it exists.
            logger.info(`[onSubscriptionUpdated] Active subscription found. Clearing grace period for ${uid}.`);
            await admin.firestore().doc(`users/${uid}/system/status`).update({
                gracePeriodUntil: admin.firestore.FieldValue.delete(),
                lastDowngradedAt: admin.firestore.FieldValue.delete()
            }).catch(() => { }); // Ignore error if field doesn't exist

            // Reconcile claims immediately since they are active
            await reconcileClaims(uid);
        }

        // Check for email triggers (Welcome, Upgrade, Downgrade, Cancellation)
        // using the specific change that triggered this event.
        if (event.data) {
            await checkAndSendSubscriptionEmails(
                uid,
                event.params.subscriptionId,
                event.data.before.data(),
                event.data.after.data(),
                event.id
            );
        }

    } catch (e: any) {
        if (e.code === 'not-found' || e.message?.includes('No active subscription found')) {
            // Expected if user has no active subs. Set grace period as above.
            // Duplicate logic partially but for safety...
            const systemDoc = await admin.firestore().doc(`users/${uid}/system/status`).get();
            if (!systemDoc.data()?.gracePeriodUntil) {
                const gracePeriodUntil = admin.firestore.Timestamp.fromDate(
                    new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
                );
                await admin.firestore().doc(`users/${uid}/system/status`).set({ gracePeriodUntil }, { merge: true });
            }
            const user = await admin.auth().getUser(uid);
            const existingClaims = user.customClaims || {};
            await admin.auth().setCustomUserClaims(uid, {
                ...existingClaims,
                stripeRole: 'free'
            });
            return;
        }
        logger.error(`[onSubscriptionUpdated] Error for user ${uid}:`, e);
    }
});
