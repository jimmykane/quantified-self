import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { deauthorizeServiceForUser } from '../OAuth2';
import * as readline from 'readline';

// Initialize admin if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const logger = console;

const STORAGE_BUCKET_NAME = 'quantified-self-io';

async function confirm(message: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(`${message} (y/N): `, (answer: string) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
        });
    });
}

/**
 * Fetch all Auth UIDs in batches.
 */
async function getAllAuthUids(): Promise<Set<string>> {
    const uids = new Set<string>();
    let nextPageToken: string | undefined;

    logger.info('Fetching all Auth users...');
    do {
        const listResult = await admin.auth().listUsers(1000, nextPageToken);
        listResult.users.forEach(user => uids.add(user.uid));
        nextPageToken = listResult.pageToken;
        process.stdout.write(`\rLoaded ${uids.size} Auth users...`);
    } while (nextPageToken);
    process.stdout.write('\n');
    return uids;
}

/**
 * Performs a thorough cleanup for a single user UID.
 */
async function cleanupUser(uid: string, dryRun: boolean) {
    if (dryRun) {
        logger.info(`  [DRY RUN] Would clean up user: ${uid}`);
        return;
    }

    logger.info(`  Cleaning up user: ${uid}...`);

    // 1. Deauthorize External Services (Best Effort)
    const services = [
        { name: 'Suunto', fn: () => deauthorizeServiceForUser(uid, ServiceNames.SuuntoApp) },
        { name: 'COROS', fn: () => deauthorizeServiceForUser(uid, ServiceNames.COROSAPI) },
        { name: 'Garmin', fn: () => deauthorizeServiceForUser(uid, ServiceNames.GarminAPI) }
    ];

    for (const service of services) {
        try {
            await service.fn();
            logger.info(`    - Deauthorized ${service.name}`);
        } catch (e: unknown) {
            const error = e as Error;
            if (error.name === 'TokenNotFoundError' || error.message === 'No tokens found' || error.message === 'No token found') {
                // Ignore
            } else {
                logger.warn(`    - Error deauthorizing ${service.name}: ${error.message}`);
            }
        }
    }

    // 2. Delete Firestore Data (Recursive)
    const collectionsToRecursiveDelete = [
        db.collection('users').doc(uid),
        db.collection('customers').doc(uid)
    ];

    for (const ref of collectionsToRecursiveDelete) {
        try {
            // Using the new recursiveDelete feature in firebase-admin 11.1.0+
            await db.recursiveDelete(ref);
            logger.info(`    - Deleted Firestore path: ${ref.path} (recursive)`);
        } catch (e: unknown) {
            const error = e as Error;
            logger.error(`    - Error deleting Firestore path ${ref.path}: ${error.message}`);
        }
    }

    // 3. Delete Storage Files
    try {
        const storage = admin.storage().bucket(STORAGE_BUCKET_NAME);
        const prefix = `users/${uid}/`;
        const [files] = await storage.getFiles({ prefix });
        if (files.length > 0) {
            await storage.deleteFiles({ prefix });
            logger.info(`    - Deleted ${files.length} files from storage (prefix: ${prefix})`);
        }
    } catch (e: unknown) {
        const error = e as Error;
        logger.error(`    - Error deleting storage files: ${error.message}`);
    }

    // 4. Delete associated emails
    try {
        const mailCollection = db.collection('mail');
        const snapshot = await mailCollection.where('toUids', 'array-contains', uid).get();
        if (!snapshot.empty) {
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            logger.info(`    - Deleted ${snapshot.size} email documents`);
        }
    } catch (e: unknown) {
        const error = e as Error;
        logger.error(`    - Error deleting emails: ${error.message}`);
    }

    // 5. Delete related documents in top-level collections (Queues, Failed Jobs)
    const topLevelCollections = [
        'garminAPIActivityQueue',
        'suuntoAppWorkoutQueue',
        'COROSAPIWorkoutQueue',
        'failed_jobs',
    ];

    for (const col of topLevelCollections) {
        try {
            // Find docs where the UID is in any of the possible fields
            const fields = ['userID', 'userName', 'openId', 'userId', 'uid'];
            for (const field of fields) {
                const snapshot = await db.collection(col).where(field, '==', uid).get();
                if (!snapshot.empty) {
                    const batch = db.batch();
                    snapshot.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    logger.info(`    - Deleted ${snapshot.size} documents in ${col} (field: ${field})`);
                }
            }
        } catch (e: unknown) {
            logger.error(`    - Error cleaning up ${col}: ${(e as Error).message}`);
        }
    }
}

