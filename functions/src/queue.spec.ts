import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Mock firebase-functions first (needed by auth modules at load time)
vi.mock('firebase-functions', () => ({
    config: () => ({
        suuntoapp: {
            client_id: 'test-suunto-client-id',
            client_secret: 'test-suunto-client-secret',
            subscription_key: 'test-suunto-subscription-key',
        },
        corosapi: {
            client_id: 'test-coros-client-id',
            client_secret: 'test-coros-client-secret',
        },
        garminhealth: {
            consumer_key: 'test-garmin-consumer-key',
            consumer_secret: 'test-garmin-consumer-secret',
        },
    }),
    region: () => ({
        https: { onRequest: () => { } },
        runWith: () => ({
            https: { onRequest: () => { } },
            pubsub: { schedule: () => ({ onRun: () => { } }) },
        }),
    }),
}));

// Mock firebase-admin before importing modules that use it
vi.mock('firebase-admin', () => {
    const mockDocRef = {
        update: vi.fn(() => Promise.resolve()),
        set: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
        id: 'mock-doc-id',
        parent: { id: 'mock-collection' }
    };

    const mockDocSnapshot = {
        id: 'mock-doc-id',
        ref: mockDocRef,
        data: vi.fn(() => ({})),
    };

    const mockBatch = {
        set: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined)
    };

    const mockCollection = {
        doc: vi.fn(() => mockDocRef),
        get: vi.fn(() => Promise.resolve({
            docs: [mockDocSnapshot],
            size: 1,
        })),
        where: vi.fn(() => mockCollection),
        limit: vi.fn(() => mockCollection),
    };

    const mockFirestore = {
        collection: vi.fn(() => mockCollection),
        collectionGroup: vi.fn(() => mockCollection),
        batch: vi.fn(() => mockBatch),
        bulkWriter: vi.fn(() => ({
            update: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined),
        })),
    };

    const mockFirestoreFn: any = vi.fn(() => mockFirestore);
    mockFirestoreFn.Timestamp = {
        fromDate: vi.fn((date) => date),
    };

    return {
        default: {
            firestore: mockFirestoreFn,
            initializeApp: vi.fn(),
            credential: { cert: vi.fn() },
        },
        firestore: mockFirestoreFn,
    };
});

// Mock simple-oauth2
vi.mock('simple-oauth2', () => ({
    AuthorizationCode: class {
        authorizeURL() {
            return 'https://mock-auth-url.com';
        }
        getToken() {
            return Promise.resolve({ token: {} });
        }
        createToken(token: any) {
            return { expired: () => false, refresh: () => Promise.resolve({ token: {} }), token };
        }
    },
}));

// Mock the history module
vi.mock('./history', () => ({
    getServiceWorkoutQueueName: vi.fn((serviceName: ServiceNames, fromHistory = false) => {
        const baseName = `${serviceName}WorkoutQueue`;
        return fromHistory ? `${baseName}History` : baseName;
    }),
}));

// Mock request-helper
vi.mock('./request-helper', () => ({
    default: {
        get: vi.fn(),
    },
    get: vi.fn(),
}));

// Import after mocks are set up
import { increaseRetryCountForQueueItem, updateToProcessed, moveToDeadLetterQueue } from './queue-utils';
import {
    addToQueueForSuunto,
    addToQueueForGarmin,
    addToQueueForCOROS,
} from './queue';
import { QueueItemInterface } from './queue/queue-item.interface';

