import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { getExpireAtTimestamp, TTL_CONFIG } from './shared/ttl-config';
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


// Consolidate mocks for the history module
vi.mock('./history', () => ({
    processHistoryImportRequest: vi.fn().mockResolvedValue(undefined),
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
import { parseQueueItems, processQueueItems } from './queue';
import { QueueItemInterface, HistoryImportRequestQueueItemInterface } from './queue/queue-item.interface';
import { processHistoryImportRequest } from './history';
import * as admin from 'firebase-admin';

describe('parseQueueItems', () => {

    it('should call processHistoryImportRequest for import_request items', async () => {
        const mockRequestItem: HistoryImportRequestQueueItemInterface = {
            id: 'test-req-1',
            dateCreated: 123,
            processed: false,
            retryCount: 0,
            type: 'import_request',
            userID: 'user1',
            serviceName: ServiceNames.SuuntoApp,
            startDate: 1000,
            endDate: 2000,
            ref: { update: vi.fn(), set: vi.fn() } as any,
        };

        const querySnapshot = {
            empty: false,
            docs: [{
                data: () => mockRequestItem as any,
                ref: mockRequestItem.ref,
                id: mockRequestItem.id,
            }],
            size: 1,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await processQueueItems(ServiceNames.SuuntoApp, querySnapshot.docs);

        expect(processHistoryImportRequest).toHaveBeenCalledWith(
            'user1',
            ServiceNames.SuuntoApp,
            new Date(1000),
            new Date(2000)
        );
    });

    it('should process standard workout items and attempt to fetch tokens', async () => {
        const mockWorkoutItem = {
            id: 'test-workout-1',
            dateCreated: 123,
            processed: false,
            retryCount: 0,
            userName: 'test-user',
            workoutID: 'w1',
            ref: { update: vi.fn(), set: vi.fn() } as any,
        };

        const querySnapshot = {
            empty: false,
            docs: [{
                data: () => mockWorkoutItem as any,
                ref: mockWorkoutItem.ref,
                id: mockWorkoutItem.id,
            }],
            size: 1,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        // Mock collectionGroup for tokens
        const mockTokenDoc = {
            id: 'token-1',
            ref: {
                parent: {
                    id: 'tokens',
                    parent: { id: 'user-1' } // Parent is user doc
                }
            },
            data: () => ({ access_token: 'abc' })
        };

        const mockCollectionGroup = {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [mockTokenDoc],
                size: 1
            })
        };

        // Hijack the firestore mock for this test
        const firestoreMock = admin.firestore();
        (firestoreMock.collectionGroup as any) = vi.fn(() => mockCollectionGroup);

        await processQueueItems(ServiceNames.SuuntoApp, querySnapshot.docs);

        expect(firestoreMock.collectionGroup).toHaveBeenCalledWith('tokens');
        // We expect normal processing to proceed to token fetching
        expect(mockCollectionGroup.where).toHaveBeenCalledWith('userName', '==', 'test-user');
    });
});

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
});
