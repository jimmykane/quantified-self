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
import { GRACE_PERIOD_DAYS } from '../../../shared/limits';

const USER_DELETION_TOMBSTONES_COLLECTION = 'userDeletionTombstones';

const getTimestampMillis = (value: unknown): number | null => {
    if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        return (value as { toMillis: () => number }).toMillis();
    }

    return null;
};

const hasActiveDeletionMarker = async (
    deletionMarkerRef: admin.firestore.DocumentReference,
    uid: string,
    logContext: string
): Promise<boolean> => {
    const markerDoc = await deletionMarkerRef.get();
    if (!markerDoc.exists) {
        return false;
    }

    const expireAtMs = getTimestampMillis(markerDoc.data()?.expireAt);
    if (expireAtMs !== null && expireAtMs <= Date.now()) {
        try {
            await deletionMarkerRef.delete();
            logger.info(`[${logContext}] Removed expired user deletion marker for ${uid}.`);
        } catch (error) {
            logger.warn(`[${logContext}] Failed to remove expired user deletion marker for ${uid}. Continuing.`, error);
        }
        return false;
    }

    return true;
};

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
    const firestore = admin.firestore();
    const userDocRef = firestore.collection('users').doc(uid);
    const deletionMarkerRef = firestore.collection(USER_DELETION_TOMBSTONES_COLLECTION).doc(uid);
    const systemStatusRef = firestore.doc(`users/${uid}/system/status`);

    logger.info(`[onSubscriptionUpdated] Change detected for user ${uid}. Reconciling claims...`);

    // Check if the user document exists before proceeding
    // This prevents creating orphaned subcollections when a user has been deleted
    if (await hasActiveDeletionMarker(deletionMarkerRef, uid, 'onSubscriptionUpdated')) {
        logger.warn(`[onSubscriptionUpdated] User ${uid} is marked for deletion. Skipping subscription processing.`);
        return;
    }

    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
        logger.warn(`[onSubscriptionUpdated] User ${uid} no longer exists in Firestore. Skipping to prevent orphaned subcollections.`);
        return;
    }

    try {
        await reconcileClaims(uid);
    } catch (error: any) {
        if (error.code === 'auth/user-not-found' || error.code === 'not-found' || error.message?.includes('No active subscription found')) {
            logger.info(`[onSubscriptionUpdated] reconcileClaims skipped or failed gracefully for ${uid}: ${error.message || 'not found'}`);
        } else {
            logger.warn(`[onSubscriptionUpdated] Non-critical error during initial reconcileClaims for ${uid}:`, error);
        }
    }

    const subscriptionsRef = firestore.collection(`customers/${uid}/subscriptions`);
    const activeSnapshot = await subscriptionsRef
        .where('status', 'in', ['active', 'trialing'])
        .limit(1)
        .get();

    if (activeSnapshot.empty) {
        logger.info(`[onSubscriptionUpdated] No active subscriptions for ${uid}. Checking for previous paid state...`);

        const gracePeriodUntil = admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
        );
        const gracePeriodResult = await firestore.runTransaction(async (transaction) => {
            const [latestDeletionMarkerDoc, latestUserDoc, systemDoc] = await Promise.all([
                transaction.get(deletionMarkerRef),
                transaction.get(userDocRef),
                transaction.get(systemStatusRef)
            ]);

            if (latestDeletionMarkerDoc.exists) {
                const expireAtMs = getTimestampMillis(latestDeletionMarkerDoc.data()?.expireAt);
                if (expireAtMs !== null && expireAtMs <= Date.now()) {
                    transaction.delete(deletionMarkerRef);
                } else {
                    return 'skip-deleted-user' as const;
                }
            }

            if (!latestUserDoc.exists) {
                return 'skip-missing-user' as const;
            }

            if (systemDoc.data()?.gracePeriodUntil) {
                return 'already-set' as const;
            }

            transaction.set(systemStatusRef, {
                gracePeriodUntil,
                lastDowngradedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            return 'set' as const;
        });

        if (gracePeriodResult === 'skip-deleted-user') {
            logger.warn(`[onSubscriptionUpdated] User ${uid} was marked for deletion before setting grace period. Skipping follow-up processing.`);
            return;
        }

        if (gracePeriodResult === 'skip-missing-user') {
            logger.warn(`[onSubscriptionUpdated] User ${uid} no longer exists before setting grace period. Skipping to prevent orphaned subcollections.`);
            return;
        }

        if (gracePeriodResult === 'set') {
            logger.info(`[onSubscriptionUpdated] Setting gracePeriodUntil: ${gracePeriodUntil.toDate().toISOString()} for user ${uid}`);

            // Re-reconcile to ensure the new grace period is in the Auth claims
            await reconcileClaims(uid);
        }
    } else {
        // User has an active sub. Clear grace period if it exists.
        if (await hasActiveDeletionMarker(deletionMarkerRef, uid, 'onSubscriptionUpdated')) {
            logger.warn(`[onSubscriptionUpdated] User ${uid} was marked for deletion before clearing grace period. Skipping follow-up processing.`);
            return;
        }

        logger.info(`[onSubscriptionUpdated] Active subscription found. Clearing grace period for ${uid}.`);
        await systemStatusRef.update({
            gracePeriodUntil: admin.firestore.FieldValue.delete(),
            lastDowngradedAt: admin.firestore.FieldValue.delete()
        }).catch(() => { }); // Ignore error if field doesn't exist

        // Re-reconcile to ensure the cleared grace period is reflected in Auth claims
        await reconcileClaims(uid);
    }

    // Check for email triggers (Welcome, Upgrade, Downgrade, Cancellation)
    // using the specific change that triggered this event.
    if (event.data) {
        if (await hasActiveDeletionMarker(deletionMarkerRef, uid, 'onSubscriptionUpdated')) {
            logger.warn(`[onSubscriptionUpdated] User ${uid} was marked for deletion before email processing. Skipping email triggers.`);
            return;
        }

        await checkAndSendSubscriptionEmails(
            uid,
            event.params.subscriptionId,
            event.data.before.data(),
            event.data.after.data(),
            event.id
        );
    }
});
