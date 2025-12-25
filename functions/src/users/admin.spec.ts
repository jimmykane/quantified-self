import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallableRequest } from 'firebase-functions/v2/https';

const {
    mockListUsers,
    mockAuth,
    mockOnCall,
    mockCollection,
    mockFirestore
} = vi.hoisted(() => {
    const mockListUsers = vi.fn();
    const mockAuth = { listUsers: mockListUsers };
    const mockOnCall = vi.fn((_options: unknown, handler: unknown) => handler);

    const mockCollection = vi.fn();
    const mockFirestore = vi.fn(() => ({
        collection: mockCollection,
    }));

    return {
        mockListUsers,
        mockAuth,
        mockOnCall,
        mockCollection,
        mockFirestore
    };
});

mockAuth.listUsers = mockListUsers;

vi.mock('firebase-admin', () => ({
    auth: () => mockAuth,
    initializeApp: vi.fn(),
    apps: { length: 1 },
    firestore: mockFirestore
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: mockOnCall,
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));

vi.mock('../utils', () => ({
    ALLOWED_CORS_ORIGINS: ['*']
}));

import { listUsers, getQueueStats } from './admin';

describe('listUsers Cloud Function', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default: Return empty user list (single page)
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        // Default: Empty Firestore results
        const emptyGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });
        const emptyDocGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });

        mockCollection.mockReturnValue({
            doc: vi.fn().mockReturnValue({
                get: emptyDocGet,
                collection: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockReturnValue({ get: emptyGet })
                        })
                    }),
                    limit: vi.fn().mockReturnValue({ get: emptyGet })
                })
            }),
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({ get: emptyGet })
                })
            })
        });
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        const request = { auth: null } as unknown as CallableRequest<any>;
        await expect((listUsers as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } }
        } as unknown as CallableRequest<any>;
        await expect((listUsers as any)(request)).rejects.toThrow('Only admins can call this function.');
    });

    it('should return paginated users with totalCount', async () => {
        // Mock 3 users
        const mockUsers = [
            { uid: 'user1', email: 'alice@test.com', displayName: 'Alice', disabled: false, metadata: { creationTime: '2024-01-01', lastSignInTime: '2024-06-01' }, customClaims: {}, providerData: [{ providerId: 'google.com' }] },
            { uid: 'user2', email: 'bob@test.com', displayName: 'Bob', disabled: false, metadata: { creationTime: '2024-02-01', lastSignInTime: '2024-06-02' }, customClaims: {}, providerData: [{ providerId: 'password' }] },
            { uid: 'user3', email: 'charlie@test.com', displayName: 'Charlie', disabled: true, metadata: { creationTime: '2024-03-01', lastSignInTime: '2024-06-03' }, customClaims: {}, providerData: [] },
        ];
        mockListUsers.mockResolvedValue({ users: mockUsers, pageToken: undefined });

        const request = {
            data: { page: 0, pageSize: 2 },
            auth: { uid: 'admin-uid', token: { admin: true } }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        expect(result.totalCount).toBe(3);
        expect(result.users).toHaveLength(2);
        expect(result.page).toBe(0);
        expect(result.pageSize).toBe(2);
        expect(result.users[0].providerIds).toEqual(['google.com']);
    });

    it('should filter users by searchTerm', async () => {
        const mockUsers = [
            { uid: 'user1', email: 'alice@test.com', displayName: 'Alice', disabled: false, metadata: {}, customClaims: {}, providerData: [] },
            { uid: 'user2', email: 'bob@test.com', displayName: 'Bob', disabled: false, metadata: {}, customClaims: {}, providerData: [] },
        ];
        mockListUsers.mockResolvedValue({ users: mockUsers, pageToken: undefined });

        const request = {
            data: { searchTerm: 'alice', page: 0, pageSize: 25 },
            auth: { uid: 'admin-uid', token: { admin: true } }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        expect(result.totalCount).toBe(1);
        expect(result.users[0].email).toBe('alice@test.com');
    });

    it('should sort users by specified field', async () => {
        const mockUsers = [
            { uid: 'user1', email: 'alice@test.com', displayName: 'Alice', disabled: false, metadata: { creationTime: '2024-01-01' }, customClaims: {}, providerData: [{ providerId: 'google.com' }] },
            { uid: 'user2', email: 'bob@test.com', displayName: 'Bob', disabled: false, metadata: { creationTime: '2024-02-01' }, customClaims: {}, providerData: [{ providerId: 'password' }] },
        ];
        mockListUsers.mockResolvedValue({ users: mockUsers, pageToken: undefined });

        const request = {
            data: { sortField: 'email', sortDirection: 'desc', page: 0, pageSize: 25 },
            auth: { uid: 'admin-uid', token: { admin: true } }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        expect(result.users[0].email).toBe('bob@test.com');
        expect(result.users[1].email).toBe('alice@test.com');
    });

    it('should sort users by providerIds', async () => {
        const mockUsers = [
            { uid: 'user1', email: 'alice@test.com', providerData: [{ providerId: 'google.com' }], metadata: {}, customClaims: {} },
            { uid: 'user2', email: 'bob@test.com', providerData: [{ providerId: 'password' }], metadata: {}, customClaims: {} },
        ];
        mockListUsers.mockResolvedValue({ users: mockUsers, pageToken: undefined });

        const request = {
            data: { sortField: 'providerIds', sortDirection: 'desc', page: 0, pageSize: 25 },
            auth: { uid: 'admin-uid', token: { admin: true } }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        // password (bob) should come before google (alice) in desc order
        expect(result.users[0].email).toBe('bob@test.com');
        expect(result.users[1].email).toBe('alice@test.com');

        const requestAsc = {
            data: { sortField: 'providerIds', sortDirection: 'asc', page: 0, pageSize: 25 },
            auth: { uid: 'admin-uid', token: { admin: true } }
        } as unknown as CallableRequest<any>;

        const resultAsc: any = await (listUsers as any)(requestAsc);
        expect(resultAsc.users[0].email).toBe('alice@test.com');
        expect(resultAsc.users[1].email).toBe('bob@test.com');
    });

    it('should iterate through all pageTokens to fetch all users', async () => {
        mockListUsers.mockResolvedValueOnce({
            users: [{ uid: 'user1', email: 'a@test.com', disabled: false, metadata: {}, customClaims: {}, providerData: [] }],
            pageToken: 'token1'
        });
        mockListUsers.mockResolvedValueOnce({
            users: [{ uid: 'user2', email: 'b@test.com', disabled: false, metadata: {}, customClaims: {}, providerData: [] }],
            pageToken: undefined
        });

        const request = {
            data: { page: 0, pageSize: 25 },
            auth: { uid: 'admin-uid', token: { admin: true } }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        expect(mockListUsers).toHaveBeenCalledTimes(2);
        expect(result.totalCount).toBe(2);
    });
});

describe('getQueueStats Cloud Function', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const mockCountGet = vi.fn().mockResolvedValue({
            data: () => ({ count: 5 })
        });

        const mockCount = vi.fn().mockReturnValue({
            get: mockCountGet
        });

        const mockWhere = vi.fn().mockReturnValue({
            where: vi.fn().mockReturnThis(),
            count: mockCount
        });

        mockCollection.mockReturnValue({
            where: mockWhere,
            count: mockCount
        });
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        const request = { auth: null } as unknown as CallableRequest<any>;
        await expect((getQueueStats as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } }
        } as unknown as CallableRequest<any>;
        await expect((getQueueStats as any)(request)).rejects.toThrow('Only admins can call this function.');
    });

    it('should return aggregated counts across all queue collections', async () => {
        const request = {
            auth: { uid: 'admin-uid', token: { admin: true } }
        } as unknown as CallableRequest<any>;

        const result = await (getQueueStats as any)(request);

        expect(result).toEqual({
            pending: 25,
            succeeded: 25,
            failed: 25
        });

        expect(mockCollection).toHaveBeenCalledWith('suuntoAppWorkoutQueue');
        expect(mockCollection).toHaveBeenCalledWith('garminHealthAPIActivityQueue');
    });
});
