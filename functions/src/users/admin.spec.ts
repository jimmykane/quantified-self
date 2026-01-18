import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CallableRequest } from 'firebase-functions/v2/https';

const {
    mockListUsers,
    mockCreateCustomToken,
    mockAuth,
    mockOnCall,
    mockCollection,
    mockFirestore,
    mockRemoteConfig,
    mockStripeClient,
    mockGetProjectBillingInfo,
    mockGetBillingAccount,
    mockListBudgets,
    mockGetTables,
    mockBigQueryQuery,
    mockGetCloudTaskQueueDepth
} = vi.hoisted(() => {
    const mockListUsers = vi.fn();
    const mockCreateCustomToken = vi.fn();
    const mockAuth = { listUsers: mockListUsers, createCustomToken: mockCreateCustomToken };
    const mockOnCall = vi.fn((_options: unknown, handler: unknown) => handler);

    const mockCollection = vi.fn() as any;
    const mockFirestore = vi.fn(() => ({
        collection: mockCollection,
        collectionGroup: mockCollection
    }));

    const mockRemoteConfig = vi.fn(() => ({
        getTemplate: vi.fn(),
        validateTemplate: vi.fn(),
        publishTemplate: vi.fn()
    }));

    const mockStripeClient = {
        invoices: {
            list: vi.fn()
        }
    };

    const mockGetProjectBillingInfo = vi.fn();
    const mockGetBillingAccount = vi.fn();
    const mockListBudgets = vi.fn();
    const mockGetTables = vi.fn();
    const mockBigQueryQuery = vi.fn();
    const mockGetCloudTaskQueueDepth = vi.fn().mockResolvedValue(42);

    return {
        mockListUsers,
        mockCreateCustomToken,
        mockAuth,
        mockOnCall,
        mockCollection,
        mockFirestore,
        mockRemoteConfig,
        mockStripeClient,
        mockGetProjectBillingInfo,
        mockGetBillingAccount,
        mockListBudgets,
        mockGetTables,
        mockBigQueryQuery,
        mockGetCloudTaskQueueDepth
    };
});

mockAuth.listUsers = mockListUsers;
mockAuth.createCustomToken = mockCreateCustomToken;

vi.mock('../stripe/client', () => ({
    getStripe: vi.fn().mockResolvedValue(mockStripeClient)
}));

vi.mock('@google-cloud/billing', () => ({
    CloudBillingClient: vi.fn(() => ({
        getProjectBillingInfo: mockGetProjectBillingInfo,
        getBillingAccount: mockGetBillingAccount
    }))
}));

vi.mock('@google-cloud/billing-budgets', () => ({
    BudgetServiceClient: vi.fn(() => ({
        listBudgets: mockListBudgets
    }))
}));

vi.mock('@google-cloud/bigquery', () => ({
    BigQuery: vi.fn(() => ({
        dataset: vi.fn(() => ({
            getTables: mockGetTables
        })),
        query: mockBigQueryQuery
    }))
}));

vi.mock('firebase-admin', () => {
    const firestoreMock: any = mockFirestore;
    firestoreMock.FieldValue = {
        serverTimestamp: vi.fn().mockReturnValue('mock-timestamp')
    };

    return {
        auth: () => mockAuth,
        initializeApp: vi.fn(),
        apps: { length: 1 },
        firestore: firestoreMock,
        remoteConfig: mockRemoteConfig
    };
});

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
    ALLOWED_CORS_ORIGINS: ['*'],
    getCloudTaskQueueDepth: mockGetCloudTaskQueueDepth
}));

import { listUsers, getQueueStats, getUserCount, getMaintenanceStatus, setMaintenanceMode, impersonateUser, getFinancialStats } from './admin';

// Helper for authenticated admin requests
const getAdminRequest = (data: any = {}) => ({
    data,
    auth: { uid: 'admin', token: { admin: true } },
    app: { appId: 'test-app' }
} as CallableRequest<any>);

