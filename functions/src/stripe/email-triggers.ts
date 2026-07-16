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
import { isDeviceSyncEnabledForRole } from '../../../shared/limits';
import {
    buildEmailPlanDetails,
    EMAIL_LINKS,
    formatEmailDate,
    formatGracePeriodEnd,
    TRANSACTIONAL_EMAIL_FROM,
    TRANSACTIONAL_EMAIL_REPLY_TO,
} from '../email/config';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import {
    getCanonicalEndingSubscription,
    getTimestampMillis,
    isActiveSubscription,
} from './subscription-state';

interface PendingSubscriptionEmail {
    id: string;
    label: string;
    payload: FirebaseFirestore.DocumentData;
}

function isAuthUserNotFound(error: unknown): boolean {
    const authError = error as { code?: string; errorInfo?: { code?: string } };
    return authError.code === 'auth/user-not-found'
        || authError.errorInfo?.code === 'auth/user-not-found';
}

function buildMailPayload(
    recipient: string,
    templateName: string,
    data: Record<string, unknown>,
): FirebaseFirestore.DocumentData {
    return {
        to: recipient,
        from: TRANSACTIONAL_EMAIL_FROM,
        replyTo: TRANSACTIONAL_EMAIL_REPLY_TO,
        template: {
            name: templateName,
            data,
        },
        expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
    };
}

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
 * ## Idempotency and current-state validation
 * Mail documents are created in a transaction that re-reads the current
 * subscription, all active subscriptions, and the account-deletion guard.
 * Existing deterministic mail IDs are preserved without resetting delivery
 * state, and stale or non-terminal cancellation events are skipped.
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
    const wasActive = isActiveSubscription(before);
    const isEventNowActive = isActiveSubscription(after);
    const shouldWelcome = !!after?.role && isEventNowActive && !wasActive;
    const oldRole = before?.role;
    const newRole = after?.role;
    const oldLevel = oldRole ? hierarchy[oldRole] || 0 : 0;
    const newLevel = newRole ? hierarchy[newRole] || 0 : 0;
    const shouldUpgrade = !!oldRole && !!newRole && oldRole !== newRole && newLevel > oldLevel;
    const shouldDowngrade = !!oldRole && !!newRole && oldRole !== newRole && newLevel < oldLevel;
    const shouldCancel = !!before && !!after
        && !before.cancel_at_period_end
        && after.cancel_at_period_end === true
        && getTimestampMillis(after.current_period_end) !== null;

    if (!shouldWelcome && !shouldUpgrade && !shouldDowngrade && !shouldCancel) {
        return;
    }

    let recipient: string | undefined;
    try {
        recipient = (await admin.auth().getUser(uid)).email;
    } catch (error) {
        if (isAuthUserNotFound(error)) {
            logger.info('[checkAndSendSubscriptionEmails] Skipping subscription email because the Auth user no longer exists.', { uid });
            return;
        }
        throw error;
    }

    if (!recipient) {
        logger.info('[checkAndSendSubscriptionEmails] Skipping subscription email because the Auth user has no email.', { uid });
        return;
    }

    const firestore = admin.firestore();
    const currentSubscriptionRef = firestore.doc(`customers/${uid}/subscriptions/${subscriptionId}`);
    const activeSubscriptionsQuery = firestore.collection(`customers/${uid}/subscriptions`)
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc');

    const result = await firestore.runTransaction(async transaction => {
        const [deletionGuard, currentSubscriptionDoc, activeSubscriptionsSnapshot] = await Promise.all([
            getUserDeletionGuardStateInTransaction(firestore, transaction, uid),
            transaction.get(currentSubscriptionRef),
            transaction.get(activeSubscriptionsQuery),
        ]);

        if (deletionGuard.shouldSkip) {
            return { status: 'skip-deleted-user' as const, queuedLabels: [] as string[] };
        }

        const currentSubscription = currentSubscriptionDoc.data();
        if (!currentSubscriptionDoc.exists || !currentSubscription || !isActiveSubscription(currentSubscription)) {
            return { status: 'skip-stale-event' as const, queuedLabels: [] as string[] };
        }

        const pendingEmails: PendingSubscriptionEmail[] = [];
        const effectiveSubscriptionId = activeSubscriptionsSnapshot.docs[0]?.id;
        const triggeringSubscriptionDefinesMembership = effectiveSubscriptionId === subscriptionId;

        if (shouldWelcome && currentSubscription.role) {
            const currentRole = `${currentSubscription.role}`;
            pendingEmails.push({
                id: `welcome_email_${subscriptionId}`,
                label: 'welcome',
                payload: buildMailPayload(recipient, 'welcome_email', {
                    role: displayNames[currentRole] || currentRole,
                    is_trial: currentSubscription.status === 'trialing',
                    ...buildEmailPlanDetails(currentRole),
                    dashboard_url: EMAIL_LINKS.dashboard,
                }),
            });
        }

        if (shouldUpgrade
            && wasActive
            && isEventNowActive
            && triggeringSubscriptionDefinesMembership
            && currentSubscription.role === newRole) {
            pendingEmails.push({
                id: `upgrade_${eventId}`,
                label: 'upgrade',
                payload: buildMailPayload(recipient, 'subscription_upgrade', {
                    new_role: displayNames[newRole] || newRole,
                    old_role: displayNames[oldRole] || oldRole,
                    ...buildEmailPlanDetails(newRole),
                    dashboard_url: EMAIL_LINKS.dashboard,
                }),
            });
        }

        if (shouldDowngrade
            && wasActive
            && isEventNowActive
            && triggeringSubscriptionDefinesMembership
            && currentSubscription.role === newRole) {
            pendingEmails.push({
                id: `downgrade_${eventId}`,
                label: 'downgrade',
                payload: buildMailPayload(recipient, 'subscription_downgrade', {
                    new_role: displayNames[newRole] || newRole,
                    old_role: displayNames[oldRole] || oldRole,
                    ...buildEmailPlanDetails(newRole),
                    device_sync_will_end: isDeviceSyncEnabledForRole(oldRole)
                        && !isDeviceSyncEnabledForRole(newRole),
                    membership_url: EMAIL_LINKS.membership,
                }),
            });
        }

        const eventPeriodEndMs = getTimestampMillis(after?.current_period_end);
        const currentPeriodEndMs = getTimestampMillis(currentSubscription.current_period_end);
        if (shouldCancel
            && currentSubscription.cancel_at_period_end === true
            && eventPeriodEndMs !== null
            && currentPeriodEndMs === eventPeriodEndMs) {
            const canonicalEndingSubscription = getCanonicalEndingSubscription(activeSubscriptionsSnapshot.docs);
            if (canonicalEndingSubscription) {
                const canonicalRole = `${canonicalEndingSubscription.subscription.role || after?.role || ''}`;
                const freePlanDetails = buildEmailPlanDetails('free');
                const deviceSyncWillEnd = activeSubscriptionsSnapshot.docs.some(subscriptionDoc => (
                    isDeviceSyncEnabledForRole(`${subscriptionDoc.data().role || ''}`)
                ));
                pendingEmails.push({
                    id: `cancellation_${canonicalEndingSubscription.subscriptionId}_${Math.floor(canonicalEndingSubscription.currentPeriodEndMs / 1000)}`,
                    label: 'cancellation',
                    payload: buildMailPayload(recipient, 'subscription_cancellation', {
                        role: displayNames[canonicalRole] || canonicalRole,
                        expiration_date: formatEmailDate(canonicalEndingSubscription.subscription.current_period_end),
                        grace_period_end: formatGracePeriodEnd(canonicalEndingSubscription.subscription.current_period_end),
                        free_activity_description: freePlanDetails.activity_description,
                        free_route_description: freePlanDetails.route_description,
                        free_ai_insights_description: freePlanDetails.ai_insights_description,
                        device_sync_will_end: deviceSyncWillEnd,
                        membership_url: EMAIL_LINKS.membership,
                    }),
                });
            }
        }

        if (pendingEmails.length === 0) {
            return { status: 'skip-stale-event' as const, queuedLabels: [] as string[] };
        }

        const uniquePendingEmails = Array.from(new Map(
            pendingEmails.map(email => [email.id, email]),
        ).values());
        const mailRefs = uniquePendingEmails.map(email => firestore.collection('mail').doc(email.id));
        const existingMailDocs = await Promise.all(mailRefs.map(mailRef => transaction.get(mailRef)));
        const queuedLabels: string[] = [];

        uniquePendingEmails.forEach((email, index) => {
            if (existingMailDocs[index].exists) {
                return;
            }
            transaction.create(mailRefs[index], email.payload);
            queuedLabels.push(email.label);
        });

        return { status: 'processed' as const, queuedLabels };
    });

    if (result.status === 'skip-deleted-user') {
        logger.info('[checkAndSendSubscriptionEmails] Skipping subscription email because the user is missing or being deleted.', { uid });
        return;
    }

    if (result.status === 'skip-stale-event') {
        logger.info('[checkAndSendSubscriptionEmails] Skipping stale subscription email event.', { uid, subscriptionId, eventId });
        return;
    }

    for (const label of result.queuedLabels) {
        logger.info(`[checkAndSendSubscriptionEmails] Queued ${label} email for user ${uid}.`);
    }
}
