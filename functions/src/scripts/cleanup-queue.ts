
import * as admin from 'firebase-admin';

// Initialize admin if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const COLLECTIONS = [
    'suuntoAppWorkoutQueue',
    'suuntoAppHistoryImportActivityQueue',
    'COROSAPIWorkoutQueue',
    'COROSAPIHistoryImportWorkoutQueue',
    'garminHealthAPIActivityQueue'
];

async function cleanupQueue() {
    // Yesterday (start of today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    console.log(`--- Cleanup Starting (High Performance Mode) ---`);
    console.log(`Target: Items created before ${today.toISOString()} (${todayTimestamp})`);
    console.log(`------------------------`);

    const bulkWriter = admin.firestore().bulkWriter();
    // Verify connection/writer availability?
    // bulkWriter.onWriteError((error) => {
    //    console.warn('Write error (will retry):', error.message);
    //    return true; // Retry
    // });

    let totalDeleted = 0;

    for (const collectionName of COLLECTIONS) {
        console.log(`\nQueueing deletions for: ${collectionName}`);

        try {
            // Use stream() for memory efficiency and continuous feeding
            const queryStream = admin.firestore()
                .collection(collectionName)
                .where('dateCreated', '<', todayTimestamp)
                .stream();

            let collectionCount = 0;
            for await (const doc of queryStream) {
                bulkWriter.delete((doc as any).ref);
                collectionCount++;
                totalDeleted++;
                if (totalDeleted % 1000 === 0) {
                    process.stdout.write(`\rQueued ${totalDeleted} deletions...`);
                }
            }
            console.log(` - Queued ${collectionCount} items for modification`);

        } catch (error) {
            console.error(`\nError queuing ${collectionName}:`, error);
        }
    }

    console.log(`\n\nFlushing bulk writer...`);
    await bulkWriter.close();

    console.log(`--- Cleanup Complete ---`);
    console.log(`Total items deleted: ${totalDeleted}`);
}

cleanupQueue()
    .then(() => {
        console.log('Script execution finished.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Fatal error during execution:', err);
        process.exit(1);
    });