describe('listUsers Cloud Function', () => {


    beforeEach(() => {
        vi.clearAllMocks();

        // Default BigQuery mocks
        mockGetTables.mockResolvedValue([[]]);
        mockBigQueryQuery.mockResolvedValue([[]]);

        // Default: Return empty user list (single page)
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        // Default: Empty Firestore results
        const emptyGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });
        const emptyDocGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });

        // Use mockImplementation instead of mockReturnValue to avoid "sticky" values
        mockCollection.mockImplementation(() => ({
            doc: vi.fn().mockReturnValue({
                get: emptyDocGet,
                set: vi.fn().mockResolvedValue({}),
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
        }));
    });

    afterEach(() => {
        mockCollection.mockReset();
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        const request = { auth: null } as unknown as CallableRequest<any>;
        await expect((listUsers as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } },
            app: { appId: 'mock-app-id' }
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
            data: { page: 0, pageSize: 2, sortDirection: 'asc' },
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
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
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
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
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
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
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        // password (bob) should come before google (alice) in desc order
        expect(result.users[0].email).toBe('bob@test.com');
        expect(result.users[1].email).toBe('alice@test.com');

        const requestAsc = {
            data: { sortField: 'providerIds', sortDirection: 'asc', page: 0, pageSize: 25 },
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const resultAsc: any = await (listUsers as any)(requestAsc);
        expect(resultAsc.users[0].email).toBe('alice@test.com');
        expect(resultAsc.users[1].email).toBe('bob@test.com');
    });

    it('should iterate through all pageTokens to fetch all users', async () => {
        const mockUsersPage1 = [{ uid: 'user1', providerData: [] }];
        const mockUsersPage2 = [{ uid: 'user2', providerData: [] }];

        mockListUsers
            .mockResolvedValueOnce({ users: mockUsersPage1, pageToken: 'token1' })
            .mockResolvedValueOnce({ users: mockUsersPage2, pageToken: undefined });

        await (listUsers as any)(getAdminRequest());

        expect(mockListUsers).toHaveBeenCalledTimes(2);
        expect(mockListUsers).toHaveBeenCalledWith(1000, undefined);
        expect(mockListUsers).toHaveBeenCalledWith(1000, 'token1');
    });

    it('should filter users by filterService (Garmin)', async () => {
        // Mock token docs for filtering
        const mockTokenDocs = [{ id: 'u1' }];
        const mockSnap = { docs: mockTokenDocs, empty: false };

        // Setup mock for the filter query
        mockCollection.mockImplementation((path) => {
            if (path === 'garminAPITokens') {
                return {
                    select: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue(mockSnap)
                    })
                };
            }
            // Defaut mock for enrichment
            return {
                doc: vi.fn().mockReturnValue({
                    collection: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true }) }) }),
                    get: vi.fn().mockResolvedValue({ empty: true })
                }),
                where: vi.fn().mockReturnThis(),
                get: vi.fn().mockResolvedValue({ empty: true })
            };
        });

        // Mock Auth Users
        const mockUsers = [
            { uid: 'u1', providerData: [] }, // Should match
            { uid: 'u2', providerData: [] }  // Should filter out
        ];
        mockListUsers.mockResolvedValue({ users: mockUsers, pageToken: undefined });

        const result: any = await (listUsers as any)(getAdminRequest({ filterService: 'garmin' }));
        expect(result.users).toHaveLength(1);
        expect(result.users[0].uid).toBe('u1');
    });

    it('should filter users by filterService (Suunto)', async () => {
        const mockSnap = { docs: [{ id: 'u1' }], empty: false };
        mockCollection.mockImplementation((path) => {
            if (path === 'suuntoAppAccessTokens') {
                return {
                    select: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue(mockSnap) })
                };
            }
            return {
                doc: vi.fn().mockReturnValue({ collection: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true }) }) }) }),
                where: vi.fn().mockReturnThis(),
                get: vi.fn().mockResolvedValue({ empty: true })
            };
        });
        mockListUsers.mockResolvedValue({ users: [{ uid: 'u1', providerData: [] }], pageToken: undefined });
        const result: any = await (listUsers as any)(getAdminRequest({ filterService: 'suunto' }));
        expect(result.users).toHaveLength(1);
    });

    it('should filter users by filterService (COROS)', async () => {
        const mockSnap = { docs: [{ id: 'u1' }], empty: false };
        mockCollection.mockImplementation((path) => {
            if (path === 'COROSAPIAccessTokens') {
                return {
                    select: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue(mockSnap) })
                };
            }
            return {
                doc: vi.fn().mockReturnValue({ collection: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true }) }) }) }),
                where: vi.fn().mockReturnThis(),
                get: vi.fn().mockResolvedValue({ empty: true })
            };
        });
        mockListUsers.mockResolvedValue({ users: [{ uid: 'u1', providerData: [] }], pageToken: undefined });
        const result: any = await (listUsers as any)(getAdminRequest({ filterService: 'coros' }));
        expect(result.users).toHaveLength(1);
    });

    it('should use default sort (email) when sortField is invalid', async () => {
        const mockUsers = [
            { uid: 'u1', email: 'b@test.com', providerData: [] },
            { uid: 'u2', email: 'a@test.com', providerData: [] }
        ];
        mockListUsers.mockResolvedValue({ users: mockUsers, pageToken: undefined });

        // invalid_field causes fall through to default which compares by email
        const result: any = await (listUsers as any)(getAdminRequest({ sortField: 'invalid_field' as any, sortDirection: 'asc' }));

        expect(result.users[0].email).toBe('a@test.com');
        expect(result.users[1].email).toBe('b@test.com');
    });

    // -------------------------------------------------------------------------
    // COVERAGE: ENRICH USERS TESTS
    // -------------------------------------------------------------------------
    describe('enrichUsers', () => {
        // ... (existing enrichment test)
        it('should enrich users with subscription and connected service valid data', async () => {
            const mockUsers = [
                { uid: 'u1', email: 'u1@test.com', displayName: 'U1', disabled: false, metadata: { creationTime: '2024-01-01', lastSignInTime: '2024-01-02' }, customClaims: {}, providerData: [] }
            ];
            mockListUsers.mockResolvedValue({ users: mockUsers, pageToken: undefined });

            // Mock Data for Enrichment
            const mockSubData = { status: 'active', current_period_end: 12345, cancel_at_period_end: false, stripeLink: 'link' };
            const mockServiceDocTitle = { dateCreated: 999999 };

            const createSnap = (dataOrEmpty: any) => ({
                empty: !dataOrEmpty,
                docs: dataOrEmpty ? [{ data: () => dataOrEmpty, createTime: 11111 }] : []
            });

            // Specific path interception for mocks
            mockCollection.mockImplementation((path: string) => {
                if (path === 'customers') {
                    // db.collection('customers').doc(uid).collection('subscriptions')...
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnThis(),
                                orderBy: vi.fn().mockReturnThis(),
                                limit: vi.fn().mockReturnValue({
                                    get: vi.fn().mockResolvedValue(createSnap(mockSubData))
                                })
                            })
                        })
                    };
                }
                if (['garminAPITokens', 'suuntoAppAccessTokens', 'COROSAPIAccessTokens'].includes(path)) {
                    // db.collection(service).doc(uid).collection('tokens').limit(1).get()
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockReturnValue({
                                limit: vi.fn().mockReturnValue({
                                    get: vi.fn().mockResolvedValue(createSnap(mockServiceDocTitle))
                                })
                            })
                        })
                    };
                }
                return {
                    doc: vi.fn().mockReturnValue({
                        set: vi.fn().mockResolvedValue({}),
                        get: vi.fn().mockResolvedValue({ exists: false }),
                        collection: vi.fn().mockReturnValue({
                            limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true }) })
                        })
                    }),
                    where: vi.fn().mockReturnThis(),
                    orderBy: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({ empty: true })
                };
            });

            const result: any = await (listUsers as any)(getAdminRequest({ page: 0, pageSize: 10 }));

            const user = result.users[0];
            expect(user.subscription).toEqual(mockSubData);
            expect(user.connectedServices).toHaveLength(3);
        });
    });

    // -------------------------------------------------------------------------
    // COVERAGE: SORTING TESTS
    // -------------------------------------------------------------------------
    describe('listUsers Sorting', () => {
        // Sort Logic: u1(pro, Aaron), u2(basic, Zack), u3(free, Middle)
        const usersForSort = [
            { uid: 'u1', displayName: 'Aaron', email: 'a@test.com', disabled: false, customClaims: { admin: true, stripeRole: 'pro' }, metadata: { creationTime: '2024-01-01', lastSignInTime: '2024-01-01' }, providerData: [{ providerId: 'google.com' }] },
            { uid: 'u2', displayName: 'Zack', email: 'z@test.com', disabled: true, customClaims: { admin: false, stripeRole: 'basic' }, metadata: { creationTime: '2024-02-01', lastSignInTime: '2024-02-01' }, providerData: [] },
            { uid: 'u3', displayName: 'Middle', email: 'm@test.com', disabled: false, customClaims: { admin: false, stripeRole: 'free' }, metadata: { creationTime: '2024-03-01', lastSignInTime: '2024-03-01' }, providerData: [{ providerId: 'facebook.com' }] },
        ];

        beforeEach(() => {
            mockListUsers.mockResolvedValue({ users: usersForSort, pageToken: undefined });
            // Reset mockCollection to simple empty default
            mockCollection.mockImplementation(() => ({
                doc: vi.fn().mockReturnValue({ collection: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true }) }) }) }),
                where: vi.fn().mockReturnThis(),
                get: vi.fn().mockResolvedValue({ empty: true })
            }));
        });

        it('should sort by displayName desc', async () => {
            const result: any = await (listUsers as any)(getAdminRequest({ sortField: 'displayName', sortDirection: 'desc' }));
            expect(result.users.map((u: any) => u.displayName)).toEqual(['Zack', 'Middle', 'Aaron']);
        });

        it('should sort by email asc', async () => {
            const result: any = await (listUsers as any)(getAdminRequest({ sortField: 'email', sortDirection: 'asc' }));
            expect(result.users.map((u: any) => u.email)).toEqual(['a@test.com', 'm@test.com', 'z@test.com']);
        });

        it('should sort by role asc', async () => {
            const result: any = await (listUsers as any)(getAdminRequest({ sortField: 'role', sortDirection: 'asc' }));
            expect(result.users.map((u: any) => u.uid)).toEqual(['u2', 'u3', 'u1']);
        });

        it('should sort by admin desc', async () => {
            const result: any = await (listUsers as any)(getAdminRequest({ sortField: 'admin', sortDirection: 'desc' }));
            expect(result.users[0].uid).toBe('u1');
        });

        it('should sort by status (disabled) desc', async () => {
            const result: any = await (listUsers as any)(getAdminRequest({ sortField: 'status', sortDirection: 'desc' }));
            expect(result.users[0].uid).toBe('u2');
        });

        it('should sort by lastLogin asc', async () => {
            const result: any = await (listUsers as any)(getAdminRequest({ sortField: 'lastLogin', sortDirection: 'asc' }));
            expect(result.users.map((u: any) => u.uid)).toEqual(['u1', 'u2', 'u3']);
        });

        it('should sort by providerIds asc', async () => {
            // u1: google, u2: '', u3: facebook
            // sorted asc: '' (u2), facebook (u3), google (u1)
            const result: any = await (listUsers as any)(getAdminRequest({ sortField: 'providerIds', sortDirection: 'asc' }));
            expect(result.users.map((u: any) => u.uid)).toEqual(['u2', 'u3', 'u1']);
        });
    });

    // -------------------------------------------------------------------------
    // COVERAGE: ERROR HANDLING & PROVIDER BREAKDOWN
    // -------------------------------------------------------------------------
    describe('Error Handling & Stats', () => {
        it('listUsers should handle auth listUsers failure', async () => {
            mockListUsers.mockRejectedValue(new Error('Auth Error'));
            await expect((listUsers as any)(getAdminRequest())).rejects.toThrow('Auth Error');
        });

        it('getUserCount should accurately count provider types', async () => {
            const mockUsers = [
                { uid: 'u1', providerData: [{ providerId: 'google.com' }] },
                { uid: 'u2', providerData: [{ providerId: 'password' }] },
                { uid: 'u3', providerData: [] } // Anonymous/Password fallback logic test line 360-362
            ];
            mockListUsers.mockResolvedValue({ users: mockUsers, pageToken: undefined });

            // Mock basic count returns (not important for this test but needed)
            mockCollection.mockReturnValue({
                count: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 100 }) }) }),
                where: vi.fn().mockReturnThis(),
                get: vi.fn().mockResolvedValue({ empty: true })
            });

            const result: any = await (getUserCount as any)(getAdminRequest());

            // u1 -> google.com: 1
            // u2 -> password: 1
            // u3 -> no providers -> falls back to password: 1 (total password: 2)
            expect(result.providers['google.com']).toBe(1);
            expect(result.providers['password']).toBe(2);
        });

        it('getUserCount should handle firestore error', async () => {
            mockCollection.mockReturnValue({
                count: vi.fn().mockReturnThis(),
                get: vi.fn().mockRejectedValue(new Error('Count Error')),
                collectionGroup: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis()
            });
            await expect((getUserCount as any)(getAdminRequest())).rejects.toThrow('Failed to get user count');
        });
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        const request = { auth: null } as unknown as CallableRequest<any>;
        await expect((impersonateUser as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        await expect((impersonateUser as any)(request)).rejects.toThrow('Only admins can call this function.');
    });

    it('should create a custom token with impersonatedBy claim', async () => {
        mockCreateCustomToken.mockResolvedValue('mock-custom-token');
        const targetUid = 'target-user-uid';
        const adminUid = 'admin-uid';
        const request = {
            data: { uid: targetUid },
            auth: { uid: adminUid, token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const result: any = await (impersonateUser as any)(request);

        expect(result.token).toBe('mock-custom-token');
        expect(mockCreateCustomToken).toHaveBeenCalledWith(targetUid, { impersonatedBy: adminUid });
    });

    it('should throw if target uid is missing', async () => {
        const request = {
            data: {},
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        await expect((impersonateUser as any)(request)).rejects.toThrow();
    });
});

describe('getQueueStats Cloud Function', () => {
    let request: any;

    beforeEach(() => {
        vi.clearAllMocks();
        request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            },
            app: { appId: 'mock-app-id' }
        };
    });

    it('should return queue statistics including DLQ', async () => {
        // Mock permissions
        mockCollection.mockImplementation((collectionName: string) => {
            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });

            // Mock implementation for query chains
            const mockQuery = {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }], // Mock for oldestPending
                    data: () => ({ count: 5 })
                })
            };

            if (collectionName === 'failed_jobs') {
                const failedJobsMock: any = {
                    count: mockCount,
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                size: 2,
                                docs: [
                                    { data: () => ({ context: 'NO_TOKEN_FOUND', originalCollection: 'suuntoAppWorkoutQueue', error: 'Token expired' }) },
                                    { data: () => ({ context: 'MAX_RETRY_REACHED', originalCollection: 'COROSAPIWorkoutQueue', error: 'Timeout' }) }
                                ]
                            })
                        })
                    }),
                    get: vi.fn().mockResolvedValue({
                        size: 2,
                        docs: [
                            { data: () => ({ context: 'NO_TOKEN_FOUND', originalCollection: 'suuntoAppWorkoutQueue', error: 'Token expired' }) },
                            { data: () => ({ context: 'MAX_RETRY_REACHED', originalCollection: 'COROSAPIWorkoutQueue', error: 'Timeout' }) }
                        ]
                    })
                };
                // Make where chainable
                failedJobsMock.where = vi.fn().mockReturnValue(failedJobsMock);
                return failedJobsMock;
            }
            return mockQuery;
        });

        request.data = { includeAnalysis: true };
        const result = await (getQueueStats as any)(request);

        // Validation of Advanced Stats
        expect(result.advanced).toBeDefined();
        expect(result.dlq.total).toBe(5); // Mock count return
        expect(result.advanced.topErrors).toHaveLength(2);

        expect(result).toHaveProperty('pending');
        // Check totals from mocked count (5) * (3 providers * 1 queue per provider * 3 statuses)
        // pending: 5 count * 3 queues = 15
        expect(result.pending).toBe(15);
        expect(result.succeeded).toBe(15);
        expect(result.stuck).toBe(15);
        expect(result.providers).toHaveLength(3);

        // Check DLQ stats
        expect(result.dlq).toBeDefined();
        expect(result.dlq.total).toBe(5);
        expect(result.dlq.byContext).toEqual(expect.arrayContaining([
            { context: 'NO_TOKEN_FOUND', count: 1 },
            { context: 'MAX_RETRY_REACHED', count: 1 }
        ]));
        expect(result.dlq.byProvider).toEqual(expect.arrayContaining([
            { provider: 'suuntoAppWorkoutQueue', count: 1 },
            { provider: 'COROSAPIWorkoutQueue', count: 1 }
        ]));

        // Check Cloud Tasks stat
        expect(result.cloudTasks).toEqual({ pending: 42 });
    });

    it('should handle Cloud Task depth error and return 0', async () => {
        mockGetCloudTaskQueueDepth.mockRejectedValueOnce(new Error('Queue depth error'));
        const result = await (getQueueStats as any)(request);
        expect(result.cloudTasks).toEqual({ pending: 0 });
    });

    it('should return only basic statistics when includeAnalysis is false', async () => {
        request.data = { includeAnalysis: false };
        const result = await (getQueueStats as any)(request);

        expect(result.pending).toBeDefined();
        expect(result.dlq).toBeUndefined(); // Should be skipped
        expect(result.advanced.topErrors).toHaveLength(0); // Should be empty
    });

    it('should require authentication', async () => {
        request.auth = undefined;
        await expect((getQueueStats as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        await expect((getQueueStats as any)(request)).rejects.toThrow('Only admins can call this function.');
    });
});

