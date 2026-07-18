import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as functions from 'firebase-functions/v1';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Hoist mocks
const {
    authBuilderMock,
    deauthorizeServiceMock,
    cleanupServiceConnectionForUserMock,
    firestoreMock,
    getServiceConfigMock,
    batchMock,
    whereMock,
    recursiveDeleteMock,
    tokensGetMock,
    setMock,
    limitMock,
    startAfterMock,
    limitGetMock,
    collectionGroupMock,
    collectionGroupWhereMock,
    markQueueItemDeletedForUserCleanupMock,
} = vi.hoisted(() => {
    const onDeleteMock = vi.fn((handler) => handler);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const userMock = vi.fn((_id?: string) => ({ onDelete: onDeleteMock }));

    const deleteMock = vi.fn().mockResolvedValue({});
    const setMock = vi.fn().mockResolvedValue({});

    // Mock for tokens subcollection - returns empty by default
    const tokensGetMock = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const tokensCollectionMock = vi.fn((collectionId?: string) => ({
        path: `subcollection/${collectionId || ''}`,
        get: tokensGetMock
    }));

     
    const docMock = vi.fn((_id?: string) => ({
        path: `doc/${_id || ''}`,
        delete: deleteMock,
        collection: tokensCollectionMock,  // Support for subcollection queries
        set: setMock
    }));

    // Define mocks first
    const querySnapshotMock = {
        docs: [
            { id: 'doc1', ref: 'ref1', data: () => ({}) },
            { id: 'doc2', ref: 'ref2', data: () => ({}) },
        ],
    };

    const whereMock = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(querySnapshotMock)
    });

    const limitGetMock = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const startAfterMock = vi.fn().mockReturnValue({ get: limitGetMock });
    const limitMock = vi.fn().mockReturnValue({ get: limitGetMock, startAfter: startAfterMock });

    const collectionGroupLimitGetMock = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const collectionGroupLimitMock = vi.fn().mockReturnValue({ get: collectionGroupLimitGetMock });
    const collectionGroupWhereMock: any = vi.fn(() => ({
        where: collectionGroupWhereMock,
        limit: collectionGroupLimitMock,
        get: collectionGroupLimitGetMock,
    }));
    const collectionGroupMock = vi.fn(() => ({
        where: collectionGroupWhereMock,
        limit: collectionGroupLimitMock,
        get: collectionGroupLimitGetMock,
    }));

    const collectionMock = vi.fn((collectionName) => {
        if (collectionName === 'mail') {
            return {
                where: whereMock,
                doc: docMock,
                limit: limitMock
            };
        }
        return {
            doc: docMock,
            where: whereMock,
            limit: limitMock
        };
    });

    const batchMock = {
        delete: vi.fn(),
        commit: vi.fn(),
    };

    const recursiveDeleteMock = vi.fn().mockResolvedValue({});

    // Timestamp mock
    const mockTimestamp = {
        toMillis: () => 1700000000000
    };

    const firestore = Object.assign(vi.fn(() => ({
        collection: collectionMock,
        collectionGroup: collectionGroupMock,
        batch: vi.fn(() => batchMock),
        recursiveDelete: recursiveDeleteMock
    })), {
        Timestamp: {
            now: vi.fn(() => mockTimestamp),
            fromMillis: vi.fn((ms) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })),
            fromDate: vi.fn((date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 }))
        }
    });

    const deauthorizeServiceMock = vi.fn();
    const cleanupServiceConnectionForUserMock = vi.fn((uid: string, serviceName: ServiceNames) => deauthorizeServiceMock(uid, serviceName));

    return {
        authBuilderMock: { user: userMock },
        deauthorizeServiceMock,
        cleanupServiceConnectionForUserMock,

        firestoreMock: firestore,
        getServiceConfigMock: vi.fn(),
        batchMock,
        whereMock,
        recursiveDeleteMock,
        tokensGetMock,
        setMock,
        limitMock,
        startAfterMock,
        limitGetMock,
        collectionGroupMock,
        collectionGroupWhereMock,
        markQueueItemDeletedForUserCleanupMock: vi.fn().mockResolvedValue(true)
    };
});

// Mock firebase-functions
vi.mock('firebase-functions/v1', () => ({
    auth: authBuilderMock,
    region: vi.fn().mockImplementation(() => ({
        auth: authBuilderMock
    })),
}));

// Mock firebase-admin
vi.mock('firebase-admin', () => ({
    firestore: firestoreMock
}));

// Mock oauth wrappers
vi.mock('../OAuth2', () => ({
    getServiceConfig: getServiceConfigMock
}));

vi.mock('../service-auth-lifecycle', () => ({
    cleanupServiceConnectionForUser: cleanupServiceConnectionForUserMock,
    SERVICE_AUTH_CLEANUP_REASONS: {
        AccountDeletion: 'account_deletion',
    },
}));

vi.mock('../queue/cleanup-tombstone', () => ({
    markQueueItemDeletedForUserCleanup: markQueueItemDeletedForUserCleanupMock,
    QUEUE_CLEANUP_TOMBSTONE_REASONS: {
        AccountDeletionCleanup: 'account_deletion_cleanup',
        UserDeletionGuard: 'user_deletion_guard',
    },
}));



// Import function under test
import { cleanupUserAccounts, ORPHANED_SERVICE_TOKENS_COLLECTION_NAME } from './cleanup';

const testEnv = functionsTest();

