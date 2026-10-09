import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as functions from 'firebase-functions/v1';
import { IS_NOT_TENANT, type AuthEvent, type User } from 'firebase-functions/v2/identity';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Hoist mocks
const {
    dataCleanupMocks,
    hydrateQuerySnapshot,
    authBuilderMock,
    runWithMock,
    deauthorizeServiceMock,
    cleanupServiceConnectionForUserMock,
    firestoreMock,
    getServiceConfigMock,
    batchMock,
    whereMock,
    recursiveDeleteMock,
    runTransactionMock,
    transactionDeleteMock,
    tokensGetMock,
    setMock,
    limitMock,
    startAfterMock,
    limitGetMock,
    collectionGroupMock,
    collectionGroupWhereMock,
    markQueueItemDeletedForUserCleanupMock,
    cleanupMcpOAuthStateForUserMock,
    cleanupRejectedRouteOriginalFilesForUserMock,
    cleanupServiceDisconnectTasksForUserMock,
} = vi.hoisted(() => {
    const dataCleanupMocks = {
        beginAccountDataCleanup: vi.fn().mockResolvedValue({ attemptId: 'synthetic-attempt', suuntoUserNames: [], corosOpenIds: [], garminUserIDs: [], wahooUserIDs: [] }),
        checkpointAccountDeletionIdentifiers: vi.fn().mockResolvedValue(undefined),
        deleteAccountOperationalTree: vi.fn(),
        checkpointAccountDeletionTarget: vi.fn().mockResolvedValue({ delete: vi.fn().mockResolvedValue(undefined) }),
        removeAccountDeletionTargetCheckpoint: vi.fn().mockResolvedValue(undefined),
        assertAccountFirestoreTreeAbsent: vi.fn().mockResolvedValue(undefined),
        completeAccountDataCleanup: vi.fn().mockResolvedValue(undefined),
        deleteAccountFirestoreRoot: vi.fn().mockResolvedValue(undefined),
        assertAccountFirestoreRootAbsent: vi.fn().mockResolvedValue(undefined),
        deleteAccountStorageFiles: vi.fn().mockResolvedValue(undefined),
        assertAccountStorageAbsent: vi.fn().mockResolvedValue(undefined),
        assertAccountCleanupQueryEmpty: vi.fn().mockResolvedValue(undefined),
    };
    const onDeleteMock = vi.fn((handler) => handler);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const userMock = vi.fn((_id?: string) => ({ onDelete: onDeleteMock }));
    const authBuilderMock = { user: userMock };

    const deleteMock = vi.fn().mockResolvedValue({});
    const setMock = vi.fn().mockResolvedValue({});

    // Mock for tokens subcollection - returns empty by default
    const tokensGetMock = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const tokensCollectionMock = vi.fn((collectionId?: string) => collectionId === 'operationalTargets' ? {
        limit: () => ({ get: async () => ({ docs: [] }) }),
    } : ({
        path: `subcollection/${collectionId || ''}`,
        get: tokensGetMock,
        limit: vi.fn(() => ({ get: tokensGetMock })),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const hydrateQuerySnapshot = (snapshot: { docs: Array<{ id?: string; ref?: unknown; data?: () => Record<string, unknown> }> }, args: unknown[] = []) => ({
        ...snapshot,
        docs: snapshot.docs.map(doc => ({
            ...doc, exists: true,
            ref: typeof doc.ref === 'object' && doc.ref ? { ...doc.ref, id: doc.id } : doc.ref,
            data: () => ({ ...(typeof args[0] === 'string' ? { [args[0]]: args[1] === 'array-contains' ? [args[2]] : args[2] } : {}), ...doc.data?.() }),
        })),
    });
    // Model Firestore collection scoping even when a scenario shares its query mock.
    const scopedQuery = (collectionName: string, query: { get: () => Promise<{ docs: { ref?: { path?: string } }[] }>; startAfter?: (...args: unknown[]) => unknown }) => {
        const scoped = {
            get: async () => {
                const snapshot = hydrateQuerySnapshot(await query.get());
                return { ...snapshot, docs: snapshot.docs.filter(doc => !doc.ref?.path || doc.ref.path.split('/')[0] === collectionName) };
            },
            limit: vi.fn(() => scoped),
            startAfter: (...args: unknown[]) => scopedQuery(collectionName, query.startAfter!(...args) as typeof query),
        };
        return scoped;
    };
    const collectionMock = vi.fn((collectionName) => ({
        doc: docMock,
        where: (...args: unknown[]) => {
            const query = whereMock(...args);
            return scopedQuery(collectionName, { ...query, get: async () => hydrateQuerySnapshot(await query.get(), args) });
        },
        limit: (...args: unknown[]) => scopedQuery(collectionName, limitMock(...args)),
    }));

    const batchMock = {
        delete: vi.fn(),
        commit: vi.fn(),
    };

    const recursiveDeleteMock = vi.fn().mockResolvedValue({});
    const transactionDeleteMock = vi.fn();
    const runTransactionMock = vi.fn(async (handler: (transaction: {
        get: (ref: { get?: () => Promise<unknown> }) => Promise<unknown>;
        delete: (ref: unknown) => void;
    }) => Promise<unknown>) => handler({
        get: async (ref) => ref?.get
            ? ref.get()
            : { exists: false, data: () => ({}) },
        delete: transactionDeleteMock,
    }));

    // Timestamp mock
    const mockTimestamp = {
        toMillis: () => 1700000000000
    };

    const firestore = Object.assign(vi.fn(() => ({
        collection: collectionMock,
        doc: vi.fn((path: string) => ({ path, id: path.split('/').pop() })),
        collectionGroup: collectionGroupMock,
        batch: vi.fn(() => batchMock),
        recursiveDelete: recursiveDeleteMock,
        runTransaction: runTransactionMock,
    })), {
        Timestamp: {
            now: vi.fn(() => mockTimestamp),
            fromMillis: vi.fn((ms) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })),
            fromDate: vi.fn((date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 }))
        }
    });

    const deauthorizeServiceMock = vi.fn();
    const cleanupServiceConnectionForUserMock = vi.fn((uid: string, serviceName: ServiceNames) => deauthorizeServiceMock(uid, serviceName));
    const runWithMock = vi.fn(() => ({
        auth: authBuilderMock,
    }));

    return {
        dataCleanupMocks,
        hydrateQuerySnapshot,
        authBuilderMock,
        runWithMock,
        deauthorizeServiceMock,
        cleanupServiceConnectionForUserMock,

        firestoreMock: firestore,
        getServiceConfigMock: vi.fn(),
        batchMock,
        whereMock,
        recursiveDeleteMock,
        runTransactionMock,
        transactionDeleteMock,
        tokensGetMock,
        setMock,
        limitMock,
        startAfterMock,
        limitGetMock,
        collectionGroupMock,
        collectionGroupWhereMock,
        markQueueItemDeletedForUserCleanupMock: vi.fn().mockResolvedValue(true),
        cleanupMcpOAuthStateForUserMock: vi.fn().mockResolvedValue(undefined),
        cleanupRejectedRouteOriginalFilesForUserMock: vi.fn().mockResolvedValue(undefined),
        cleanupServiceDisconnectTasksForUserMock: vi.fn().mockResolvedValue(undefined),
    };
});