describe('getUserCount Cloud Function', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return total user count with subscription breakdown', async () => {
        const request = {
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const mockTotalCount = vi.fn().mockResolvedValue({
            data: () => ({ count: 150 })
        });
        const mockProCount = vi.fn().mockResolvedValue({
            data: () => ({ count: 50 })
        });

        // Mock implementation for chainable queries
        const mockQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({
                get: mockProCount
            })
        };

        mockCollection.mockImplementation((name) => {
            if (name === 'users') {
                return {
                    count: vi.fn().mockReturnValue({
                        get: mockTotalCount
                    })
                };
            }
            if (name === 'subscriptions') {
                // This handles collectionGroup('subscriptions')
                return mockQuery;
            }
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result).toEqual({
            count: 150,
            total: 150,
            pro: 50,
            basic: 50,
            free: 50,
            providers: {}
        });
        expect(mockCollection).toHaveBeenCalledWith('users');
        expect(mockCollection).toHaveBeenCalledWith('subscriptions'); // collectionGroup calls this name
    });
});

describe('getMaintenanceStatus Cloud Function', () => {
    let request: any;

    beforeEach(() => {
        vi.clearAllMocks();
        request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            },
            app: { appId: 'mock-app-id' }
        };

        // Reset Remote Config mock
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue({
                parameters: {
                    maintenance_mode: { defaultValue: { value: 'true' } },
                    maintenance_message: { defaultValue: { value: 'RC Message' } }
                }
            }),
            validateTemplate: vi.fn(),
            publishTemplate: vi.fn()
        });
    });

    it('should return status for all environments (prod/beta/dev)', async () => {
        // Mock docs for each env
        const docs: Record<string, any> = {
            'maintenance_prod': { exists: true, data: () => ({ enabled: true, message: 'Prod Msg' }) },
            'maintenance_beta': { exists: true, data: () => ({ enabled: false, message: 'Beta Msg' }) },
            'maintenance_dev': { exists: true, data: () => ({ enabled: true, message: 'Dev Msg' }) },
            'maintenance': { exists: false }
        };

        mockCollection.mockReturnValue({
            doc: vi.fn().mockImplementation((id) => ({
                get: vi.fn().mockResolvedValue(docs[id] || { exists: false })
            }))
        });

        const result: any = await (getMaintenanceStatus as any)(request);

        expect(result.prod.enabled).toBe(true);
        expect(result.prod.message).toBe('Prod Msg');
        expect(result.beta.enabled).toBe(false);
        expect(result.beta.message).toBe('Beta Msg');
        expect(result.dev.enabled).toBe(true);
        expect(result.dev.message).toBe('Dev Msg');
    });

    it('should fallback to legacy Firestore document for prod if maintenance_prod is missing', async () => {
        const docs: Record<string, any> = {
            'maintenance_prod': { exists: false },
            'maintenance_beta': { exists: false },
            'maintenance_dev': { exists: false },
            'maintenance': { exists: true, data: () => ({ enabled: true, message: 'Legacy Msg' }) }
        };

        mockCollection.mockReturnValue({
            doc: vi.fn().mockImplementation((id) => ({
                get: vi.fn().mockResolvedValue(docs[id] || { exists: false })
            }))
        });

        const result: any = await (getMaintenanceStatus as any)(request);
        expect(result.prod.message).toBe('Legacy Msg');
    });

    it('should return default (off) if no docs exist', async () => {
        mockCollection.mockReturnValue({
            doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: false })
            })
        });

        const result: any = await (getMaintenanceStatus as any)(request);
        expect(result.prod.enabled).toBe(false);
        expect(result.beta.enabled).toBe(false);
        expect(result.dev.enabled).toBe(false);
    });
});

