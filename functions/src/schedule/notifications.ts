import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import {
    buildEmailPlanDetails,
    EMAIL_LINKS,
    formatEmailDate,
    getRoleDisplayName,
    TRANSACTIONAL_EMAIL_FROM,
    TRANSACTIONAL_EMAIL_REPLY_TO,
} from '../email/config';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { isDeviceSyncEnabledForRole } from '../../../shared/limits';
import {
    getCanonicalEndingSubscription,
    getTimestampMillis,
} from '../stripe/subscription-state';

export const checkSubscriptionNotifications = onSchedule({ schedule: 'every 24 hours', region: 'europe-west2' }, async () => {
    const db = admin.firestore();
    const now = new Date();

    logger.info('Starting subscription notification check...');

    // -------------------------------------------------------------------------
    // 1. Subscription Expiring Soon (3 days out)
    // -------------------------------------------------------------------------
    const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
    const fourDaysFromNow = new Date(now.getTime() + (4 * 24 * 60 * 60 * 1000));

    // Firestore timestamp serialization of active intent
    const snapshot = await db.collectionGroup('subscriptions')
        .where('status', 'in', ['active', 'trialing'])
        .where('cancel_at_period_end', '==', true)
        .where('current_period_end', '>=', admin.firestore.Timestamp.fromDate(threeDaysFromNow))
        .where('current_period_end', '<', admin.firestore.Timestamp.fromDate(fourDaysFromNow))
        .get();

    logger.info(`Found ${snapshot.size} subscriptions expiring between ${threeDaysFromNow.toISOString()} and ${fourDaysFromNow.toISOString()}`);

    for (const doc of snapshot.docs) {
        const sub = doc.data();
        const uid = doc.ref.parent.parent?.id;

        if (!uid) {
            logger.error(`Could not determine UID for subscription ${doc.id}`);
            continue;
        }

        const idempotencyKey = `expiring_${doc.id}_${sub.current_period_end.seconds}`;
        const mailRef = db.collection('mail').doc(idempotencyKey);

        const systemStatusRef = db.doc(`users/${uid}/system/status`);
        const activeSubscriptionsQuery = doc.ref.parent
            .where('status', 'in', ['active', 'trialing']);
        const queueResult = await db.runTransaction(async transaction => {
            const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
            if (deletionGuard.shouldSkip) {
                return 'skip-deleted-user' as const;
            }

            const [currentSubscriptionDoc, activeSubscriptionsSnapshot, mailDoc] = await Promise.all([
                transaction.get(doc.ref),
                transaction.get(activeSubscriptionsQuery),
                transaction.get(mailRef),
            ]);
            const currentSubscription = currentSubscriptionDoc.data();
            const snapshotPeriodEndMs = getTimestampMillis(sub.current_period_end);
            const currentPeriodEndMs = getTimestampMillis(currentSubscription?.current_period_end);
            if (!currentSubscriptionDoc.exists
                || !currentSubscription
                || !['active', 'trialing'].includes(`${currentSubscription.status || ''}`)
                || currentSubscription?.cancel_at_period_end !== true
                || snapshotPeriodEndMs === null
                || currentPeriodEndMs !== snapshotPeriodEndMs) {
                return 'skip-stale-subscription' as const;
            }

            const canonicalEndingSubscription = getCanonicalEndingSubscription(
                activeSubscriptionsSnapshot.docs,
            );
            if (!canonicalEndingSubscription
                || canonicalEndingSubscription.subscriptionId !== doc.id
                || canonicalEndingSubscription.currentPeriodEndMs !== currentPeriodEndMs) {
                return 'skip-nonterminal-entitlement' as const;
            }

            const expirationDate = formatEmailDate(
                canonicalEndingSubscription.subscription.current_period_end,
            );
            const scheduledGracePeriodUntil = canonicalEndingSubscription.scheduledGracePeriodUntil;
            const freePlanDetails = buildEmailPlanDetails('free');
            const deviceSyncWillEnd = activeSubscriptionsSnapshot.docs.some(subscriptionDoc => (
                isDeviceSyncEnabledForRole(`${subscriptionDoc.data().role || ''}`)
            ));
            transaction.set(systemStatusRef, { scheduledGracePeriodUntil }, { merge: true });
            if (mailDoc.exists) {
                return 'already-queued' as const;
            }

            transaction.set(mailRef, {
                toUids: [uid],
                from: TRANSACTIONAL_EMAIL_FROM,
                replyTo: TRANSACTIONAL_EMAIL_REPLY_TO,
                template: {
                    name: 'subscription_expiring_soon',
                    data: {
                        role: getRoleDisplayName(canonicalEndingSubscription.subscription.role),
                        expiration_date: expirationDate,
                        grace_period_end: formatEmailDate(scheduledGracePeriodUntil),
                        free_activity_description: freePlanDetails.activity_description,
                        free_route_description: freePlanDetails.route_description,
                        free_ai_insights_description: freePlanDetails.ai_insights_description,
                        device_sync_will_end: deviceSyncWillEnd,
                        membership_url: EMAIL_LINKS.membership,
                    }
                },
                expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
            });
            return 'queued' as const;
        });

        if (queueResult === 'skip-deleted-user') {
            logger.info(`Skipping expiring email for deleted or missing user ${uid}`);
            continue;
        }

        if (queueResult === 'skip-stale-subscription') {
            logger.info(`Skipping stale expiring subscription snapshot for ${doc.id}`);
            continue;
        }

        if (queueResult === 'skip-nonterminal-entitlement') {
            logger.info(`Skipping expiring subscription ${doc.id} because another active entitlement continues or ends later.`);
            continue;
        }

        logger.info(queueResult === 'queued'
            ? `Queued expiring email for user ${uid}`
            : `Expiring email for ${doc.id} was already queued; repaired its canonical grace deadline.`);
    }

    logger.info('Subscription notification check complete.');
});
