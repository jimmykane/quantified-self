import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';


// Use vi.hoisted to ensure mocks are initialized before vi.mock
const {
    adminFirestoreMock,
    adminStorageMock,
    deleteFilesMock,
    docGetMock,
    loggerErrorMock,
    loggerWarnMock,
    recursiveDeleteMock,
    runTransactionMock,
    transactionDeleteMock,
    transactionGetMock,
} = vi.hoisted(() => {
    const onDeleteMock = vi.fn((handler) => handler);
    const documentMock = vi.fn(() => ({ onDelete: onDeleteMock }));

    const recursiveDeleteMock = vi.fn().mockResolvedValue(undefined); // Keep for potential other use or safety
    const collectionMock = vi.fn((path) => ({
        path: path || 'mock/path',
        where: vi.fn((field: string, operator: string, value: unknown) => ({
            path: path || 'mock/path',
            filters: [{ field, operator, value }],
        })),
    }));
    const docGetMock = vi.fn().mockResolvedValue({ exists: false });
    const docMock = vi.fn((path) => ({
        path: path || 'mock/doc',
        get: docGetMock,
    }));

    const transactionGetMock = vi.fn();
    const transactionDeleteMock = vi.fn();
    const runTransactionMock = vi.fn(async (handler: unknown) => (
        handler as (transaction: unknown) => Promise<unknown>
    )({
        get: transactionGetMock,
        delete: transactionDeleteMock,
    }));

    const firestoreMock = {
        collection: collectionMock,
        doc: docMock,
        recursiveDelete: recursiveDeleteMock,
        runTransaction: runTransactionMock,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const deleteFilesMock = vi.fn().mockResolvedValue(undefined);
    const storageMock = {
        bucket: vi.fn().mockReturnValue({
            file: vi.fn().mockReturnValue({
                delete: vi.fn(),
            }),
            deleteFiles: deleteFilesMock,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const loggerErrorMock = vi.fn();
    const loggerWarnMock = vi.fn();

    return {
        firestoreBuilderMock: { document: documentMock },
        adminFirestoreMock: firestoreMock,
        adminStorageMock: storageMock,
        recursiveDeleteMock,
        deleteFilesMock,
        docGetMock,
        loggerErrorMock,
        loggerWarnMock,
        runTransactionMock,
        transactionDeleteMock,
        transactionGetMock,
    };
});

// Mock firebase-functions v2
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentDeleted: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-admin', () => ({
    firestore: () => adminFirestoreMock,
    storage: () => adminStorageMock,
    initializeApp: vi.fn(),
    credential: {
        cert: vi.fn(),
    },
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: loggerWarnMock,
    error: loggerErrorMock,
}));

// Import the function AFTER mocking
import { cleanupEventFile } from './cleanup';
import { Firestore } from 'firebase-admin/firestore';

const testEnv = functionsTest();

// Mock console methods
global.console = { ...global.console, log: vi.fn(), error: vi.fn() };

describe('cleanupEventFile', () => {
    // helpers to access mocks in tests
    const mocks = {
        firestore: adminFirestoreMock,
        storage: adminStorageMock,
        recursiveDelete: recursiveDeleteMock,
        deleteFile: adminStorageMock.bucket().file().delete,
        deleteFiles: deleteFilesMock,
        docGet: docGetMock,
        loggerError: loggerErrorMock,
        loggerWarn: loggerWarnMock,
        runTransaction: runTransactionMock,
        transactionDelete: transactionDeleteMock,
        transactionGet: transactionGetMock,
    };

    beforeEach(() => {
        // Reset mocks if needed, but since they are hoisted consts, verify they are cleared
        vi.clearAllMocks();
        mocks.docGet.mockResolvedValue({ exists: false });
        mocks.transactionGet.mockImplementation(async (refOrQuery: { path?: string }) => {
            if (refOrQuery.path === 'users/testUser/events/testEvent') {
                return { exists: false };
            }
            if (refOrQuery.path === 'users/testUser/activities') {
                return { empty: true, size: 0, docs: [] };
            }
            return { exists: false };
        });
        mocks.runTransaction.mockImplementation(async (handler: unknown) => (
            handler as (transaction: unknown) => Promise<unknown>
        )({
            get: mocks.transactionGet,
            delete: mocks.transactionDelete,
        }));
    });

    afterEach(() => {
        vi.clearAllMocks();
        testEnv.cleanup();
    });

    it('should recursively delete activities and delete the original files by prefix', async () => {
        // Since we mocked the builder to just return the handler, cleanupEventFile IS the handler
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;

        const snap = testEnv.firestore.makeDocumentSnapshot({
            originalFile: { path: 'path/to/file.fit' }
        }, 'users/testUser/events/testEvent');

        const event = {
            data: snap,
            params: {
                userId: 'testUser',
                eventId: 'testEvent',
            },
        };

        // Mock snapshot for flat activities
        const mockDocs = [{ ref: 'docRef1' }, { ref: 'docRef2' }];
        mocks.transactionGet.mockImplementation(async (refOrQuery: { path?: string }) => {
            if (refOrQuery.path === 'users/testUser/events/testEvent') {
                return { exists: false };
            }
            if (refOrQuery.path === 'users/testUser/activities') {
                return {
                    empty: false,
                    size: 2,
                    docs: mockDocs.map(doc => ({ ref: doc.ref })) // Ensure docs have a ref property
                };
            }
            return { exists: false };
        });

        await wrapped(event);

        // Check flat activity delete
        expect(mocks.firestore.collection).toHaveBeenCalledWith('users/testUser/activities');
        expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
        expect(mocks.transactionGet.mock.calls[0][0]).toMatchObject({
            path: 'users/testUser/events/testEvent',
        });
        expect(mocks.transactionGet.mock.calls[1][0]).toMatchObject({
            path: 'users/testUser/activities',
            filters: [{ field: 'eventID', operator: '==', value: 'testEvent' }],
        });

        // Expect transaction delete to be called 2 times (once per doc) for activities
        expect(mocks.transactionDelete).toHaveBeenCalledTimes(2);
        expect(mocks.transactionDelete).toHaveBeenCalledWith('docRef1');
        expect(mocks.transactionDelete).toHaveBeenCalledWith('docRef2');

        // Expect recursiveDelete to be called 1 time (for metaData)
        expect(mocks.recursiveDelete).toHaveBeenCalledTimes(1);

        // Check file delete with prefix
        expect(mocks.deleteFiles).toHaveBeenCalledWith({
            prefix: 'users/testUser/events/testEvent/'
        });
    });

    it('should delete activities and files even if originalFile metadata is missing', async () => {
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;

        // NO data in snapshot
        const snap = testEnv.firestore.makeDocumentSnapshot({}, 'users/testUser/events/testEvent');

        const event = {
            data: snap,
            params: {
                userId: 'testUser',
                eventId: 'testEvent',
            },
        };

        await wrapped(event);

        // Check flat activity delete query called
        expect(mocks.firestore.collection).toHaveBeenCalledWith('users/testUser/activities');
        expect(mocks.transactionDelete).not.toHaveBeenCalled();

        // Check file delete called with prefix regardless
        expect(mocks.deleteFiles).toHaveBeenCalledWith({
            prefix: 'users/testUser/events/testEvent/'
        });
    });

    it('should delete metaData documents using recursiveDelete', async () => {
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;
        const snap = testEnv.firestore.makeDocumentSnapshot({}, 'users/testUser/events/testEvent');
        const event = {
            data: snap,
            params: { userId: 'testUser', eventId: 'testEvent' },
        };

        // For recursiveDelete, we don't need to mock the .get() return value of metaDataRef specifically,
        // because we are just asserting that recursiveDelete is called with the collection ref.
        // However, we need to ensure recursiveDelete logic inside the function works.
        // In our mock setup, recursiveDelete is mocked on `adminFirestoreMock` (lines 30 and 46).

        await wrapped(event);

        // Verify recursiveDelete is called with the correct collection reference
        // We need to capture the argument passed to recursiveDelete
        expect(mocks.recursiveDelete).toHaveBeenCalledTimes(1);
        const callArgs = mocks.recursiveDelete.mock.calls[0];
        const collectionRef = callArgs[0] as unknown as Firestore;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        expect(collectionRef.path).toBe('users/testUser/events/testEvent/metaData');
    });

    it('should skip destructive cleanup when a deleted event has been recreated inside the activity transaction', async () => {
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;
        const snap = testEnv.firestore.makeDocumentSnapshot({}, 'users/testUser/events/testEvent');
        const event = {
            data: snap,
            params: { userId: 'testUser', eventId: 'testEvent' },
        };
        mocks.transactionGet.mockImplementation(async (refOrQuery: { path?: string }) => {
            if (refOrQuery.path === 'users/testUser/events/testEvent') {
                return { exists: true };
            }
            return { empty: true, size: 0, docs: [] };
        });

        await wrapped(event);

        expect(mocks.firestore.doc).toHaveBeenCalledWith('users/testUser/events/testEvent');
        expect(mocks.transactionGet).toHaveBeenCalledTimes(1);
        expect(mocks.transactionDelete).not.toHaveBeenCalled();
        expect(mocks.recursiveDelete).not.toHaveBeenCalled();
        expect(mocks.deleteFiles).not.toHaveBeenCalled();
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            expect.stringContaining('stale_delete_trigger_skipped'),
            expect.objectContaining({
                userId: 'testUser',
                eventId: 'testEvent',
                phase: 'activity_transaction',
            }),
        );
    });

    it('should skip storage cleanup when a deleted event is recreated after metadata cleanup', async () => {
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;
        const snap = testEnv.firestore.makeDocumentSnapshot({}, 'users/testUser/events/testEvent');
        const event = {
            data: snap,
            params: { userId: 'testUser', eventId: 'testEvent' },
        };
        mocks.docGet
            .mockResolvedValueOnce({ exists: false })
            .mockResolvedValueOnce({ exists: true });

        await wrapped(event);

        expect(mocks.transactionDelete).not.toHaveBeenCalled();
        expect(mocks.recursiveDelete).toHaveBeenCalledTimes(1);
        expect(mocks.deleteFiles).not.toHaveBeenCalled();
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            expect.stringContaining('stale_delete_trigger_skipped'),
            expect.objectContaining({
                userId: 'testUser',
                eventId: 'testEvent',
                phase: 'before_storage_cleanup',
            }),
        );
    });

    it('should fail closed when the stale cleanup guard cannot read the current event', async () => {
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;
        const snap = testEnv.firestore.makeDocumentSnapshot({}, 'users/testUser/events/testEvent');
        const event = {
            data: snap,
            params: { userId: 'testUser', eventId: 'testEvent' },
        };
        const readError = new Error('firestore unavailable');
        mocks.transactionGet.mockRejectedValue(readError);

        await wrapped(event);

        expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
        expect(mocks.transactionDelete).not.toHaveBeenCalled();
        expect(mocks.recursiveDelete).not.toHaveBeenCalled();
        expect(mocks.deleteFiles).not.toHaveBeenCalled();
        expect(mocks.loggerError).toHaveBeenCalledWith(
            expect.stringContaining('Failed to delete linked activities'),
            readError,
        );
    });
});
