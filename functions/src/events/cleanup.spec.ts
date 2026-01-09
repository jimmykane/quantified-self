import * as admin from 'firebase-admin';
import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';


// Use vi.hoisted to ensure mocks are initialized before vi.mock
const { firestoreBuilderMock, adminFirestoreMock, adminStorageMock, batchDeleteMock, batchCommitMock, deleteFilesMock } = vi.hoisted(() => {
    const onDeleteMock = vi.fn((handler) => handler);
    const documentMock = vi.fn(() => ({ onDelete: onDeleteMock }));

    const recursiveDeleteMock = vi.fn().mockResolvedValue(undefined); // Keep for potential other use or safety
    // Mock return of collection() needs to permit chaining: .where().get()
    const whereMock = vi.fn();
    const getMock = vi.fn();
    const collectionMock = vi.fn((path) => ({
        path: path || 'mock/path',
        where: whereMock,
        get: getMock
    }));

    // Batch Mocks
    const batchDeleteMock = vi.fn();
    const batchCommitMock = vi.fn().mockResolvedValue(undefined);
    const batchMock = vi.fn().mockReturnValue({
        delete: batchDeleteMock,
        commit: batchCommitMock
    });

    const firestoreMock = {
        collection: collectionMock,
        recursiveDelete: recursiveDeleteMock,
        batch: batchMock
    } as any;

    const deleteFilesMock = vi.fn().mockResolvedValue(undefined);
    const storageMock = {
        bucket: vi.fn().mockReturnValue({
            file: vi.fn().mockReturnValue({
                delete: vi.fn(),
            }),
            deleteFiles: deleteFilesMock,
        }),
    } as any;

    return {
        firestoreBuilderMock: { document: documentMock },
        adminFirestoreMock: firestoreMock,
        adminStorageMock: storageMock,
        batchDeleteMock,
        batchCommitMock,
        deleteFilesMock
    };
});

// Mock firebase-functions v2
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentDeleted: (opts: any, handler: any) => handler,
}));

vi.mock('firebase-admin', () => ({
    firestore: () => adminFirestoreMock,
    storage: () => adminStorageMock,
    initializeApp: vi.fn(),
    credential: {
        cert: vi.fn(),
    },
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
        recursiveDelete: adminFirestoreMock.recursiveDelete,
        deleteFile: adminStorageMock.bucket().file().delete,
        deleteFiles: deleteFilesMock,
        batchDelete: batchDeleteMock,
        batchCommit: batchCommitMock
    };

    beforeEach(() => {
        // Reset mocks if needed, but since they are hoisted consts, verify they are cleared
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
        testEnv.cleanup();
    });

    it('should recursively delete activities and delete the original files by prefix', async () => {
        // Since we mocked the builder to just return the handler, cleanupEventFile IS the handler
        const wrapped = cleanupEventFile as any;

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
        (mocks.firestore.collection('users/testUser/activities').where as any).mockReturnValue({
            get: vi.fn().mockResolvedValue({
                empty: false,
                size: 2,
                docs: mockDocs.map(doc => ({ ref: doc.ref })) // Ensure docs have a ref property
            })
        });

        await wrapped(event);

        // Check flat activity delete
        expect(mocks.firestore.collection).toHaveBeenCalledWith('users/testUser/activities');

        // Expect batch delete to be called 2 times (once per doc) for activities
        expect(mocks.batchDelete).toHaveBeenCalledTimes(2);
        expect(mocks.batchCommit).toHaveBeenCalled();

        // Expect recursiveDelete to be called 1 time (for metaData)
        expect(mocks.recursiveDelete).toHaveBeenCalledTimes(1);

        // Check file delete with prefix
        expect(mocks.deleteFiles).toHaveBeenCalledWith({
            prefix: 'users/testUser/events/testEvent/'
        });
    });

    it('should delete activities and files even if originalFile metadata is missing', async () => {
        // Mock snapshot for flat activities (EMPTY)
        (mocks.firestore.collection('users/testUser/activities').where as any).mockReturnValue({
            get: vi.fn().mockResolvedValue({
                empty: true,
                size: 0,
                docs: []
            })
        });

        const wrapped = cleanupEventFile as any;

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

        // Check file delete called with prefix regardless
        expect(mocks.deleteFiles).toHaveBeenCalledWith({
            prefix: 'users/testUser/events/testEvent/'
        });
    });

    it('should delete metaData documents using recursiveDelete', async () => {
        const wrapped = cleanupEventFile as any;
        const snap = testEnv.firestore.makeDocumentSnapshot({}, 'users/testUser/events/testEvent');
        const event = {
            data: snap,
            params: { userId: 'testUser', eventId: 'testEvent' },
        };

        // Mock activities (empty)
        (mocks.firestore.collection('users/testUser/activities').where as any).mockReturnValue({
            get: vi.fn().mockResolvedValue({ empty: true, size: 0, docs: [] })
        });

        // For recursiveDelete, we don't need to mock the .get() return value of metaDataRef specifically,
        // because we are just asserting that recursiveDelete is called with the collection ref.
        // However, we need to ensure recursiveDelete logic inside the function works.
        // In our mock setup, recursiveDelete is mocked on `adminFirestoreMock` (lines 30 and 46).

        await wrapped(event);

        // Verify recursiveDelete is called with the correct collection reference
        // We need to capture the argument passed to recursiveDelete
        expect(mocks.recursiveDelete).toHaveBeenCalledTimes(1);
        const callArgs = mocks.recursiveDelete.mock.calls[0];
        const collectionRef = callArgs[0];
        expect(collectionRef.path).toBe('users/testUser/events/testEvent/metaData');
    });
});
