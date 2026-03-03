import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { deauthorizeServiceForUser } from '../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { reconcileClaims } from '../stripe/claims';

import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { GRACE_PERIOD_DAYS, getUsageLimitForRole } from '../shared/limits';

const EVENT_PRUNE_BATCH_SIZE = 250;
const USER_PROCESS_BATCH_SIZE = 10;
const USER_SCAN_PAGE_SIZE = 500;

/**
 * Disconnects external services (Garmin, Suunto, COROS) for users who have no active pro subscription.
 * Iterates through all connected tokens to ensure strict enforcement.
 */
export const enforceSubscriptionLimits = onSchedule({
    region: 'europe-west2',
    schedule: 'every 24 hours',
}, async (_event) => {
    const connectedUserIds = await getConnectedUserIds();
    logger.info(`Found ${connectedUserIds.size} users with connected services.`);

    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

    while (true) {
        let query = admin.firestore()
            .collection('users')
            .select('hasSubscribedOnce')
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(USER_SCAN_PAGE_SIZE);

        if (cursor) {
            query = query.startAfter(cursor);
        }

        const snapshot = await query.get();
        if (snapshot.empty) {
            break;
        }

        const users = snapshot.docs.map((doc) => ({
            uid: doc.id,
            hasConnectedServices: connectedUserIds.has(doc.id),
            hasPaidHistory: doc.data()?.hasSubscribedOnce === true
        }));

        for (let i = 0; i < users.length; i += USER_PROCESS_BATCH_SIZE) {
            const batch = users.slice(i, i + USER_PROCESS_BATCH_SIZE);
            await Promise.all(batch.map(async (user) => {
                try {
                    await processUser(user.uid, user.hasConnectedServices, user.hasPaidHistory);
                } catch (err) {
                    logger.error(`Error processing user ${user.uid}`, err);
                }
            }));
        }

        if (snapshot.docs.length < USER_SCAN_PAGE_SIZE) {
            break;
        }

        cursor = snapshot.docs[snapshot.docs.length - 1];
    }
});

async function getConnectedUserIds(): Promise<Set<string>> {
    const userIDs = new Set<string>();

    const garminSnapshot = await admin.firestore().collection(GARMIN_API_TOKENS_COLLECTION_NAME).get();
    garminSnapshot.forEach(doc => userIDs.add(doc.id));

    const suuntoSnapshot = await admin.firestore().collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).get();
    suuntoSnapshot.forEach(doc => userIDs.add(doc.id));

    const corosSnapshot = await admin.firestore().collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME).get();
    corosSnapshot.forEach(doc => userIDs.add(doc.id));

    return userIDs;
}

async function getUserEntitlementState(uid: string): Promise<{
    activeRole: string;
    hasActiveSubscription: boolean;
    gracePeriodUntil?: FirebaseFirestore.Timestamp;
}> {
    const [systemDoc, activeSubSnapshot] = await Promise.all([
        admin.firestore().doc(`users/${uid}/system/status`).get(),
        admin.firestore().collection(`customers/${uid}/subscriptions`)
            .where('status', 'in', ['active', 'trialing'])
            .orderBy('created', 'desc')
            .limit(1)
            .get()
    ]);

    const systemData = systemDoc.data();
    const gracePeriodUntil = systemData?.gracePeriodUntil as FirebaseFirestore.Timestamp | undefined;
    const subscription = activeSubSnapshot.empty ? null : activeSubSnapshot.docs[0].data();

    return {
        activeRole: subscription?.role ?? 'free',
        hasActiveSubscription: !activeSubSnapshot.empty,
        gracePeriodUntil
    };
}

function isGracePeriodActive(gracePeriodUntil?: FirebaseFirestore.Timestamp): boolean {
    if (!gracePeriodUntil) {
        return false;
    }

    return gracePeriodUntil.toMillis() > admin.firestore.Timestamp.now().toMillis();
}

