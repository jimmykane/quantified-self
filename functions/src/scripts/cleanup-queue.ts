import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

// Initialize admin if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const COLLECTIONS = [
    'suuntoAppWorkoutQueue',
    'COROSAPIWorkoutQueue',
    'garminAPIActivityQueue'
];

async function cleanupQueue() {
    const args = process.argv.slice(2);
    const hoursArg = args.find(arg => arg.startsWith('--hours='));
    const daysArg = args.find(arg => arg.startsWith('--days='));

    if (!hoursArg && !daysArg) {
        logger.error('Error: You must specify a cleanup window using --hours=X or --days=X');
        logger.info('Usage: npm run cleanup-queue -- --hours=2');
        logger.info('   or: npm run cleanup-queue -- --days=1');
        process.exit(1);
    }

    let msOffset = 0;
    let windowLabel = '';

    if (hoursArg) {
        const hours = parseInt(hoursArg.split('=')[1]);
        msOffset = hours * 60 * 60 * 1000;
        windowLabel = `${hours} hours`;
    } else if (daysArg) {
        const days = parseInt(daysArg.split('=')[1]);
        msOffset = days * 24 * 60 * 60 * 1000;
        windowLabel = `${days} days`;
    }

    const cutoffTimestamp = Date.now() - msOffset;
    const cutoffDate = new Date(cutoffTimestamp);

    logger.info(`--- Cleanup Starting (High Performance Mode) ---`);
    logger.info(`Target: Items older than ${windowLabel} (created before ${cutoffDate.toISOString()})`);
    logger.info(`------------------------`);

    const bulkWriter = admin.firestore().bulkWriter();
    // Verify connection/writer availability?
    // bulkWriter.onWriteError((error) => {
    //    console.warn('Write error (will retry):', error.message);
    //    return true; // Retry
    // });

    let totalDeleted = 0;

    for (const collectionName of COLLECTIONS) {
        logger.info(`\nQueueing deletions for: ${collectionName}`);

        try {
            // Use stream() for memory efficiency and continuous feeding
            const queryStream = admin.firestore()
                .collection(collectionName)
                .where('dateCreated', '<', cutoffTimestamp)
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
            logger.info(` - Queued ${collectionCount} items for modification`);

        } catch (error) {
            logger.error(`\nError queuing ${collectionName}:`, error);
        }
    }

    logger.info(`\n\nFlushing bulk writer...`);
    await bulkWriter.close();

    logger.info(`--- Cleanup Complete ---`);
    logger.info(`Total items deleted: ${totalDeleted}`);
}

cleanupQueue()
    .then(() => {
        logger.info('Script execution finished.');
        process.exit(0);
    })
    .catch((err) => {
        logger.error('Fatal error during execution:', err);
        process.exit(1);
    });
