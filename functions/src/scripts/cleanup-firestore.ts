import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { deauthorizeServiceForUser } from '../OAuth2';
import { deauthorizeGarminHealthAPIForUser } from '../garmin/auth/wrapper';
import * as readline from 'readline';

// Initialize admin if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

const COLLECTION_GROUPS = [
    "streams",
    "activities",
    "tokens",
    "events",
    "meta",
    "metaData",
    "athletes",
    "users",
    "coaches",
    "garminHealthAPITokens",
    "suuntoAppAccessTokens",
    "COROSAPIAccessTokens",
    "garminHealthAPIActivityQueue",
    "suuntoAppWorkoutQueue",
    "COROSAPIWorkoutQueue",
    "COROSAPIHistoryImportWorkoutQueue",
    "suuntoAppHistoryImportActivityQueue"
];

const DEAUTH_CONFIG: Record<string, { service: ServiceNames | null, fn: (uid: string, service?: any) => Promise<void> }> = {
    'suuntoAppAccessTokens': { service: ServiceNames.SuuntoApp, fn: deauthorizeServiceForUser },
    'COROSAPIAccessTokens': { service: ServiceNames.COROSAPI, fn: deauthorizeServiceForUser },
    'garminHealthAPITokens': { service: null, fn: deauthorizeGarminHealthAPIForUser }
};

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

async function deauthorize(collectionName: string, dryRun: boolean) {
    const config = DEAUTH_CONFIG[collectionName];
    if (!config) return;

    logger.info(`\nScanning collection: ${collectionName} for deauthorization...`);
    const snapshot = await db.collection(collectionName).get();

    if (snapshot.empty) {
        logger.info(`  No users found in ${collectionName}.`);
        return;
    }

    logger.info(`  Found ${snapshot.size} users with tokens.`);

    for (const doc of snapshot.docs) {
        const uid = doc.id;
        if (dryRun) {
            logger.info(`  [DRY RUN] Would deauthorize user ${uid} from ${config.service || 'Garmin'}`);
        } else {
            process.stdout.write(`  Deauthorizing user ${uid} from ${config.service || 'Garmin'}...`);
            try {
                if (config.service) {
                    await config.fn(uid, config.service);
                } else {
                    await config.fn(uid);
                }
                logger.info(` ✓`);
            } catch (e: Error | any) {
                logger.info(` ✗ (${e.message})`);
            }
        }
    }
}

async function cleanupFirestore() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');
    const disconnectOnly = args.includes('--disconnect-only');
    const deauthorizeFlag = args.includes('--deauthorize');
    const collectionsArg = args.find(arg => arg.startsWith('--collections='));

    let targetCollections = COLLECTION_GROUPS;
    if (collectionsArg) {
        const requested = collectionsArg.split('=')[1].split(',').map(c => c.trim());
        targetCollections = COLLECTION_GROUPS.filter(c => requested.includes(c));
        const invalid = requested.filter(c => !COLLECTION_GROUPS.includes(c));
        if (invalid.length > 0) {
            logger.warn(`Warning: Invalid collections skipped: ${invalid.join(', ')}`);
        }
    }

    logger.info(`=============================================`);
    logger.info(`Firestore Cleanup Script`);
    logger.info(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTION'}`);
    logger.info(`Disconnect Only: ${disconnectOnly}`);
    logger.info(`Deauthorize Flag: ${deauthorizeFlag}`);
    logger.info(`Collections: ${targetCollections.join(', ')}`);
    logger.info(`=============================================`);

    if (targetCollections.length === 0) {
        logger.error('Error: No valid collections selected for cleanup.');
        process.exit(1);
    }

    if (!dryRun && !force) {
        const message = disconnectOnly
            ? 'This will deauthorize users from selected services. Proceed?'
            : 'DANGER: This will permanently delete data. Proceed?';
        const proceed = await confirm(message);
        if (!proceed) {
            logger.info('Operation cancelled.');
            process.exit(0);
        }
    }

    // Determine if we should run deauthorization
    let shouldDeauth = deauthorizeFlag;
    if (!shouldDeauth && !force && !dryRun) {
        shouldDeauth = await confirm('Do you want to deauthorize users from external services (Suunto, COROS, Garmin)?');
    }

    // 1. Deauthorization phase
    if (shouldDeauth || dryRun) {
        logger.info('\n--- Phase 1: Deauthorization ---');
        for (const collection of targetCollections) {
            if (DEAUTH_CONFIG[collection]) {
                await deauthorize(collection, dryRun);
            }
        }
    } else {
        logger.info('\nSkipping Phase 1: Deauthorization (not requested)');
    }

    if (disconnectOnly) {
        if (!shouldDeauth && !dryRun) {
            logger.info('\nDisconnect-only mode active but deauthorization skipped. Nothing to do.');
        } else {
            logger.info('\nDisconnect-only mode active. Skipping deletion phase.');
        }
        return;
    }

    // 2. Deletion phase
    logger.info('\n--- Phase 2: Deletion (BulkWriter) ---');
    const bulkWriter = db.bulkWriter();
    bulkWriter.onWriteError((error) => {
        logger.error('BulkWriter Error:', error.message);
        return true; // Retry
    });

    let totalDeleted = 0;

    for (const group of targetCollections) {
        logger.info(`Processing collection group: [${group}]...`);

        try {
            const query = db.collectionGroup(group);
            const snapshot = await query.count().get();
            const count = snapshot.data().count;

            if (count === 0) {
                logger.info(` - No documents found in [${group}]`);
                continue;
            }

            if (dryRun) {
                logger.info(` - [DRY RUN] Would delete ${count} documents from [${group}]`);
                totalDeleted += count;
            } else {
                const stream = db.collectionGroup(group).stream();
                let groupDeleted = 0;
                for await (const doc of stream) {
                    bulkWriter.delete((doc as any).ref);
                    groupDeleted++;
                    totalDeleted++;
                    if (totalDeleted % 500 === 0) {
                        process.stdout.write(`\rDeleted ${totalDeleted} documents...`);
                    }
                }
                logger.info(`\n - Queued ${groupDeleted} documents from [${group}]`);
            }
        } catch (error: any) {
            logger.error(`Error processing [${group}]:`, error.message);
        }
    }

    if (!dryRun) {
        logger.info(`\nFlushing BulkWriter...`);
        await bulkWriter.close();
    }

    logger.info(`\n=============================================`);
    logger.info(`Cleanup Complete.`);
    logger.info(`Total documents ${dryRun ? 'identified' : 'deleted'}: ${totalDeleted}`);
    logger.info(`=============================================`);
}

// Only run if called directly
if (require.main === module) {
    cleanupFirestore()
        .then(() => process.exit(0))
        .catch(err => {
            logger.error('Fatal error:', err);
            process.exit(1);
        });
}

// Export for testing
export { cleanupFirestore, DEAUTH_CONFIG, COLLECTION_GROUPS };
