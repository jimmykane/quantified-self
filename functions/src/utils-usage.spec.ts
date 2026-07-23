import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageLimitExceededError, checkEventUsageLimit, hasBasicAccess, hasProAccess, getUserRoleAndGracePeriod, setEvent, setEventDocumentIfUserActive, determineRedirectURI, setAccessControlHeadersOnResponse, EventWriteSkippedByTransactionGuardError, EventWriteSkippedForDeletedUserError } from './utils';
import { SPORTS_LIB_VERSION } from './shared/sports-lib-version.node';
import { USAGE_LIMITS } from '../../shared/limits';
import { preserveEventTagsOnRewrite } from '../../shared/event-tags';

type SetEventParameters = Parameters<typeof setEvent>;

// Hoisted shared/id-generator mock
vi.mock('./shared/id-generator', () => ({
    generateIDFromParts: vi.fn(async () => 'gen-part-id'),
    generateEventID: vi.fn(async () => 'event-id'),
}));

// Mock firebase-functions/logger to no-op
vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

// Mock EventWriter to avoid heavy behavior
const mockSavedOriginalFiles = [
    { path: 'users/user-1/events/event-1/original.fit' },
];
const writeAllEventDataMock = vi.fn().mockResolvedValue(mockSavedOriginalFiles);
const eventWriterConstructorMock = vi.fn();
vi.mock('./shared/event-writer', () => ({
    EventWriter: vi.fn().mockImplementation((...constructorArgs: unknown[]) => {
        eventWriterConstructorMock(...constructorArgs);
        return { writeAllEventData: writeAllEventDataMock };
    }),
    FirestoreAdapter: class { },
    StorageAdapter: class { },
    LogAdapter: class { },
}));

// firebase-functions/v2/https mock (provide HttpsError already imported)
vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));

// Hoisted firebase-admin mock
const hoisted = vi.hoisted(() => {
    let countValue = 0;
    const setCount = (v: number) => { countValue = v; };
    const serverTimestamp = vi.fn().mockReturnValue('SERVER_TIMESTAMP');
    const getUserDeletionGuardState = vi.fn();
    const getUserDeletionGuardStateInTransaction = vi.fn();
    const transactionSet = vi.fn();
    const transactionGet = vi.fn();
    const runTransaction = vi.fn(async (callback: any) => callback({
        get: transactionGet,
        set: transactionSet,
    }));

    const makeCollection = (name: string) => ({
        _name: name,
        doc: (id: string) => makeDoc(`${name}/${id}`),
        count: () => ({
            get: async () => ({ data: () => ({ count: countValue }) })
        }),
    });

    const makeDoc = (path: string) => ({
        _path: path,
        collection: (name: string) => makeCollection(`${path}/${name}`),
        set: vi.fn(),
        update: vi.fn(),
    });

    const firestore = () => ({
        collection: (name: string) => makeCollection(name),
        doc: (id: string) => makeDoc(id),
        batch: vi.fn(),
        runTransaction,
    });
    (firestore as any).FieldValue = { serverTimestamp };

    const bucketSave = vi.fn();
    const bucketCopy = vi.fn();
    const bucketDelete = vi.fn();
    const bucketGetMetadata = vi.fn().mockResolvedValue([{ generation: '1' }]);
    const bucketFile = vi.fn((path: string) => ({
        path,
        save: (data: unknown) => bucketSave(path, data),
        copy: (destination: unknown) => bucketCopy(path, destination),
        delete: (options: unknown) => bucketDelete(path, options),
        getMetadata: bucketGetMetadata,
    }));
    const storage = () => ({
        bucket: () => ({
            name: 'mock-bucket',
            file: bucketFile,
        }),
    });

    const getUser = vi.fn();
    const createCustomToken = vi.fn(async () => 'custom-token');
    const auth = () => ({
        getUser,
        updateUser: vi.fn(),
        createUser: vi.fn(),
        createCustomToken,
    });

    return {
        firestore,
        storage,
        auth,
        getUser,
        setCount,
        bucketSave,
        bucketCopy,
        bucketDelete,
        bucketFile,
        serverTimestamp,
        getUserDeletionGuardState,
        getUserDeletionGuardStateInTransaction,
        transactionSet,
        transactionGet,
        runTransaction,
    };
});

