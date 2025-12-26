import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ALLOWED_CORS_ORIGINS } from '../utils';

interface ListUsersRequest {
    pageSize?: number;
    page?: number;
    searchTerm?: string;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
}

interface BasicUser {
    uid: string;
    email: string | undefined;
    displayName: string | undefined;
    photoURL: string | undefined;
    customClaims: { [key: string]: unknown };
    metadata: {
        lastSignInTime: string | null;
        creationTime: string | null;
    };
    disabled: boolean;
    providerIds: string[];
}

interface EnrichedUser extends BasicUser {
    subscription: {
        status: string;
        current_period_end: unknown;
        cancel_at_period_end: boolean | undefined;
        stripeLink: string | undefined;
    } | null;
    connectedServices: { provider: string; connectedAt: unknown }[];
}

/**
 * Enrich a small batch of users with Firestore data (subscriptions, services)
 * This is the ONLY place we do Firestore reads
 */
async function enrichUsers(
    users: BasicUser[],
    db: admin.firestore.Firestore
): Promise<EnrichedUser[]> {
    return Promise.all(
        users.map(async (user) => {
            let subscriptionData: EnrichedUser['subscription'] = null;
            const connectedServices: { provider: string; connectedAt: unknown }[] = [];

            try {
                const [subsSnapshot, garminDoc, suuntoSnapshot, corosSnapshot] = await Promise.all([
                    db.collection('customers')
                        .doc(user.uid)
                        .collection('subscriptions')
                        .where('status', 'in', ['active', 'trialing', 'past_due'])
                        .orderBy('created', 'desc')
                        .limit(1)
                        .get(),
                    db.collection('garminHealthAPITokens').doc(user.uid).get(),
                    db.collection('suuntoAppAccessTokens').doc(user.uid).collection('tokens').limit(1).get(),
                    db.collection('COROSAPIAccessTokens').doc(user.uid).collection('tokens').limit(1).get()
                ]);

                if (!subsSnapshot.empty) {
                    const sub = subsSnapshot.docs[0].data();
                    subscriptionData = {
                        status: sub.status,
                        current_period_end: sub.current_period_end,
                        cancel_at_period_end: sub.cancel_at_period_end,
                        stripeLink: sub.stripeLink
                    };
                }

                if (garminDoc.exists) {
                    const docData = garminDoc.data();
                    connectedServices.push({ provider: 'Garmin', connectedAt: docData?.dateCreated || garminDoc.createTime });
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
                console.warn(`Failed to fetch details for ${user.uid}`, e);
            }

            return {
                ...user,
                subscription: subscriptionData,
                connectedServices: connectedServices
            };
        })
    );
}

/**
 * Lists all users with pagination, search, and sorting support.
 * OPTIMIZED: Only enriches users on the current page to minimize Firestore reads.
 * 
 * Performance:
 * - Firebase Auth listUsers: FREE (no Firestore reads)
 * - Search/Sort on Auth data: FREE
 * - Enrich current page only: ~4 reads per user (subscription, garmin, suunto, coros)
 * - For pageSize=10: ~40 Firestore reads total
 */
export const listUsers = onCall({
    region: 'europe-west2',
    cors: ALLOWED_CORS_ORIGINS,
    memory: '256MiB',
    timeoutSeconds: 120,
}, async (request) => {
    // 1. Check authentication
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    // 2. Check for admin claim
    if (request.auth.token.admin !== true) {
        throw new HttpsError('permission-denied', 'Only admins can call this function.');
    }

    try {
        const data = request.data as ListUsersRequest || {};
        const pageSize = data.pageSize ? parseInt(String(data.pageSize)) : 10;
        const page = data.page ? parseInt(String(data.page)) : 0;
        const searchTerm = (data.searchTerm || '').toLowerCase().trim();
        const sortField = data.sortField || 'email';
        const sortDirection = data.sortDirection || 'asc';

        // ============================================
        // STEP 1: Fetch ALL users from Firebase Auth
        // This is FREE - no Firestore reads
        // ============================================
        const allAuthUsers: BasicUser[] = [];
        let nextPageToken: string | undefined;

        do {
            const listResult = await admin.auth().listUsers(1000, nextPageToken);

            // Extract only the fields we need (minimizes memory usage)
            for (const userRecord of listResult.users) {
                allAuthUsers.push({
                    uid: userRecord.uid,
                    email: userRecord.email,
                    displayName: userRecord.displayName,
                    photoURL: userRecord.photoURL,
                    customClaims: userRecord.customClaims || {},
                    metadata: {
                        lastSignInTime: userRecord.metadata?.lastSignInTime || null,
                        creationTime: userRecord.metadata?.creationTime || null,
                    },
                    disabled: userRecord.disabled,
                    providerIds: userRecord.providerData.map(p => p.providerId),
                });
            }

            nextPageToken = listResult.pageToken;
        } while (nextPageToken);

        console.log(`Fetched ${allAuthUsers.length} total users from Firebase Auth (0 Firestore reads)`);

        // ============================================
        // STEP 2: Apply search filter (FREE - in-memory)
        // ============================================
        let filteredUsers = allAuthUsers;
        if (searchTerm) {
            filteredUsers = allAuthUsers.filter(user => {
                const emailMatch = user.email?.toLowerCase().includes(searchTerm);
                const nameMatch = user.displayName?.toLowerCase().includes(searchTerm);
                const uidMatch = user.uid.toLowerCase().includes(searchTerm);
                return emailMatch || nameMatch || uidMatch;
            });
            console.log(`Search "${searchTerm}" matched ${filteredUsers.length} users`);
        }

        // ============================================
        // STEP 3: Apply sorting (FREE - in-memory)
        // Note: Sorting by subscription/services not supported (would require full enrichment)
        // ============================================
        filteredUsers.sort((a, b) => {
            let aValue: string | number;
            let bValue: string | number;

            switch (sortField) {
                case 'email':
                    aValue = a.email || '';
                    bValue = b.email || '';
                    break;
                case 'displayName':
                    aValue = a.displayName || '';
                    bValue = b.displayName || '';
                    break;
                case 'role':
                    aValue = String((a.customClaims as Record<string, unknown>)?.stripeRole || 'free');
                    bValue = String((b.customClaims as Record<string, unknown>)?.stripeRole || 'free');
                    break;
                case 'admin':
                    aValue = (a.customClaims as Record<string, unknown>)?.admin ? 1 : 0;
                    bValue = (b.customClaims as Record<string, unknown>)?.admin ? 1 : 0;
                    break;
                case 'created':
                    aValue = a.metadata.creationTime ? new Date(a.metadata.creationTime).getTime() : 0;
                    bValue = b.metadata.creationTime ? new Date(b.metadata.creationTime).getTime() : 0;
                    break;
                case 'lastLogin':
                    aValue = a.metadata.lastSignInTime ? new Date(a.metadata.lastSignInTime).getTime() : 0;
                    bValue = b.metadata.lastSignInTime ? new Date(b.metadata.lastSignInTime).getTime() : 0;
                    break;
                case 'status':
                    aValue = a.disabled ? 1 : 0;
                    bValue = b.disabled ? 1 : 0;
                    break;
                case 'providerIds':
                    aValue = a.providerIds[0] || '';
                    bValue = b.providerIds[0] || '';
                    break;
                default:
                    aValue = a.email || '';
                    bValue = b.email || '';
            }

            if (typeof aValue === 'string' && typeof bValue === 'string') {
                const comparison = aValue.localeCompare(bValue);
                return sortDirection === 'asc' ? comparison : -comparison;
            }

            if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        // ============================================
        // STEP 4: Slice to current page
        // ============================================
        const totalCount = filteredUsers.length;
        const startIndex = page * pageSize;
        const endIndex = startIndex + pageSize;
        const pageUsers = filteredUsers.slice(startIndex, endIndex);

        // ============================================
        // STEP 5: Enrich ONLY the current page users
        // This is the ONLY place we do Firestore reads!
        // ~4 reads per user = ~40 reads for pageSize=10
        // ============================================
        const db = admin.firestore();
        const enrichedUsers = await enrichUsers(pageUsers, db);

        // Debug: Count users with photoURL

        return {
            users: enrichedUsers,
            totalCount: totalCount,
            page: page,
            pageSize: pageSize
        };
    } catch (error: unknown) {
        console.error('Error listing users:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to list users';
        throw new HttpsError('internal', errorMessage);
    }
});

/**
 * Gets the total number of users in the system.
 */
export const getUserCount = onCall({
    region: 'europe-west2',
    cors: ALLOWED_CORS_ORIGINS,
    memory: '256MiB',
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    if (request.auth.token.admin !== true) {
        throw new HttpsError('permission-denied', 'Only admins can call this function.');
    }

    try {
        const db = admin.firestore();
        const snapshot = await db.collection('users').count().get();
        return { count: snapshot.data().count };
    } catch (error: unknown) {
        console.error('Error getting user count:', error);
        throw new HttpsError('internal', 'Failed to get user count');
    }
});

/**
 * Gets aggregated statistics for all workout queues.
 * Uses efficient Firestore count() queries.
 */
export const getQueueStats = onCall({
    region: 'europe-west2',
    cors: ALLOWED_CORS_ORIGINS,
    memory: '256MiB',
}, async (request) => {
    // 1. Check authentication
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    // 2. Check for admin claim
    if (request.auth.token.admin !== true) {
        throw new HttpsError('permission-denied', 'Only admins can call this function.');
    }

    const PROVIDER_QUEUES: Record<string, string[]> = {
        'Suunto': ['suuntoAppWorkoutQueue', 'suuntoAppHistoryImportActivityQueue'],
        'COROS': ['COROSAPIWorkoutQueue', 'COROSAPIHistoryImportWorkoutQueue'],
        'Garmin': ['garminHealthAPIActivityQueue']
    };

    try {
        const db = admin.firestore();
        let totalPending = 0;
        let totalSucceeded = 0;
        let totalFailed = 0;
        const providers: { name: string; pending: number; succeeded: number; failed: number }[] = [];

        // Map over providers to get individual and total stats
        for (const [providerName, collections] of Object.entries(PROVIDER_QUEUES)) {
            let providerPending = 0;
            let providerSucceeded = 0;
            let providerFailed = 0;

            await Promise.all(collections.map(async (collectionName) => {
                const col = db.collection(collectionName);

                const [p, s, f] = await Promise.all([
                    col.where('processed', '==', false).where('retryCount', '<', 10).count().get(),
                    col.where('processed', '==', true).count().get(),
                    col.where('processed', '==', false).where('retryCount', '>=', 10).count().get()
                ]);

                providerPending += p.data().count;
                providerSucceeded += s.data().count;
                providerFailed += f.data().count;
            }));

            totalPending += providerPending;
            totalSucceeded += providerSucceeded;
            totalFailed += providerFailed;

            providers.push({
                name: providerName,
                pending: providerPending,
                succeeded: providerSucceeded,
                failed: providerFailed
            });
        }

        return {
            pending: totalPending,
            succeeded: totalSucceeded,
            failed: totalFailed,
            providers
        };
    } catch (error: unknown) {
        console.error('Error getting queue stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to get queue statistics';
        throw new HttpsError('internal', errorMessage);
    }
});

interface SetMaintenanceModeRequest {
    enabled: boolean;
    message?: string;
}

/**
 * Sets the maintenance mode status using a Firestore document.
 * This is used instead of Remote Config to allow admin-controlled updates.
 */
export const setMaintenanceMode = onCall({
    region: 'europe-west2',
    cors: ALLOWED_CORS_ORIGINS,
    memory: '256MiB',
}, async (request) => {
    // 1. Check authentication
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    // 2. Check for admin claim
    if (request.auth.token.admin !== true) {
        throw new HttpsError('permission-denied', 'Only admins can call this function.');
    }

    try {
        const data = request.data as SetMaintenanceModeRequest;
        // Use empty string if no message provided (user requested to remove default)
        const msg = data.message || "";
        const db = admin.firestore();

        // 1. Update Firestore (for admin dashboard source of truth)
        const maintenanceDoc = db.collection('config').doc('maintenance');

        await maintenanceDoc.set({
            enabled: data.enabled,
            message: msg,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: request.auth.uid,
        });

        // 2. Update Firebase Remote Config (for client source of truth)
        // Note: Clients only fetch once per session, so this won't be instant for active sessions.
        const rc = admin.remoteConfig();
        const template = await rc.getTemplate();

        // Ensure parameters exist
        template.parameters = template.parameters || {};

        template.parameters['maintenance_mode'] = {
            defaultValue: { value: String(data.enabled) },
            valueType: 'BOOLEAN' as any
        };

        template.parameters['maintenance_message'] = {
            defaultValue: { value: msg },
            valueType: 'STRING' as any
        };

        // Validate and publish
        await rc.validateTemplate(template);
        await rc.publishTemplate(template);

        console.log(`Maintenance mode ${data.enabled ? 'ENABLED' : 'DISABLED'} by ${request.auth.uid} (Synced to Remote Config)`);

        return {
            success: true,
            enabled: data.enabled,
            message: msg
        };
    } catch (error: unknown) {
        console.error('Error setting maintenance mode:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to set maintenance mode';
        throw new HttpsError('internal', errorMessage);
    }
});

/**
 * Gets the current maintenance mode status from Firestore.
 */
export const getMaintenanceStatus = onCall({
    region: 'europe-west2',
    cors: ALLOWED_CORS_ORIGINS,
    memory: '256MiB',
}, async (request) => {
    // 1. Check authentication
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    // 2. Check for admin claim
    if (request.auth.token.admin !== true) {
        throw new HttpsError('permission-denied', 'Only admins can call this function.');
    }

    try {
        const db = admin.firestore();
        const maintenanceDoc = await db.collection('config').doc('maintenance').get();

        if (!maintenanceDoc.exists) {
            return {
                enabled: false,
                message: ""
            };
        }

        const data = maintenanceDoc.data();
        return {
            enabled: data?.enabled || false,
            message: data?.message || "",
            updatedAt: data?.updatedAt,
            updatedBy: data?.updatedBy
        };
    } catch (error: unknown) {
        console.error('Error getting maintenance status:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to get maintenance status';
        throw new HttpsError('internal', errorMessage);
    }
});