function createPaginatedLimitQueryMock(pages: Array<{ docs: unknown[]; empty?: boolean }>) {
    const get = vi.fn();
    for (const page of pages) {
        get.mockResolvedValueOnce(page);
    }
    get.mockResolvedValue({ empty: true, docs: [] });

    const startAfter = vi.fn().mockReturnValue({ get });
    const limit = vi.fn().mockReturnValue({ get, startAfter });

    return { get, startAfter, limit };
}

function mockCollectionLimitQueriesByName(limitQueriesByCollectionName: Record<string, ReturnType<typeof createPaginatedLimitQueryMock>>) {
    const collectionMock = firestoreMock().collection;
    const baseImplementation = collectionMock.getMockImplementation();
    if (!baseImplementation) {
        throw new Error('Expected Firestore collection mock implementation');
    }

    collectionMock.mockImplementation((collectionName: string) => {
        const baseCollection = baseImplementation(collectionName) as Record<string, unknown>;
        const queryOverride = limitQueriesByCollectionName[collectionName];
        if (!queryOverride) {
            return baseCollection;
        }

        return {
            ...baseCollection,
            limit: queryOverride.limit,
        };
    });
}

function mockCollectionWhereResultsByName(
    resolver: (collectionName: string, field: string, operator: string, value: string) => { docs: unknown[] } | null,
): () => void {
    const collectionMock = firestoreMock().collection;
    const baseImplementation = collectionMock.getMockImplementation();
    if (!baseImplementation) {
        throw new Error('Expected Firestore collection mock implementation');
    }

    collectionMock.mockImplementation((collectionName: string) => {
        const baseCollection = baseImplementation(collectionName) as Record<string, unknown>;
        return {
            ...baseCollection,
            where: vi.fn((field: string, operator: string, value: string) => {
                whereMock(field, operator, value);
                return {
                    get: vi.fn().mockResolvedValue(resolver(collectionName, field, operator, value) || { docs: [] }),
                };
            }),
        };
    });

    return () => {
        collectionMock.mockImplementation(baseImplementation);
    };
}