describe('setMaintenanceMode Cloud Function', () => {
    let request: any;

    beforeEach(() => {
        vi.clearAllMocks();
        request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            },
            app: { appId: 'mock-app-id' },
            data: {
                enabled: true,
                message: 'New Maintenance',
                env: 'beta'
            }
        };

        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue({ parameters: {} }),
            validateTemplate: vi.fn().mockResolvedValue({}),
            publishTemplate: vi.fn().mockResolvedValue({})
        });
    });

    it('should update Firestore and Remote Config for the specific environment', async () => {
        const mockSet = vi.fn().mockResolvedValue({});
        const mockDoc = vi.fn().mockReturnValue({ set: mockSet });
        mockCollection.mockReturnValue({ doc: mockDoc });

        const result: any = await (setMaintenanceMode as any)(request);

        expect(result.success).toBe(true);
        // Verify Firestore update
        expect(mockDoc).toHaveBeenCalledWith('maintenance_beta');
        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            enabled: true,
            message: 'New Maintenance'
        }));

        // Verify Remote Config update
        const rc = mockRemoteConfig();
        expect(rc.publishTemplate).toHaveBeenCalled();
    });

    it('should update legacy keys when environment is prod', async () => {
        request.data.env = 'prod';
        const template: any = { parameters: {} };
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue(template),
            validateTemplate: vi.fn(),
            publishTemplate: vi.fn()
        });

        await (setMaintenanceMode as any)(request);

        expect(template.parameters['maintenance_mode_prod']).toBeDefined();
        expect(template.parameters['maintenance_mode']).toBeDefined(); // Legacy fallback
    });

    it('should NOT update legacy keys when environment is beta', async () => {
        request.data.env = 'beta';
        const template: any = { parameters: {} };
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue(template),
            validateTemplate: vi.fn(),
            publishTemplate: vi.fn()
        });

        await (setMaintenanceMode as any)(request);

        expect(template.parameters['maintenance_mode_beta']).toBeDefined();
        expect(template.parameters['maintenance_mode']).toBeUndefined();
    });
});

