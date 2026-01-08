import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';
import { cleanupOrphanedUsers } from './cleanup-orphaned-users';
import * as OAuth2 from '../OAuth2';
import * as GarminWrapper from '../garmin/auth/wrapper';
import * as readline from 'readline';

// Mock the dependencies
vi.mock('readline', () => ({
    createInterface: vi.fn(),
}));

vi.mock('../OAuth2', () => ({
    deauthorizeServiceForUser: vi.fn(),
}));

vi.mock('../garmin/auth/wrapper', () => ({
    deauthorizeGarminHealthAPIForUser: vi.fn(),
}));

vi.mock('firebase-admin', () => {
    const mockAuth = {
        listUsers: vi.fn(),
    };
    const mockFirestore = {
        collection: vi.fn(),
        recursiveDelete: vi.fn(),
        batch: vi.fn(),
        select: vi.fn(),
    };
    const mockBucket = {
        getFiles: vi.fn(),
        deleteFiles: vi.fn(),
    };
    const mockStorage = {
        bucket: vi.fn(() => mockBucket),
    };
    return {
        apps: [],
        initializeApp: vi.fn(),
        auth: vi.fn(() => mockAuth),
        firestore: Object.assign(vi.fn(() => mockFirestore), {
            FieldValue: {
                delete: vi.fn(),
            },
        }),
        storage: vi.fn(() => mockStorage),
        app: vi.fn(() => ({
            options: {
                storageBucket: 'test-bucket'
            }
        })),
    };
});