describe('cleanupUserAccounts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset console mocks to keep output clean during tests if needed
        global.console = { ...global.console, log: vi.fn(), error: vi.fn() };

        // Setup default mocks
        getServiceConfigMock.mockReturnValue({ tokenCollectionName: 'mockCollection' });
        deauthorizeServiceMock.mockReset().mockResolvedValue(undefined);
        cleanupServiceConnectionForUserMock
            .mockReset()
            .mockImplementation((uid: string, serviceName: ServiceNames) => deauthorizeServiceMock(uid, serviceName));
        tokensGetMock.mockReset().mockResolvedValue({ empty: true, size: 0, docs: [] });
        setMock.mockReset().mockResolvedValue({});
        whereMock.mockReset().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) });
        limitGetMock.mockReset().mockResolvedValue({ empty: true, docs: [] });
        startAfterMock.mockReset().mockReturnValue({ get: limitGetMock });
        limitMock.mockReset().mockReturnValue({ get: limitGetMock, startAfter: startAfterMock });
        collectionGroupWhereMock.mockReset().mockImplementation(() => ({
            where: collectionGroupWhereMock,
            limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true, docs: [] }) }),
            get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        }));
        collectionGroupMock.mockReset().mockImplementation(() => ({
            where: collectionGroupWhereMock,
            limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true, docs: [] }) }),
            get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        }));
        markQueueItemDeletedForUserCleanupMock.mockReset().mockResolvedValue(true);

        // Reset batch/where mocks specific behavior if needed
        batchMock.commit.mockResolvedValue({});
    });

    afterEach(() => {
        testEnv.cleanup();
        vi.clearAllMocks();
    });

    it('should deauthorize services and delete parent documents', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify Suunto
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);
        expect(getServiceConfigMock).toHaveBeenCalledWith(ServiceNames.SuuntoApp);
        expect(firestoreMock().collection).toHaveBeenCalledWith('mockCollection');
        expect(firestoreMock().collection('mockCollection').doc).toHaveBeenCalledWith('testUser123');
        expect(recursiveDeleteMock).toHaveBeenCalled();

        // Verify COROS
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.WahooAPI);
        expect(cleanupServiceConnectionForUserMock).toHaveBeenCalledWith(
            'testUser123',
            ServiceNames.SuuntoApp,
            'account_deletion',
            { missingTokensBehavior: 'ignore' },
        );
        expect(cleanupServiceConnectionForUserMock).toHaveBeenCalledWith(
            'testUser123',
            ServiceNames.COROSAPI,
            'account_deletion',
            { missingTokensBehavior: 'ignore' },
        );
        expect(cleanupServiceConnectionForUserMock).toHaveBeenCalledWith(
            'testUser123',
            ServiceNames.GarminAPI,
            'account_deletion',
            { missingTokensBehavior: 'ignore' },
        );
        expect(cleanupServiceConnectionForUserMock).toHaveBeenCalledWith(
            'testUser123',
            ServiceNames.WahooAPI,
            'account_deletion',
            { missingTokensBehavior: 'ignore' },
        );
    });

    it('should force delete Suunto tokens even if deauthorization fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto fail
        deauthorizeServiceMock.mockRejectedValueOnce(new Error('Suunto 500 API Error'));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify Suunto was called (and failed)
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);
        // But local cleanup should STILL happen
        expect(recursiveDeleteMock).toHaveBeenCalled();

        // COROS succeeded
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
    });

    it('should continue if parent doc deletion fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto doc deletion fail (via the recursiveDelete mock)
        recursiveDeleteMock.mockRejectedValueOnce(new Error('Firestore delete failed'));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify Suunto was called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);

        // Verify COROS was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
    });

    it('should query and delete emails for the user', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123', email: 'test@example.com' });

        const uidDocs = { docs: [{ id: 'mail1', ref: 'ref1', data: () => ({}) }] };
        const emailDocs = { docs: [{ id: 'mail2', ref: 'ref2', data: () => ({}) }] };

        // Fix: where() returns an object with get(), which returns the promise.
        // The mock definition logic for whereMock was:
        // const whereMock = vi.fn().mockReturnValue({
        //     get: vi.fn().mockResolvedValue(querySnapshotMock)
        // });

        // We need to override the inner `get` behavior.
        const getMock = vi.fn();
        getMock
            .mockResolvedValueOnce(uidDocs)
            .mockResolvedValueOnce(emailDocs);

        whereMock.mockReturnValue({ get: getMock });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(firestoreMock().collection).toHaveBeenCalledWith('mail');

        // Verify Queries
        expect(whereMock).toHaveBeenCalledWith('toUids', 'array-contains', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('to', '==', 'test@example.com');

        // Verify Deletion
        // expect(firestoreMock().batch).toHaveBeenCalled(); // Removed as firestoreMock returns new instance with new batch spy each time
        expect(batchMock.delete).toHaveBeenCalledWith('ref1');
        expect(batchMock.delete).toHaveBeenCalledWith('ref2');
        expect(batchMock.commit).toHaveBeenCalled();
    });

    it('should preserve account deletion confirmation emails during mail cleanup', async () => {
        const wrapped = cleanupUserAccounts;
        const uid = 'testUser123';
        const user = testEnv.auth.makeUserRecord({ uid, email: 'test@example.com' });

        const uidDocs = {
            docs: [
                {
                    id: `account_deleted_confirmation_${uid}`,
                    ref: 'preservedRefById',
                    data: () => ({ template: { name: 'account_deleted_confirmation' } })
                },
                {
                    id: 'mail1',
                    ref: 'deleteRef1',
                    data: () => ({ template: { name: 'subscription_upgrade' } })
                }
            ]
        };
        const emailDocs = {
            docs: [
                {
                    id: 'mail2',
                    ref: 'deleteRef2',
                    data: () => ({ template: { name: 'welcome_email' } })
                },
                {
                    id: 'mail3',
                    ref: 'preservedRefByTemplate',
                    data: () => ({ template: { name: 'account_deleted_confirmation' } })
                }
            ]
        };

        const getMock = vi.fn();
        getMock
            .mockResolvedValueOnce(uidDocs)
            .mockResolvedValueOnce(emailDocs);

        whereMock.mockReturnValue({ get: getMock });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(batchMock.delete).toHaveBeenCalledWith('deleteRef1');
        expect(batchMock.delete).toHaveBeenCalledWith('deleteRef2');
        expect(batchMock.delete).not.toHaveBeenCalledWith('preservedRefById');
        expect(batchMock.delete).not.toHaveBeenCalledWith('preservedRefByTemplate');
        expect(batchMock.commit).toHaveBeenCalled();
    });

    it('should recursively delete parent doc', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify recursiveDelete was called with the correct doc ref
        const docRef = firestoreMock().collection('mockCollection').doc('testUser123');
        expect(recursiveDeleteMock).toHaveBeenCalledWith(docRef);
    });

    it('should recursively delete generated derived metrics subtree', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'subcollection/derivedMetrics' }));
    });

    it('should handle subcollection deletion error and continue', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make subcollection query throw for first service
        // Make recursiveDelete throw
        recursiveDeleteMock.mockRejectedValueOnce(new Error('Firestore error'));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Should still call COROS and Garmin
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
    });

    it('should force delete Garmin tokens even if deauthorization fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Garmin fail
        deauthorizeServiceMock.mockImplementation((userId, serviceName) => {
            if (serviceName === ServiceNames.GarminAPI) {
                return Promise.reject(new Error('Garmin 500 API Error'));
            }
            return Promise.resolve();
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify Garmin deauth attempted
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);

        // Verify local cleanup encountered error but TRIED to delete
        // Note: The helper calls deleteTokenDocumentWithSubcollections, which calls doc(uid).delete()
        expect(firestoreMock().collection).toHaveBeenCalledWith('garminAPITokens');
        expect(firestoreMock().collection('garminAPITokens').doc).toHaveBeenCalledWith('testUser123');
        expect(recursiveDeleteMock).toHaveBeenCalled();
    });

    it('should force delete COROS tokens even if deauthorization fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make COROS fail. Since deauthorizeServiceForUser is used for both Suunto and COROS,
        // we need to verify the call args to distinguish.
        // We can mock it to throw ONLY when called with COROSAPI.
        deauthorizeServiceMock.mockImplementation((userId, serviceName) => {
            if (serviceName === ServiceNames.COROSAPI) {
                return Promise.reject(new Error('COROS 500 API Error'));
            }
            return Promise.resolve();
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify COROS deauth attempted
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify local cleanup encountered error but TRIED to delete (COROS collection from config mock)
        // Note: Config mock returns 'mockCollection' for all calls currently
        expect(firestoreMock().collection).toHaveBeenCalledWith('mockCollection');
        expect(firestoreMock().collection('mockCollection').doc).toHaveBeenCalledWith('testUser123');
        expect(recursiveDeleteMock).toHaveBeenCalled();
    });

    it('should handle TokenNotFoundError gracefully', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Throw TokenNotFoundError for Suunto
        const tokenNotFoundError = new Error('No token found');
        tokenNotFoundError.name = 'TokenNotFoundError';
        deauthorizeServiceMock.mockRejectedValueOnce(tokenNotFoundError);

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Should still process other services
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
        expect(recursiveDeleteMock).toHaveBeenCalled();
    });

    it('should archive remaining tokens when they exist after deauthorization', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make tokens subcollection return some remaining tokens
        tokensGetMock.mockResolvedValue({
            empty: false,
            size: 2,
            docs: [
                { id: 'orphaned-token-1', data: () => ({ accessToken: 'tok1' }) },
                { id: 'orphaned-token-2', data: () => ({ accessToken: 'tok2' }) }
            ]
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify it called the correct collection
        expect(firestoreMock().collection).toHaveBeenCalledWith(ORPHANED_SERVICE_TOKENS_COLLECTION_NAME);

        // Should have called set to archive the orphaned tokens
        // 3 services x 2 tokens each = 6 archive calls
        expect(setMock).toHaveBeenCalled();

        // Verify archive data structure
        expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
            serviceName: expect.any(String),
            uid: 'testUser123',
            originalTokenId: expect.stringContaining('orphaned-token'),
            token: expect.any(Object),
            archivedAt: expect.any(Object),
            expireAt: expect.any(Object),
            lastError: expect.stringContaining('Cleanup: Token remained after deauthorization attempts')
        }));
    });

    it('should archive refreshed lifecycle token material when account deletion deauth fails after in-memory refresh', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        cleanupServiceConnectionForUserMock.mockImplementation(async (uid: string, serviceName: ServiceNames) => {
            await deauthorizeServiceMock(uid, serviceName);
            if (serviceName !== ServiceNames.SuuntoApp) {
                return undefined;
            }

            return {
                reason: 'account_deletion',
                tokenCount: 1,
                deletedTokenCount: 1,
                preservedTokenCount: 0,
                partnerDeauthorizeAttempted: 1,
                partnerDeauthorizeFailed: 1,
                localCleanupStatus: 'completed',
                connectionStateUpdate: 'unchanged',
                fallbackTokenRootCleanupPerformed: false,
                tokensToArchive: [{
                    tokenID: 'suunto-token-id',
                    tokenData: {
                        serviceName: ServiceNames.SuuntoApp,
                        accessToken: 'fresh-access-token',
                        refreshToken: 'fresh-refresh-token',
                        userName: 'suunto-user-id',
                    },
                    errorMessage: 'partner unavailable',
                }],
            };
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
            serviceName: ServiceNames.SuuntoApp,
            uid: 'testUser123',
            originalTokenId: 'suunto-token-id',
            token: expect.objectContaining({
                accessToken: 'fresh-access-token',
                refreshToken: 'fresh-refresh-token',
                userName: 'suunto-user-id',
            }),
            lastError: 'partner unavailable',
        }));
    });

    it('should let refreshed lifecycle token archival override stale remaining local token archival', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        const emptyTokensSnapshot = { empty: true, size: 0, docs: [] };

        cleanupServiceConnectionForUserMock.mockImplementation(async (uid: string, serviceName: ServiceNames) => {
            await deauthorizeServiceMock(uid, serviceName);
            if (serviceName !== ServiceNames.SuuntoApp) {
                return undefined;
            }

            return {
                reason: 'account_deletion',
                tokenCount: 1,
                deletedTokenCount: 0,
                preservedTokenCount: 0,
                partnerDeauthorizeAttempted: 1,
                partnerDeauthorizeFailed: 1,
                localCleanupStatus: 'partial',
                connectionStateUpdate: 'unchanged',
                fallbackTokenRootCleanupPerformed: false,
                tokensToArchive: [{
                    tokenID: 'suunto-token-id',
                    tokenData: {
                        serviceName: ServiceNames.SuuntoApp,
                        accessToken: 'fresh-access-token',
                        refreshToken: 'fresh-refresh-token',
                        userName: 'suunto-user-id',
                    },
                    errorMessage: 'partner unavailable after refresh',
                }],
            };
        });
        tokensGetMock
            .mockResolvedValue(emptyTokensSnapshot)
            .mockResolvedValueOnce(emptyTokensSnapshot)
            .mockResolvedValueOnce(emptyTokensSnapshot)
            .mockResolvedValueOnce(emptyTokensSnapshot)
            .mockResolvedValueOnce(emptyTokensSnapshot)
            .mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [{
                    id: 'suunto-token-id',
                    data: () => ({
                        accessToken: 'stale-access-token',
                        refreshToken: 'stale-refresh-token',
                        userName: 'suunto-user-id',
                    }),
                }],
            });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        const suuntoArchiveCalls = setMock.mock.calls
            .map(([data]) => data)
            .filter((data) => data?.serviceName === ServiceNames.SuuntoApp && data?.originalTokenId === 'suunto-token-id');
        expect(suuntoArchiveCalls).toHaveLength(2);
        expect(suuntoArchiveCalls[0].token).toEqual(expect.objectContaining({
            accessToken: 'stale-access-token',
            refreshToken: 'stale-refresh-token',
        }));
        expect(suuntoArchiveCalls[1].token).toEqual(expect.objectContaining({
            accessToken: 'fresh-access-token',
            refreshToken: 'fresh-refresh-token',
        }));
        expect(suuntoArchiveCalls[1].lastError).toBe('partner unavailable after refresh');
    });

    it('should handle archive failure gracefully and continue cleanup', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make tokens subcollection return a remaining token
        tokensGetMock.mockResolvedValue({
            empty: false,
            size: 1,
            docs: [
                { id: 'failing-token', data: () => ({ accessToken: 'fail' }) }
            ]
        });

        // Make set fail for archiving
        setMock.mockRejectedValue(new Error('Firestore write failed'));

        // Should not throw, just log and continue
        await expect(wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext)).resolves.not.toThrow();

        // Should still call recursiveDelete
        expect(recursiveDeleteMock).toHaveBeenCalled();
    });

    it('should still force delete token roots when reading remaining tokens for archival fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockRejectedValue(new Error('Firestore read failed'));

        await expect(wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext)).resolves.not.toThrow();

        const tokenRootDeleteCalls = recursiveDeleteMock.mock.calls
            .filter(([ref]) => ref?.path === 'doc/testUser123');
        expect(tokenRootDeleteCalls).toHaveLength(4);
    });

    it('should skip archiving when no tokens remain', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Tokens subcollection returns empty (default)
        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Set should NOT be called for archiving
        expect(setMock).not.toHaveBeenCalled();
    });

    it('should handle null email correctly and skip email query', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        // User without email - only uid query should run

        const getMock = vi.fn().mockResolvedValue({ docs: [] });
        whereMock.mockReturnValue({ get: getMock });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Should only query by toUids, not by email
        expect(whereMock).toHaveBeenCalledWith('toUids', 'array-contains', 'testUser123');
    });

    it('should log when no email documents found', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123', email: 'test@test.com' });

        // Both queries return empty
        const getMock = vi.fn().mockResolvedValue({ docs: [] });
        whereMock.mockReturnValue({ get: getMock });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // No batch commit since no emails
        expect(batchMock.commit).not.toHaveBeenCalled();
    });

    it('should recursively delete top-level queue and failed-job state for the deleted user', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123', email: 'test@example.com' });

        tokensGetMock.mockResolvedValue({
            empty: false,
            size: 1,
            docs: [
                {
                    id: 'service-token-1',
                    data: () => ({
                        userName: 'suunto-provider-user',
                        openId: 'coros-provider-user',
                        userID: 'garmin-provider-user',
                    })
                }
            ]
        });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'firebaseUserID' && value === 'testUser123'
                    ? { docs: [{ id: 'provider-job-1', ref: { path: 'suuntoAppWorkoutQueue/provider-job-1' }, data: () => ({}) }] }
                    :
                field === 'providerUserId' && value === 'suunto-provider-user'
                    ? {
                        docs: [{
                            id: 'sleep-job-1',
                            ref: { path: 'sleepSyncQueue/sleep-job-1' },
                            data: () => ({
                                provider: 'SuuntoApp',
                                providerUserId: 'suunto-provider-user',
                            }),
                        }]
                    }
                    : field === 'userID' && value === 'testUser123'
                        ? { docs: [{ id: 'activity-job-1', ref: { path: 'activitySyncQueue/activity-job-1' }, data: () => ({}) }] }
                        : field === 'uid' && value === 'testUser123'
                            ? {
                                docs: [
                                    { id: 'reparse-job-1', ref: { path: 'sportsLibReparseJobs/reparse-job-1' }, data: () => ({}) },
                                    { id: 'route-reparse-job-1', ref: { path: 'sportsLibRouteReparseJobs/route-reparse-job-1' }, data: () => ({}) },
                                ],
                            }
                        : { docs: [] }
            )
        }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(firestoreMock().collection).toHaveBeenCalledWith('activitySyncQueue');
        expect(firestoreMock().collection).toHaveBeenCalledWith('sleepSyncQueue');
        expect(firestoreMock().collection).toHaveBeenCalledWith('garminAPIActivityQueue');
        expect(firestoreMock().collection).toHaveBeenCalledWith('suuntoAppWorkoutQueue');
        expect(firestoreMock().collection).toHaveBeenCalledWith('COROSAPIWorkoutQueue');
        expect(firestoreMock().collection).toHaveBeenCalledWith('sportsLibReparseJobs');
        expect(firestoreMock().collection).toHaveBeenCalledWith('sportsLibRouteReparseJobs');
        expect(firestoreMock().collection).toHaveBeenCalledWith('failed_jobs');
        expect(whereMock).toHaveBeenCalledWith('firebaseUserID', '==', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('uid', '==', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('providerUserId', '==', 'suunto-provider-user');
        expect(whereMock).toHaveBeenCalledWith('userName', '==', 'suunto-provider-user');
        expect(whereMock).toHaveBeenCalledWith('openId', '==', 'coros-provider-user');
        expect(whereMock).toHaveBeenCalledWith('userID', '==', 'garmin-provider-user');
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'sleepSyncQueue/sleep-job-1' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'activitySyncQueue/activity-job-1' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'suuntoAppWorkoutQueue/provider-job-1' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'sportsLibReparseJobs/reparse-job-1' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'sportsLibRouteReparseJobs/route-reparse-job-1' }));
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'sleep-job-1',
            'account_deletion_cleanup',
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'activitySyncQueue',
            'activity-job-1',
            'account_deletion_cleanup',
        );
    });

    it('should preserve queue state when cleanup tombstone write fails during account deletion', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123', email: 'test@example.com' });
        markQueueItemDeletedForUserCleanupMock.mockResolvedValue(false);
        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'userID' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'activity-job-no-tombstone',
                            ref: { path: 'activitySyncQueue/activity-job-no-tombstone' },
                            data: () => ({ userID: 'testUser123' }),
                        }],
                    }
                    : { docs: [] }
            )
        }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'activitySyncQueue',
            'activity-job-no-tombstone',
            'account_deletion_cleanup',
        );
        expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
            path: 'activitySyncQueue/activity-job-no-tombstone',
        }));
    });

    it('should recover provider identifiers from archived orphan tokens when current token docs are already gone', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'uid' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'archived-garmin-token',
                            ref: { path: `${ORPHANED_SERVICE_TOKENS_COLLECTION_NAME}/archived-garmin-token` },
                            data: () => ({
                                serviceName: ServiceNames.GarminAPI,
                                token: { userID: 'archived-garmin-user' },
                            }),
                        }],
                    }
                    : field === 'userID' && value === 'archived-garmin-user'
                        ? {
                            docs: [{
                                id: 'legacy-garmin-job',
                                ref: { path: 'garminAPIActivityQueue/legacy-garmin-job' },
                                data: () => ({
                                    userID: 'archived-garmin-user',
                                }),
                            }],
                        }
                        : { docs: [] }
            )
        }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(whereMock).toHaveBeenCalledWith('uid', '==', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('userID', '==', 'archived-garmin-user');
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: 'garminAPIActivityQueue/legacy-garmin-job',
        }));
    });

    it('should recover provider identifiers from uid-keyed queue docs when token docs are already gone', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'userID' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'uid-keyed-sleep-job',
                            ref: { path: 'sleepSyncQueue/uid-keyed-sleep-job' },
                            data: () => ({
                                provider: 'SuuntoApp',
                                providerUserId: 'suunto-provider-from-queue',
                            }),
                        }],
                    }
                    : field === 'providerUserId' && value === 'suunto-provider-from-queue'
                        ? {
                            docs: [{
                                id: 'provider-only-sleep-job',
                                ref: { path: 'sleepSyncQueue/provider-only-sleep-job' },
                                data: () => ({
                                    provider: 'SuuntoApp',
                                    providerUserId: 'suunto-provider-from-queue',
                                }),
                            }],
                        }
                        : { docs: [] }
            )
        }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(whereMock).toHaveBeenCalledWith('userID', '==', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('providerUserId', '==', 'suunto-provider-from-queue');
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: 'sleepSyncQueue/provider-only-sleep-job',
        }));
    });

    it('should remove legacy provider-keyed orphan queue and DLQ docs for recovered provider identifiers', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        const routeQueueQuery = createPaginatedLimitQueryMock([{ docs: [] }]);
        const sleepQueueQuery = createPaginatedLimitQueryMock([{
            docs: [{
                id: 'legacy-provider-only-sleep',
                ref: { path: 'sleepSyncQueue/legacy-provider-only-sleep' },
                data: () => ({
                    provider: 'SuuntoApp',
                    providerUserId: 'legacy-suunto-provider',
                }),
            }],
        }]);
        const failedJobsQuery = createPaginatedLimitQueryMock([{
            docs: [{
                id: 'legacy-provider-only-dlq',
                ref: { path: 'failed_jobs/legacy-provider-only-dlq' },
                data: () => ({
                    originalCollection: 'suuntoAppWorkoutQueue',
                    userName: 'legacy-suunto-provider',
                }),
            }],
        }]);

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'uid' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'archived-suunto-token',
                            ref: { path: `${ORPHANED_SERVICE_TOKENS_COLLECTION_NAME}/archived-suunto-token` },
                            data: () => ({
                                serviceName: ServiceNames.SuuntoApp,
                                token: { userName: 'legacy-suunto-provider' },
                            }),
                        }],
                    }
                    : { docs: [] }
            )
        }));
        mockCollectionLimitQueriesByName({
            routeSyncQueue: routeQueueQuery,
            sleepSyncQueue: sleepQueueQuery,
            failed_jobs: failedJobsQuery,
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(collectionGroupMock).toHaveBeenCalledWith('tokens');
        expect(collectionGroupWhereMock).toHaveBeenCalledWith('userName', '==', 'legacy-suunto-provider');
        expect(collectionGroupWhereMock).not.toHaveBeenCalledWith('serviceName', '==', ServiceNames.SuuntoApp);
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: 'sleepSyncQueue/legacy-provider-only-sleep',
        }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: 'failed_jobs/legacy-provider-only-dlq',
        }));
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'legacy-provider-only-sleep',
            'account_deletion_cleanup',
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'suuntoAppWorkoutQueue',
            'legacy-provider-only-dlq',
            'account_deletion_cleanup',
        );
    });

    it('should paginate legacy provider-keyed orphan sweeps beyond the first page', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        const firstPageDocs = Array.from({ length: 500 }, (_, index) => ({
            id: `first-page-sleep-${index}`,
            ref: { path: `sleepSyncQueue/first-page-sleep-${index}` },
            data: () => ({
                provider: 'SuuntoApp',
                providerUserId: `other-provider-${index}`,
            }),
        }));
        const routeQueueQuery = createPaginatedLimitQueryMock([{ docs: [] }]);
        const sleepQueueQuery = createPaginatedLimitQueryMock([
            { docs: firstPageDocs },
            {
                docs: [{
                    id: 'second-page-provider-only-sleep',
                    ref: { path: 'sleepSyncQueue/second-page-provider-only-sleep' },
                    data: () => ({
                        provider: 'SuuntoApp',
                        providerUserId: 'paged-legacy-suunto-provider',
                    }),
                }],
            },
        ]);

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'uid' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'archived-suunto-token',
                            ref: { path: `${ORPHANED_SERVICE_TOKENS_COLLECTION_NAME}/archived-suunto-token` },
                            data: () => ({
                                serviceName: ServiceNames.SuuntoApp,
                                token: { userName: 'paged-legacy-suunto-provider' },
                            }),
                        }],
                    }
                    : { docs: [] }
            )
        }));
        mockCollectionLimitQueriesByName({
            routeSyncQueue: routeQueueQuery,
            sleepSyncQueue: sleepQueueQuery,
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(sleepQueueQuery.startAfter).toHaveBeenCalledWith(firstPageDocs[firstPageDocs.length - 1]);
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: 'sleepSyncQueue/second-page-provider-only-sleep',
        }));
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'second-page-provider-only-sleep',
            'account_deletion_cleanup',
        );
    });

    it('should skip legacy provider-keyed orphan sweeps when no provider identifiers were recovered', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(limitMock).not.toHaveBeenCalled();
        expect(limitGetMock).not.toHaveBeenCalled();
        expect(startAfterMock).not.toHaveBeenCalled();
    });

    it('should not remove unassociated provider-keyed orphan queue docs during another user cleanup', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        const routeQueueQuery = createPaginatedLimitQueryMock([{ docs: [] }]);
        const sleepQueueQuery = createPaginatedLimitQueryMock([{
            docs: [{
                id: 'unassociated-provider-only-sleep',
                ref: { path: 'sleepSyncQueue/unassociated-provider-only-sleep' },
                data: () => ({
                    provider: 'SuuntoApp',
                    providerUserId: 'other-users-provider-id',
                }),
            }],
        }]);

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) });
        mockCollectionLimitQueriesByName({
            routeSyncQueue: routeQueueQuery,
            sleepSyncQueue: sleepQueueQuery,
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(collectionGroupMock).not.toHaveBeenCalled();
        expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
            path: 'sleepSyncQueue/unassociated-provider-only-sleep',
        }));
        expect(markQueueItemDeletedForUserCleanupMock).not.toHaveBeenCalledWith(
            'sleepSyncQueue',
            'unassociated-provider-only-sleep',
            'account_deletion_cleanup',
        );
    });

    it('should not treat the Firebase uid as a provider identifier fallback', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'userName' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'provider-id-equals-firebase-uid',
                            ref: { path: 'suuntoAppWorkoutQueue/provider-id-equals-firebase-uid' },
                            data: () => ({
                                userName: 'testUser123',
                            }),
                        }],
                    }
                    : { docs: [] }
            )
        }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(whereMock).not.toHaveBeenCalledWith('userName', '==', 'testUser123');
        expect(whereMock).not.toHaveBeenCalledWith('openId', '==', 'testUser123');
        expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
            path: 'suuntoAppWorkoutQueue/provider-id-equals-firebase-uid',
        }));
    });

    it('should not recover Garmin provider identifiers from failed_jobs userID collisions', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        const restoreCollectionMock = mockCollectionWhereResultsByName((collectionName, field, _operator, value) => (
            collectionName === 'failed_jobs' && field === 'userID' && value === 'testUser123'
                ? {
                    docs: [{
                        id: 'garmin-provider-id-equals-firebase-uid',
                        ref: { path: 'failed_jobs/garmin-provider-id-equals-firebase-uid' },
                        data: () => ({
                            originalCollection: 'garminAPIActivityQueue',
                            userID: 'testUser123',
                            activityFileID: 'activity-file-1',
                        }),
                    }],
                }
                : null
        ));

        try {
            await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

            expect(whereMock).toHaveBeenCalledWith('userID', '==', 'testUser123');
            expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
                path: 'garminAPIActivityQueue/garmin-provider-id-equals-firebase-uid',
            }));
            expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
                path: 'failed_jobs/garmin-provider-id-equals-firebase-uid',
            }));
        } finally {
            restoreCollectionMock();
        }
    });

    it('should delete failed_jobs userID docs when originalCollection makes userID a Firebase uid', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        const restoreCollectionMock = mockCollectionWhereResultsByName((collectionName, field, _operator, value) => (
            collectionName === 'failed_jobs' && field === 'userID' && value === 'testUser123'
                ? {
                    docs: [{
                        id: 'sleep-failed-job-for-user',
                        ref: { path: 'failed_jobs/sleep-failed-job-for-user' },
                        data: () => ({
                            originalCollection: 'sleepSyncQueue',
                            userID: 'testUser123',
                            provider: 'SuuntoApp',
                            providerUserId: 'suunto-provider-user',
                        }),
                    }],
                }
                : null
        ));

        try {
            await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

            expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
                path: 'failed_jobs/sleep-failed-job-for-user',
            }));
            expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
                'sleepSyncQueue',
                'sleep-failed-job-for-user',
                'account_deletion_cleanup',
            );
        } finally {
            restoreCollectionMock();
        }
    });

    it('should write fallback tombstones before deleting failed_jobs docs without a recoverable source collection', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'uid' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'failed-job-without-source',
                            ref: { path: 'failed_jobs/failed-job-without-source' },
                            data: () => ({
                                uid: 'testUser123',
                            }),
                        }],
                    }
                    : { docs: [] }
            )
        }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'activitySyncQueue',
            'failed-job-without-source',
            'account_deletion_cleanup',
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'failed-job-without-source',
            'account_deletion_cleanup',
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'suuntoAppWorkoutQueue',
            'failed-job-without-source',
            'account_deletion_cleanup',
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'COROSAPIWorkoutQueue',
            'failed-job-without-source',
            'account_deletion_cleanup',
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'garminAPIActivityQueue',
            'failed-job-without-source',
            'account_deletion_cleanup',
        );
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: 'failed_jobs/failed-job-without-source',
        }));
    });

    it('should not remove provider-keyed queue docs explicitly owned by another Firebase user', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'uid' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'archived-suunto-token',
                            ref: { path: `${ORPHANED_SERVICE_TOKENS_COLLECTION_NAME}/archived-suunto-token` },
                            data: () => ({
                                serviceName: ServiceNames.SuuntoApp,
                                token: { userName: 'shared-suunto-provider' },
                            }),
                        }],
                    }
                    : field === 'userName' && value === 'shared-suunto-provider'
                        ? {
                            docs: [{
                                id: 'other-user-provider-job',
                                ref: { path: 'suuntoAppWorkoutQueue/other-user-provider-job' },
                                data: () => ({
                                    userName: 'shared-suunto-provider',
                                    firebaseUserID: 'other-user-id',
                                }),
                            }],
                        }
                        : { docs: [] }
            )
        }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(collectionGroupMock).not.toHaveBeenCalled();
        expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
            path: 'suuntoAppWorkoutQueue/other-user-provider-job',
        }));
        expect(markQueueItemDeletedForUserCleanupMock).not.toHaveBeenCalledWith(
            'suuntoAppWorkoutQueue',
            'other-user-provider-job',
            'account_deletion_cleanup',
        );
    });

    it('should not remove provider-keyed queue docs that still resolve to an active token', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        const activeTokenGet = vi.fn().mockResolvedValue({
            empty: false,
            docs: [{
                id: 'active-token',
                data: () => ({ serviceName: ServiceNames.SuuntoApp }),
                ref: {
                    parent: {
                        parent: {
                            id: 'other-user-id',
                            parent: { id: 'mockCollection' },
                        },
                    },
                },
            }],
        });
        const activeTokenLimit = vi.fn().mockReturnValue({ get: activeTokenGet });
        const routeQueueQuery = createPaginatedLimitQueryMock([{ docs: [] }]);
        const sleepQueueQuery = createPaginatedLimitQueryMock([{
            docs: [{
                id: 'active-provider-sleep',
                ref: { path: 'sleepSyncQueue/active-provider-sleep' },
                data: () => ({
                    provider: 'SuuntoApp',
                    providerUserId: 'active-suunto-provider',
                }),
            }],
        }]);

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'uid' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'archived-active-suunto-token',
                            ref: { path: `${ORPHANED_SERVICE_TOKENS_COLLECTION_NAME}/archived-active-suunto-token` },
                            data: () => ({
                                serviceName: ServiceNames.SuuntoApp,
                                token: { userName: 'active-suunto-provider' },
                            }),
                        }],
                    }
                    : field === 'userName' && value === 'active-suunto-provider'
                        ? {
                            docs: [{
                                id: 'active-provider-workout',
                                ref: { path: 'suuntoAppWorkoutQueue/active-provider-workout' },
                                data: () => ({
                                    userName: 'active-suunto-provider',
                                }),
                            }],
                        }
                    : { docs: [] }
            )
        }));
        collectionGroupWhereMock.mockImplementation(() => ({
            where: collectionGroupWhereMock,
            limit: activeTokenLimit,
            get: activeTokenGet,
        }));
        collectionGroupMock.mockImplementation(() => ({
            where: collectionGroupWhereMock,
            limit: activeTokenLimit,
            get: activeTokenGet,
        }));
        mockCollectionLimitQueriesByName({
            routeSyncQueue: routeQueueQuery,
            sleepSyncQueue: sleepQueueQuery,
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(activeTokenGet).toHaveBeenCalled();
        expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
            path: 'suuntoAppWorkoutQueue/active-provider-workout',
        }));
        expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
            path: 'sleepSyncQueue/active-provider-sleep',
        }));
        expect(markQueueItemDeletedForUserCleanupMock).not.toHaveBeenCalledWith(
            'sleepSyncQueue',
            'active-provider-sleep',
            'account_deletion_cleanup',
        );
    });

    it('should recover Garmin provider identifiers from legacy failed jobs without originalCollection', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        whereMock.mockImplementation((field: string, _operator: string, value: string) => ({
            get: vi.fn().mockResolvedValue(
                field === 'firebaseUserID' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'legacy-garmin-failed-job',
                            ref: { path: 'failed_jobs/legacy-garmin-failed-job' },
                            data: () => ({
                                firebaseUserID: 'testUser123',
                                userID: 'legacy-garmin-provider-user',
                                activityFileID: 'activity-file-1',
                                activityFileType: 'FIT',
                            }),
                        }],
                    }
                    : field === 'userID' && value === 'legacy-garmin-provider-user'
                        ? {
                            docs: [{
                                id: 'legacy-garmin-queue-job',
                                ref: { path: 'garminAPIActivityQueue/legacy-garmin-queue-job' },
                                data: () => ({
                                    userID: 'legacy-garmin-provider-user',
                                }),
                            }],
                        }
                        : { docs: [] }
            )
        }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(whereMock).toHaveBeenCalledWith('firebaseUserID', '==', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('userID', '==', 'legacy-garmin-provider-user');
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: 'garminAPIActivityQueue/legacy-garmin-queue-job',
        }));
    });

    it('should handle archiving with non-standard error and empty token data', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make tokens subcollection return a token with NO data (undefined data())
        tokensGetMock.mockResolvedValue({
            empty: false,
            size: 1,
            docs: [
                { id: 'failing-token', data: () => undefined } // Returns undefined tokenData
            ]
        });

        // Make deauthorize fail with an object that has no message but has toString
        const weirdError = { toString: () => 'Weird Error Object' };
        deauthorizeServiceMock.mockRejectedValueOnce(weirdError);

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify set was called with the fallback error string and empty token object
        expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
            token: {},
            lastError: 'Weird Error Object'
        }));
    });
});