describe('getFinancialStats Cloud Function', () => {
    let request: any;
    const productsDocs: any[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        mockCollection.mockReset();

        // Reset BigQuery mocks
        mockGetTables.mockResolvedValue([[]]);
        mockBigQueryQuery.mockResolvedValue([[]]);

        request = {
            data: { env: 'prod' },
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            },
            app: { appId: 'mock-app-id' }
        };
        process.env.GCLOUD_PROJECT = 'test-project';
        productsDocs.length = 0;

        // Base mock for firestore
        mockCollection.mockImplementation((name) => {
            if (name === 'products') {
                return {
                    get: vi.fn().mockImplementation(async () => ({ docs: [...productsDocs] })),
                    doc: vi.fn(),
                    where: vi.fn(),
                    add: vi.fn()
                };
            }
            return {
                get: vi.fn().mockResolvedValue({ docs: [] }),
                doc: vi.fn(),
                where: vi.fn(),
                add: vi.fn()
            };
        });
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        request.auth = null;
        await expect((getFinancialStats as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        request.auth = { uid: 'user1', token: { admin: false } };
        request.app = { appId: 'mock-app-id' };
        await expect((getFinancialStats as any)(request)).rejects.toThrow('Only admins can call this function.');
    });

    it('should return combined financial stats (Revenue + GCP Cost Link)', async () => {
        // Mock Firestore products
        productsDocs.push(
            { id: 'prod_valid_1' },
            { id: 'prod_valid_2' }
        );

        // Mock Stripe response
        mockStripeClient.invoices.list.mockResolvedValue({
            has_more: false,
            data: [
                { id: 'inv_1', currency: 'usd', amount_paid: 2000, tax: 200, lines: { data: [{ amount: 1800, price: { product: 'prod_valid_1' } }] } },
                { id: 'inv_2', currency: 'usd', amount_paid: 3000, tax: null, lines: { data: [{ amount: 3000, price: { product: 'prod_valid_2' } }] } },
                { id: 'inv_3', currency: 'usd', amount_paid: 5000, tax: null, lines: { data: [{ amount: 5000, price: { product: 'prod_invalid' } }] } }
            ]
        });

        // Mock GCP Billing response
        mockGetProjectBillingInfo.mockResolvedValue([{
            billingAccountName: 'billingAccounts/000000-000000-000000'
        }]);
        mockGetBillingAccount.mockResolvedValue([{
            currencyCode: 'EUR'
        }]);
        mockListBudgets.mockResolvedValue([[
            {
                amount: {
                    specifiedAmount: {
                        units: '100',
                        currencyCode: 'EUR'
                    }
                }
            }
        ]]);

        const result: any = await (getFinancialStats as any)(request);

        // Verify Revenue (only valid products)
        expect(result.revenue.total).toBe(4800); // 1800 + 3000
        expect(result.revenue.invoiceCount).toBe(2);
        expect(result.revenue.currency).toBe('usd');

        // Verify GCP Cost Details
        expect(result.cost.currency).toBe('eur');
        expect(result.cost.budget).toEqual({ amount: 10000, currency: 'eur' });

        // Verify Cost Link
        expect(result.cost.billingAccountId).toBe('000000-000000-000000');
        expect(result.cost.reportUrl).toContain('console.cloud.google.com/billing/000000-000000-000000/reports');
    });

    it('should include lastUpdated when BigQuery returns it', async () => {
        // Mock BigQuery returning a cost and a timestamp
        const mockTimestamp = '2026-01-09T10:00:00Z';
        mockGetTables.mockResolvedValue([[{ id: 'gcp_billing_export_v1_123' }]]);
        mockBigQueryQuery.mockResolvedValue([[{
            total_cost: 15.5,
            last_updated: mockTimestamp,
            currency: 'USD'
        }]]);

        const result: any = await (getFinancialStats as any)(request);

        expect(result.cost.total).toBe(1550); // 15.5 * 100
        expect(result.cost.lastUpdated).toBe(mockTimestamp);
    });

    it('should handle pagination for Stripe invoices', async () => {
        productsDocs.push({ id: 'prod_valid_1' });

        mockStripeClient.invoices.list
            .mockResolvedValueOnce({
                has_more: true,
                next_page: 'page2',
                data: [{ id: 'inv_1', currency: 'eur', amount_paid: 1000, tax: 0, lines: { data: [{ amount: 1000, price: { product: 'prod_valid_1' } }] } }]
            })
            .mockResolvedValueOnce({
                has_more: false,
                data: [{ id: 'inv_2', currency: 'eur', amount_paid: 2000, tax: 0, lines: { data: [{ amount: 2000, price: { product: 'prod_valid_1' } }] } }]
            });

        mockGetProjectBillingInfo.mockResolvedValue([{}]);

        const result: any = await (getFinancialStats as any)(request);

        expect(result.revenue.total).toBe(3000);
        expect(result.revenue.invoiceCount).toBe(2);
        expect(mockStripeClient.invoices.list).toHaveBeenCalledTimes(2);
    });

    it('should handle missing GCP permissions gracefully and fallback to revenue currency', async () => {
        // Mock Firestore products
        productsDocs.push({ id: 'prod_valid_1' });

        // Mock Stripe response in EUR
        mockStripeClient.invoices.list.mockResolvedValue({
            has_more: false,
            data: [
                { id: 'inv_1', currency: 'eur', amount_paid: 2000, tax: 0, lines: { data: [{ amount: 2000, price: { product: 'prod_valid_1' } }] } }
            ]
        });

        // Mock GCP Billing failing (Permission Denied)
        mockGetProjectBillingInfo.mockRejectedValue(new Error('Permission Denied'));

        const result: any = await (getFinancialStats as any)(request);

        // Verify Revenue is in EUR
        expect(result.revenue.currency).toBe('eur');
        expect(result.revenue.total).toBe(2000);

        // Verify Cost fallback to EUR (project default)
        expect(result.cost.currency).toBe('eur');
    });
    it('should handle missing GCP permissions gracefully', async () => {
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        // Simulate permission error
        mockGetProjectBillingInfo.mockRejectedValue(new Error('Permission denied'));

        const result: any = await (getFinancialStats as any)(request);

        // Should still return stats, just with empty cost info
        expect(result.revenue.total).toBe(0);
        expect(result.cost.billingAccountId).toBeNull();
        expect(result.cost.reportUrl).toBeNull();
    });

    it('should handle specific billing account fetch error', async () => {
        // Mock success for getProjectBillingInfo but failure for getBillingAccount
        mockGetProjectBillingInfo.mockResolvedValue([{ billingAccountName: 'billingAccounts/123' }]);
        mockGetBillingAccount.mockRejectedValue(new Error('Permission denied'));
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        const result: any = await (getFinancialStats as any)(request);
        expect(result.cost.billingAccountId).toBe('123'); // Still gets ID
        // Budget fetch might also fail or be skipped, but function shouldn't throw
    });

    it('should handle budget list error', async () => {
        mockGetProjectBillingInfo.mockResolvedValue([{ billingAccountName: 'billingAccounts/123' }]);
        mockGetBillingAccount.mockResolvedValue([{ currencyCode: 'USD' }]);
        mockListBudgets.mockRejectedValue(new Error('Budget Error'));
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        const result: any = await (getFinancialStats as any)(request);
        // Should just have null budget
        expect(result.cost.budget).toBeNull();
    });

    it('should handle BigQuery query error', async () => {
        mockGetProjectBillingInfo.mockResolvedValue([{ billingAccountName: 'billingAccounts/123' }]);
        mockGetBillingAccount.mockResolvedValue([{ currencyCode: 'USD' }]);
        mockListBudgets.mockResolvedValue([]);
        mockGetTables.mockResolvedValue([[{ id: 'gcp_billing_export_v1_xyz' }]]);
        mockBigQueryQuery.mockRejectedValue(new Error('Query Failed'));
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        const result: any = await (getFinancialStats as any)(request);
        // Total remains null or 0 from initialization
        expect(result.cost.total).toBeNull();
    });

    it('should handle missing BigQuery export table', async () => {
        mockGetProjectBillingInfo.mockResolvedValue([{ billingAccountName: 'billingAccounts/123' }]);
        mockGetBillingAccount.mockResolvedValue([{ currencyCode: 'USD' }]);
        mockListBudgets.mockResolvedValue([]);
        mockGetTables.mockResolvedValue([[]]); // No tables
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        const result: any = await (getFinancialStats as any)(request);
        expect(result.cost.total).toBeNull();
    });
});

