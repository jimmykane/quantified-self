import * as admin from 'firebase-admin';
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
    "athletes",
    "users",
    "coaches",
    "garminHealthAPITokens",
    "suuntoAppAccessTokens",
    "COROSAPIAccessTokens",
    "stravaTokens",
    "polarAccessTokens",
    "fitbitAccessTokens",
    "garminHealthAPIActivityQueue",
    "suuntoAppWorkoutQueue"
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

    console.log(`\nScanning collection: ${collectionName} for deauthorization...`);
    const snapshot = await db.collection(collectionName).get();

    if (snapshot.empty) {
        console.log(`  No users found in ${collectionName}.`);
        return;
    }

    console.log(`  Found ${snapshot.size} users with tokens.`);

    for (const doc of snapshot.docs) {
        const uid = doc.id;
        if (dryRun) {
            console.log(`  [DRY RUN] Would deauthorize user ${uid} from ${config.service || 'Garmin'}`);
        } else {
            process.stdout.write(`  Deauthorizing user ${uid} from ${config.service || 'Garmin'}...`);
            try {
                if (config.service) {
                    await config.fn(uid, config.service);
                } else {
                    await config.fn(uid);
                }
                console.log(` ✓`);
            } catch (e: Error | any) {
                console.log(` ✗ (${e.message})`);
            }
        }
    }
}

async function cleanupFirestore() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');
    const collectionsArg = args.find(arg => arg.startsWith('--collections='));

    let targetCollections = COLLECTION_GROUPS;
    if (collectionsArg) {
        const requested = collectionsArg.split('=')[1].split(',').map(c => c.trim());
        targetCollections = COLLECTION_GROUPS.filter(c => requested.includes(c));
        const invalid = requested.filter(c => !COLLECTION_GROUPS.includes(c));
        if (invalid.length > 0) {
            console.warn(`Warning: Invalid collections skipped: ${invalid.join(', ')}`);
        }
    }

    console.log(`=============================================`);
    console.log(`Firestore Cleanup Script`);
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTION'}`);
    console.log(`Collections: ${targetCollections.join(', ')}`);
    console.log(`=============================================`);

    if (targetCollections.length === 0) {
        console.error('Error: No valid collections selected for cleanup.');
        process.exit(1);
    }

    if (!dryRun && !force) {
        const proceed = await confirm('DANGER: This will permanently delete data. Proceed?');
        if (!proceed) {
            console.log('Operation cancelled.');
            process.exit(0);
        }
    }

    // 1. Deauthorization phase
    console.log('\n--- Phase 1: Deauthorization ---');
    for (const collection of targetCollections) {
        if (DEAUTH_CONFIG[collection]) {
            await deauthorize(collection, dryRun);
        }
    }

    // 2. Deletion phase
    console.log('\n--- Phase 2: Deletion (BulkWriter) ---');
    const bulkWriter = db.bulkWriter();
    bulkWriter.onWriteError((error) => {
        console.error('BulkWriter Error:', error.message);
        return true; // Retry
    });

    let totalDeleted = 0;

    for (const group of targetCollections) {
        console.log(`Processing collection group: [${group}]...`);

        try {
            const query = db.collectionGroup(group);
            const snapshot = await query.count().get();
            const count = snapshot.data().count;

            if (count === 0) {
                console.log(` - No documents found in [${group}]`);
                continue;
            }

            if (dryRun) {
                console.log(` - [DRY RUN] Would delete ${count} documents from [${group}]`);
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
                console.log(`\n - Queued ${groupDeleted} documents from [${group}]`);
            }
        } catch (error: any) {
            console.error(`Error processing [${group}]:`, error.message);
        }
    }

    if (!dryRun) {
        console.log(`\nFlushing BulkWriter...`);
        await bulkWriter.close();
    }

    console.log(`\n=============================================`);
    console.log(`Cleanup Complete.`);
    console.log(`Total documents ${dryRun ? 'identified' : 'deleted'}: ${totalDeleted}`);
    console.log(`=============================================`);
}

// Only run if called directly
if (require.main === module) {
    cleanupFirestore()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        });
}

// Export for testing
export { cleanupFirestore, DEAUTH_CONFIG, COLLECTION_GROUPS };
