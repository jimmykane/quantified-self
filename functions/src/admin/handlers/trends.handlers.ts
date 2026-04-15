import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { onAdminCall } from '../../shared/auth';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import {
    GetSubscriptionHistoryTrendRequest,
    GetUserGrowthTrendRequest,
    SubscriptionHistoryTrendBucket,
    SubscriptionHistoryTrendResponse,
    UserGrowthTrendBucket,
    UserGrowthTrendResponse,
} from '../shared/types';
import { ACTIVE_SUBSCRIPTION_STATUS_SET, ACTIVE_SUBSCRIPTION_STATUSES, SUBSCRIPTION_ROLE_BASIC, SUBSCRIPTION_ROLE_PRO } from '../shared/subscription.constants';
import { buildMonthlyBucketWindows, clampSubscriptionHistoryMonths, toEpochMillis, toUtcMonthKey } from '../shared/date.utils';

/**
 * Returns historical monthly subscription lifecycle buckets for Admin dashboards.
 * Buckets are generated in UTC and include:
 * - newSubscriptions: subscriptions created in each month
 * - plannedCancellations: subscriptions with cancel_at_period_end=true whose current_period_end falls in month
 * - net: newSubscriptions - plannedCancellations
 */
export const getSubscriptionHistoryTrend = onAdminCall<GetSubscriptionHistoryTrendRequest, SubscriptionHistoryTrendResponse>({
    region: FUNCTIONS_MANIFEST.getSubscriptionHistoryTrend.region,
    memory: '256MiB',
}, async (request) => {
    try {
        const db = admin.firestore();
        const months = clampSubscriptionHistoryMonths(request.data?.months);
        const bucketWindows = buildMonthlyBucketWindows(months, new Date());

        if (bucketWindows.length === 0) {
            return {
                months,
                buckets: [],
                totals: {
                    newSubscriptions: 0,
                    plannedCancellations: 0,
                    net: 0,
                    basicNewSubscriptions: 0,
                    basicPlannedCancellations: 0,
                    basicNet: 0,
                    proNewSubscriptions: 0,
                    proPlannedCancellations: 0,
                    proNet: 0
                }
            };
        }

        const rangeStartMs = bucketWindows[0].startMs;
        const rangeEndMs = bucketWindows[bucketWindows.length - 1].endMs;
        const rangeStartDate = new Date(rangeStartMs);
        const rangeEndDate = new Date(rangeEndMs);

        const [newSubscriptionSnapshot, plannedCancellationSnapshot] = await Promise.all([
            db.collectionGroup('subscriptions')
                .where('created', '>=', rangeStartDate)
                .where('created', '<', rangeEndDate)
                .select('created', 'role')
                .get(),
            db.collectionGroup('subscriptions')
                .where('cancel_at_period_end', '==', true)
                .where('status', 'in', [...ACTIVE_SUBSCRIPTION_STATUSES])
                .where('current_period_end', '>=', rangeStartDate)
                .where('current_period_end', '<', rangeEndDate)
                .select('current_period_end', 'cancel_at_period_end', 'status', 'role')
                .get()
        ]);

        const buckets = bucketWindows.map((window) => ({
            key: window.key,
            label: window.label,
            newSubscriptions: 0,
            plannedCancellations: 0,
            net: 0,
            basicNewSubscriptions: 0,
            basicPlannedCancellations: 0,
            basicNet: 0,
            proNewSubscriptions: 0,
            proPlannedCancellations: 0,
            proNet: 0
        }));
        const bucketByKey = new Map<string, SubscriptionHistoryTrendBucket>();
        buckets.forEach(bucket => {
            bucketByKey.set(bucket.key, bucket);
        });

        newSubscriptionSnapshot.docs.forEach(doc => {
            const subscription = doc.data() as Record<string, unknown>;
            const createdAtMillis = toEpochMillis(subscription.created);
            if (createdAtMillis === null || createdAtMillis < rangeStartMs || createdAtMillis >= rangeEndMs) {
                return;
            }
            const bucket = bucketByKey.get(toUtcMonthKey(createdAtMillis));
            if (bucket) {
                bucket.newSubscriptions += 1;
                const role = `${subscription.role || ''}`.toLowerCase();
                if (role === SUBSCRIPTION_ROLE_BASIC) {
                    bucket.basicNewSubscriptions += 1;
                } else if (role === SUBSCRIPTION_ROLE_PRO) {
                    bucket.proNewSubscriptions += 1;
                }
            }
        });

        plannedCancellationSnapshot.docs.forEach(doc => {
            const subscription = doc.data() as Record<string, unknown>;
            const status = `${subscription.status || ''}`.toLowerCase();
            if (subscription.cancel_at_period_end !== true || !ACTIVE_SUBSCRIPTION_STATUS_SET.has(status)) {
                return;
            }
            const periodEndMillis = toEpochMillis(subscription.current_period_end);
            if (periodEndMillis === null || periodEndMillis < rangeStartMs || periodEndMillis >= rangeEndMs) {
                return;
            }
            const bucket = bucketByKey.get(toUtcMonthKey(periodEndMillis));
            if (bucket) {
                bucket.plannedCancellations += 1;
                const role = `${subscription.role || ''}`.toLowerCase();
                if (role === SUBSCRIPTION_ROLE_BASIC) {
                    bucket.basicPlannedCancellations += 1;
                } else if (role === SUBSCRIPTION_ROLE_PRO) {
                    bucket.proPlannedCancellations += 1;
                }
            }
        });

        let totalNewSubscriptions = 0;
        let totalPlannedCancellations = 0;
        let totalBasicNewSubscriptions = 0;
        let totalBasicPlannedCancellations = 0;
        let totalProNewSubscriptions = 0;
        let totalProPlannedCancellations = 0;
        buckets.forEach(bucket => {
            bucket.net = bucket.newSubscriptions - bucket.plannedCancellations;
            bucket.basicNet = bucket.basicNewSubscriptions - bucket.basicPlannedCancellations;
            bucket.proNet = bucket.proNewSubscriptions - bucket.proPlannedCancellations;
            totalNewSubscriptions += bucket.newSubscriptions;
            totalPlannedCancellations += bucket.plannedCancellations;
            totalBasicNewSubscriptions += bucket.basicNewSubscriptions;
            totalBasicPlannedCancellations += bucket.basicPlannedCancellations;
            totalProNewSubscriptions += bucket.proNewSubscriptions;
            totalProPlannedCancellations += bucket.proPlannedCancellations;
        });

        return {
            months,
            buckets,
            totals: {
                newSubscriptions: totalNewSubscriptions,
                plannedCancellations: totalPlannedCancellations,
                net: totalNewSubscriptions - totalPlannedCancellations,
                basicNewSubscriptions: totalBasicNewSubscriptions,
                basicPlannedCancellations: totalBasicPlannedCancellations,
                basicNet: totalBasicNewSubscriptions - totalBasicPlannedCancellations,
                proNewSubscriptions: totalProNewSubscriptions,
                proPlannedCancellations: totalProPlannedCancellations,
                proNet: totalProNewSubscriptions - totalProPlannedCancellations
            }
        };
    } catch (error: unknown) {
        logger.error('Error getting subscription history trend:', error);
        throw new HttpsError('internal', 'Failed to get subscription history trend');
    }
});

