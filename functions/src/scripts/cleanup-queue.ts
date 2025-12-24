
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

    console.log(`--- Cleanup Starting ---`);
    console.log(`Target: Items created before ${today.toISOString()} (${todayTimestamp})`);
    console.log(`------------------------`);

    for (const collectionName of COLLECTIONS) {
        console.log(`\nProcessing: ${collectionName}`);
        let deletedCount = 0;

        try {
            while (true) {
                const snapshot = await admin.firestore()
                    .collection(collectionName)
                    .where('dateCreated', '<', todayTimestamp)
                    .limit(500)
                    .get();

                if (snapshot.empty) {
                    break;
                }

                const batch = admin.firestore().batch();
                snapshot.docs.forEach((doc) => {
                    batch.delete(doc.ref);
                });

                await batch.commit();
                deletedCount += snapshot.size;
                // Move cursor to start of line and print progress
                process.stdout.write(`\rDeleted ${deletedCount} items...`);
            }

            // Get final count
            const remainingSnapshot = await admin.firestore().collection(collectionName).count().get();
            console.log(`\nResults for ${collectionName}:`);
            console.log(` - Deleted: ${deletedCount}`);
            console.log(` - Remaining: ${remainingSnapshot.data().count}`);
        } catch (error) {
            console.error(`\nError processing ${collectionName}:`, error);
        }
    }
    console.log(`\n--- Cleanup Complete ---`);
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
