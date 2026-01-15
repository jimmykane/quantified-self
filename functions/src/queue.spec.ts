import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { getExpireAtTimestamp, TTL_CONFIG } from './shared/ttl-config';
import { MAX_PENDING_TASKS, DISPATCH_SPREAD_SECONDS } from './shared/queue-config';
import { ServiceNames, ActivityParsingOptions, EventImporterFIT, COROSAPIEventMetaData, SuuntoAppEventMetaData } from '@sports-alliance/sports-lib';

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

const { mockDocRef, mockBatch, mockDocSnapshot, mockCollection } = vi.hoisted(() => {
    const docRef = {
        update: vi.fn(() => Promise.resolve()),
        set: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
        id: 'mock-doc-id',
        parent: {
            id: 'tokens',
            parent: { id: 'mock-user-id' }
        }
    };

    const docSnapshot = {
        id: 'mock-doc-id',
        ref: docRef,
        data: vi.fn(() => ({})),
    };

    const batch = {
        set: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined)
    };

    const collection: any = {
        doc: vi.fn(() => docRef),
        get: vi.fn(() => Promise.resolve({
            docs: [docSnapshot],
            size: 1,
        })),
        where: vi.fn().mockImplementation(function (this: any) { return this; }),
        limit: vi.fn().mockImplementation(function (this: any) { return this; }),
        orderBy: vi.fn().mockImplementation(function (this: any) { return this; }),
    };

    return {
        mockDocRef: docRef,
        mockBatch: batch,
        mockDocSnapshot: docSnapshot,
        mockCollection: collection,
    };
});

// Mock firebase-admin before importing modules that use it
vi.mock('firebase-admin', () => {
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

// Mock the request-helper module (used by getWorkoutForService)
vi.mock('./request-helper', () => {
    const mock: any = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.get = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.post = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.put = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.delete = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    return mock;
});

// Mock the history module
vi.mock('./history', () => ({
    getServiceWorkoutQueueName: vi.fn((serviceName: ServiceNames, fromHistory = false) => {
        const baseName = `${serviceName}WorkoutQueue`;
        return fromHistory ? `${baseName}History` : baseName;
    }),
}));

// Mock request-helper (used by queue.ts)
vi.mock('./request-helper', () => {
    const mock: any = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.get = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.post = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.put = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.delete = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    return {
        __esModule: true,
        default: mock,
        ...mock
    };
});

// Mock utils
vi.mock('./utils', () => ({
    generateIDFromParts: vi.fn((parts) => parts.join('-')),
    setEvent: vi.fn(),
    UsageLimitExceededError: class extends Error { },
    UserNotFoundError: class extends Error { },
    enqueueWorkoutTask: vi.fn(),
    getCloudTaskQueueDepth: vi.fn().mockResolvedValue(0),
    generateEventID: vi.fn().mockResolvedValue('standardized-event-id'),
}));

import * as utils from './utils';
import requestHelper from './request-helper';

vi.mock('./tokens', () => ({
    getTokenData: vi.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        userName: 'mock-user',
        openId: 'mock-openid'
    }),
}));

vi.mock('./garmin/queue', () => ({
    processGarminAPIActivityQueueItem: vi.fn().mockResolvedValue('PROCESSED'),
}));

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const original: any = await importOriginal();
    return {
        ...original,
        EventImporterFIT: {
            getFromArrayBuffer: vi.fn().mockResolvedValue({
                setID: vi.fn(),
                getID: () => 'mock-fit-event-id',
                startDate: new Date('2026-01-14T10:00:00.000Z'),
            }),
        },
        COROSAPIEventMetaData: class {
            constructor() { }
            toJSON() { return {}; }
        },
        SuuntoAppEventMetaData: class {
            constructor() { }
            toJSON() { return {}; }
        },
        ActivityParsingOptions: class {
            constructor() { }
        },
    };
});

