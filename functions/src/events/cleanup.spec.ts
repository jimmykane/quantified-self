import * as admin from 'firebase-admin';
import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';


// Use vi.hoisted to ensure mocks are initialized before vi.mock
const { firestoreBuilderMock, adminFirestoreMock, adminStorageMock, batchDeleteMock, batchCommitMock } = vi.hoisted(() => {
    const onDeleteMock = vi.fn((handler) => handler);
    const documentMock = vi.fn(() => ({ onDelete: onDeleteMock }));

    const recursiveDeleteMock = vi.fn().mockResolvedValue(undefined); // Keep for potential other use or safety
    // Mock return of collection() needs to permit chaining: .where().get()
    const whereMock = vi.fn();
    const collectionMock = vi.fn().mockReturnValue({
        path: 'mock/path',
        where: whereMock
    });

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

    const deleteFileMock = vi.fn().mockResolvedValue(undefined);
    const storageMock = {
        bucket: vi.fn().mockReturnValue({
            file: vi.fn().mockReturnValue({
                delete: deleteFileMock,
            }),
        }),
    } as any;

    return {
        firestoreBuilderMock: { document: documentMock },
        adminFirestoreMock: firestoreMock,
        adminStorageMock: storageMock,
        batchDeleteMock,
        batchCommitMock
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

    it('should recursively delete activities and delete the original file', async () => {
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
        // Simple check for now, can be more specific if needed
        expect(mocks.batchDelete).toHaveBeenCalledTimes(2);
        expect(mocks.batchCommit).toHaveBeenCalled();

        // Check file delete
        expect(mocks.deleteFile).toHaveBeenCalled();
    });

    it('should delete activities even if no original file exists', async () => {
        // Mock snapshot for flat activities (EMPTY)
        (mocks.firestore.collection('users/testUser/activities').where as any).mockReturnValue({
            get: vi.fn().mockResolvedValue({
                empty: true,
                size: 0,
                docs: []
            })
        });

        const wrapped = cleanupEventFile as any;

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

        // Check file delete NOT called
        expect(mocks.deleteFile).not.toHaveBeenCalled();
    });
});
