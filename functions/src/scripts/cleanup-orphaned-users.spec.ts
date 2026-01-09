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
                storageBucket: 'quantified-self-io'
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

    it('should identify orphans from storage and clean them up', async () => {
        // Setup scenarios: 
        // Auth: user-1
        // Storage: users/orphan-1/
        mockAuthListUsers.mockResolvedValue({
            users: [{ uid: 'user-1' }],
            pageToken: undefined,
        });

        // Firestore scans return empty for primary collections
        mockFirestoreGet.mockResolvedValue({ docs: [] });

        // Storage returns an orphan prefix
        mockStorageGetFiles.mockResolvedValue([
            [{ name: 'dummy-file' }],
            {},
            { prefixes: ['users/orphan-1/'] }
        ]);

        await cleanupOrphanedUsers();

        // Verify it identifies and cleans up orphans found in storage
        expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/orphan-1' }));
        expect(mockStorageDeleteFiles).toHaveBeenCalledWith({ prefix: 'users/orphan-1/' });
    });

    it('should support dry run mode', async () => {
        vi.stubGlobal('process', {
            ...process,
            argv: ['node', 'script.js', '--dry-run'],
            exit: vi.fn(),
        });

        mockAuthListUsers.mockResolvedValue({
            users: [{ uid: 'user-1' }],
            pageToken: undefined,
        });

        mockStorageGetFiles.mockResolvedValue([
            [],
            {},
            { prefixes: ['users/orphan-1/'] }
        ]);

        await cleanupOrphanedUsers();

        // Verify no deletions occurred
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
        expect(mockStorageDeleteFiles).not.toHaveBeenCalled();
    });

    it('should clean up associated services and data', async () => {
        mockAuthListUsers.mockResolvedValue({
            users: [],
            pageToken: undefined,
        });

        mockFirestoreGet.mockResolvedValueOnce({
            docs: [{ id: 'orphaned-user' }]
        });

        // Mock mail queries to return empty by default
        mockFirestoreGet.mockResolvedValue({ empty: true });
        mockStorageGetFiles.mockResolvedValue([[]]);

        await cleanupOrphanedUsers();

        expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/orphaned-user' }));
        expect(OAuth2.deauthorizeServiceForUser).toHaveBeenCalledWith('orphaned-user', expect.anything());
        expect(GarminWrapper.deauthorizeGarminHealthAPIForUser).toHaveBeenCalledWith('orphaned-user');
    });
});
