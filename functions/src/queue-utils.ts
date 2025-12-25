import * as admin from 'firebase-admin';
import { QueueItemInterface } from './queue/queue-item.interface';

export async function increaseRetryCountForQueueItem(queueItem: QueueItemInterface, error: Error, incrementBy = 1, bulkWriter?: admin.firestore.BulkWriter) {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }
    queueItem.retryCount += incrementBy;
    queueItem.totalRetryCount = queueItem.totalRetryCount || 0;
    queueItem.totalRetryCount += incrementBy;
    queueItem.errors = queueItem.errors || [];
    queueItem.errors.push({
        error: error.message,
        atRetryCount: queueItem.totalRetryCount,
        date: (new Date()).getTime(),
    });

    try {
        const ref = queueItem.ref;
        queueItem.ref = undefined;
        const updateData = JSON.parse(JSON.stringify(queueItem));
        if (bulkWriter) {
            void bulkWriter.update(ref, updateData);
        } else {
            await ref.update(updateData);
        }
        queueItem.ref = ref;
        console.info(`Updated retry count for ${queueItem.id} to ${queueItem.retryCount}`);
    } catch {
        console.error(new Error(`Could not update retry count on ${queueItem.id}`));
    }
}

export async function updateToProcessed(queueItem: QueueItemInterface, bulkWriter?: admin.firestore.BulkWriter) {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }
    try {
        const ref = queueItem.ref;
        queueItem.ref = undefined;
        const updateData = {
            'processed': true,
            'processedAt': (new Date()).getTime(),
        };
        if (bulkWriter) {
            void bulkWriter.update(ref, updateData);
        } else {
            await ref.update(updateData);
        }
        console.log(`Updated to processed  ${queueItem.id}`);
    } catch {
        console.error(new Error(`Could not update processed state for ${queueItem.id}`));
    }
}