// Mock firebase-functions
vi.mock('firebase-functions/v1', () => ({
    auth: authBuilderMock,
    region: vi.fn().mockImplementation(() => ({
        auth: authBuilderMock,
        runWith: runWithMock,
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

vi.mock('../mcp/oauth.service', () => ({
    MCP_OAUTH_COLLECTIONS: { authorizationRequests: 'mcpOAuthAuthorizationRequests', authorizationCodes: 'mcpOAuthAuthorizationCodes', accessTokens: 'mcpOAuthAccessTokens', refreshTokens: 'mcpOAuthRefreshTokens', rateLimits: 'mcpOAuthRateLimits' },
    cleanupMcpOAuthStateForUser: cleanupMcpOAuthStateForUserMock,
}));

vi.mock('../routes/rejected-original-cleanup', () => ({
    REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME: 'routeOriginalFileCleanup',
    cleanupRejectedRouteOriginalFilesForUser: cleanupRejectedRouteOriginalFilesForUserMock,
}));

vi.mock('./data-cleanup', () => ({ ...dataCleanupMocks, ACCOUNT_DELETION_ROOT_COLLECTIONS: ['users', 'customers'], ACCOUNT_DELETION_TARGETS_COLLECTION: 'operationalTargets' }));

vi.mock('../service-disconnect-cleanup', () => ({
    SERVICE_DISCONNECT_CLEANUP_COLLECTION: 'serviceDisconnectCleanup',
    cleanupServiceDisconnectTasksForUser: cleanupServiceDisconnectTasksForUserMock,
}));



// Import function under test
import {
    ACCOUNT_DELETION_CLEANUP_RUNTIME_OPTIONS,
    cleanupUserAccountsV2,
    ACCOUNT_DELETION_CLEANUP_V2_RUNTIME_OPTIONS,
    ORPHANED_SERVICE_TOKENS_COLLECTION_NAME,
} from './cleanup';
import { SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME } from '../sleep/constants';
import { SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME } from '../suunto/health-webhook-binding';

const testEnv = functionsTest();
const authEvent = (user: User): AuthEvent<User> => ({
    data: user, id: 'synthetic-delete', type: 'google.firebase.auth.user.v2.deleted',
    source: '//identitytoolkit.googleapis.com/projects/demo-account-deletion',
    time: '2026-10-09T00:00:00Z', specversion: '1.0',
});
// Keep the behavioral cases readable while invoking the real Gen 2 SDK handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const cleanupUserAccounts = (user: User, _context: functions.EventContext) => cleanupUserAccountsV2.run(authEvent(user));
const registeredCleanupRuntimeOptions = runWithMock.mock.calls[0]?.[0];

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
                const query = {
                    get: vi.fn().mockResolvedValue(hydrateQuerySnapshot((resolver(collectionName, field, operator, value) || { docs: [] }) as Parameters<typeof hydrateQuerySnapshot>[0], [field, operator, value])),
                    limit: vi.fn(() => query),
                };
                return query;
            }),
        };
    });

    return () => {
        collectionMock.mockImplementation(baseImplementation);
    };
}

