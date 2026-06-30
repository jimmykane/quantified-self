import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';


// Use vi.hoisted to ensure mocks are initialized before vi.mock
const {
    adminFirestoreMock,
    adminStorageMock,
    deleteFilesMock,
    docGetMock,
    fileDeleteMock,
    fileMock,
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
    const fileDeleteMock = vi.fn().mockResolvedValue(undefined);
    const fileMock = vi.fn().mockReturnValue({
        delete: fileDeleteMock,
    });
    const storageMock = {
        bucket: vi.fn((name?: string) => ({
            name: name || 'quantified-self-io',
            file: fileMock,
            deleteFiles: deleteFilesMock,
        })),
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
        fileDeleteMock,
        fileMock,
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

const testEnv = functionsTest();

// Mock console methods
global.console = { ...global.console, log: vi.fn(), error: vi.fn() };

describe('cleanupEventFile', () => {
    // helpers to access mocks in tests
    const mocks = {
        firestore: adminFirestoreMock,
        storage: adminStorageMock,
        recursiveDelete: recursiveDeleteMock,
        deleteFiles: deleteFilesMock,
        fileDelete: fileDeleteMock,
        file: fileMock,
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
        mocks.docGet.mockReset();
        mocks.transactionGet.mockReset();
        mocks.runTransaction.mockReset();
        mocks.fileDelete.mockReset();
        mocks.docGet.mockResolvedValue({ exists: false });
        mocks.fileDelete.mockResolvedValue(undefined);
        mocks.transactionGet.mockImplementation(async (refOrQuery: { path?: string }) => {
            if (refOrQuery.path === 'users/testUser/events/testEvent') {
                return { exists: false };
            }
            if (refOrQuery.path === 'users/testUser/activities') {
                return { empty: true, size: 0, docs: [] };
            }
            if (refOrQuery.path === 'users/testUser/events/testEvent/metaData') {
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

    it('should delete activities and generation-pinned source files', async () => {
        // Since we mocked the builder to just return the handler, cleanupEventFile IS the handler
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;

        const snap = testEnv.firestore.makeDocumentSnapshot({
            originalFile: {
                path: 'users/testUser/events/testEvent/original.fit',
                bucket: 'quantified-self-io',
                generation: '12345',
            }
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
            if (refOrQuery.path === 'users/testUser/events/testEvent/metaData') {
                return { empty: true, size: 0, docs: [] };
            }
            return { exists: false };
        });

        await wrapped(event);

        // Check flat activity delete
        expect(mocks.firestore.collection).toHaveBeenCalledWith('users/testUser/activities');
        expect(mocks.runTransaction).toHaveBeenCalledTimes(2);
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

        expect(mocks.recursiveDelete).not.toHaveBeenCalled();
        expect(mocks.deleteFiles).not.toHaveBeenCalled();
        expect(mocks.file).toHaveBeenCalledWith('users/testUser/events/testEvent/original.fit');
        expect(mocks.fileDelete).toHaveBeenCalledWith({
            ignoreNotFound: true,
            ifGenerationMatch: '12345',
        });
    });

    it('should skip source file cleanup when originalFile metadata is missing', async () => {
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
        expect(mocks.deleteFiles).not.toHaveBeenCalled();
        expect(mocks.fileDelete).not.toHaveBeenCalled();
    });

    it('should delete metaData leaf documents inside an event-absence transaction', async () => {
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;
        const snap = testEnv.firestore.makeDocumentSnapshot({}, 'users/testUser/events/testEvent');
        const event = {
            data: snap,
            params: { userId: 'testUser', eventId: 'testEvent' },
        };
        mocks.transactionGet.mockImplementation(async (refOrQuery: { path?: string }) => {
            if (refOrQuery.path === 'users/testUser/events/testEvent') {
                return { exists: false };
            }
            if (refOrQuery.path === 'users/testUser/activities') {
                return { empty: true, size: 0, docs: [] };
            }
            if (refOrQuery.path === 'users/testUser/events/testEvent/metaData') {
                return {
                    empty: false,
                    size: 2,
                    docs: [{ ref: 'metadataRef1' }, { ref: 'metadataRef2' }],
                };
            }
            return { exists: false };
        });

        await wrapped(event);

        expect(mocks.recursiveDelete).not.toHaveBeenCalled();
        expect(mocks.transactionDelete).toHaveBeenCalledTimes(2);
        expect(mocks.transactionDelete).toHaveBeenCalledWith('metadataRef1');
        expect(mocks.transactionDelete).toHaveBeenCalledWith('metadataRef2');
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
        expect(mocks.fileDelete).not.toHaveBeenCalled();
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            expect.stringContaining('stale_delete_trigger_skipped'),
            expect.objectContaining({
                userId: 'testUser',
                eventId: 'testEvent',
                phase: 'activity_transaction',
            }),
        );
    });

    it('should skip metadata and storage cleanup when an event is recreated inside the metadata transaction', async () => {
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;
        const snap = testEnv.firestore.makeDocumentSnapshot({
            originalFile: {
                path: 'users/testUser/events/testEvent/original.fit',
                generation: '12345',
            },
        }, 'users/testUser/events/testEvent');
        const event = {
            data: snap,
            params: { userId: 'testUser', eventId: 'testEvent' },
        };
        mocks.transactionGet
            .mockResolvedValueOnce({ exists: false })
            .mockResolvedValueOnce({ empty: true, size: 0, docs: [] })
            .mockResolvedValueOnce({ exists: true });

        await wrapped(event);

        expect(mocks.transactionDelete).not.toHaveBeenCalled();
        expect(mocks.recursiveDelete).not.toHaveBeenCalled();
        expect(mocks.deleteFiles).not.toHaveBeenCalled();
        expect(mocks.fileDelete).not.toHaveBeenCalled();
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            expect.stringContaining('stale_delete_trigger_skipped'),
            expect.objectContaining({
                userId: 'testUser',
                eventId: 'testEvent',
                phase: 'metadata_transaction',
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
        mocks.docGet.mockResolvedValueOnce({ exists: true });

        await wrapped(event);

        expect(mocks.transactionDelete).not.toHaveBeenCalled();
        expect(mocks.recursiveDelete).not.toHaveBeenCalled();
        expect(mocks.deleteFiles).not.toHaveBeenCalled();
        expect(mocks.fileDelete).not.toHaveBeenCalled();
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
        expect(mocks.fileDelete).not.toHaveBeenCalled();
        expect(mocks.loggerError).toHaveBeenCalledWith(
            expect.stringContaining('Failed to delete linked activities'),
            readError,
        );
    });

    it('should skip legacy source files without storage generation metadata', async () => {
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;
        const snap = testEnv.firestore.makeDocumentSnapshot({
            originalFile: {
                path: 'users/testUser/events/testEvent/original.fit',
                bucket: 'quantified-self-io',
            },
        }, 'users/testUser/events/testEvent');
        const event = {
            data: snap,
            params: { userId: 'testUser', eventId: 'testEvent' },
        };

        await wrapped(event);

        expect(mocks.deleteFiles).not.toHaveBeenCalled();
        expect(mocks.fileDelete).not.toHaveBeenCalled();
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            expect.stringContaining('Skipping source file cleanup without a storage generation precondition'),
            expect.objectContaining({
                userId: 'testUser',
                eventId: 'testEvent',
                path: 'users/testUser/events/testEvent/original.fit',
            }),
        );
    });

    it('should not fail cleanup when a source file generation precondition no longer matches', async () => {
        const wrapped = cleanupEventFile as unknown as (event: unknown) => Promise<void>;
        const snap = testEnv.firestore.makeDocumentSnapshot({
            originalFile: {
                path: 'users/testUser/events/testEvent/original.fit',
                bucket: 'quantified-self-io',
                generation: '12345',
            },
        }, 'users/testUser/events/testEvent');
        const event = {
            data: snap,
            params: { userId: 'testUser', eventId: 'testEvent' },
        };
        mocks.fileDelete.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { code: 412 }));

        await wrapped(event);

        expect(mocks.fileDelete).toHaveBeenCalledWith({
            ignoreNotFound: true,
            ifGenerationMatch: '12345',
        });
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            expect.stringContaining('Source file generation no longer matches'),
            expect.objectContaining({
                userId: 'testUser',
                eventId: 'testEvent',
                path: 'users/testUser/events/testEvent/original.fit',
                generation: '12345',
            }),
        );
    });
});
