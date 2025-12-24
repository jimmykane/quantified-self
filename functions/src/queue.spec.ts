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
        id: 'mock-doc-id',
    };

    const mockDocSnapshot = {
        id: 'mock-doc-id',
        ref: mockDocRef,
        data: vi.fn(() => ({})),
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
    };

    return {
        default: {
            firestore: vi.fn(() => mockFirestore),
            initializeApp: vi.fn(),
            credential: { cert: vi.fn() },
        },
        firestore: vi.fn(() => mockFirestore),
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
import {
    increaseRetryCountForQueueItem,
    updateToProcessed,
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

        it('should increment by custom amount', async () => {
            const mockRef = {
                update: vi.fn(() => Promise.resolve()),
            };

            const queueItem: QueueItemInterface = {
                id: 'test-item-2',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Big error'), 10);

            expect(queueItem.retryCount).toBe(10);
            expect(queueItem.totalRetryCount).toBe(10);
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
            ).rejects.toThrow('No docuemnt reference supplied');
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
            const updateArg = mockUpdate.mock.calls[0][0];
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
            ).rejects.toThrow('No docuemnt reference supplied');
        });
    });
});