/**
 * Returns historical monthly user growth buckets for Admin dashboards.
 * Buckets are generated in UTC and include:
 * - registeredUsers: users created in each month
 * - onboardedUsers: same users where onboardingCompleted === true
 */
export const getUserGrowthTrend = onAdminCall<GetUserGrowthTrendRequest, UserGrowthTrendResponse>({
    region: FUNCTIONS_MANIFEST.getUserGrowthTrend.region,
    memory: '256MiB',
}, async (request) => {
    try {
        const db = admin.firestore();
        const months = clampSubscriptionHistoryMonths(request.data?.months);
        const bucketWindows = buildMonthlyBucketWindows(months, new Date());

        if (bucketWindows.length === 0) {
            return {
                months,
                buckets: [],
                totals: {
                    registeredUsers: 0,
                    onboardedUsers: 0
                }
            };
        }

        const rangeStartMs = bucketWindows[0].startMs;
        const rangeEndMs = bucketWindows[bucketWindows.length - 1].endMs;
        const rangeStartDate = new Date(rangeStartMs);
        const rangeEndDate = new Date(rangeEndMs);

        const userSnapshot = await db.collection('users')
            .where('creationDate', '>=', rangeStartDate)
            .where('creationDate', '<', rangeEndDate)
            .select('creationDate', 'onboardingCompleted')
            .get();

        const buckets = bucketWindows.map((window) => ({
            key: window.key,
            label: window.label,
            registeredUsers: 0,
            onboardedUsers: 0
        }));
        const bucketByKey = new Map<string, UserGrowthTrendBucket>();
        buckets.forEach(bucket => {
            bucketByKey.set(bucket.key, bucket);
        });

        userSnapshot.docs.forEach(doc => {
            const user = doc.data() as Record<string, unknown>;
            const creationDateMillis = toEpochMillis(user.creationDate);
            if (creationDateMillis === null || creationDateMillis < rangeStartMs || creationDateMillis >= rangeEndMs) {
                return;
            }

            const bucket = bucketByKey.get(toUtcMonthKey(creationDateMillis));
            if (!bucket) {
                return;
            }

            bucket.registeredUsers += 1;
            if (user.onboardingCompleted === true) {
                bucket.onboardedUsers += 1;
            }
        });

        const totals = buckets.reduce(
            (accu, bucket) => {
                accu.registeredUsers += bucket.registeredUsers;
                accu.onboardedUsers += bucket.onboardedUsers;
                return accu;
            },
            {
                registeredUsers: 0,
                onboardedUsers: 0
            }
        );

        return {
            months,
            buckets,
            totals
        };
    } catch (error: unknown) {
        logger.error('Error getting user growth trend:', error);
        throw new HttpsError('internal', 'Failed to get user growth trend');
    }
});
