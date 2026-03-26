import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { deauthorizeServiceForUser } from '../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { reconcileClaims } from '../stripe/claims';
import { TokenNotFoundError } from '../utils';

import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { GRACE_PERIOD_DAYS } from '../../../shared/limits';

const USER_PROCESS_BATCH_SIZE = 10;
const USER_SCAN_PAGE_SIZE = 500;
const SERVICES_TO_DEAUTHORIZE: ReadonlyArray<ServiceNames> = [
    ServiceNames.SuuntoApp,
    ServiceNames.COROSAPI,
    ServiceNames.GarminAPI
];

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
    const pendingConnectedUserIds = new Set(connectedUserIds);

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
            hasPaidHistory: doc.data()?.hasSubscribedOnce === true,
            userExists: true
        }));

        users.forEach((user) => pendingConnectedUserIds.delete(user.uid));

        for (let i = 0; i < users.length; i += USER_PROCESS_BATCH_SIZE) {
            const batch = users.slice(i, i + USER_PROCESS_BATCH_SIZE);
            await Promise.all(batch.map(async (user) => {
                try {
                    await processUser(user.uid, user.hasConnectedServices, user.hasPaidHistory, user.userExists);
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

    if (pendingConnectedUserIds.size > 0) {
        logger.info(`Found ${pendingConnectedUserIds.size} connected-service users without users/{uid} doc. Processing token cleanup.`);
        const orphanUsers = Array.from(pendingConnectedUserIds).map((uid) => ({
            uid,
            hasConnectedServices: true,
            hasPaidHistory: false,
            userExists: false
        }));

        for (let i = 0; i < orphanUsers.length; i += USER_PROCESS_BATCH_SIZE) {
            const batch = orphanUsers.slice(i, i + USER_PROCESS_BATCH_SIZE);
            await Promise.all(batch.map(async (user) => {
                try {
                    await processUser(user.uid, user.hasConnectedServices, user.hasPaidHistory, user.userExists);
                } catch (err) {
                    logger.error(`Error processing connected token cleanup for user ${user.uid}`, err);
                }
            }));
        }
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

function isAuthUserNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const authError = error as {
        code?: string;
        errorInfo?: {
            code?: string;
        };
    };

    return authError.code === 'auth/user-not-found' || authError.errorInfo?.code === 'auth/user-not-found';
}

function isTokenNotFoundError(error: unknown): boolean {
    if (error instanceof TokenNotFoundError) {
        return true;
    }

    if (!error || typeof error !== 'object') {
        return false;
    }

    return (error as { name?: string }).name === 'TokenNotFoundError';
}

async function deauthorizeConnectedServicesBestEffort(uid: string): Promise<void> {
    for (const serviceName of SERVICES_TO_DEAUTHORIZE) {
        try {
            await deauthorizeServiceForUser(uid, serviceName);
        } catch (error) {
            if (isTokenNotFoundError(error)) {
                logger.info(`[enforceSubscriptionLimits] No ${serviceName} tokens found for ${uid} during cleanup.`);
                continue;
            }

            logger.error(`[enforceSubscriptionLimits] Error deauthorizing ${serviceName} for ${uid}`, error);
        }
    }
}

async function cleanupOrphanedUserRoots(uid: string): Promise<void> {
    const db = admin.firestore();
    const roots = [
        db.doc(`users/${uid}`),
        db.doc(`customers/${uid}`)
    ];

    for (const root of roots) {
        try {
            await db.recursiveDelete(root);
            logger.info(`[enforceSubscriptionLimits] Recursively deleted orphaned path ${root.path} for missing Auth user ${uid}.`);
        } catch (error) {
            logger.error(`[enforceSubscriptionLimits] Error recursively deleting orphaned path ${root.path} for ${uid}`, error);
        }
    }
}

async function reconcileClaimsWithMissingAuthCleanup(uid: string, hasConnectedServices: boolean): Promise<boolean> {
    try {
        await reconcileClaims(uid);
        return true;
    } catch (error) {
        if (!isAuthUserNotFoundError(error)) {
            throw error;
        }

        logger.warn(`[enforceSubscriptionLimits] Auth user ${uid} not found during claim reconciliation. Cleaning orphaned Firestore roots.`);
        if (hasConnectedServices) {
            await deauthorizeConnectedServicesBestEffort(uid);
        }
        await cleanupOrphanedUserRoots(uid);
        return false;
    }
}

async function ensureAuthUserExistsForFailSafe(uid: string, hasConnectedServices: boolean): Promise<boolean> {
    try {
        await admin.auth().getUser(uid);
        return true;
    } catch (error) {
        if (!isAuthUserNotFoundError(error)) {
            throw error;
        }

        logger.warn(`[enforceSubscriptionLimits] Auth user ${uid} not found before fail-safe grace write. Cleaning orphaned Firestore roots.`);
        if (hasConnectedServices) {
            await deauthorizeConnectedServicesBestEffort(uid);
        }
        await cleanupOrphanedUserRoots(uid);
        return false;
    }
}

async function processUser(uid: string, hasConnectedServices: boolean, hasPaidHistory: boolean, userExists: boolean) {
    const { activeRole, hasActiveSubscription, gracePeriodUntil } = await getUserEntitlementState(uid);
    const isPro = activeRole === 'pro';

    // 3. Handle Grace Period & Fail-safe (Only if NOT Pro)
    if (!isPro) {
        if (isGracePeriodActive(gracePeriodUntil)) {
            logger.info(`User ${uid} in grace period until ${gracePeriodUntil!.toDate().toISOString()}. Skipping cleanup.`);
            // Ensure claims are synced so backend checks recognize the grace period
            // This prevents "soft-lock" where a user has a grace period doc but missing Auth claims
            await reconcileClaimsWithMissingAuthCleanup(uid, hasConnectedServices);
            return;
        }

        if (userExists && !gracePeriodUntil && (hasConnectedServices || (!hasActiveSubscription && hasPaidHistory))) {
            const authUserExists = await ensureAuthUserExistsForFailSafe(uid, hasConnectedServices);
            if (!authUserExists) {
                return;
            }

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
            await reconcileClaimsWithMissingAuthCleanup(uid, hasConnectedServices);

            return; // Skip cleanup for this run, let them have their 30 days
        }
    }

    // 4. Disconnect Services & Clear Claims (Strict enforcement)
    if (hasConnectedServices && !isPro) {
        logger.info(`Disconnecting services and clearing claims for user ${uid} (No active pro status and grace period expired).`);

        if (userExists) {
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
                if (isAuthUserNotFoundError(e)) {
                    logger.warn(`[enforceSubscriptionLimits] Auth user ${uid} not found while clearing claims. Cleaning orphaned Firestore roots.`);
                    await cleanupOrphanedUserRoots(uid);
                } else {
                    logger.error(`Error clearing claims for ${uid}`, e);
                }
            }
        } else {
            logger.info(`User ${uid} has connected services but no users/{uid} document. Skipping status/claims updates and deauthorizing services.`);
        }

        // Disconnect sync
        await deauthorizeConnectedServicesBestEffort(uid);
    }

    // Event pruning disabled: we retain historical events after grace-period expiry.
}