vi.mock('firebase-admin', () => ({
    default: {
        firestore: hoisted.firestore,
        storage: hoisted.storage,
        auth: hoisted.auth,
    },
    firestore: hoisted.firestore,
    storage: hoisted.storage,
    auth: hoisted.auth,
}));

vi.mock('./shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
        readonly name = 'UserDeletionGuardReadError';
        readonly code = 'unavailable';
        readonly statusCode = 503;

        constructor(
            public readonly uid: string,
            public readonly phase: string,
            public readonly originalError: unknown,
        ) {
            super(`Could not read deletion guard for user ${uid} during ${phase}.`);
        }
    },
}));

describe('utils higher-level helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.setCount(0);
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.transactionSet.mockClear();
        hoisted.transactionGet.mockClear();
        hoisted.runTransaction.mockClear();
        eventWriterConstructorMock.mockClear();
    });

    describe('checkEventUsageLimit', () => {
        it('bypasses limit for pro users', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            await expect(checkEventUsageLimit('u1')).resolves.toBeUndefined();
            expect(hoisted.getUser).toHaveBeenCalled();
        });

        it('bypasses limit during grace period', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free', gracePeriodUntil: Date.now() + 10000 } });
            await expect(checkEventUsageLimit('u1')).resolves.toBeUndefined();
        });

        it('throws UsageLimitExceededError when over limit including pending writes', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
            hoisted.setCount(USAGE_LIMITS.free - 1);
            const pending = new Map<string, number>([['u1', 2]]); // total exceeds free-tier limit

            await expect(checkEventUsageLimit('u1', undefined, pending)).rejects.toBeInstanceOf(UsageLimitExceededError);
        });

        it('uses cache to avoid duplicate Firestore count calls', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
            hoisted.setCount(1);
            const cache = new Map();

            await checkEventUsageLimit('u1', cache);
            await checkEventUsageLimit('u1', cache); // should use cached promise

            // count() should have been invoked once (via first call)
            expect(cache.size).toBe(1);
        });

        it('throws for unsupported roles instead of silently using the free-tier limit', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'enterprise' } });

            await expect(checkEventUsageLimit('u1')).rejects.toThrow("Unsupported subscription role 'enterprise'");
        });
    });

    describe('hasProAccess', () => {
        it('returns true for pro role', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            await expect(hasProAccess('u1')).resolves.toBe(true);
        });

        it('returns true for active grace period', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free', gracePeriodUntil: Date.now() + 5000 } });
            await expect(hasProAccess('u1')).resolves.toBe(true);
        });
    });

    describe('hasBasicAccess', () => {
        it('returns true for basic role', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'basic' } });
            await expect(hasBasicAccess('u1')).resolves.toBe(true);
        });

        it('returns true for active grace period', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free', gracePeriodUntil: Date.now() + 5000 } });
            await expect(hasBasicAccess('u1')).resolves.toBe(true);
        });

        it('returns false for free users without grace', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
            await expect(hasBasicAccess('u1')).resolves.toBe(false);
        });
    });

    describe('getUserRoleAndGracePeriod', () => {
        it('throws UserNotFoundError for missing user', async () => {
            const err: any = new Error('not found');
            err.code = 'auth/user-not-found';
            hoisted.getUser.mockRejectedValue(err);

            await expect(getUserRoleAndGracePeriod('missing')).rejects.toThrow('User missing not found in Auth');
        });
    });

    describe('setEventDocumentIfUserActive', () => {
        it('passes merge options through deletion-guarded document writes', async () => {
            const docRef = hoisted.firestore().doc('users/user-1/events/event-1');
            const payload = { comparison: { status: 'ready' } };

            await setEventDocumentIfUserActive('user-1', 'comparison_metadata', docRef as any, payload, { merge: true });

            expect(hoisted.transactionSet).toHaveBeenCalledWith(docRef, payload, { merge: true });
        });

        it('does not set guarded documents when account deletion is active', async () => {
            hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });
            const docRef = hoisted.firestore().doc('users/user-1/events/event-1');

            await expect(setEventDocumentIfUserActive('user-1', 'comparison_metadata', docRef as any, { ready: true }))
                .rejects.toBeInstanceOf(EventWriteSkippedForDeletedUserError);

            expect(hoisted.transactionSet).not.toHaveBeenCalled();
        });

        it('does not set event documents when their transaction authorization guard is rejected', async () => {
            const docRef = hoisted.firestore().doc('users/user-1/events/event-1');
            const transactionGuard = vi.fn().mockResolvedValue(false);

            await expect(setEventDocumentIfUserActive(
                'user-1',
                'wahoo_event_write',
                docRef as any,
                { ready: true },
                undefined,
                undefined,
                transactionGuard,
            )).rejects.toBeInstanceOf(EventWriteSkippedByTransactionGuardError);

            expect(transactionGuard).toHaveBeenCalledWith(expect.objectContaining({
                get: expect.any(Function),
                set: expect.any(Function),
            }));
            expect(hoisted.transactionSet).not.toHaveBeenCalled();
        });

        it('sets event documents when their transaction authorization guard remains current', async () => {
            const docRef = hoisted.firestore().doc('users/user-1/events/event-1');
            const transactionGuard = vi.fn().mockResolvedValue(true);

            await setEventDocumentIfUserActive(
                'user-1',
                'wahoo_event_write',
                docRef as any,
                { ready: true },
                undefined,
                undefined,
                transactionGuard,
            );

            expect(transactionGuard).toHaveBeenCalledTimes(1);
            expect(hoisted.transactionSet).toHaveBeenCalledWith(docRef, { ready: true });
        });

        it('records a created document only after its guarded transaction commits', async () => {
            const docRef = hoisted.firestore().doc('users/user-1/events/event-1');
            const onDocumentCreated = vi.fn();
            hoisted.transactionGet.mockResolvedValueOnce({ exists: false });

            await setEventDocumentIfUserActive(
                'user-1',
                'wahoo_event_write',
                docRef as any,
                { ready: true },
                undefined,
                undefined,
                undefined,
                onDocumentCreated,
            );

            expect(onDocumentCreated).toHaveBeenCalledTimes(1);
        });

        it('does not record a pre-existing deterministic document as attempt-created', async () => {
            const docRef = hoisted.firestore().doc('users/user-1/events/event-1');
            const onDocumentCreated = vi.fn();
            hoisted.transactionGet.mockResolvedValueOnce({ exists: true, data: () => ({ id: 'event-1' }) });

            await setEventDocumentIfUserActive(
                'user-1',
                'wahoo_event_write',
                docRef as any,
                { ready: true },
                undefined,
                undefined,
                undefined,
                onDocumentCreated,
            );

            expect(onDocumentCreated).not.toHaveBeenCalled();
        });

        it('can preserve existing event tags inside the guarded write transaction', async () => {
            const docRef = hoisted.firestore().doc('users/user-1/events/event-1');
            hoisted.transactionGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({ tags: [' Race ', '2026'] }),
            });

            await setEventDocumentIfUserActive(
                'user-1',
                'event_rewrite',
                docRef as any,
                { name: 'Reparsed event', tags: ['Stale'] },
                undefined,
                preserveEventTagsOnRewrite,
            );

            expect(hoisted.transactionSet).toHaveBeenCalledWith(docRef, {
                name: 'Reparsed event',
                tags: ['Race', '2026'],
            });
        });
    });

    describe('setEvent', () => {
        it('writes activities and metadata through deletion-guarded transactions even when bulkWriter is provided', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            const bulkWriter = { set: vi.fn() };
            let assignedEventID: string | null = null;
            const event = {
                getID: () => assignedEventID,
                setID: vi.fn((id: string) => {
                    assignedEventID = id;
                }),
                getActivities: () => [{
                    getID: () => null,
                    setID: vi.fn(),
                    toJSON: () => ({ id: 'act' }),
                    getAllExportableStreams: () => [],
                }],
            };
            const metaData = {
                serviceName: 'GARMINAPI',
                toJSON: () => ({ meta: true }),
            } as any;
            const originalFile = {
                data: Buffer.from('file'),
                extension: 'fit',
                startDate: new Date(),
            };

            const result = await setEvent('user-1', 'event-1', event as any, metaData, originalFile as any, bulkWriter as any);

            expect(writeAllEventDataMock).toHaveBeenCalled();
            expect(bulkWriter.set).not.toHaveBeenCalled();

            const processingCall = hoisted.transactionSet.mock.calls.find((call: any[]) => call[1]?.sportsLibVersion);
            expect(processingCall).toBeTruthy();
            expect(processingCall[1]).toEqual(expect.objectContaining({
                processingEntity: 'event',
                sportsLibVersion: SPORTS_LIB_VERSION,
                sportsLibVersionCode: expect.any(Number),
                processedAt: 'SERVER_TIMESTAMP',
            }));
            expect(result).toEqual({
                eventID: 'event-1',
                savedOriginalFiles: mockSavedOriginalFiles,
            });
        });

        it('does not write event data when account deletion is active', async () => {
            hoisted.getUserDeletionGuardState.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            const bulkWriter = { set: vi.fn() };
            const event = {
                getID: () => 'event-1',
                setID: vi.fn(),
                getActivities: () => [],
            };
            const metaData = {
                serviceName: 'GARMINAPI',
                toJSON: () => ({ meta: true }),
            } as any;

            await expect(setEvent('user-1', 'event-1', event as any, metaData, undefined, bulkWriter as any))
                .rejects.toBeInstanceOf(EventWriteSkippedForDeletedUserError);

            expect(writeAllEventDataMock).not.toHaveBeenCalled();
            expect(bulkWriter.set).not.toHaveBeenCalled();
        });

        it('promotes a staged original file only after all guarded writes succeed', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            hoisted.transactionGet.mockResolvedValue({ exists: false, data: () => undefined });
            const transactionGuard = vi.fn().mockResolvedValue(true);
            const createdDocumentPaths: string[][] = [];
            const event = {
                getID: () => 'event-1',
                setID: vi.fn(),
                getActivities: () => [],
            };
            const metaData = {
                serviceName: 'WAHOOAPI',
                toJSON: () => ({ meta: true }),
            } as unknown as SetEventParameters[3];
            const originalFile = {
                data: Buffer.from('file'),
                extension: 'fit',
                startDate: new Date(),
            };

            writeAllEventDataMock.mockImplementationOnce(async () => {
                const [adapter, storageAdapter] = eventWriterConstructorMock.mock.calls.at(-1);
                await storageAdapter.uploadFile('users/user-1/events/event-1/original.fit', originalFile.data);
                await adapter.setDoc(['users', 'user-1', 'events', 'event-1'], { id: 'event-1' });
                return mockSavedOriginalFiles;
            });

            await setEvent(
                'user-1',
                'event-1',
                event as unknown as SetEventParameters[2],
                metaData,
                originalFile,
                undefined,
                undefined,
                undefined,
                {
                    transactionGuard,
                    stageOriginalFilesUntilEventWrite: true,
                    onDocumentCreated: (path) => createdDocumentPaths.push([...path]),
                },
            );

            const stagingPath = hoisted.bucketFile.mock.calls
                .map(([path]: [string]) => path)
                .find((path: string) => path.startsWith('event-write-staging/'));
            expect(stagingPath).toBeDefined();
            expect(hoisted.bucketSave).toHaveBeenCalledWith(stagingPath, originalFile.data);
            expect(hoisted.bucketCopy).toHaveBeenCalledWith(
                stagingPath,
                expect.objectContaining({ path: 'users/user-1/events/event-1/original.fit' }),
            );
            expect(hoisted.bucketDelete).toHaveBeenCalledWith(stagingPath, { ignoreNotFound: true });
            expect(createdDocumentPaths).toEqual(expect.arrayContaining([
                ['users', 'user-1', 'events', 'event-1'],
                ['users', 'user-1', 'events', 'event-1', 'metaData', 'processing'],
                ['users', 'user-1', 'events', 'event-1', 'metaData', 'WAHOOAPI'],
            ]));
            expect(transactionGuard).toHaveBeenCalledTimes(4);
        });

        it('removes the staged original file when a later ownership guard rejects', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            hoisted.transactionGet.mockResolvedValue({ exists: false, data: () => undefined });
            const transactionGuard = vi.fn()
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            const event = {
                getID: () => 'event-1',
                setID: vi.fn(),
                getActivities: () => [],
            };
            const metaData = {
                serviceName: 'WAHOOAPI',
                toJSON: () => ({ meta: true }),
            } as unknown as SetEventParameters[3];
            const originalFile = {
                data: Buffer.from('file'),
                extension: 'fit',
                startDate: new Date(),
            };

            writeAllEventDataMock.mockImplementationOnce(async () => {
                const [adapter, storageAdapter] = eventWriterConstructorMock.mock.calls.at(-1);
                await storageAdapter.uploadFile('users/user-1/events/event-1/original.fit', originalFile.data);
                await adapter.setDoc(['users', 'user-1', 'events', 'event-1'], { id: 'event-1' });
                return mockSavedOriginalFiles;
            });

            await expect(setEvent(
                'user-1',
                'event-1',
                event as unknown as SetEventParameters[2],
                metaData,
                originalFile,
                undefined,
                undefined,
                undefined,
                { transactionGuard, stageOriginalFilesUntilEventWrite: true },
            )).rejects.toBeInstanceOf(EventWriteSkippedByTransactionGuardError);

            const stagingPath = hoisted.bucketFile.mock.calls
                .map(([path]: [string]) => path)
                .find((path: string) => path.startsWith('event-write-staging/'));
            expect(stagingPath).toBeDefined();
            expect(hoisted.bucketCopy).not.toHaveBeenCalled();
            expect(hoisted.bucketDelete).toHaveBeenCalledWith(stagingPath, { ignoreNotFound: true });
        });

        it('removes a staging object when Storage reports an upload failure', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            hoisted.bucketSave.mockRejectedValueOnce(new Error('storage unavailable'));
            const event = {
                getID: () => 'event-1',
                setID: vi.fn(),
                getActivities: () => [],
            };
            const metaData = {
                serviceName: 'WAHOOAPI',
                toJSON: () => ({ meta: true }),
            } as unknown as SetEventParameters[3];
            const originalFile = {
                data: Buffer.from('file'),
                extension: 'fit',
                startDate: new Date(),
            };

            writeAllEventDataMock.mockImplementationOnce(async () => {
                const [, storageAdapter] = eventWriterConstructorMock.mock.calls.at(-1);
                await storageAdapter.uploadFile('users/user-1/events/event-1/original.fit', originalFile.data);
                return mockSavedOriginalFiles;
            });

            await expect(setEvent(
                'user-1',
                'event-1',
                event as unknown as SetEventParameters[2],
                metaData,
                originalFile,
                undefined,
                undefined,
                undefined,
                { stageOriginalFilesUntilEventWrite: true },
            )).rejects.toThrow('storage unavailable');

            const stagingPath = hoisted.bucketFile.mock.calls
                .map(([path]: [string]) => path)
                .find((path: string) => path.startsWith('event-write-staging/'));
            expect(stagingPath).toBeDefined();
            expect(hoisted.bucketCopy).not.toHaveBeenCalled();
            expect(hoisted.bucketDelete).toHaveBeenCalledWith(stagingPath, { ignoreNotFound: true });
        });
    });

    describe('determineRedirectURI and headers', () => {
        it('returns empty string for disallowed redirect', () => {
            const req = { body: { redirectUri: 'https://evil.com' } } as any;
            expect(determineRedirectURI(req)).toBe('');
        });

        it('sets access control headers from origin', () => {
            const res = { set: vi.fn(), get: vi.fn() } as any;
            const req = { get: vi.fn().mockReturnValue('http://localhost:4200') } as any;
            setAccessControlHeadersOnResponse(req, res);
            expect(res.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:4200');
        });
    });
});
