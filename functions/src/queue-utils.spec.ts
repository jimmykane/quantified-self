import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moveToDeadLetterQueue, increaseRetryCountForQueueItem, updateToProcessed, QueueResult } from './queue-utils';

// Hoisted Firestore mocks
const hoisted = vi.hoisted(() => {
    const batch = {
        set: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn(),
    };
    const bulkWriter = {
        set: vi.fn(),
        delete: vi.fn(),
    };
    const collection = vi.fn(() => ({
        doc: vi.fn((id: string) => ({ id }))
    }));
    const firestore = () => ({
        batch: vi.fn(() => batch),
        collection,
    });
    // Attach Timestamp for getExpireAtTimestamp
    (firestore as any).Timestamp = {
        fromDate: vi.fn((date) => date),
    };
    return { batch, bulkWriter, collection, firestore };
});

vi.mock('firebase-admin', () => ({
    default: {
        firestore: hoisted.firestore,
    },
    firestore: hoisted.firestore,
}));

describe('queue-utils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.batch.set.mockReset();
        hoisted.batch.delete.mockReset();
        hoisted.batch.commit.mockReset();
        hoisted.bulkWriter.set.mockReset();
        hoisted.bulkWriter.delete.mockReset();
    });

    describe('moveToDeadLetterQueue', () => {
        it('uses bulkWriter when provided', async () => {
            const queueItem: any = {
                id: 'q1',
                ref: { parent: { id: 'orig' }, id: 'doc1' },
                retryCount: 0,
            };
            const result = await moveToDeadLetterQueue(queueItem, new Error('boom'), hoisted.bulkWriter as any, 'CTX');

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(hoisted.bulkWriter.set).toHaveBeenCalled();
            expect(hoisted.bulkWriter.delete).toHaveBeenCalledWith(queueItem.ref);
        });

        it('returns Failed when batch commit throws', async () => {
            hoisted.batch.commit.mockRejectedValue(new Error('db down'));
            const queueItem: any = {
                id: 'q2',
                ref: { parent: { id: 'orig' }, id: 'doc2' },
            };

            const result = await moveToDeadLetterQueue(queueItem, new Error('fail'));

            expect(hoisted.batch.commit).toHaveBeenCalled();
            expect(result).toBe(QueueResult.Failed);
        });

        it('throws when ref is missing', async () => {
            await expect(moveToDeadLetterQueue({ id: 'x' } as any, new Error('no ref'))).rejects.toThrow(/No document reference supplied/);
        });
    });

    describe('increaseRetryCountForQueueItem', () => {
        it('uses bulkWriter and resets dispatchedToCloudTask', async () => {
            const queueItem: any = {
                id: 'q3',
                ref: { update: vi.fn() },
                retryCount: 1,
                totalRetryCount: 1,
                errors: [],
                dispatchedToCloudTask: 123,
            };

            const res = await increaseRetryCountForQueueItem(queueItem, new Error('err'), 1, {
                update: vi.fn(),
            } as any);

            expect(res).toBe(QueueResult.RetryIncremented);
            expect(queueItem.retryCount).toBe(2);
        });
    });

    describe('updateToProcessed', () => {
        it('updates via bulkWriter when supplied', async () => {
            const queueItem: any = {
                id: 'q4',
                ref: { id: 'ref' },
            };

            const bulkWriter = { update: vi.fn() };
            const res = await updateToProcessed(queueItem, bulkWriter as any, { extra: true });

            expect(res).toBe(QueueResult.Processed);
            expect(bulkWriter.update).toHaveBeenCalledWith(
                { id: 'ref' },
                expect.objectContaining({ processed: true, extra: true })
            );
        });

        it('throws when ref missing', async () => {
            await expect(updateToProcessed({ id: 'no-ref' } as any)).rejects.toThrow(/No document reference supplied/);
        });
    });
});