describe('Generic Error Handling', () => {
    it('getQueueStats should handle generic errors', async () => {
        const { getQueueStats } = await import('./admin');
        const req = getAdminRequest();
        mockFirestore.mockImplementationOnce(() => { throw new Error('Generic Failure'); });
        await expect((getQueueStats as any)(req)).rejects.toThrow('Generic Failure');
    });

    it('setMaintenanceMode should handle generic errors', async () => {
        const { setMaintenanceMode } = await import('./admin');
        const req = getAdminRequest({ enabled: true });
        mockFirestore.mockImplementationOnce(() => { throw new Error('Firestore init failed'); });
        await expect((setMaintenanceMode as any)(req)).rejects.toThrow('Firestore init failed');
    });

    it('getMaintenanceStatus should handle generic errors', async () => {
        const { getMaintenanceStatus } = await import('./admin');
        mockFirestore.mockImplementationOnce(() => { throw new Error('Firestore init failed'); });
        await expect((getMaintenanceStatus as any)(getAdminRequest())).rejects.toThrow('Firestore init failed');
    });

    it('impersonateUser should handle generic errors', async () => {
        const { impersonateUser } = await import('./admin');
        const req = getAdminRequest({ uid: 'target' });
        mockCreateCustomToken.mockRejectedValueOnce(new Error('Token Gen Failed'));
        await expect((impersonateUser as any)(req)).rejects.toThrow('Token Gen Failed');
    });

    it('getFinancialStats should handle generic errors', async () => {
        const { getFinancialStats } = await import('./admin');
        mockFirestore.mockImplementationOnce(() => { throw new Error('Firestore init failed'); });
        await expect((getFinancialStats as any)(getAdminRequest())).rejects.toThrow('Firestore init failed');
    });

    it('should fallback to revenue currency for budget when billing currency is missing and budget is set via env', async () => {
        const { getFinancialStats } = await import('./admin');

        // Setup env var
        process.env.GCP_BILLING_BUDGET = '500';

        // Mock billing account fetch to fail (so cost.currency remains empty initially)
        mockGetProjectBillingInfo.mockRejectedValueOnce(new Error('Auth Error'));

        // Mock stripe (revenue currency defaults to 'eur')
        const stripeMock = await import('../stripe/client');
        (stripeMock.getStripe as any).mockResolvedValue({
            invoices: {
                list: vi.fn().mockResolvedValue({ data: [], has_more: false })
            }
        });

        // Mock valid products
        mockCollection.mockReturnValue({
            get: vi.fn().mockResolvedValue({ docs: [] })
        });

        const result = await (getFinancialStats as any)(getAdminRequest());

        expect(result.cost.budget).toEqual({ amount: 500, currency: 'eur' });
        expect(result.cost.currency).toBe('eur');

        // Cleanup
        delete process.env.GCP_BILLING_BUDGET;
    });
});
