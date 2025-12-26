import * as admin from 'firebase-admin';
import { QueueItemInterface } from './queue/queue-item.interface';

import { MAX_RETRY_COUNT, QUEUE_ITEM_TTL_MS } from './shared/queue-config';

export async function moveToDeadLetterQueue(queueItem: QueueItemInterface, error: Error, bulkWriter?: admin.firestore.BulkWriter, context?: string) {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }

    const failedItem = Object.assign({}, queueItem, {
        error: error.message,
        failedAt: (new Date()).getTime(),
        originalCollection: queueItem.ref.parent.id,
        context: context || 'MAX_RETRY_REACHED',
        expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + QUEUE_ITEM_TTL_MS)),
        // Remove ref from payload
        ref: undefined
    });

    const failedDocRef = admin.firestore().collection('failed_jobs').doc(queueItem.id);

    try {
        if (bulkWriter) {
            void bulkWriter.set(failedDocRef, failedItem);
            void bulkWriter.delete(queueItem.ref);
        } else {
            const batch = admin.firestore().batch();
            batch.set(failedDocRef, failedItem);
            batch.delete(queueItem.ref);
            await batch.commit();
        }
        console.info(`Moved item ${queueItem.id} to Dead Letter Queue (failed_jobs)`);
    } catch (e) {
        console.error(new Error(`Failed to move item ${queueItem.id} to DLQ: ${e}`));
    }
}

export async function increaseRetryCountForQueueItem(queueItem: QueueItemInterface, error: Error, incrementBy = 1, bulkWriter?: admin.firestore.BulkWriter) {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }

    // Check if we overlap the max retry count
    if ((queueItem.retryCount || 0) + incrementBy >= MAX_RETRY_COUNT) {
        console.warn(`Item ${queueItem.id} exceeded max retries (${MAX_RETRY_COUNT}). Moving to DLQ.`);
        return moveToDeadLetterQueue(queueItem, error, bulkWriter);
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

export async function updateToProcessed(queueItem: QueueItemInterface, bulkWriter?: admin.firestore.BulkWriter, additionalData?: any) {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }
    try {
        const ref = queueItem.ref;
        queueItem.ref = undefined;
        const updateData = Object.assign({
            'processed': true,
            'processedAt': (new Date()).getTime(),
        }, additionalData);
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
