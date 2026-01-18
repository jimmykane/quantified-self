/**
 * @fileoverview Stripe Subscription Email Triggers Module
 *
 * Handles automated transactional email notifications for subscription lifecycle events.
 * This module integrates with Firebase's `mail` collection, which is processed by the
 * Firebase Trigger Email extension to send actual emails.
 *
 * ## Email Types
 * | Event | Template Name | Trigger Condition |
 * |-------|--------------|-------------------|
 * | Welcome | `welcome_email` | New active/trialing subscription |
 * | Upgrade | `subscription_upgrade` | Role level increased |
 * | Downgrade | `subscription_downgrade` | Role level decreased |
 * | Cancellation | `subscription_cancellation` | `cancel_at_period_end` set to true |
 *
 * ## Deduplication Strategy
 * Each email type uses a unique document ID in the `mail` collection to prevent
 * duplicate sends:
 * - Welcome: `welcome_email_{subscriptionId}`
 * - Upgrade: `upgrade_{eventId}`
 * - Downgrade: `downgrade_{eventId}`
 * - Cancellation: `cancellation_{subscriptionId}_{periodEndTimestamp}`
 *
 * ## TTL (Time-To-Live)
 * All mail documents include an `expireAt` timestamp for automatic cleanup by
 * Firestore TTL policies. This prevents mail queue buildup from processed emails.
 *
 * ## Integration
 * This module is called by `onSubscriptionUpdated` in `subscriptions.ts` whenever
 * a subscription document changes in Firestore.
 *
 * @module stripe/email-triggers
 */

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ROLE_HIERARCHY, ROLE_DISPLAY_NAMES } from '../shared/pricing';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { DocumentData } from 'firebase-admin/firestore';


/**
 * Formats a Firestore Timestamp to a human-readable date string.
 *
 * @param timestamp - Firestore Timestamp to format
 * @returns Formatted date string (e.g., "15 January 2025")
 *
 * @example
 * formatDate(admin.firestore.Timestamp.now()) // "3 January 2026"
 *
 * @internal
 */
const formatDate = (timestamp: admin.firestore.Timestamp): string => {
    return timestamp.toDate().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
};



/**
 * Analyzes subscription changes and queues appropriate transactional emails.
 *
 * This function is the central dispatcher for all subscription-related emails.
 * It compares the before/after states of a subscription document and determines
 * which emails (if any) should be sent.
 *
 * ## Email Trigger Logic
 *
 * ### 1. Welcome Email
 * - **Condition**: Subscription becomes active/trialing when it wasn't before
 * - **Template**: `welcome_email`
 * - **Data**: `{ role }`
 *
 * ### 2. Upgrade Email
 * - **Condition**: Role changes to a higher tier (based on `ROLE_HIERARCHY`)
 * - **Template**: `subscription_upgrade`
 * - **Data**: `{ new_role, old_role }`
 *
 * ### 3. Downgrade Email
 * - **Condition**: Role changes to a lower tier
 * - **Template**: `subscription_downgrade`
 * - **Data**: `{ new_role, old_role, limit }`
 *
 * ### 4. Cancellation Email
 * - **Condition**: `cancel_at_period_end` changes from false to true
 * - **Template**: `subscription_cancellation`
 * - **Data**: `{ role, expiration_date }`
 *
 * ## Idempotency
 * Each email type checks if a mail document with its unique ID already exists
 * before creating a new one. This ensures emails are not duplicated even if
 * the function is triggered multiple times for the same event.
 *
 * @param uid - Firebase user ID (owner of the subscription)
 * @param subscriptionId - Stripe subscription ID (sub_xxx)
 * @param before - Subscription document data before the change (undefined for creates)
 * @param after - Subscription document data after the change (undefined for deletes)
 * @param eventId - Unique event ID from the Firestore trigger (used for deduplication)
 *
 * @example
 * ```typescript
 * // Called from onSubscriptionUpdated trigger
 * await checkAndSendSubscriptionEmails(
 *     'user123',
 *     'sub_1234567890',
 *     { status: 'trialing', role: 'basic' },
 *     { status: 'active', role: 'pro' },
 *     'abc123-event-id'
 * );
 * // This would trigger an upgrade email (basic → pro)
 * ```
 */