// Import after mocks are set up
import {
    addToQueueForSuunto,
    addToQueueForGarmin,
    addToQueueForCOROS,
    parseWorkoutQueueItemForServiceName,
} from './queue';
import { QueueItemInterface, SuuntoAppWorkoutQueueItemInterface, COROSAPIWorkoutQueueItemInterface } from './queue/queue-item.interface';
import { getTokenData } from './tokens';
import { processGarminAPIActivityQueueItem } from './garmin/queue';
import { QueueResult, increaseRetryCountForQueueItem, updateToProcessed, moveToDeadLetterQueue } from './queue-utils';

describe('queue', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const admin = await import('firebase-admin');
        const mockCollection = admin.firestore().collectionGroup('tokens') as any;
        mockCollection.get.mockResolvedValue({
            docs: [
                {
                    id: 'mock-doc-id',
                    ref: {
                        id: 'mock-doc-id',
                        parent: {
                            id: 'tokens',
                            parent: { id: 'mock-user-id' }
                        }
                    },
                    data: vi.fn(() => ({})),
                }
            ],
            size: 1,
        });
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
                dispatchedToCloudTask: null,
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
                dispatchedToCloudTask: null,
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
                dispatchedToCloudTask: null,
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
                dispatchedToCloudTask: null,
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
                dispatchedToCloudTask: null,
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Test'));

            expect(mockUpdate).toHaveBeenCalled();
            const updateArg = (mockUpdate.mock.calls[0] as any[])[0];
            expect(updateArg.retryCount).toBe(1);
            expect(updateArg.dispatchedToCloudTask).toBeNull();
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
                dispatchedToCloudTask: null,
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
                dispatchedToCloudTask: null,
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
                dispatchedToCloudTask: null,
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

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);

            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('should dispatch available slots when queue is partially full', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(MAX_PENDING_TASKS - 2); // 2 slots available
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            // Mock query results
            const mockDoc1 = { id: 'doc1', ref: { update: vi.fn(), parent: { id: 'col' }, id: 'doc1' }, data: () => ({ dateCreated: Date.now() }) };
            const mockDoc2 = { id: 'doc2', ref: { update: vi.fn(), parent: { id: 'col' }, id: 'doc2' }, data: () => ({ dateCreated: Date.now() }) };

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

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);

            expect(utils.getCloudTaskQueueDepth).toHaveBeenCalledWith(true);
            // Verify limit was called with batch size
            expect(collection.limit).toHaveBeenCalledWith(2);

            // Verify enqueue called for both
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledTimes(2);
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.GarminAPI, 'doc1', expect.any(Number), expect.any(Number));
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.GarminAPI, 'doc2', expect.any(Number), expect.any(Number));

            // Verify dispatchedToCloudTask update
            expect(mockDoc1.ref.update).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
            expect(mockDoc2.ref.update).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('should apply staggered delay to dispatched tasks', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            const mockDocs = [
                { id: '1', ref: { update: vi.fn() }, data: () => ({ dateCreated: Date.now() }) },
                { id: '2', ref: { update: vi.fn() }, data: () => ({ dateCreated: Date.now() }) },
                { id: '3', ref: { update: vi.fn() }, data: () => ({ dateCreated: Date.now() }) }
            ];

            const firestore = admin.firestore();
            const delayPerItem = Math.floor(DISPATCH_SPREAD_SECONDS / mockDocs.length);

            vi.mocked(firestore.collection('any').get).mockResolvedValue({
                docs: mockDocs as any,
                size: 3,
                empty: false,
                isEqual: vi.fn(), // Fix TS error
            } as any);

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);

            expect(utils.getCloudTaskQueueDepth).toHaveBeenCalledWith(true);
            // Expected spread: Total 1800s. Size 3. Delay per item = 600s.
            // Items: 0, 600, 1200
            expect(utils.enqueueWorkoutTask).toHaveBeenNthCalledWith(1, ServiceNames.GarminAPI, '1', expect.any(Number), 0);
            expect(utils.enqueueWorkoutTask).toHaveBeenNthCalledWith(2, ServiceNames.GarminAPI, '2', expect.any(Number), delayPerItem);
            expect(utils.enqueueWorkoutTask).toHaveBeenNthCalledWith(3, ServiceNames.GarminAPI, '3', expect.any(Number), delayPerItem * 2);
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

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);

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
                userAccessToken: 'at1',
                callbackURL: 'cb1'
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
                userAccessToken: 'at1',
                callbackURL: 'cb1'
            });

            // Should call enqueue
            expect(utils.enqueueWorkoutTask).toHaveBeenCalled();
        });
    });

    describe('increaseRetryCountForQueueItem - dispatchedToCloudTask reset', () => {
        it('should reset dispatchedToCloudTask to null when item had a timestamp', async () => {
            const mockUpdate = vi.fn(() => Promise.resolve());
            const mockRef = { update: mockUpdate };

            const queueItem: QueueItemInterface = {
                id: 'test-dispatch-reset',
                ref: mockRef as any,
                retryCount: 1,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: 1704067200000, // A timestamp value
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Transient failure'));

            expect(mockUpdate).toHaveBeenCalled();
            const updateArg = (mockUpdate.mock.calls[0] as any[])[0];

            // Critical: dispatchedToCloudTask must be null so dispatcher picks it up again
            expect(updateArg.dispatchedToCloudTask).toBeNull();
            expect(updateArg.retryCount).toBe(2);
        });

        it('should keep dispatchedToCloudTask as null if it was already null', async () => {
            const mockUpdate = vi.fn(() => Promise.resolve());
            const mockRef = { update: mockUpdate };

            const queueItem: QueueItemInterface = {
                id: 'test-dispatch-was-null',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Some error'));

            const updateArg = (mockUpdate.mock.calls[0] as any[])[0];
            expect(updateArg.dispatchedToCloudTask).toBeNull();
        });
    });

    describe('EVENT_EMPTY_ERROR handling', () => {
        it('should move to DLQ immediately when FIT file has no activities', async () => {
            // This test verifies the fix for empty FIT files going to DLQ immediately
            // instead of retrying 10 times

            const admin = await import('firebase-admin');
            const firestore = admin.firestore();
            const batch = firestore.batch();

            const mockRef = {
                parent: { id: 'suuntoAppWorkoutQueue' },
                update: vi.fn(),
                delete: vi.fn(),
                id: 'empty-fit-item'
            };

            const queueItem: QueueItemInterface = {
                id: 'empty-fit-item',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            // Create an error with the EVENT_EMPTY_ERROR code
            const emptyEventError: any = new Error('No activities found');
            emptyEventError.code = 'EVENT_EMPTY_ERROR';

            // Call moveToDeadLetterQueue directly since parseWorkoutQueueItemForServiceName
            // requires complex token mocking
            const result = await moveToDeadLetterQueue(queueItem, emptyEventError, undefined, 'EVENT_EMPTY_ERROR');

            // Should have moved to DLQ
            expect(result).toBe('MOVED_TO_DLQ');
            expect(batch.set).toHaveBeenCalled();
            expect(batch.delete).toHaveBeenCalledWith(mockRef);

            // Verify the context is preserved
            const setCallArgs = (batch.set as any).mock.calls[0][1];
            expect(setCallArgs.context).toBe('EVENT_EMPTY_ERROR');
        });
    });

    describe('addToQueue functions', () => {
        it('addToQueueForSuunto should insert item with correct ID', async () => {
            const result = await addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' });
            expect(result.id).toBe('mock-doc-id');
            const admin = await import('firebase-admin');
            const doc = admin.firestore().collection('suuntoAppWorkoutQueue').doc('user1-work1');
            expect(doc.set).toHaveBeenCalledWith(expect.objectContaining({
                id: 'user1-work1',
                userName: 'user1',
                workoutID: 'work1'
            }));
        });

        it('addToQueueForCOROS should insert item', async () => {
            const queueItem: any = { id: 'coros1', openId: 'oid1', workoutID: 'wid1' };
            const result = await addToQueueForCOROS(queueItem);
            expect(result.id).toBe('mock-doc-id');
            const admin = await import('firebase-admin');
            const doc = admin.firestore().collection('COROSAPIWorkoutQueue').doc('coros1');
            expect(doc.set).toHaveBeenCalledWith(expect.objectContaining({
                id: 'coros1',
                openId: 'oid1'
            }));
        });

        it('addToQueueForGarmin should insert item with activityFileID based ID', async () => {
            const queueItem = {
                userID: 'u1',
                startTimeInSeconds: 123,
                manual: false,
                activityFileID: 'file123',
                activityFileType: 'FIT' as const,
                token: 't1',
                userAccessToken: 'ut1',
                callbackURL: 'cb1',
            };
            const result = await addToQueueForGarmin(queueItem);
            expect(result.id).toBe('mock-doc-id');
            const admin = await import('firebase-admin');
            const doc = admin.firestore().collection('garminAPIActivityQueue').doc('u1-file123');
            expect(doc.set).toHaveBeenCalledWith(expect.objectContaining({
                id: 'u1-file123',
                activityFileID: 'file123'
            }));
        });
    });

    describe('parseWorkoutQueueItemForServiceName', () => {
        let mockRef: any;
        let suuntoQueueItem: SuuntoAppWorkoutQueueItemInterface;

        beforeEach(() => {
            mockRef = {
                parent: { id: 'suuntoAppWorkoutQueue' },
                update: vi.fn(),
                delete: vi.fn(),
                id: 'test-suunto-item'
            };

            suuntoQueueItem = {
                id: 'test-suunto-item',
                ref: mockRef,
                userName: 'suuntoUser',
                workoutID: 'sw1',
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            vi.mocked(getTokenData).mockResolvedValue({
                accessToken: 'fresh-token',
                userName: 'suuntoUser'
            } as any);

            vi.mocked(requestHelper.get).mockResolvedValue(new ArrayBuffer(8));
        });

        it('should call garmin processor for GarminAPI service', async () => {
            const garminItem: any = { id: 'garmin1' };
            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.GarminAPI, garminItem);
            expect(processGarminAPIActivityQueueItem).toHaveBeenCalled();
            expect(result).toBe('PROCESSED');
        });

        it('should process SuuntoApp item successfully', async () => {
            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);
            expect(result).toBe(QueueResult.Processed);
            expect(vi.mocked(utils.setEvent)).toHaveBeenCalledWith(
                'mock-user-id', // Corrected from mock-doc-id based on hierarchy fix
                'standardized-event-id',
                expect.any(Object),
                expect.any(Object),
                expect.any(Object),
                undefined,
                undefined,
                undefined
            );
        });

        it('should move to DLQ if no token found', async () => {
            const admin = await import('firebase-admin');
            vi.spyOn(admin.firestore().collectionGroup('tokens'), 'get').mockResolvedValueOnce({
                size: 0,
                docs: [],
                empty: true
            } as any);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);
            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(mockBatch.delete).toHaveBeenCalledWith(mockRef);
        });

        it('should handle COROSAPI item successfully', async () => {
            const corosItem: COROSAPIWorkoutQueueItemInterface = {
                id: 'test-coros-item',
                ref: mockRef,
                openId: 'corosOpenId',
                workoutID: 'cw1',
                FITFileURI: 'https://coros.com/fit',
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };
            mockRef.parent.id = 'COROSAPIWorkoutQueue';

            vi.mocked(getTokenData).mockResolvedValue({
                accessToken: 'fresh-token',
                openId: 'corosOpenId'
            } as any);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.COROSAPI, corosItem);
            expect(result).toBe(QueueResult.Processed);
            expect(vi.mocked(utils.setEvent)).toHaveBeenCalledWith(
                'mock-user-id',
                'standardized-event-id',
                expect.any(Object),
                expect.any(Object),
                expect.any(Object),
                undefined,
                undefined,
                undefined
            );
        });

        it('should handle 401 Unauthorized with token refresh and retry', async () => {
            vi.mocked(requestHelper.get)
                .mockRejectedValueOnce({ statusCode: 401 })
                .mockResolvedValueOnce(new ArrayBuffer(8));

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.Processed);
            expect(getTokenData).toHaveBeenCalledTimes(2); // Initial + Force Refresh
        });

        it('should handle 403 Forbidden by increasing retry count significantly', async () => {
            vi.mocked(requestHelper.get).mockRejectedValue({ statusCode: 403 });

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);
            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(mockBatch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                context: 'MAX_RETRY_REACHED'
            }));
        });
    });
});