async function processUser(uid: string, hasConnectedServices: boolean, hasPaidHistory: boolean) {
    const { activeRole, hasActiveSubscription, gracePeriodUntil } = await getUserEntitlementState(uid);
    const isPro = activeRole === 'pro';

    // 3. Handle Grace Period & Fail-safe (Only if NOT Pro)
    if (!isPro) {
        if (isGracePeriodActive(gracePeriodUntil)) {
            logger.info(`User ${uid} in grace period until ${gracePeriodUntil!.toDate().toISOString()}. Skipping cleanup.`);
            // Ensure claims are synced so backend checks recognize the grace period
            // This prevents "soft-lock" where a user has a grace period doc but missing Auth claims
            await reconcileClaims(uid);
            return;
        }

        if (!gracePeriodUntil && (hasConnectedServices || (!hasActiveSubscription && hasPaidHistory))) {
            // FAIL-SAFE: Trigger might have failed. Initialize grace period now.
            const newGracePeriodUntil = admin.firestore.Timestamp.fromDate(
                new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
            );
            logger.info(`FAIL-SAFE: No grace period found for non-pro user ${uid}. Initializing to ${newGracePeriodUntil.toDate().toISOString()}.`);
            await admin.firestore().doc(`users/${uid}/system/status`).set({
                gracePeriodUntil: newGracePeriodUntil,
                lastDowngradedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // Ensure claims are synced so backend checks recognize the grace period
            await reconcileClaims(uid);

            return; // Skip cleanup for this run, let them have their 30 days
        }
    }

    // 4. Disconnect Services & Clear Claims (Strict enforcement)
    if (hasConnectedServices && !isPro) {
        logger.info(`Disconnecting services and clearing claims for user ${uid} (No active pro status and grace period expired).`);

        // Clear stale grace period state and preserve unrelated claims such as admin.
        try {
            await admin.firestore().doc(`users/${uid}/system/status`).set({
                gracePeriodUntil: admin.firestore.FieldValue.delete(),
                lastDowngradedAt: admin.firestore.FieldValue.delete()
            }, { merge: true });
        } catch (e) {
            logger.error(`Error clearing grace period state for ${uid}`, e);
        }

        try {
            const user = await admin.auth().getUser(uid);
            const nextClaims = { ...(user.customClaims || {}), stripeRole: 'free' } as Record<string, unknown>;
            delete nextClaims.gracePeriodUntil;
            await admin.auth().setCustomUserClaims(uid, nextClaims);
        } catch (e) {
            logger.error(`Error clearing claims for ${uid}`, e);
        }

        // Disconnect sync
        try { await deauthorizeServiceForUser(uid, ServiceNames.SuuntoApp); } catch (e) { logger.error(`Error deauthorizing Suunto for ${uid}`, e); }
        try { await deauthorizeServiceForUser(uid, ServiceNames.COROSAPI); } catch (e) { logger.error(`Error deauthorizing COROS for ${uid}`, e); }
        try { await deauthorizeServiceForUser(uid, ServiceNames.GarminAPI); } catch (e) { logger.error(`Error deauthorizing Garmin for ${uid}`, e); }
    }

    // 5. Activity Pruning (Destructive - Delete OLDEST)
    const limit = getUsageLimitForRole(activeRole);

    if (limit !== null) {
        const eventsRef = admin.firestore().collection(`users/${uid}/events`);
        const countSnapshot = await eventsRef.count().get();
        const actualCount = countSnapshot.data().count;


        if (actualCount > limit) {
            const excess = actualCount - limit;

            logger.info(`User ${uid} has ${actualCount} events (limit: ${limit}). Deleting ${excess} oldest events.`);
            let remainingToDelete = excess;

            while (remainingToDelete > 0) {
                const chunkSize = Math.min(EVENT_PRUNE_BATCH_SIZE, remainingToDelete);
                const excessSnapshot = await eventsRef
                    .orderBy('startDate', 'asc') // Oldest first
                    .limit(chunkSize)
                    .get();

                if (excessSnapshot.empty) {
                    logger.warn(`Expected ${remainingToDelete} more events to prune for ${uid}, but no more events were found.`);
                    break;
                }

                const bulkWriter = admin.firestore().bulkWriter();
                const deletePromises = excessSnapshot.docs.map((eventDoc) => {
                    logger.info(`Deleting excess event ${eventDoc.id}`);
                    return bulkWriter.delete(eventDoc.ref);
                });

                await bulkWriter.close();

                const deleteResults = await Promise.allSettled(deletePromises);
                const firstFailure = deleteResults.find((result): result is PromiseRejectedResult => result.status === 'rejected');
                if (firstFailure) {
                    throw firstFailure.reason;
                }

                remainingToDelete -= excessSnapshot.docs.length;
            }
        }
    }
}