describe('cleanupOrphanedUsers', () => {
    let mockAuthListUsers: ReturnType<typeof vi.fn>;
    let mockFirestoreGet: ReturnType<typeof vi.fn>;
    let mockFirestoreSelect: ReturnType<typeof vi.fn>;
    let mockRecursiveDelete: ReturnType<typeof vi.fn>;
    let mockStorageGetFiles: ReturnType<typeof vi.fn>;
    let mockStorageDeleteFiles: ReturnType<typeof vi.fn>;
    let mockMailWhere: ReturnType<typeof vi.fn>;
    let mockBatchDelete: ReturnType<typeof vi.fn>;
    let mockBatchCommit: ReturnType<typeof vi.fn>;
    let mockQuestion: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup process.argv mocks
        vi.stubGlobal('process', {
            ...process,
            argv: ['node', 'script.js', '--force'], // Use --force by default to skip readline
            exit: vi.fn(),
        });

        // Get references to mocks
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const firestoreMock = admin.firestore() as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const authMock = admin.auth() as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const storageMock = admin.storage().bucket() as any;

        mockAuthListUsers = authMock.listUsers;
        mockFirestoreGet = vi.fn();
        mockFirestoreSelect = vi.fn().mockReturnThis();
        mockRecursiveDelete = firestoreMock.recursiveDelete;

        mockBatchDelete = vi.fn();
        mockBatchCommit = vi.fn().mockResolvedValue({});
        const mockBatch = {
            delete: mockBatchDelete,
            commit: mockBatchCommit,
        };
        firestoreMock.batch.mockReturnValue(mockBatch);

        mockMailWhere = vi.fn().mockReturnThis();

        firestoreMock.collection.mockImplementation((name: string) => ({
            get: mockFirestoreGet,
            select: mockFirestoreSelect,
            doc: (id: string) => ({
                path: `${name}/${id}`,
            }),
            where: mockMailWhere,
        }));

        mockStorageGetFiles = storageMock.getFiles;
        mockStorageDeleteFiles = storageMock.deleteFiles;

        // Setup Readline Mock
        mockQuestion = vi.fn((q, callback) => callback('y'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (readline.createInterface as any).mockReturnValue({
            question: mockQuestion,
            close: vi.fn(),
        });

        // Hide console output during tests
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('should identify orphaned users and clean them up', async () => {
        // Setup scenarios: 
        // Auth: active-user
        // Firestore: active-user, orphaned-user
        mockAuthListUsers.mockResolvedValue({
            users: [{ uid: 'active-user' }],
            pageToken: undefined,
        });

        mockFirestoreGet.mockResolvedValueOnce({
            docs: [
                { id: 'active-user' },
                { id: 'orphaned-user' }
            ]
        });

        // Mock mail queries to return empty by default
        mockFirestoreGet.mockResolvedValue({ empty: true });

        await cleanupOrphanedUsers();

        // Verify it cleaned up ONLY 'orphaned-user'
        expect(mockRecursiveDelete).toHaveBeenCalledTimes(2); // users/orphaned-user and customers/orphaned-user
        expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/orphaned-user' }));
        expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'customers/orphaned-user' }));

        // Verify it DID NOT clean up 'active-user'
        expect(mockRecursiveDelete).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'users/active-user' }));

        // Verify service deauthorizations
        expect(OAuth2.deauthorizeServiceForUser).toHaveBeenCalledWith('orphaned-user', expect.anything());
        expect(GarminWrapper.deauthorizeGarminHealthAPIForUser).toHaveBeenCalledWith('orphaned-user');
    });

    it('should support dry run mode', async () => {
        vi.stubGlobal('process', {
            ...process,
            argv: ['node', 'script.js', '--dry-run'],
            exit: vi.fn(),
        });

        mockAuthListUsers.mockResolvedValue({
            users: [{ uid: 'active-user' }],
            pageToken: undefined,
        });

        mockFirestoreGet.mockResolvedValueOnce({
            docs: [{ id: 'orphaned-user' }]
        });

        await cleanupOrphanedUsers();

        // Verify no deletions occurred
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
        expect(OAuth2.deauthorizeServiceForUser).not.toHaveBeenCalled();
    });

    it('should handle pagination in Auth listUsers', async () => {
        mockAuthListUsers
            .mockResolvedValueOnce({
                users: [{ uid: 'user-1' }],
                pageToken: 'token-1',
            })
            .mockResolvedValueOnce({
                users: [{ uid: 'user-2' }],
                pageToken: undefined,
            });

        mockFirestoreGet.mockResolvedValueOnce({
            docs: [{ id: 'orphaned-user' }]
        });
        mockFirestoreGet.mockResolvedValue({ empty: true });

        await cleanupOrphanedUsers();

        expect(mockAuthListUsers).toHaveBeenCalledTimes(2);
        expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/orphaned-user' }));
    });

    it('should delete storage files for orphaned users', async () => {
        mockAuthListUsers.mockResolvedValue({
            users: [{ uid: 'active-user' }],
            pageToken: undefined,
        });

        mockFirestoreGet.mockResolvedValueOnce({
            docs: [{ id: 'orphaned-user' }]
        });
        mockFirestoreGet.mockResolvedValue({ empty: true });

        mockStorageGetFiles.mockResolvedValue([[{ name: 'file1' }]]);

        await cleanupOrphanedUsers();

        expect(mockStorageDeleteFiles).toHaveBeenCalledWith({ prefix: 'users/orphaned-user/' });
    });

    it('should delete mail documents for orphaned users', async () => {
        mockAuthListUsers.mockResolvedValue({
            users: [{ uid: 'active-user' }],
            pageToken: undefined,
        });

        mockFirestoreGet.mockResolvedValueOnce({
            docs: [{ id: 'orphaned-user' }]
        });

        const mockMailDoc = { ref: { id: 'mail-ref' } };
        mockFirestoreGet.mockResolvedValue({
            empty: false,
            docs: [mockMailDoc]
        });

        await cleanupOrphanedUsers();

        expect(mockMailWhere).toHaveBeenCalledWith('toUids', 'array-contains', 'orphaned-user');
        expect(mockBatchDelete).toHaveBeenCalledWith(mockMailDoc.ref);
        expect(mockBatchCommit).toHaveBeenCalled();
    });

    it('should continue if one user cleanup fails', async () => {
        mockAuthListUsers.mockResolvedValue({
            users: [],
            pageToken: undefined,
        });

        mockFirestoreGet.mockResolvedValueOnce({
            docs: [
                { id: 'orphaned-1' },
                { id: 'orphaned-2' }
            ]
        });
        mockFirestoreGet.mockResolvedValue({ empty: true });

        // Make first one fail
        mockRecursiveDelete.mockRejectedValueOnce(new Error('Firestore crash'));

        await cleanupOrphanedUsers();

        // it should still have called deletions for BOTH (or at least attempted)
        expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/orphaned-1' }));
        expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/orphaned-2' }));
    });
});