describe('cleanupUserAccountsV2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset console mocks to keep output clean during tests if needed
        global.console = { ...global.console, log: vi.fn(), error: vi.fn() };

        for (const [key, mock] of Object.entries(dataCleanupMocks)) {
            mock.mockReset().mockResolvedValue(key === 'beginAccountDataCleanup'
                ? { attemptId: 'synthetic-attempt', suuntoUserNames: [], corosOpenIds: [], garminUserIDs: [], wahooUserIDs: [] } : key === 'checkpointAccountDeletionTarget' ? { delete: vi.fn().mockResolvedValue(undefined) } : undefined);
        }
        dataCleanupMocks.deleteAccountOperationalTree.mockImplementation(async (_db, _uid, _attempt, root, beforeDelete) => {
            await beforeDelete({ get: (ref: { get: () => Promise<unknown> }) => ref.get(), set: vi.fn() }, true);
            await recursiveDeleteMock(root.ref);
        });
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
        cleanupMcpOAuthStateForUserMock.mockReset().mockResolvedValue(undefined);
        cleanupRejectedRouteOriginalFilesForUserMock.mockReset().mockResolvedValue(undefined);
        cleanupServiceDisconnectTasksForUserMock.mockReset().mockResolvedValue(undefined);
        transactionDeleteMock.mockReset();
        runTransactionMock.mockReset().mockImplementation(async (handler: (transaction: {
            get: (ref: { get?: () => Promise<unknown> }) => Promise<unknown>;
            delete: (ref: unknown) => void;
        }) => Promise<unknown>) => handler({
            get: async (ref) => ref?.get
                ? ref.get()
                : { exists: false, data: () => ({}) },
            delete: transactionDeleteMock,
        }));

        // Reset batch/where mocks specific behavior if needed
        batchMock.commit.mockResolvedValue({});
    });

    afterEach(() => {
        testEnv.cleanup();
        vi.clearAllMocks();
    });

    it('unwraps the real Eventarc deleted-user envelope with the original email', async () => {
        const event = { ...authEvent(testEnv.auth.makeUserRecord({ uid: 'testUser123' })),
            data: { oldValue: { uid: 'testUser123', email: 'deleted@example.invalid' } } };
        await cleanupUserAccountsV2(event as unknown as AuthEvent<User>);
        expect(dataCleanupMocks.beginAccountDataCleanup).toHaveBeenCalledWith(expect.anything(), 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('to', '==', 'deleted@example.invalid');
        expect(dataCleanupMocks.completeAccountDataCleanup).toHaveBeenCalledWith(expect.anything(), 'testUser123', 'synthetic-attempt');
    });

    it.each(['tenantid', 'tenantId'])('ignores another tenant even when its UID matches a default-project account (%s)', async tenantField => {
        await cleanupUserAccountsV2({ ...authEvent(testEnv.auth.makeUserRecord({ uid: 'testUser123' })),
            [tenantField]: 'other-tenant' });
        expect(dataCleanupMocks.beginAccountDataCleanup).not.toHaveBeenCalled();
        expect(firestoreMock).not.toHaveBeenCalled();
        expect(deauthorizeServiceMock).not.toHaveBeenCalled();
    });

    it('rejects missing Auth data before any cleanup starts', async () => {
        await expect(cleanupUserAccountsV2.run({ ...authEvent(testEnv.auth.makeUserRecord({ uid: 'testUser123' })),
            data: undefined } as unknown as AuthEvent<User>)).rejects.toThrow('Missing deleted Auth user');
        expect(dataCleanupMocks.beginAccountDataCleanup).not.toHaveBeenCalled();
        expect(firestoreMock).not.toHaveBeenCalled();
    });

    it('registers the default-project Gen 2 trigger with retries and the previous runtime identity', () => {
        expect(ACCOUNT_DELETION_CLEANUP_V2_RUNTIME_OPTIONS.tenantId).toBe(IS_NOT_TENANT);
        expect(cleanupUserAccountsV2.__endpoint).toMatchObject({
            platform: 'gcfv2', region: ['europe-west2'], availableMemoryMb: 1024,
            timeoutSeconds: 540, concurrency: 1, cpu: 1,
            serviceAccountEmail: 'quantified-self-io@appspot.gserviceaccount.com',
            eventTrigger: { eventType: 'google.firebase.auth.user.v2.deleted', retry: true, region: 'global', eventFilters: {} },
        });
        expect(ACCOUNT_DELETION_CLEANUP_V2_RUNTIME_OPTIONS.secrets.map(secret => secret.name))
            .toEqual(ACCOUNT_DELETION_CLEANUP_RUNTIME_OPTIONS.secrets.map(secret => secret.name));
    });

    it('fails closed when the account fence cannot be established', async () => {
        dataCleanupMocks.beginAccountDataCleanup.mockRejectedValueOnce(new Error('marker unavailable'));
        await expect(cleanupUserAccounts(testEnv.auth.makeUserRecord({ uid: 'testUser123' }), {} as functions.EventContext))
            .rejects.toThrow('marker unavailable');
        expect(recursiveDeleteMock).not.toHaveBeenCalled();
        expect(deauthorizeServiceMock).not.toHaveBeenCalled();
        expect(dataCleanupMocks.deleteAccountStorageFiles).not.toHaveBeenCalled();
    });

    it('preserves identity sources after a failed checkpoint while completing independent erasure stages', async () => {
        dataCleanupMocks.checkpointAccountDeletionIdentifiers.mockRejectedValueOnce(new Error('checkpoint unavailable'));
        await expect(cleanupUserAccounts(testEnv.auth.makeUserRecord({ uid: 'testUser123' }), {} as functions.EventContext))
            .rejects.toThrow('checkpoint unavailable');
        expect(deauthorizeServiceMock).not.toHaveBeenCalled();
        expect(dataCleanupMocks.deleteAccountFirestoreRoot).toHaveBeenCalledTimes(2);
        expect(dataCleanupMocks.deleteAccountStorageFiles).toHaveBeenCalledWith('testUser123');
        expect(cleanupMcpOAuthStateForUserMock).toHaveBeenCalled();
        expect(dataCleanupMocks.completeAccountDataCleanup).not.toHaveBeenCalled();
    });

    it('continues all independent stages after root failure and completes only a verified retry', async () => {
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        dataCleanupMocks.deleteAccountFirestoreRoot.mockRejectedValueOnce(new Error('root unavailable'));
        await expect(cleanupUserAccounts(user, {} as functions.EventContext)).rejects.toThrow('root unavailable');
        expect(dataCleanupMocks.deleteAccountFirestoreRoot).toHaveBeenCalledTimes(2);
        expect(dataCleanupMocks.deleteAccountStorageFiles).toHaveBeenCalled();
        expect(dataCleanupMocks.assertAccountStorageAbsent).toHaveBeenCalled();
        expect(dataCleanupMocks.completeAccountDataCleanup).not.toHaveBeenCalled();
        await cleanupUserAccounts(user, {} as functions.EventContext);
        expect(dataCleanupMocks.completeAccountDataCleanup).toHaveBeenCalledTimes(1);
    });

    it('recovers provider-only work from the durable checkpoint after credentials disappear', async () => {
        dataCleanupMocks.beginAccountDataCleanup.mockResolvedValueOnce({
            attemptId: 'synthetic-attempt', suuntoUserNames: ['retained-provider'], corosOpenIds: [], garminUserIDs: [], wahooUserIDs: [],
        });
        await cleanupUserAccounts(testEnv.auth.makeUserRecord({ uid: 'testUser123' }), {} as functions.EventContext);
        expect(whereMock).toHaveBeenCalledWith('userName', '==', 'retained-provider');
        expect(dataCleanupMocks.checkpointAccountDeletionIdentifiers).toHaveBeenCalledWith(expect.anything(), 'testUser123', {
            suuntoUserNames: ['retained-provider'], corosOpenIds: [], garminUserIDs: [], wahooUserIDs: [],
        }, 'synthetic-attempt');
    });

    it('keeps the fence pending when scoped absence cannot be verified', async () => {
        dataCleanupMocks.assertAccountStorageAbsent.mockRejectedValueOnce(new Error('late object remains'));
        await expect(cleanupUserAccounts(testEnv.auth.makeUserRecord({ uid: 'testUser123' }), {} as functions.EventContext))
            .rejects.toThrow('late object remains');
        expect(dataCleanupMocks.completeAccountDataCleanup).not.toHaveBeenCalled();
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
        expect(cleanupMcpOAuthStateForUserMock).toHaveBeenCalledWith('testUser123', expect.any(Function));
        expect(cleanupRejectedRouteOriginalFilesForUserMock).toHaveBeenCalledWith('testUser123');
        expect(cleanupServiceDisconnectTasksForUserMock).toHaveBeenCalledWith('testUser123');
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

    it('registers durable retry and extended runtime limits for account-deletion cleanup', () => {
        const expectedSecretNames = [
            'COROSAPI_CLIENT_ID',
            'COROSAPI_CLIENT_SECRET',
            'GARMINAPI_CLIENT_ID',
            'GARMINAPI_CLIENT_SECRET',
            'SUUNTOAPP_CLIENT_ID',
            'SUUNTOAPP_CLIENT_SECRET',
            'WAHOOAPI_CLIENT_ID',
            'WAHOOAPI_CLIENT_SECRET',
        ];

        expect(ACCOUNT_DELETION_CLEANUP_RUNTIME_OPTIONS.failurePolicy).toBe(true);
        expect(ACCOUNT_DELETION_CLEANUP_RUNTIME_OPTIONS.timeoutSeconds).toBe(540);
        expect(ACCOUNT_DELETION_CLEANUP_RUNTIME_OPTIONS.memory).toBe('512MB');
        expect(ACCOUNT_DELETION_CLEANUP_RUNTIME_OPTIONS.secrets.map(secret => secret.name)).toEqual(expectedSecretNames);
        expect(registeredCleanupRuntimeOptions?.failurePolicy).toBe(true);
        expect(registeredCleanupRuntimeOptions?.timeoutSeconds).toBe(540);
        expect(registeredCleanupRuntimeOptions?.memory).toBe('512MB');
        expect(registeredCleanupRuntimeOptions?.secrets.map(secret => secret.name)).toEqual(expectedSecretNames);
    });

    it('continues later deletion stages and requests a retry when MCP OAuth cleanup fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        cleanupMcpOAuthStateForUserMock.mockRejectedValueOnce(new Error('MCP OAuth cleanup failed'));

        await expect(
            wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext),
        ).rejects.toThrow('MCP OAuth cleanup failed');

        expect(cleanupMcpOAuthStateForUserMock).toHaveBeenCalledWith('testUser123', expect.any(Function));
        expect(firestoreMock().collection).toHaveBeenCalledWith('mail');
        expect(whereMock).toHaveBeenCalledWith('toUids', 'array-contains', 'testUser123');
        expect(firestoreMock().collection).toHaveBeenCalledWith(ORPHANED_SERVICE_TOKENS_COLLECTION_NAME);
        expect(firestoreMock().collection).toHaveBeenCalledWith('activitySyncQueue');
    });

    it('requests a retry even when MCP OAuth cleanup rejects without an Error object', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        cleanupMcpOAuthStateForUserMock.mockRejectedValueOnce(undefined);

        await expect(
            wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext),
        ).rejects.toThrow('Account cleanup did not complete.');

        expect(firestoreMock().collection).toHaveBeenCalledWith('mail');
        expect(firestoreMock().collection).toHaveBeenCalledWith('activitySyncQueue');
    });

    it('continues account cleanup and requests a retry when route-original cleanup fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        cleanupRejectedRouteOriginalFilesForUserMock.mockRejectedValueOnce(
            new Error('Storage cleanup unavailable'),
        );

        await expect(
            wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext),
        ).rejects.toThrow('Storage cleanup unavailable');

        expect(cleanupRejectedRouteOriginalFilesForUserMock).toHaveBeenCalledWith('testUser123');
        expect(cleanupMcpOAuthStateForUserMock).toHaveBeenCalledWith('testUser123', expect.any(Function));
        expect(firestoreMock().collection).toHaveBeenCalledWith('mail');
        expect(firestoreMock().collection).toHaveBeenCalledWith('activitySyncQueue');
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

        await expect(wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext)).rejects.toThrow('Firestore delete failed');

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
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce(emailDocs);

        whereMock.mockImplementation((field: string) => ({ get: ['toUids', 'marketing.uid', 'to'].includes(field) ? getMock : vi.fn().mockResolvedValue({ docs: [] }) }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(firestoreMock().collection).toHaveBeenCalledWith('mail');

        // Verify Queries
        expect(whereMock).toHaveBeenCalledWith('toUids', 'array-contains', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('to', '==', 'test@example.com');

        // Verify Deletion
        // expect(firestoreMock().batch).toHaveBeenCalled(); // Removed as firestoreMock returns new instance with new batch spy each time
        expect(batchMock.delete).toHaveBeenCalledWith('ref1', { lastUpdateTime: undefined });
        expect(batchMock.delete).toHaveBeenCalledWith('ref2', { lastUpdateTime: undefined });
        expect(batchMock.commit).toHaveBeenCalled();
    });

    it('deletes a large campaign mail history in bounded batches', async () => {
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        const marketingDocs = Array.from({ length: 801 }, (_, index) => ({
            id: `marketing-${index}`, ref: `mail-ref-${index}`, data: () => ({}),
        }));
        const pages = Array.from({ length: 9 }, (_, page) => ({ docs: marketingDocs.slice(page * 100, (page + 1) * 100) }));
        const paginated = createPaginatedLimitQueryMock(pages);
        // Model successive reads from the same query, including deleted cursor rows.
        whereMock.mockImplementation((field: string) => field === 'marketing.uid'
            ? { get: paginated.get, startAfter: paginated.startAfter }
            : { get: vi.fn().mockResolvedValue({ docs: [] }) });

        await cleanupUserAccounts(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(batchMock.delete).toHaveBeenCalledTimes(801);
        expect(batchMock.commit).toHaveBeenCalledTimes(9);
        expect(paginated.get).toHaveBeenCalledTimes(9);
        expect(paginated.startAfter.mock.calls.map(([doc]) => doc.id)).toEqual(
            Array.from({ length: 8 }, (_, index) => `marketing-${(index + 1) * 100 - 1}`),
        );
    });

    it('preserves explicit other-owner mail sharing the deleted email and pins owned revisions', async () => {
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123', email: 'shared@example.invalid' });
        const revision = { seconds: 1, nanoseconds: 2 };
        const docs = [
            { id: 'other-campaign', ref: 'other-campaign', data: () => ({ marketing: { uid: 'anotherUser' } }) },
            { id: 'other-uid', ref: 'other-uid', data: () => ({ toUids: ['anotherUser'] }) },
            { id: 'owned', ref: 'owned', updateTime: revision, data: () => ({ marketing: { uid: user.uid } }) },
        ];
        whereMock.mockImplementation((field: string) => ({ get: vi.fn().mockResolvedValue({ docs: field === 'to' ? docs : [] }) }));

        await cleanupUserAccounts(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(batchMock.delete.mock.calls).toEqual([['owned', { lastUpdateTime: revision }]]);
    });

    it('requests an account cleanup retry after a campaign mail batch fails', async () => {
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        const getMock = vi.fn()
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [{ id: 'marketing-mail', ref: 'mail-ref', data: () => ({}) }] });
        whereMock.mockImplementation((field: string) => ({ get: ['toUids', 'marketing.uid', 'to'].includes(field) ? getMock : vi.fn().mockResolvedValue({ docs: [] }) }));
        batchMock.commit.mockRejectedValueOnce(new Error('Mail batch failed'));

        await expect(cleanupUserAccounts(user, { eventId: 'eventId' } as unknown as functions.EventContext))
            .rejects.toThrow('Mail batch failed');
        expect(firestoreMock().collection).toHaveBeenCalledWith('activitySyncQueue');
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
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce(emailDocs);

        whereMock.mockImplementation((field: string) => ({ get: ['toUids', 'marketing.uid', 'to'].includes(field) ? getMock : vi.fn().mockResolvedValue({ docs: [] }) }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(batchMock.delete).toHaveBeenCalledWith('deleteRef1', { lastUpdateTime: undefined });
        expect(batchMock.delete).toHaveBeenCalledWith('deleteRef2', { lastUpdateTime: undefined });
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

    it('should recursively delete generated metrics and training-planning subtrees', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'subcollection/derivedMetrics' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'subcollection/trainingPlanState' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'subcollection/trainingPlans' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'subcollection/scheduledWorkouts' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'subcollection/trainingWorkoutCompletions' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'subcollection/trainingActivityCompletionLinks' }));
        for (const collection of ['trainingDeliveryLedger', 'trainingDeliveryState', 'trainingDeliveryScopes',
            'trainingDeliverySettings', 'trainingDeliveryStatuses', 'trainingDeliveryVerifications', 'trainingProviderCapacity',
            'trainingMcpProposals', 'trainingMcpLibraryProposals']) {
            expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: `subcollection/${collection}` }));
        }
    });

    it('should handle subcollection deletion error and continue', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make subcollection query throw for first service
        // Make recursiveDelete throw
        recursiveDeleteMock.mockRejectedValueOnce(new Error('Firestore error'));

        await expect(wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext)).rejects.toThrow('Firestore error');

        // Should still call COROS and Garmin
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
    });
    it('recursively removes UID-scoped Training delivery jobs on a repeat cleanup after a failure', async () => {
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        const queueRef = { path: 'trainingDeliveryQueue/delivery-job' };
        const restoreCollectionMock = mockCollectionWhereResultsByName((collection, field, _operator, value) => (
            collection === 'trainingDeliveryQueue' && field === 'uid' && value === user.uid
                ? { docs: [{ id: 'delivery-job', ref: queueRef, data: () => ({ uid: user.uid }) }] } : null
        ));
        let failed = false;
        recursiveDeleteMock.mockImplementation(async ref => {
            if (ref.path === queueRef.path && !failed) { failed = true; throw new Error('Transient cleanup failure'); }
        });
        try {
            await expect(cleanupUserAccounts(user, { eventId: 'first' } as unknown as functions.EventContext)).rejects.toThrow('Transient cleanup failure');
            await cleanupUserAccounts(user, { eventId: 'retry' } as unknown as functions.EventContext);
            expect(recursiveDeleteMock.mock.calls.filter(([ref]) => ref.path === queueRef.path)).toHaveLength(2);
            expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
                'trainingDeliveryQueue', 'delivery-job', 'account_deletion_cleanup', expect.anything(),
            );
        } finally {
            recursiveDeleteMock.mockReset().mockResolvedValue({});
            restoreCollectionMock();
        }
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

    it('preserves provider identity sources on failed discovery while continuing independent cleanup', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockRejectedValue(new Error('Firestore read failed'));

        await expect(wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext)).rejects.toThrow('Firestore read failed');

        const tokenRootDeleteCalls = recursiveDeleteMock.mock.calls
            .filter(([ref]) => ref?.path === 'doc/testUser123');
        expect(tokenRootDeleteCalls).toHaveLength(0);
        expect(dataCleanupMocks.deleteAccountFirestoreRoot).toHaveBeenCalledTimes(2);
        expect(dataCleanupMocks.completeAccountDataCleanup).not.toHaveBeenCalled();
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
        whereMock.mockImplementation((field: string) => ({ get: ['toUids', 'marketing.uid', 'to'].includes(field) ? getMock : vi.fn().mockResolvedValue({ docs: [] }) }));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Should only query by toUids, not by email
        expect(whereMock).toHaveBeenCalledWith('toUids', 'array-contains', 'testUser123');
    });

    it('should log when no email documents found', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123', email: 'test@test.com' });

        // Both queries return empty
        const getMock = vi.fn().mockResolvedValue({ docs: [] });
        whereMock.mockImplementation((field: string) => ({ get: ['toUids', 'marketing.uid', 'to'].includes(field) ? getMock : vi.fn().mockResolvedValue({ docs: [] }) }));

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
                            id: 'suunto-health-job-1',
                            ref: { path: 'sleepSyncQueue/suunto-health-job-1' },
                            data: () => ({
                                type: 'suunto_health_poll',
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
        expect(firestoreMock().collection).toHaveBeenCalledWith('trainingDeliveryCorosIntegerClaims');
        expect(firestoreMock().collection).toHaveBeenCalledWith('sportsLibReparseJobs');
        expect(firestoreMock().collection).toHaveBeenCalledWith('sportsLibRouteReparseJobs');
        expect(firestoreMock().collection).toHaveBeenCalledWith('failed_jobs');
        expect(whereMock).toHaveBeenCalledWith('firebaseUserID', '==', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('uid', '==', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('providerUserId', '==', 'suunto-provider-user');
        expect(whereMock).toHaveBeenCalledWith('userName', '==', 'suunto-provider-user');
        expect(whereMock).toHaveBeenCalledWith('openId', '==', 'coros-provider-user');
        expect(whereMock).toHaveBeenCalledWith('userID', '==', 'garmin-provider-user');
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'sleepSyncQueue/suunto-health-job-1' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'activitySyncQueue/activity-job-1' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'suuntoAppWorkoutQueue/provider-job-1' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'sportsLibReparseJobs/reparse-job-1' }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'sportsLibRouteReparseJobs/route-reparse-job-1' }));
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'suunto-health-job-1',
            'account_deletion_cleanup', expect.anything(),
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'activitySyncQueue',
            'activity-job-1',
            'account_deletion_cleanup', expect.anything(),
        );
    });

    it('should recursively delete Suunto Health webhook ingress by uid and recovered provider identity', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        const uidKeyedIngress = {
            id: 'uid-keyed-ingress',
            ref: { path: `${SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME}/uid-keyed-ingress` },
            data: () => ({
                userID: 'testUser123',
                providerUserId: 'suunto-provider-from-ingress',
            }),
        };
        const providerKeyedIngress = {
            id: 'provider-keyed-ingress',
            ref: { path: `${SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME}/provider-keyed-ingress` },
            data: () => ({ providerUserId: 'suunto-provider-from-ingress' }),
        };
        const accountBinding = {
            id: 'binding-digest',
            ref: { path: `${SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME}/binding-digest` },
            data: () => ({ userID: 'testUser123' }),
        };
        const restoreCollectionMock = mockCollectionWhereResultsByName(
            (collectionName, field, _operator, value) => {
                if (collectionName === SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME
                    && field === 'userID'
                    && value === 'testUser123') {
                    return { docs: [accountBinding] };
                }
                if (collectionName !== SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME) return null;
                if (field === 'userID' && value === 'testUser123') {
                    return { docs: [uidKeyedIngress] };
                }
                if (field === 'providerUserId' && value === 'suunto-provider-from-ingress') {
                    return { docs: [uidKeyedIngress, providerKeyedIngress] };
                }
                return null;
            },
        );

        try {
            await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);
        } finally {
            restoreCollectionMock();
        }

        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: `${SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME}/uid-keyed-ingress`,
        }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: `${SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME}/provider-keyed-ingress`,
        }));
        expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            path: `${SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME}/binding-digest`,
        }));
        expect(markQueueItemDeletedForUserCleanupMock).not.toHaveBeenCalledWith(
            SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME,
            expect.any(String),
            expect.any(String), expect.anything(),
        );
    });

    it('should preserve queue state when cleanup tombstone write fails during account deletion', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123', email: 'test@example.com' });
        markQueueItemDeletedForUserCleanupMock.mockResolvedValue(false);
        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        const restoreCollectionMock = mockCollectionWhereResultsByName(
            (collectionName, field, _operator, value) => (
                collectionName === 'activitySyncQueue'
                && field === 'userID'
                && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'activity-job-no-tombstone',
                            ref: { path: 'activitySyncQueue/activity-job-no-tombstone' },
                            data: () => ({ userID: 'testUser123' }),
                        }],
                    }
                    : null
            ),
        );

        try {
            await expect(wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext)).rejects.toThrow('Queue cleanup tombstone');
        } finally {
            restoreCollectionMock();
        }

        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'activitySyncQueue',
            'activity-job-no-tombstone',
            'account_deletion_cleanup', expect.anything(),
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

    it('removes legacy provider-only queue and DLQ rows through exact provider queries', async () => {
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        dataCleanupMocks.beginAccountDataCleanup.mockResolvedValueOnce({
            attemptId: 'synthetic-attempt', suuntoUserNames: ['legacy-suunto-provider'], corosOpenIds: [], garminUserIDs: [], wahooUserIDs: [],
        });
        const restore = mockCollectionWhereResultsByName((collection, field, _operator, value) => {
            if (value !== 'legacy-suunto-provider') return null;
            if (collection === 'sleepSyncQueue' && field === 'providerUserId') return { docs: [{
                id: 'legacy-sleep', ref: { path: 'sleepSyncQueue/legacy-sleep' },
                data: () => ({ provider: 'SuuntoApp', providerUserId: value }),
            }] };
            if (collection === 'failed_jobs' && field === 'userName') return { docs: [{
                id: 'legacy-dlq', ref: { path: 'failed_jobs/legacy-dlq' },
                data: () => ({ originalCollection: 'suuntoAppWorkoutQueue', userName: value }),
            }] };
            return null;
        });
        try {
            await cleanupUserAccounts(user, {} as functions.EventContext);
            expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'sleepSyncQueue/legacy-sleep' }));
            expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'failed_jobs/legacy-dlq' }));
            expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
                'suuntoAppWorkoutQueue', 'legacy-dlq', 'account_deletion_cleanup', expect.anything(),
            );
            expect(limitMock).not.toHaveBeenCalled(); // No global collection scan.
        } finally { restore(); }
    });

    it('pages an exact provider query past preserved other-owner rows', async () => {
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        dataCleanupMocks.beginAccountDataCleanup.mockResolvedValueOnce({
            attemptId: 'synthetic-attempt', suuntoUserNames: ['paged-provider'], corosOpenIds: [], garminUserIDs: [], wahooUserIDs: [],
        });
        const first = Array.from({ length: 100 }, (_, index) => ({
            id: `foreign-${index}`, ref: { path: `sleepSyncQueue/foreign-${index}` },
            data: () => ({ provider: 'SuuntoApp', providerUserId: 'paged-provider', firebaseUserID: 'another-owner' }),
        }));
        const query = createPaginatedLimitQueryMock([{ docs: first }, { docs: [{
            id: 'owned', exists: true, ref: { path: 'sleepSyncQueue/owned', id: 'owned' },
            data: () => ({ provider: 'SuuntoApp', providerUserId: 'paged-provider' }),
        }] }]);
        const collectionMock = firestoreMock().collection;
        const base = collectionMock.getMockImplementation()!;
        collectionMock.mockImplementation((collection: string) => {
            const source = base(collection);
            return { ...source, where: (field: string, operator: string, value: string) =>
                collection === 'sleepSyncQueue' && field === 'providerUserId' && value === 'paged-provider'
                    ? query : source.where(field, operator, value) };
        });
        try {
            await cleanupUserAccounts(user, {} as functions.EventContext);
            expect(query.limit).toHaveBeenCalledWith(100);
            expect(query.startAfter).toHaveBeenCalledWith(first[99]);
            expect(recursiveDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'sleepSyncQueue/owned' }));
            expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'sleepSyncQueue/foreign-0' }));
        } finally { collectionMock.mockImplementation(base); }
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

        expect(collectionGroupMock).toHaveBeenCalledTimes(1);
        expect(collectionGroupMock).toHaveBeenCalledWith('recipients');
        expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
            path: 'sleepSyncQueue/unassociated-provider-only-sleep',
        }));
        expect(markQueueItemDeletedForUserCleanupMock).not.toHaveBeenCalledWith(
            'sleepSyncQueue',
            'unassociated-provider-only-sleep',
            'account_deletion_cleanup', expect.anything(),
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
                'account_deletion_cleanup', expect.anything(),
            );
        } finally {
            restoreCollectionMock();
        }
    });

    it('should write fallback tombstones before deleting failed_jobs docs without a recoverable source collection', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });
        const restoreCollectionMock = mockCollectionWhereResultsByName((collectionName, field, _operator, value) => (
                collectionName === 'failed_jobs' && field === 'uid' && value === 'testUser123'
                    ? {
                        docs: [{
                            id: 'failed-job-without-source',
                            ref: { path: 'failed_jobs/failed-job-without-source' },
                            data: () => ({
                                uid: 'testUser123',
                            }),
                        }],
                    }
                    : null
        ));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);
        restoreCollectionMock();

        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'activitySyncQueue',
            'failed-job-without-source',
            'account_deletion_cleanup', expect.anything(),
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'failed-job-without-source',
            'account_deletion_cleanup', expect.anything(),
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'suuntoAppWorkoutQueue',
            'failed-job-without-source',
            'account_deletion_cleanup', expect.anything(),
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'COROSAPIWorkoutQueue',
            'failed-job-without-source',
            'account_deletion_cleanup', expect.anything(),
        );
        expect(markQueueItemDeletedForUserCleanupMock).toHaveBeenCalledWith(
            'garminAPIActivityQueue',
            'failed-job-without-source',
            'account_deletion_cleanup', expect.anything(),
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

        expect(collectionGroupMock).toHaveBeenCalledTimes(1);
        expect(collectionGroupMock).toHaveBeenCalledWith('recipients');
        expect(recursiveDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
            path: 'suuntoAppWorkoutQueue/other-user-provider-job',
        }));
        expect(markQueueItemDeletedForUserCleanupMock).not.toHaveBeenCalledWith(
            'suuntoAppWorkoutQueue',
            'other-user-provider-job',
            'account_deletion_cleanup', expect.anything(),
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
            'account_deletion_cleanup', expect.anything(),
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
