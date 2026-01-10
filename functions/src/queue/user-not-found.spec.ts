
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ServiceNames } from '@sports-alliance/sports-lib';

// Mock Modules
vi.mock('firebase-functions', () => ({
    config: () => ({
        suuntoapp: { subscription_key: 'key', client_id: 'id' },
        corosapi: { client_id: 'id' },
        garminhealth: { consumer_key: 'key' },
    }),
    region: () => ({
        runWith: () => ({
            pubsub: { schedule: () => ({ onRun: () => { } }) },
            https: { onRequest: () => { } }
        }),
    }),
}));

const mockBatch = {
    set: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
};

const mockDocRef = {
    path: 'users/test-uid',
    parent: { id: 'test-parent-col' },
    delete: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    id: 'test-doc-id'
};

const mockSnapshot = {
    empty: false,
    size: 1,
    docs: [{
        id: 'token-1',
        data: () => ({ accessToken: 'foo', refreshToken: 'bar', expiresAt: Date.now() + 10000 }),
        ref: {
            ...mockDocRef,
            parent: { parent: { id: 'test-uid' } } // User ID structure
        }
    }]
};

const mockFirestore = {
    collection: vi.fn(() => ({
        doc: vi.fn(() => ({
            collection: vi.fn(() => ({
                doc: vi.fn(() => mockDocRef),
                count: vi.fn(() => ({ get: vi.fn(() => ({ data: () => ({ count: 5 }) })) }))
            })),
            get: vi.fn(() => Promise.resolve({ data: () => ({}) })),
            set: vi.fn()
        })),
        where: vi.fn(() => ({
            get: vi.fn(() => Promise.resolve(mockSnapshot)),
            where: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockSnapshot)) }))
        })),
        add: vi.fn(),
    })),
    collectionGroup: vi.fn(() => ({
        where: vi.fn(() => ({
            get: vi.fn(() => Promise.resolve(mockSnapshot))
        }))
    })),
    batch: vi.fn(() => mockBatch),
    bulkWriter: vi.fn(() => ({
        set: vi.fn(),
        delete: vi.fn(),
        close: vi.fn(),
        update: vi.fn()
    })),
};

vi.mock('firebase-admin', () => ({
    default: {
        firestore: Object.assign(vi.fn(() => mockFirestore), {
            Timestamp: {
                fromDate: vi.fn((date) => date)
            }
        }),
        auth: vi.fn(),
        storage: vi.fn(() => ({ bucket: () => ({ file: () => ({ save: vi.fn() }), name: 'b' }) })),
    },
    firestore: Object.assign(vi.fn(() => mockFirestore), {
        Timestamp: {
            fromDate: vi.fn((date) => date)
        }
    }),
    auth: vi.fn(),
    storage: vi.fn(),
}));

import * as admin from 'firebase-admin';

// Import subject under test
import { getUserRole, UserNotFoundError } from '../utils';
import { parseWorkoutQueueItemForServiceName } from '../queue';
import { processGarminHealthAPIActivityQueueItem } from '../garmin/queue';

// We need to mock some internals to force flow
vi.mock('../tokens', () => ({
    getTokenData: vi.fn().mockResolvedValue({ accessToken: 'valid' })
}));

vi.mock('../request-helper', () => ({
    default: { get: vi.fn().mockResolvedValue(new ArrayBuffer(10)) },
    get: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
}));

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const mod = await importOriginal<any>();
    return {
        ...mod,
        EventImporterFIT: {
            getFromArrayBuffer: vi.fn().mockResolvedValue({
                getID: () => 'event-id',
                getActivities: () => [],
                startDate: new Date(),
                setID: vi.fn(),
            })
        },
    };
});

vi.mock('../garmin/auth/auth', () => ({
    GarminHealthAPIAuth: () => ({
        authorize: vi.fn().mockReturnValue({}),
        toHeader: vi.fn().mockReturnValue({})
    })
}));

