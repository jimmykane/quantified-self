import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { QueueItemInterface } from './queue/queue-item.interface';

import { MAX_RETRY_COUNT } from './shared/queue-config';
import { getExpireAtTimestamp, TTL_CONFIG } from './shared/ttl-config';


export enum QueueResult {
    Processed = 'PROCESSED',
    MovedToDLQ = 'MOVED_TO_DLQ',
    RetryIncremented = 'RETRY_INCREMENTED',
    Failed = 'FAILED',
}

export async function moveToDeadLetterQueue(queueItem: QueueItemInterface, error: Error, bulkWriter?: admin.firestore.BulkWriter, context?: string): Promise<QueueResult.MovedToDLQ | QueueResult.Failed> {

    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }

    const failedItem = Object.assign({}, queueItem, {
        error: error.message,
        failedAt: (new Date()).getTime(),
        originalCollection: queueItem.ref.parent ? queueItem.ref.parent.id : 'unknown',
        context: context || 'MAX_RETRY_REACHED',
        expireAt: getExpireAtTimestamp(TTL_CONFIG.FAILED_JOBS_IN_DAYS),
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

        logger.info(`Moved item ${queueItem.id} to Dead Letter Queue (failed_jobs)`);
        return QueueResult.MovedToDLQ;
    } catch (e) {
        logger.error(new Error(`Failed to move item ${queueItem.id} to DLQ: ${e}`));
        return QueueResult.Failed;
    }
}


export async function increaseRetryCountForQueueItem(queueItem: QueueItemInterface, error: Error, incrementBy = 1, bulkWriter?: admin.firestore.BulkWriter): Promise<QueueResult.MovedToDLQ | QueueResult.RetryIncremented | QueueResult.Failed> {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }

    // Check if we overlap the max retry count
    if ((queueItem.retryCount || 0) + incrementBy >= MAX_RETRY_COUNT) {
        logger.warn(`Item ${queueItem.id} exceeded max retries (${MAX_RETRY_COUNT}). Moving to DLQ.`);
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
        // Reset dispatchedToCloudTask to null so the dispatcher can pick it up again
        const updateData = Object.assign(JSON.parse(JSON.stringify(queueItem)), {
            dispatchedToCloudTask: null
        });
        if (bulkWriter) {
            void bulkWriter.update(ref, updateData);
        } else {
            await ref.update(updateData);
        }

        queueItem.ref = ref;
        logger.info(`Updated retry count for ${queueItem.id} to ${queueItem.retryCount}`);
        return QueueResult.RetryIncremented;
    } catch {
        logger.error(new Error(`Could not update retry count on ${queueItem.id}`));
        return QueueResult.Failed;
    }
}


export async function updateToProcessed(queueItem: QueueItemInterface, bulkWriter?: admin.firestore.BulkWriter, additionalData?: any): Promise<QueueResult.Processed | QueueResult.Failed> {
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

        logger.info(`Updated to processed  ${queueItem.id}`);
        return QueueResult.Processed;
    } catch {
        logger.error(new Error(`Could not update processed state for ${queueItem.id}`));
        return QueueResult.Failed;
    }
}

