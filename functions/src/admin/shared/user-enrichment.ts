import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../../coros/constants';
import { toEpochMillis } from './date.utils';
import { BasicUser, EnrichedUser } from './types';

function buildAiInsightsUsageDocIdForSubscriptionPeriod(
    periodStart: unknown,
    periodEnd: unknown
): string | null {
    const periodStartMs = toEpochMillis(periodStart);
    const periodEndMs = toEpochMillis(periodEnd);

    if (periodStartMs === null || periodEndMs === null) {
        return null;
    }

    return `period_${periodStartMs}_${periodEndMs}`;
}

function resolveAiInsightsSuccessfulRequestCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.floor(value));
}

function resolveAiCreditsConsumedFromUsageData(value: unknown): number {
    if (!value || typeof value !== 'object') {
        return 0;
    }

    return resolveAiInsightsSuccessfulRequestCount(
        (value as { successfulRequestCount?: unknown }).successfulRequestCount
    );
}

/**
 * Enrich a small batch of users with Firestore data (subscriptions, services)
 * This is the ONLY place we do Firestore reads
 */
export async function enrichUsers(
    users: BasicUser[],
    db: admin.firestore.Firestore
): Promise<EnrichedUser[]> {
    const userFlagsByUid = new Map<string, { onboardingCompleted: boolean; hasSubscribedOnce: boolean }>();

    if (users.length > 0) {
        try {
            const userDocRefs = users.map(user => db.collection('users').doc(user.uid));
            const userDocs = await db.getAll(...userDocRefs);

            userDocs.forEach(snapshot => {
                const userData = snapshot.data() || {};
                userFlagsByUid.set(snapshot.id, {
                    onboardingCompleted: userData.onboardingCompleted === true,
                    hasSubscribedOnce: userData.hasSubscribedOnce === true
                });
            });
        } catch (e) {
            logger.warn('Failed to fetch onboarding flags for admin user list', e);
        }
    }

    return Promise.all(
        users.map(async (user) => {
            let subscriptionData: EnrichedUser['subscription'] = null;
            const connectedServices: { provider: string; connectedAt: unknown }[] = [];
            let aiCreditsConsumed = 0;
            let hasResolvedAiUsageFromCurrentPeriod = false;
            const hasSubscribedOnce = userFlagsByUid.get(user.uid)?.hasSubscribedOnce === true;

            try {
                const [subsSnapshot, garminDoc, suuntoSnapshot, corosSnapshot] = await Promise.all([
                    db.collection('customers')
                        .doc(user.uid)
                        .collection('subscriptions')
                        .where('status', 'in', ['active', 'trialing', 'past_due'])
                        .orderBy('created', 'desc')
                        .limit(1)
                        .get(),
                    db.collection(GARMIN_API_TOKENS_COLLECTION_NAME).doc(user.uid).collection('tokens').limit(1).get(),
                    db.collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(user.uid).collection('tokens').limit(1).get(),
                    db.collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME).doc(user.uid).collection('tokens').limit(1).get()
                ]);

                if (!subsSnapshot.empty) {
                    const sub = subsSnapshot.docs[0].data();
                    subscriptionData = {
                        status: sub.status,
                        current_period_end: sub.current_period_end,
                        cancel_at_period_end: sub.cancel_at_period_end,
                        stripeLink: sub.stripeLink
                    };

                    const usageDocID = buildAiInsightsUsageDocIdForSubscriptionPeriod(
                        sub.current_period_start,
                        sub.current_period_end
                    );

                    if (usageDocID) {
                        const usageSnapshot = await db.collection('users')
                            .doc(user.uid)
                            .collection('aiInsightsUsage')
                            .doc(usageDocID)
                            .get();

                        if (usageSnapshot.exists) {
                            aiCreditsConsumed = resolveAiCreditsConsumedFromUsageData(usageSnapshot.data());
                            hasResolvedAiUsageFromCurrentPeriod = true;
                        }
                    }
                }

                if (!hasResolvedAiUsageFromCurrentPeriod && !subscriptionData && hasSubscribedOnce) {
                    try {
                        const latestUsageSnapshot = await db.collection('users')
                            .doc(user.uid)
                            .collection('aiInsightsUsage')
                            .orderBy('periodEnd', 'desc')
                            .limit(1)
                            .get();

                        if (!latestUsageSnapshot.empty) {
                            aiCreditsConsumed = resolveAiCreditsConsumedFromUsageData(
                                latestUsageSnapshot.docs[0].data()
                            );
                        }
                    } catch (fallbackUsageError) {
                        logger.warn(`Failed to fetch fallback AI usage for ${user.uid}`, fallbackUsageError);
                    }
                }

                if (!garminDoc.empty) {
                    const doc = garminDoc.docs[0];
                    const docData = doc.data();
                    connectedServices.push({ provider: 'Garmin', connectedAt: docData?.dateCreated || doc.createTime });
                }
                if (!suuntoSnapshot.empty) {
                    const doc = suuntoSnapshot.docs[0];
                    const docData = doc.data();
                    connectedServices.push({ provider: 'Suunto', connectedAt: docData?.dateCreated || doc.createTime });
                }
                if (!corosSnapshot.empty) {
                    const doc = corosSnapshot.docs[0];
                    const docData = doc.data();
                    connectedServices.push({ provider: 'COROS', connectedAt: docData?.dateCreated || doc.createTime });
                }
            } catch (e) {
                logger.warn(`Failed to fetch details for ${user.uid}`, e);
            }

            return {
                ...user,
                subscription: subscriptionData,
                connectedServices: connectedServices,
                onboardingCompleted: userFlagsByUid.get(user.uid)?.onboardingCompleted === true,
                hasSubscribedOnce,
                aiCreditsConsumed
            };
        })
    );
}