describe('User Not Found Scenarios', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset admin.auth() mock for basic success by default
        (admin.auth as any).mockReturnValue({
            getUser: vi.fn().mockResolvedValue({ uid: 'test-uid' })
        });
    });

    describe('getUserRole', () => {
        it('should throw UserNotFoundError when auth/user-not-found error occurs', async () => {
            (admin.auth as any).mockReturnValue({
                getUser: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' })
            });

            await expect(getUserRole('missing-uid')).rejects.toThrow(UserNotFoundError);
        });

        it('should return "free" (safe default) for other errors', async () => {
            (admin.auth as any).mockReturnValue({
                getUser: vi.fn().mockRejectedValue({ code: 'auth/internal-error' })
            });

            const role = await getUserRole('error-uid');
            expect(role).toBe('free');
        });
    });

    describe('Queue Processing (Suunto/COROS)', () => {
        // We need to verify that parseWorkoutQueueItemForServiceName catches UserNotFoundError and moves to DLQ
        // Logic path: parse -> getToken -> download -> setEvent -> checkEventUsageLimit -> getUserRole
        // We will mock checkEventUsageLimit logic or rely on real getUserRole throwing.
        // Since setEvent is in utils and we are testing integration, let's let it flow.

        it('should move to DLQ when user is not found during processing', async () => {
            const queueItem: any = {
                id: 'q-item-1',
                retryCount: 0,
                userName: 'test-user',
                ref: {
                    id: 'q-item-1',
                    update: vi.fn(),
                    delete: vi.fn(),
                    parent: { id: 'queue-col' }
                }
            };

            // Mock getUserRole failure
            (admin.auth as any).mockReturnValue({
                getUser: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' })
            });

            const bulkWriter = (admin.firestore() as any).bulkWriter();

            await parseWorkoutQueueItemForServiceName(
                ServiceNames.SuuntoApp,
                queueItem,
                bulkWriter
            );

            // Verify move to DLQ logic
            // In bulkWriter mode, it calls bulkWriter.set(failedJob) and bulkWriter.delete(original)
            expect(bulkWriter.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    context: 'USER_NOT_FOUND',
                    error: expect.stringContaining('not found')
                })
            );
            expect(bulkWriter.delete).toHaveBeenCalledWith(queueItem.ref);

            expect(bulkWriter.update).not.toHaveBeenCalled();
        });

        it('should Retry (not DLQ) for generic errors', async () => {
            const queueItem: any = {
                id: 'q-item-retry',
                retryCount: 0,
                userName: 'retry-user',
                ref: {
                    id: 'q-item-retry',
                    update: vi.fn(),
                    delete: vi.fn(),
                    parent: { id: 'queue-col' }
                }
            };

            // Mock network error during download (request-helper) to trigger generic error catch
            const requestHelper = await import('../request-helper');
            requestHelper.default.get.mockRejectedValueOnce(new Error('Network Error'));

            const bulkWriter = (admin.firestore() as any).bulkWriter();

            await parseWorkoutQueueItemForServiceName(
                ServiceNames.SuuntoApp,
                queueItem,
                bulkWriter
            );

            // DLQ should NOT be called
            expect(bulkWriter.set).not.toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ context: 'USER_NOT_FOUND' })
            );

            // Should increment retry count (which uses ref.update in non-bulk or bulkWriter logic)
            // queue-utils increaseRetryCountForQueueItem calls ref.update if bulkWriter not provided? 
            // OR bulkWriter.update(ref, { retryCount: ... })
            // In our mock bulkWriter, we have update mock.
            // But wait, queue-utils implementation for bulkWriter uses sets/deletes?
            // "increaseRetryCountForQueueItem" -> calls ref.update({ retryCount: ... })
            // Since we passed bulkWriter, it should use bulkWriter.update
            expect(bulkWriter.update).toHaveBeenCalled();
        });

        it('should abort immediately if user not found for FIRST token (Multi-Token scenario)', async () => {
            const queueItem: any = {
                id: 'q-item-multi',
                retryCount: 0,
                userName: 'multi-user',
                ref: {
                    id: 'q-item-multi',
                    update: vi.fn(),
                    delete: vi.fn(),
                    parent: { id: 'queue-col' }
                }
            };

            // Setup mock to return TWO tokens
            // The first one will fail user lookup.
            // We want to ensure the loop breaks and we don't try the second one.
            const twoTokensSnapshot = {
                empty: false,
                size: 2,
                docs: [
                    {
                        id: 'token-1',
                        data: () => ({ accessToken: 't1' }),
                        ref: { parent: { parent: { id: 'uid-1' } } }
                    },
                    {
                        id: 'token-2',
                        data: () => ({ accessToken: 't2' }),
                        ref: { parent: { parent: { id: 'uid-2' } } }
                    }
                ]
            };

            // Mock firestore query failure for first one? No, query succeeds.
            // Mock auth lookup failure.
            (admin.auth as any).mockReturnValue({
                getUser: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' })
            });

            // Mock firestore to return 2 tokens
            const firestoreMock = admin.firestore();
            // @ts-expect-error Mocking complex firestore chain
            firestoreMock.collection().where().get.mockResolvedValue(twoTokensSnapshot);


            const bulkWriter = (admin.firestore() as any).bulkWriter();

            await parseWorkoutQueueItemForServiceName(
                ServiceNames.SuuntoApp,
                queueItem,
                bulkWriter
            );

            // Should move to DLQ
            expect(bulkWriter.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ context: 'USER_NOT_FOUND' })
            );

            // Verified it aborted: 
            // If it continued, it might have tried 2nd token. 
            // But since UserNotFoundError calls return QueueResult.MovedToDLQ immediately, 
            // it implicitly verifies we stopped. 
            // If we want to be sure, we could spy on setEvent and check it was called only once?
            // But setEvent is imported.
            // We can check how many times getUser was called?
            // It should be called once (for the first user ID).
            expect(admin.auth().getUser).toHaveBeenCalledTimes(1);
        });
    });

    describe('Queue Processing (Garmin)', () => {
        it('should move to DLQ when user is not found during Garmin processing', async () => {
            const queueItem: any = {
                id: 'g-item-1',
                retryCount: 0,
                userAccessToken: 'token',
                token: 't',
                activityFileID: '1',
                activityFileType: 'FIT',
                userID: 'test-uid',
                startTimeInSeconds: 1234567890,
                ref: {
                    id: 'g-item-1',
                    update: vi.fn(),
                    delete: vi.fn(),
                    parent: { id: 'queue-col' }
                }
            };

            // Mock getUserRole failure
            (admin.auth as any).mockReturnValue({
                getUser: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' })
            });

            const bulkWriter = (admin.firestore() as any).bulkWriter();

            await processGarminHealthAPIActivityQueueItem(
                queueItem,
                bulkWriter
            );

            expect(bulkWriter.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    context: 'USER_NOT_FOUND'
                })
            );
            expect(bulkWriter.delete).toHaveBeenCalledWith(queueItem.ref);
        });
    });
});
