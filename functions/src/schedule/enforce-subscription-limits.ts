import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { deauthorizeServiceForUser } from '../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { GRACE_PERIOD_DAYS } from '../shared/limits';

/**
 * Disconnects external services (Garmin, Suunto, COROS) for users who have no active pro subscription.
 * Iterates through all connected tokens to ensure strict enforcement.
 */
export const enforceSubscriptionLimits = onSchedule({
    region: 'europe-west2',
    schedule: 'every 24 hours',
}, async (_event) => {
    // 1. Identify all users with ANY connected service
    const userIDs = new Set<string>();

    // Garmin Tokens
    const garminSnapshot = await admin.firestore().collection(GARMIN_API_TOKENS_COLLECTION_NAME).get();
    garminSnapshot.forEach(doc => userIDs.add(doc.id));

    // Suunto Tokens
    const suuntoSnapshot = await admin.firestore().collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).get();
    suuntoSnapshot.forEach(doc => userIDs.add(doc.id));

    // COROS Tokens
    const corosSnapshot = await admin.firestore().collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME).get();
    corosSnapshot.forEach(doc => userIDs.add(doc.id));

    logger.info(`Found ${userIDs.size} users with connected services.`);

    for (const uid of userIDs) {
        // 1. Fetch User Data for Grace Period
        const systemDoc = await admin.firestore().doc(`users/${uid}/system/status`).get();
        const systemData = systemDoc.data();
        const gracePeriodUntil = systemData?.gracePeriodUntil;

        // 2. Check for ACTIVE Pro status
        const activeSubSnapshot = await admin.firestore().collection(`customers/${uid}/subscriptions`)
            .where('status', 'in', ['active', 'trialing'])
            .where('role', '==', 'pro') // Sync is PRO only
            .limit(1)
            .get();

        const isPro = !activeSubSnapshot.empty;

        // 3. Handle Grace Period & Fail-safe
        if (!isPro) {
            if (gracePeriodUntil) {
                const now = admin.firestore.Timestamp.now();
                if (gracePeriodUntil.toMillis() > now.toMillis()) {
                    logger.info(`User ${uid} in grace period until ${gracePeriodUntil.toDate().toISOString()}. Skipping cleanup.`);
                    continue;
                }
            } else {
                // FAIL-SAFE: Trigger might have failed. Initialize grace period now.
                const newGracePeriodUntil = admin.firestore.Timestamp.fromDate(
                    new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
                );
                logger.info(`FAIL-SAFE: No grace period found for non-pro user ${uid}. Initializing to ${newGracePeriodUntil.toDate().toISOString()}.`);
                await admin.firestore().doc(`users/${uid}/system/status`).set({
                    gracePeriodUntil: newGracePeriodUntil,
                    lastDowngradedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                continue; // Skip cleanup for this run, let them have their 30 days
            }
        }

        // 4. Disconnect Services & Clear Claims (Strict enforcement)
        if (!isPro) {
            logger.info(`Disconnecting services and clearing claims for user ${uid} (No active pro status and grace period expired).`);

            // Clear Auth claims
            try { await admin.auth().setCustomUserClaims(uid, { stripeRole: 'free' }); } catch (e) { logger.error(`Error clearing claims for ${uid}`, e); }

            // Disconnect sync
            try { await deauthorizeServiceForUser(uid, ServiceNames.SuuntoApp); } catch (e) { logger.error(`Error deauthorizing Suunto for ${uid}`, e); }
            try { await deauthorizeServiceForUser(uid, ServiceNames.COROSAPI); } catch (e) { logger.error(`Error deauthorizing COROS for ${uid}`, e); }
            try { await deauthorizeServiceForUser(uid, ServiceNames.GarminAPI); } catch (e) { logger.error(`Error deauthorizing Garmin for ${uid}`, e); }
        }

        // 5. Activity Pruning (Destructive - Delete Newest)
        // Check role again for limits (Free=10, Basic=100)
        const subSnapshot = await admin.firestore().collection(`customers/${uid}/subscriptions`)
            .where('status', 'in', ['active', 'trialing'])
            .where('role', '==', 'basic')
            .limit(1)
            .get();

        const isBasic = !subSnapshot.empty;
        const limit = isPro ? Infinity : (isBasic ? 100 : 10);

        if (limit !== Infinity) {
            const eventsRef = admin.firestore().collection(`users/${uid}/events`);
            const countSnapshot = await eventsRef.count().get();
            const actualCount = countSnapshot.data().count;

            if (actualCount > limit) {
                const excess = actualCount - limit;
                logger.info(`User ${uid} has ${actualCount} events (limit: ${limit}). Deleting ${excess} newest events.`);

                // Get the newest 'excess' events
                const excessSnapshot = await eventsRef
                    .orderBy('startDate', 'desc') // Newer first
                    .limit(excess)
                    .get();

                for (const eventDoc of excessSnapshot.docs) {
                    logger.info(`Deleting excess event ${eventDoc.id}`);
                    await admin.firestore().recursiveDelete(eventDoc.ref);
                }
            }
        }
    }
});