describe('queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('increaseRetryCountForQueueItem', () => {
        it('should increment retryCount by 1 by default', async () => {
            const mockRef = {
                update: vi.fn(() => Promise.resolve()),
            };

            const queueItem: QueueItemInterface = {
                id: 'test-item-1',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Test error'));

            expect(queueItem.retryCount).toBe(1);
            expect(queueItem.totalRetryCount).toBe(1);
            expect(queueItem.errors).toHaveLength(1);
            expect(queueItem.errors![0].error).toBe('Test error');
        });

        it('should move to DLQ if max retries reached', async () => {
            const admin = await import('firebase-admin');
            const firestore = admin.firestore();
            const batch = firestore.batch();

            const mockRef = {
                update: vi.fn(() => Promise.resolve()),
                delete: vi.fn(() => Promise.resolve()),
                parent: { id: 'original-col' }
            };

            const queueItem: QueueItemInterface = {
                id: 'test-item-2',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
            };

            // 10 is max retry count
            await increaseRetryCountForQueueItem(queueItem, new Error('Big error'), 10);

            // Should NOT verify update on original ref
            expect(mockRef.update).not.toHaveBeenCalled();

            // Should verify batch delete and set (DLQ logic)
            expect(batch.delete).toHaveBeenCalledWith(mockRef);
            expect(batch.set).toHaveBeenCalled();
            expect(batch.commit).toHaveBeenCalled();
        });

        it('should accumulate errors', async () => {
            const mockRef = {
                update: vi.fn(() => Promise.resolve()),
            };

            const queueItem: QueueItemInterface = {
                id: 'test-item-3',
                ref: mockRef as any,
                retryCount: 1,
                totalRetryCount: 1,
                errors: [{ error: 'Previous error', atRetryCount: 1, date: Date.now() - 1000 }],
                processed: false,
                dateCreated: Date.now(),
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('New error'));

            expect(queueItem.errors).toHaveLength(2);
            expect(queueItem.errors![1].error).toBe('New error');
        });

        it('should throw if no ref is provided', async () => {
            const queueItem: QueueItemInterface = {
                id: 'test-item-4',
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
            };

            await expect(
                increaseRetryCountForQueueItem(queueItem, new Error('Test'))
            ).rejects.toThrow('No document reference supplied');
        });

        it('should call ref.update with serialized queue item', async () => {
            const mockUpdate = vi.fn(() => Promise.resolve());
            const mockRef = { update: mockUpdate };

            const queueItem: QueueItemInterface = {
                id: 'test-item-5',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Test'));

            expect(mockUpdate).toHaveBeenCalled();
            const updateArg = (mockUpdate.mock.calls[0] as any[])[0];
            expect(updateArg.retryCount).toBe(1);
            expect(updateArg.ref).toBeUndefined(); // ref should be stripped
        });
    });

    describe('updateToProcessed', () => {
        it('should set processed to true', async () => {
            const mockUpdate = vi.fn(() => Promise.resolve());
            const mockRef = { update: mockUpdate };

            const queueItem: QueueItemInterface = {
                id: 'test-item-1',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
            };

            await updateToProcessed(queueItem);

            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    processed: true,
                    processedAt: expect.any(Number),
                })
            );
        });

        it('should throw if no ref is provided', async () => {
            const queueItem: QueueItemInterface = {
                id: 'test-item-2',
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
            };

            await expect(
                updateToProcessed(queueItem)
            ).rejects.toThrow('No document reference supplied');
        });
    });

    describe('moveToDeadLetterQueue', () => {
        it('should move queue item to failed_jobs collection', async () => {
            const admin = await import('firebase-admin');
            const firestore = admin.firestore();
            const batch = firestore.batch();

            const mockRef = {
                parent: { id: 'original-col' },
                update: vi.fn(),
                delete: vi.fn(),
                id: 'ref-id'
            };

            const queueItem: QueueItemInterface = {
                id: 'test-item-dlq',
                ref: mockRef as any,
                retryCount: 9,
                processed: false,
                dateCreated: Date.now(),
            };

            await moveToDeadLetterQueue(queueItem, new Error('Fatal error'));

            expect(batch.set).toHaveBeenCalledWith(
                expect.any(Object), // failedDocRef
                expect.objectContaining({
                    id: 'test-item-dlq',
                    error: 'Fatal error',
                    originalCollection: 'original-col',
                    expireAt: expect.any(Object)
                })
            );
            expect(batch.delete).toHaveBeenCalledWith(mockRef);
            expect(batch.commit).toHaveBeenCalled();
        });
    });
});
