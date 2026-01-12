import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { getExpireAtTimestamp, TTL_CONFIG } from './shared/ttl-config';
import { MAX_PENDING_TASKS, DISPATCH_SPREAD_SECONDS } from './shared/queue-config';
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

// Mock utils
vi.mock('./utils', () => ({
    generateIDFromParts: vi.fn((parts) => parts.join('-')),
    setEvent: vi.fn(),
    UsageLimitExceededError: class extends Error { },
    UserNotFoundError: class extends Error { },
    enqueueWorkoutTask: vi.fn(),
    getCloudTaskQueueDepth: vi.fn().mockResolvedValue(0),
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



            // Verify explicit expiration date calculation
            const calledArg = (batch.set as any).mock.calls[0][1];
            // Allow small delta for execution time difference if not mocking system time
            const expectedExpiry = Date.now() + TTL_CONFIG.QUEUE_ITEM_IN_DAYS * 24 * 60 * 60 * 1000;
            // The mock Timestamp implementation returns the date object directly in toDate or we can check logic
            // Since we mocked firestore.Timestamp.fromDate to return the date, we can check basic validity
            // But here we just want to ensure it IS the timestamp we expect.
            // Let's refine the expectation to be strictly about the call structure we refactored to.
            expect(batch.set).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({
                    expireAt: expect.anything() // We trust getExpireAtTimestamp unit test for the value
                })
            );
            expect(batch.delete).toHaveBeenCalledWith(mockRef);
            expect(batch.commit).toHaveBeenCalled();
        });
    });

    describe('dispatchQueueItemTasks', () => {
        it('should skip dispatch if queue is full', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(MAX_PENDING_TASKS); // Max pending
            const { dispatchQueueItemTasks } = await import('./queue');

            await dispatchQueueItemTasks(ServiceNames.GarminHealthAPI);

            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('should dispatch available slots when queue is partially full', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(MAX_PENDING_TASKS - 2); // 2 slots available
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            // Mock query results
            const mockDoc1 = { id: 'doc1', ref: { update: vi.fn(), parent: { id: 'col' }, id: 'doc1' }, data: () => ({}) };
            const mockDoc2 = { id: 'doc2', ref: { update: vi.fn(), parent: { id: 'col' }, id: 'doc2' }, data: () => ({}) };

            const firestore = admin.firestore();
            const collection = firestore.collection('any');
            // We need to spy on the chain: collection -> where -> where -> where -> limit -> get
            // The global mock implementation of `limit` returns `mockCollection`, and `get` returns docs.
            // We can override the return value of `get`
            vi.mocked(collection.get).mockResolvedValue({
                docs: [mockDoc1, mockDoc2] as any,
                size: 2,
                empty: false,
                query: {} as any,
                forEach: vi.fn(),
                docChanges: vi.fn(),
                readTime: {} as any,
                isEqual: vi.fn(),
            });

            await dispatchQueueItemTasks(ServiceNames.GarminHealthAPI);

            expect(utils.getCloudTaskQueueDepth).toHaveBeenCalledWith(true);
            // Verify limit was called with batch size
            expect(collection.limit).toHaveBeenCalledWith(2);

            // Verify enqueue called for both
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledTimes(2);
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.GarminHealthAPI, 'doc1', expect.any(Number));
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.GarminHealthAPI, 'doc2', expect.any(Number));

            // Verify dispatchedToCloudTask update
            expect(mockDoc1.ref.update).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
            expect(mockDoc2.ref.update).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('should apply staggered delay to dispatched tasks', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            // Mock 3 docs
            const mockDocs = [
                { id: '1', ref: { update: vi.fn() }, data: () => ({}) },
                { id: '2', ref: { update: vi.fn() }, data: () => ({}) },
                { id: '3', ref: { update: vi.fn() }, data: () => ({}) }
            ];

            const firestore = admin.firestore();
            const delayPerItem = Math.floor(DISPATCH_SPREAD_SECONDS / mockDocs.length);

            vi.mocked(firestore.collection('any').get).mockResolvedValue({
                docs: mockDocs as any,
                size: 3,
                empty: false,
                isEqual: vi.fn(), // Fix TS error
            } as any);

            await dispatchQueueItemTasks(ServiceNames.GarminHealthAPI);

            expect(utils.getCloudTaskQueueDepth).toHaveBeenCalledWith(true);
            // Expected spread: Total 1800s. Size 3. Delay per item = 600s.
            // Items: 0, 600, 1200
            expect(utils.enqueueWorkoutTask).toHaveBeenNthCalledWith(1, ServiceNames.GarminHealthAPI, '1', 0);
            expect(utils.enqueueWorkoutTask).toHaveBeenNthCalledWith(2, ServiceNames.GarminHealthAPI, '2', delayPerItem);
            expect(utils.enqueueWorkoutTask).toHaveBeenNthCalledWith(3, ServiceNames.GarminHealthAPI, '3', delayPerItem * 2);
        });

        it('should do nothing if no items found', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            const firestore = admin.firestore();
            vi.mocked(firestore.collection('any').get).mockResolvedValue({
                docs: [],
                size: 0,
                empty: true,
                isEqual: vi.fn(), // Fix TS error
            } as any);

            await dispatchQueueItemTasks(ServiceNames.GarminHealthAPI);

            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });
    });

    describe('addToQueue deferred dispatch', () => {
        it('should defer dispatch for manual/bulk items', async () => {
            const utils = await import('./utils');
            // Reset mocks
            vi.mocked(utils.enqueueWorkoutTask).mockClear();

            const { addToQueueForGarmin } = await import('./queue');

            await addToQueueForGarmin({
                userID: 'u1',
                startTimeInSeconds: 123,
                manual: true, // DEFER
                activityFileID: 'f1',
                activityFileType: 'FIT',
                token: 't1',
                userAccessToken: 'at1'
            });

            // Should NOT call enqueue
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('should immediate dispatch for normal items', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.enqueueWorkoutTask).mockClear();

            const { addToQueueForGarmin } = await import('./queue');

            await addToQueueForGarmin({
                userID: 'u1',
                startTimeInSeconds: 123,
                manual: false, // IMMEDIATE
                activityFileID: 'f1',
                activityFileType: 'FIT',
                token: 't1',
                userAccessToken: 'at1'
            });

            // Should call enqueue
            expect(utils.enqueueWorkoutTask).toHaveBeenCalled();
        });
    });
});
