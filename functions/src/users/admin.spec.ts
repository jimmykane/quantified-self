const {
    mockListUsers,
    mockAuth,
    mockOnCall,
    mockCollection,
    mockFirestore,
    mockRemoteConfig
} = vi.hoisted(() => {
    const mockListUsers = vi.fn();
    const mockAuth = { listUsers: mockListUsers };
    const mockOnCall = vi.fn((_options: unknown, handler: unknown) => handler);

    const mockCollection = vi.fn();
    const mockFirestore = vi.fn(() => ({
        collection: mockCollection,
        collectionGroup: mockCollection
    }));

    const mockRemoteConfig = vi.fn(() => ({
        getTemplate: vi.fn(),
        validateTemplate: vi.fn(),
        publishTemplate: vi.fn()
    }));

    return {
        mockListUsers,
        mockAuth,
        mockOnCall,
        mockCollection,
        mockFirestore,
        mockRemoteConfig
    };
});

mockAuth.listUsers = mockListUsers;

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
    ALLOWED_CORS_ORIGINS: ['*']
}));

import { listUsers, getQueueStats, getUserCount, getMaintenanceStatus, setMaintenanceMode } from './admin';

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
    let request: any;

    beforeEach(() => {
        vi.clearAllMocks();
        request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            }
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

        const result = await (getQueueStats as any)(request);

        // Validation of Advanced Stats
        expect(result.advanced).toBeDefined();
        expect(result.dlq.total).toBe(5); // Mock count return
        expect(result.advanced.topErrors).toHaveLength(2);

        expect(result).toHaveProperty('pending');
        // Check totals from mocked count (5) * (3 providers * 2 queues per provider * 3 statuses) = this logic is simpler in the implementation loop
        // pending: 5 count * 5 queues = 25
        expect(result.pending).toBe(25);
        expect(result.succeeded).toBe(25);
        expect(result.stuck).toBe(25);
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
    });

    it('should require authentication', async () => {
        request.auth = undefined;
        await expect((getQueueStats as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } }
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
            auth: { uid: 'admin-uid', token: { admin: true } }
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
            }
        };

        // Reset Remote Config mock
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue({
                parameters: {
                    maintenance_mode: { defaultValue: { value: 'true' } },
                    maintenance_message: { defaultValue: { value: 'RC Message' } }
                }
            })
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
