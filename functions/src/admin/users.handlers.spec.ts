import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CallableRequest } from 'firebase-functions/v2/https';
import {
    getAdminRequest,
    listUsers,
    impersonateUser,
    stopImpersonation,
    getUserCount,
    mockListUsers,
    mockCreateCustomToken,
    mockGetUser,
    mockCollection,
    mockGetAll,
    mockGetTables,
    mockBigQueryQuery,
} from './test-utils/admin-test-harness';

describe('listUsers Cloud Function', () => {


    beforeEach(() => {
        vi.clearAllMocks();

        // Default BigQuery mocks
        mockGetTables.mockResolvedValue([[]]);
        mockBigQueryQuery.mockResolvedValue([[]]);

        // Default: Return empty user list (single page)
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });
        mockGetAll.mockResolvedValue([]);

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

    it('should clamp oversized pageSize values to the server-side max', async () => {
        const request = {
            data: { page: 0, pageSize: 1000 },
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        expect(result.pageSize).toBe(50);
    });

    it('should include onboardingCompleted=true when user doc has onboardingCompleted=true', async () => {
        mockListUsers.mockResolvedValue({
            users: [{ uid: 'user1', email: 'alice@test.com', providerData: [], metadata: {}, customClaims: {} }],
            pageToken: undefined
        });
        mockGetAll.mockResolvedValue([
            { id: 'user1', data: () => ({ onboardingCompleted: true, hasSubscribedOnce: true }) }
        ]);

        const result: any = await (listUsers as any)(getAdminRequest({ page: 0, pageSize: 25 }));
        expect(result.users[0].onboardingCompleted).toBe(true);
        expect(result.users[0].hasSubscribedOnce).toBe(true);
    });

    it('should default onboardingCompleted=false when user doc is missing the flag', async () => {
        mockListUsers.mockResolvedValue({
            users: [{ uid: 'user1', email: 'alice@test.com', providerData: [], metadata: {}, customClaims: {} }],
            pageToken: undefined
        });
        mockGetAll.mockResolvedValue([
            { id: 'user1', data: () => ({}) }
        ]);

        const result: any = await (listUsers as any)(getAdminRequest({ page: 0, pageSize: 25 }));
        expect(result.users[0].onboardingCompleted).toBe(false);
        expect(result.users[0].hasSubscribedOnce).toBe(false);
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

    it('should use default sort (created) when sortField is invalid', async () => {
        const mockUsers = [
            { uid: 'u1', email: 'b@test.com', metadata: { creationTime: '2024-02-01' }, providerData: [] },
            { uid: 'u2', email: 'a@test.com', metadata: { creationTime: '2024-01-01' }, providerData: [] }
        ];
        mockListUsers.mockResolvedValue({ users: mockUsers, pageToken: undefined });

        // invalid_field causes fall through to default which compares by creation date
        const result: any = await (listUsers as any)(getAdminRequest({ sortField: 'invalid_field' as any, sortDirection: 'asc' }));

        expect(result.users[0].uid).toBe('u2');
        expect(result.users[1].uid).toBe('u1');
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

        it('should include aiCreditsConsumed from the current subscription usage period', async () => {
            const periodStartMs = Date.parse('2026-01-01T00:00:00.000Z');
            const periodEndMs = Date.parse('2026-02-01T00:00:00.000Z');
            const expectedUsageDocID = `period_${periodStartMs}_${periodEndMs}`;

            mockListUsers.mockResolvedValue({
                users: [
                    {
                        uid: 'u1',
                        email: 'u1@test.com',
                        displayName: 'U1',
                        disabled: false,
                        metadata: { creationTime: '2024-01-01', lastSignInTime: '2024-01-02' },
                        customClaims: {},
                        providerData: []
                    }
                ],
                pageToken: undefined
            });

            const createSnap = (dataOrEmpty: any) => ({
                empty: !dataOrEmpty,
                docs: dataOrEmpty ? [{ data: () => dataOrEmpty, createTime: 11111 }] : []
            });

            mockCollection.mockImplementation((path: string) => {
                if (path === 'customers') {
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnThis(),
                                orderBy: vi.fn().mockReturnThis(),
                                limit: vi.fn().mockReturnValue({
                                    get: vi.fn().mockResolvedValue(createSnap({
                                        status: 'active',
                                        current_period_start: periodStartMs,
                                        current_period_end: periodEndMs,
                                        cancel_at_period_end: false,
                                        stripeLink: 'https://stripe.example/u1'
                                    }))
                                })
                            })
                        })
                    };
                }

                if (path === 'users') {
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockImplementation((collectionName: string) => {
                                if (collectionName === 'aiInsightsUsage') {
                                    return {
                                        doc: vi.fn().mockImplementation((docID: string) => ({
                                            get: vi.fn().mockResolvedValue({
                                                exists: docID === expectedUsageDocID,
                                                data: () => ({ successfulRequestCount: 17 })
                                            })
                                        }))
                                    };
                                }

                                return {
                                    limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true }) })
                                };
                            })
                        })
                    };
                }

                if (['garminAPITokens', 'suuntoAppAccessTokens', 'COROSAPIAccessTokens'].includes(path)) {
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockReturnValue({
                                limit: vi.fn().mockReturnValue({
                                    get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
                                })
                            })
                        })
                    };
                }

                return {
                    doc: vi.fn().mockReturnValue({
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
            expect(result.users[0].aiCreditsConsumed).toBe(17);
        });

        it('should not fall back to latest usage doc for active subscriptions when current period doc is missing', async () => {
            const periodStartMs = Date.parse('2026-01-01T00:00:00.000Z');
            const periodEndMs = Date.parse('2026-02-01T00:00:00.000Z');
            const latestUsageGet = vi.fn().mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ successfulRequestCount: 29 }) }]
            });

            mockListUsers.mockResolvedValue({
                users: [
                    {
                        uid: 'u1',
                        email: 'u1@test.com',
                        displayName: 'U1',
                        disabled: false,
                        metadata: { creationTime: '2024-01-01', lastSignInTime: '2024-01-02' },
                        customClaims: {},
                        providerData: []
                    }
                ],
                pageToken: undefined
            });

            const createSnap = (dataOrEmpty: any) => ({
                empty: !dataOrEmpty,
                docs: dataOrEmpty ? [{ data: () => dataOrEmpty, createTime: 11111 }] : []
            });

            mockGetAll.mockResolvedValue([
                { id: 'u1', data: () => ({ hasSubscribedOnce: true }) }
            ]);

            mockCollection.mockImplementation((path: string) => {
                if (path === 'customers') {
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnThis(),
                                orderBy: vi.fn().mockReturnThis(),
                                limit: vi.fn().mockReturnValue({
                                    get: vi.fn().mockResolvedValue(createSnap({
                                        status: 'active',
                                        current_period_start: periodStartMs,
                                        current_period_end: periodEndMs,
                                        cancel_at_period_end: false,
                                        stripeLink: 'https://stripe.example/u1'
                                    }))
                                })
                            })
                        })
                    };
                }

                if (path === 'users') {
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockImplementation((collectionName: string) => {
                                if (collectionName === 'aiInsightsUsage') {
                                    return {
                                        doc: vi.fn().mockReturnValue({
                                            get: vi.fn().mockResolvedValue({
                                                exists: false,
                                                data: () => undefined
                                            })
                                        }),
                                        orderBy: vi.fn().mockReturnValue({
                                            limit: vi.fn().mockReturnValue({
                                                get: latestUsageGet
                                            })
                                        })
                                    };
                                }

                                return {
                                    limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true }) })
                                };
                            })
                        })
                    };
                }

                if (['garminAPITokens', 'suuntoAppAccessTokens', 'COROSAPIAccessTokens'].includes(path)) {
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockReturnValue({
                                limit: vi.fn().mockReturnValue({
                                    get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
                                })
                            })
                        })
                    };
                }

                return {
                    doc: vi.fn().mockReturnValue({
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
            expect(result.users[0].aiCreditsConsumed).toBe(0);
            expect(latestUsageGet).not.toHaveBeenCalled();
        });

        it('should fall back to latest usage doc when there is no active subscription and user has subscribed before', async () => {
            const latestUsageGet = vi.fn().mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ successfulRequestCount: 29 }) }]
            });

            mockListUsers.mockResolvedValue({
                users: [
                    {
                        uid: 'u1',
                        email: 'u1@test.com',
                        displayName: 'U1',
                        disabled: false,
                        metadata: { creationTime: '2024-01-01', lastSignInTime: '2024-01-02' },
                        customClaims: {},
                        providerData: []
                    }
                ],
                pageToken: undefined
            });

            mockGetAll.mockResolvedValue([
                { id: 'u1', data: () => ({ hasSubscribedOnce: true }) }
            ]);

            mockCollection.mockImplementation((path: string) => {
                if (path === 'customers') {
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnThis(),
                                orderBy: vi.fn().mockReturnThis(),
                                limit: vi.fn().mockReturnValue({
                                    get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
                                })
                            })
                        })
                    };
                }

                if (path === 'users') {
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockImplementation((collectionName: string) => {
                                if (collectionName === 'aiInsightsUsage') {
                                    return {
                                        doc: vi.fn().mockReturnValue({
                                            get: vi.fn().mockResolvedValue({
                                                exists: false,
                                                data: () => undefined
                                            })
                                        }),
                                        orderBy: vi.fn().mockReturnValue({
                                            limit: vi.fn().mockReturnValue({
                                                get: latestUsageGet
                                            })
                                        })
                                    };
                                }

                                return {
                                    limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true }) })
                                };
                            })
                        })
                    };
                }

                if (['garminAPITokens', 'suuntoAppAccessTokens', 'COROSAPIAccessTokens'].includes(path)) {
                    return {
                        doc: vi.fn().mockReturnValue({
                            collection: vi.fn().mockReturnValue({
                                limit: vi.fn().mockReturnValue({
                                    get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
                                })
                            })
                        })
                    };
                }

                return {
                    doc: vi.fn().mockReturnValue({
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
            expect(result.users[0].aiCreditsConsumed).toBe(29);
            expect(latestUsageGet).toHaveBeenCalledTimes(1);
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

    it('should restore the original admin session for an impersonated user', async () => {
        const adminUid = 'admin-uid';
        mockGetUser.mockResolvedValue({
            uid: adminUid,
            disabled: false,
            customClaims: { admin: true }
        });
        mockCreateCustomToken.mockResolvedValue('restored-admin-token');
        const request = {
            auth: { uid: 'target-user-uid', token: { impersonatedBy: adminUid } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const result: any = await (stopImpersonation as any)(request);

        expect(mockGetUser).toHaveBeenCalledWith(adminUid);
        expect(mockCreateCustomToken).toHaveBeenCalledWith(adminUid);
        expect(result.token).toBe('restored-admin-token');
    });

    it('should reject stopImpersonation when session is not impersonated', async () => {
        const request = {
            auth: { uid: 'user1', token: {} },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        await expect((stopImpersonation as any)(request)).rejects.toThrow('The current session is not impersonating another user.');
    });

    it('should reject stopImpersonation when unauthenticated', async () => {
        const request = {
            auth: null,
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        await expect((stopImpersonation as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should reject stopImpersonation when original admin is no longer eligible', async () => {
        const adminUid = 'admin-uid';
        mockGetUser.mockResolvedValue({
            uid: adminUid,
            disabled: false,
            customClaims: { admin: false }
        });
        const request = {
            auth: { uid: 'target-user-uid', token: { impersonatedBy: adminUid } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        await expect((stopImpersonation as any)(request)).rejects.toThrow('The original admin session is no longer eligible for restoration.');
    });

    it('should reject stopImpersonation when original admin cannot be loaded', async () => {
        const adminUid = 'admin-uid';
        mockGetUser.mockRejectedValue(new Error('not-found'));
        const request = {
            auth: { uid: 'target-user-uid', token: { impersonatedBy: adminUid } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        await expect((stopImpersonation as any)(request)).rejects.toThrow('The original admin session is no longer available.');
    });

    it('should throw internal when creating the restoration token fails', async () => {
        const adminUid = 'admin-uid';
        mockGetUser.mockResolvedValue({
            uid: adminUid,
            disabled: false,
            customClaims: { admin: true }
        });
        mockCreateCustomToken.mockRejectedValue(new Error('token gen failed'));
        const request = {
            auth: { uid: 'target-user-uid', token: { impersonatedBy: adminUid } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        await expect((stopImpersonation as any)(request)).rejects.toThrow('token gen failed');
    });
});