async function cleanupOrphanedUsers() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');

    // Support targeting a specific UID
    const uidIndex = args.indexOf('--uid');
    const targetUid = uidIndex !== -1 ? args[uidIndex + 1] : null;

    logger.info(`=============================================`);
    logger.info(`Orphaned Users Cleanup Script`);
    logger.info(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTION'}`);
    if (targetUid) logger.info(`Target UID: ${targetUid}`);
    logger.info(`Storage Bucket: ${STORAGE_BUCKET_NAME}`);
    logger.info(`Discovery: Firestore (Primary) + Storage`);
    logger.info(`=============================================`);

    let orphans: string[] = [];

    if (targetUid) {
        // Targeted Cleanup
        orphans = [targetUid];
        logger.info(`Proceeding with targeted cleanup for UID: ${targetUid}`);
    } else {
        // Phase 1: Identify Orphans
        const authUids = await getAllAuthUids();
        const potentialOrphanUids = new Set<string>();

        // 1. Discovery from primary Firestore collections
        const collectionsToScan = ['users', 'customers'];
        for (const collectionName of collectionsToScan) {
            logger.info(`Scanning Firestore collection: ${collectionName}...`);
            try {
                // Use .select() to minimize data transfer and costs (only fetches document IDs)
                const snapshot = await db.collection(collectionName).select().get();
                snapshot.docs.forEach(doc => {
                    if (!authUids.has(doc.id)) {
                        potentialOrphanUids.add(doc.id);
                    }
                });
            } catch {
                // Ignore missing collections
            }
        }

        // 2. Discovery from Storage (Relatively Cheap Listing)
        logger.info('Scanning Storage for user prefixes...');
        try {
            const storage = admin.storage().bucket(STORAGE_BUCKET_NAME);
            // Metadata listing is cheap compared to Firestore reads
            const [, , apiResponse] = await storage.getFiles({ prefix: 'users/', delimiter: '/', autoPaginate: true }) as any;
            const prefixes = apiResponse.prefixes || [];
            prefixes.forEach((prefix: string) => {
                const parts = prefix.split('/');
                if (parts.length >= 2 && parts[0] === 'users') {
                    const uid = parts[1];
                    if (uid && !authUids.has(uid)) {
                        potentialOrphanUids.add(uid);
                    }
                }
            });
        } catch (e: unknown) {
            logger.error(`  Error scanning storage: ${(e as Error).message}`);
        }

        orphans = Array.from(potentialOrphanUids);
        logger.info(`Identified ${orphans.length} unique orphaned UIDs.`);
    }

    if (orphans.length === 0) {
        logger.info('No orphans found. Exiting.');
        return;
    }

    if (!dryRun && !force) {
        const confirmed = await confirm(`DANGER: Do you want to PERMANENTLY cleanup and delete all data for ${orphans.length} orphaned users?`);
        if (!confirmed) {
            logger.info('Aborted.');
            return;
        }
    }

    // Phase 2: Cleanup
    let count = 0;
    for (const uid of orphans) {
        await cleanupUser(uid, dryRun);
        count++;
        if (count % 10 === 0) {
            logger.info(`Progress: ${count} / ${orphans.length} users processed.`);
        }
    }

    logger.info(`=============================================`);
    logger.info(`Cleanup Complete.`);
    logger.info(`Total users ${dryRun ? 'identified' : 'processed'}: ${orphans.length}`);
    logger.info(`=============================================`);
}

// Only run if called directly
if (require.main === module) {
    cleanupOrphanedUsers()
        .then(() => process.exit(0))
        .catch(err => {
            logger.error('Fatal error:', err);
            process.exit(1);
        });
}

export { cleanupOrphanedUsers };