export async function checkAndSendSubscriptionEmails(
    uid: string,
    subscriptionId: string,
    before: DocumentData | undefined,
    after: DocumentData | undefined,
    eventId: string
): Promise<void> {
    const hierarchy = ROLE_HIERARCHY as Record<string, number>;
    const displayNames = ROLE_DISPLAY_NAMES as Record<string, string>;


    // 1. Welcome Email
    // Trigger: New active/trialing subscription.
    // Condition: No 'before' state (creation) OR 'before' state was NOT active/trialing, AND 'after' IS active/trialing.
    const isNowActive = after && ['active', 'trialing'].includes(after.status);
    const wasActive = before && ['active', 'trialing'].includes(before.status);

    if (isNowActive && !wasActive && after.role) {
        // Welcome Email Logic
        const mailDocId = `welcome_email_${subscriptionId}`;
        const mailRef = admin.firestore().collection('mail').doc(mailDocId);
        const mailDoc = await mailRef.get();

        if (!mailDoc.exists) {
            const userRecord = await admin.auth().getUser(uid);
            if (userRecord.email) {
                logger.info(`[checkAndSendSubscriptionEmails] Queuing welcome email for user ${uid}, subscription ${subscriptionId}`);
                await mailRef.set({
                    to: userRecord.email,
                    from: 'Quantified Self <hello@quantified-self.io>',
                    template: {
                        name: 'welcome_email',
                        data: {
                            role: displayNames[after.role] || after.role,
                        },
                    },
                    expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
                });
            }
        }
    }

    // Ensure we have both before and after for comparison logic below
    if (!before || !after) return;

    // 2. Upgrade / Downgrade Logic
    const oldRole = before.role;
    const newRole = after.role;

    if (oldRole && newRole && oldRole !== newRole) {

        const oldLevel = hierarchy[oldRole] || 0;
        const newLevel = hierarchy[newRole] || 0;

        if (newLevel > oldLevel) {
            // Upgrade
            const mailId = `upgrade_${eventId}`;
            const mailRef = admin.firestore().collection('mail').doc(mailId);
            const exists = (await mailRef.get()).exists;

            if (!exists) {
                const userRecord = await admin.auth().getUser(uid);
                if (userRecord.email) {
                    logger.info(`[checkAndSendSubscriptionEmails] Queuing UPGRADE email for user ${uid}`);
                    await mailRef.set({
                        to: userRecord.email,
                        from: 'Quantified Self <hello@quantified-self.io>',
                        template: {
                            name: 'subscription_upgrade',
                            data: {
                                new_role: displayNames[newRole] || newRole,
                                old_role: displayNames[oldRole] || oldRole,
                            }
                        },
                        expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
                    });
                }
            }
        } else if (newLevel < oldLevel) {
            // Downgrade
            const mailId = `downgrade_${eventId}`;
            const mailRef = admin.firestore().collection('mail').doc(mailId);
            const exists = (await mailRef.get()).exists;
            if (!exists) {
                const userRecord = await admin.auth().getUser(uid);
                if (userRecord.email) {
                    logger.info(`[checkAndSendSubscriptionEmails] Queuing DOWNGRADE email for user ${uid}`);
                    await mailRef.set({
                        to: userRecord.email,
                        from: 'Quantified Self <hello@quantified-self.io>',
                        template: {
                            name: 'subscription_downgrade',
                            data: {
                                new_role: displayNames[newRole] || newRole,
                                old_role: displayNames[oldRole] || oldRole,
                                limit: (newRole === 'basic') ? '100' : '10', // Basic=100, Free=10
                            }
                        },
                        expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
                    });
                }
            }
        }
    }
    // 3. Cancellation (Active -> Canceled/Non-renewing)
    // Trigger: cancel_at_period_end goes from false -> true
    if (before && after && !before.cancel_at_period_end && after.cancel_at_period_end) {
        const currentPeriodEnd = after.current_period_end;
        if (currentPeriodEnd) {
            // We use subscriptionId + timestamp to allow for re-cancellation warnings if they renew
            // and cancel again later (different period end)
            // or just to avoid spamming if they toggle it quickly?
            // Ideally triggering on the *change* is enough, but using period_end helps uniqueness if they renew/cancel multiple times.
            const mailId = `cancellation_${subscriptionId}_${currentPeriodEnd.seconds}`;

            const mailRef = admin.firestore().collection('mail').doc(mailId);
            const exists = (await mailRef.get()).exists;

            if (!exists) {
                const userRecord = await admin.auth().getUser(uid);
                if (userRecord.email) {
                    logger.info(`[checkAndSendSubscriptionEmails] Queuing CANCELLATION email for user ${uid}`);
                    await mailRef.set({
                        to: userRecord.email,
                        from: 'Quantified Self <hello@quantified-self.io>',
                        template: {
                            name: 'subscription_cancellation',
                            data: {
                                role: displayNames[after.role] || after.role,
                                expiration_date: formatDate(currentPeriodEnd),
                            }
                        },
                        expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
                    });
                }
            }
        }
    }
}

