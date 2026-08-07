import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { CallableRequest } from 'firebase-functions/v2/https';
import {
    getUserCount,
    mockListUsers,
    mockCollection,
    mockFirestore,
} from './test-utils/admin-test-harness';

describe('getUserCount Cloud Function', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return total user count with subscription breakdown', async () => {
        const request = {
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const mockTotalCount = vi.fn().mockResolvedValue({
            data: () => ({ count: 150 })
        });
        const mockCountGet = vi.fn()
            .mockResolvedValueOnce({ data: () => ({ count: 50 }) }) // pro
            .mockResolvedValueOnce({ data: () => ({ count: 50 }) }); // basic
        const mockOnboardingCount = vi.fn().mockResolvedValue({
            data: () => ({ count: 40 })
        });
        const mockActiveSubscriptionsGet = vi.fn().mockResolvedValue({
            docs: [
                ...Array.from({ length: 45 }, () => ({
                    data: () => ({ role: 'pro', items: [{ plan: { interval: 'month' } }] })
                })),
                ...Array.from({ length: 5 }, () => ({
                    data: () => ({ role: 'basic', items: [{ plan: { interval: 'year' } }] })
                }))
            ]
        });
        const mockEventCountGet = vi.fn().mockResolvedValue({
            data: () => ({ count: 1_000_000 })
        });
        const mockRouteCountGet = vi.fn().mockResolvedValue({
            data: () => ({ count: 25_000 })
        });

        // Mock implementation for chainable queries
        const mockQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: mockCountGet }),
            select: vi.fn().mockReturnValue({ get: mockActiveSubscriptionsGet })
        };
        const mockEventsQuery = {
            count: vi.fn().mockReturnValue({ get: mockEventCountGet })
        };
        const mockRoutesQuery = {
            count: vi.fn().mockReturnValue({ get: mockRouteCountGet })
        };

        mockCollection.mockImplementation((name) => {
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({
                            get: mockOnboardingCount
                        })
                    }),
                    count: vi.fn().mockReturnValue({
                        get: mockTotalCount
                    })
                };
            }
            if (name === 'subscriptions') {
                // This handles collectionGroup('subscriptions')
                return mockQuery;
            }
            if (name === 'events') {
                return mockEventsQuery;
            }
            if (name === 'routes') {
                return mockRoutesQuery;
            }
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result).toEqual(expect.objectContaining({
            count: 150,
            total: 150,
            pro: 50,
            basic: 50,
            free: 50,
            monthlyPaid: 45,
            yearlyPaid: 5,
            onboardingCompleted: 40,
            events: expect.objectContaining({
                total: 1_000_000,
                cacheStatus: 'refreshed',
            }),
            routes: expect.objectContaining({
                total: 25_000,
                cacheStatus: 'refreshed',
            }),
            providers: {}
        }));
        expect(mockCollection).toHaveBeenCalledWith('users');
        expect(mockCollection).toHaveBeenCalledWith('subscriptions'); // collectionGroup calls this name
        expect(mockCollection).toHaveBeenCalledWith('events');
        expect(mockCollection).toHaveBeenCalledWith('routes');
        expect(mockEventsQuery.count).toHaveBeenCalled();
        expect(mockRoutesQuery.count).toHaveBeenCalled();
    });

    it('should report event count as unavailable when the event aggregation fails', async () => {
        const request = {
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const mockCountGet = vi.fn()
            .mockResolvedValueOnce({ data: () => ({ count: 0 }) })
            .mockResolvedValueOnce({ data: () => ({ count: 0 }) });
        const mockEventsCountGet = vi.fn().mockRejectedValue(new Error('event count failed'));
        const mockSubscriptionQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: mockCountGet }),
            select: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        };

        mockCollection.mockImplementation((name) => {
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({ data: () => ({ count: 7 }) })
                        })
                    }),
                    count: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) })
                    })
                };
            }
            if (name === 'subscriptions') {
                return mockSubscriptionQuery;
            }
            if (name === 'events') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockEventsCountGet })
                };
            }
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result.events).toEqual({
            total: null,
            cacheStatus: 'unavailable',
            computedAt: null,
            expireAt: null,
        });
    });

    it('should report route count as unavailable when the route aggregation fails', async () => {
        const request = {
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const mockCountGet = vi.fn()
            .mockResolvedValueOnce({ data: () => ({ count: 0 }) })
            .mockResolvedValueOnce({ data: () => ({ count: 0 }) });
        const mockEventsCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) });
        const mockRoutesCountGet = vi.fn().mockRejectedValue(new Error('route count failed'));
        const mockSubscriptionQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: mockCountGet }),
            select: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        };

        mockCollection.mockImplementation((name) => {
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({ data: () => ({ count: 7 }) })
                        })
                    }),
                    count: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) })
                    })
                };
            }
            if (name === 'subscriptions') {
                return mockSubscriptionQuery;
            }
            if (name === 'events') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockEventsCountGet })
                };
            }
            if (name === 'routes') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockRoutesCountGet })
                };
            }
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result.events).toEqual(expect.objectContaining({ total: 10 }));
        expect(result.routes).toEqual({
            total: null,
            cacheStatus: 'unavailable',
            computedAt: null,
            expireAt: null,
        });
    });

    it('should return a stale cached route count when refreshing the route aggregation fails', async () => {
        const request = {
            data: { refreshRouteCount: true },
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const mockCountGet = vi.fn()
            .mockResolvedValueOnce({ data: () => ({ count: 0 }) })
            .mockResolvedValueOnce({ data: () => ({ count: 0 }) });
        const mockRoutesCountGet = vi.fn().mockRejectedValue(new Error('route count failed'));
        const mockSubscriptionQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: mockCountGet }),
            select: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        };
        const staleComputedAt = '2026-05-07T05:00:00.000Z';
        const staleExpireAt = '2026-05-07T06:00:00.000Z';

        mockCollection.mockImplementation((name) => {
            if (name === 'adminStats') {
                return {
                    doc: vi.fn((docId: string) => ({
                        get: vi.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({
                                total: docId === 'routeCounts' ? 777 : 10,
                                computedAt: staleComputedAt,
                                expireAt: docId === 'routeCounts' ? staleExpireAt : '2999-05-07T06:00:00.000Z',
                            }),
                        }),
                        set: vi.fn(),
                    })),
                };
            }
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({ data: () => ({ count: 7 }) })
                        })
                    }),
                    count: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) })
                    })
                };
            }
            if (name === 'subscriptions') {
                return mockSubscriptionQuery;
            }
            if (name === 'routes') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockRoutesCountGet })
                };
            }
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result.routes).toEqual({
            total: 777,
            cacheStatus: 'stale',
            computedAt: staleComputedAt,
            expireAt: staleExpireAt,
        });
    });

    it('should reuse a fresh cached global event count', async () => {
        const request = {
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const mockTotalCount = vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) });
        const mockCountGet = vi.fn()
            .mockResolvedValueOnce({ data: () => ({ count: 2 }) })
            .mockResolvedValueOnce({ data: () => ({ count: 3 }) });
        const mockOnboardingCount = vi.fn().mockResolvedValue({ data: () => ({ count: 8 }) });
        const mockActiveSubscriptionsGet = vi.fn().mockResolvedValue({ docs: [] });
        const mockEventsCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 999 }) });
        const mockCacheGet = vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
                total: 777,
                computedAt: '2026-05-07T05:00:00.000Z',
                expireAt: '2999-05-07T06:00:00.000Z',
            }),
        });
        const mockCacheDoc = vi.fn().mockReturnValue({
            get: mockCacheGet,
            set: vi.fn(),
        });

        const mockSubscriptionQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: mockCountGet }),
            select: vi.fn().mockReturnValue({ get: mockActiveSubscriptionsGet }),
        };

        mockCollection.mockImplementation((name) => {
            if (name === 'adminStats') {
                return { doc: mockCacheDoc };
            }
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({ get: mockOnboardingCount })
                    }),
                    count: vi.fn().mockReturnValue({ get: mockTotalCount })
                };
            }
            if (name === 'subscriptions') {
                return mockSubscriptionQuery;
            }
            if (name === 'events') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockEventsCountGet })
                };
            }
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result.events).toEqual({
            total: 777,
            cacheStatus: 'fresh',
            computedAt: '2026-05-07T05:00:00.000Z',
            expireAt: '2999-05-07T06:00:00.000Z',
        });
        expect(mockCacheDoc).toHaveBeenCalledWith('eventCounts');
        expect(mockEventsCountGet).not.toHaveBeenCalled();
    });

    it('should reuse a fresh cached global route count', async () => {
        const request = {
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const mockTotalCount = vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) });
        const mockCountGet = vi.fn()
            .mockResolvedValueOnce({ data: () => ({ count: 2 }) })
            .mockResolvedValueOnce({ data: () => ({ count: 3 }) });
        const mockOnboardingCount = vi.fn().mockResolvedValue({ data: () => ({ count: 8 }) });
        const mockActiveSubscriptionsGet = vi.fn().mockResolvedValue({ docs: [] });
        const mockEventsCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 999 }) });
        const mockRoutesCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 999 }) });
        const mockCacheDoc = vi.fn((docId: string) => ({
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                    total: docId === 'routeCounts' ? 777 : 111,
                    computedAt: '2026-05-07T05:00:00.000Z',
                    expireAt: '2999-05-07T06:00:00.000Z',
                }),
            }),
            set: vi.fn(),
        }));

        const mockSubscriptionQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: mockCountGet }),
            select: vi.fn().mockReturnValue({ get: mockActiveSubscriptionsGet }),
        };

        mockCollection.mockImplementation((name) => {
            if (name === 'adminStats') {
                return { doc: mockCacheDoc };
            }
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({ get: mockOnboardingCount })
                    }),
                    count: vi.fn().mockReturnValue({ get: mockTotalCount })
                };
            }
            if (name === 'subscriptions') {
                return mockSubscriptionQuery;
            }
            if (name === 'events') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockEventsCountGet })
                };
            }
            if (name === 'routes') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockRoutesCountGet })
                };
            }
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result.routes).toEqual({
            total: 777,
            cacheStatus: 'fresh',
            computedAt: '2026-05-07T05:00:00.000Z',
            expireAt: '2999-05-07T06:00:00.000Z',
        });
        expect(mockCacheDoc).toHaveBeenCalledWith('routeCounts');
        expect(mockRoutesCountGet).not.toHaveBeenCalled();
    });

    it('should bypass the cached global event count when refreshEventCount is true', async () => {
        const request = {
            data: { refreshEventCount: true },
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const mockTotalCount = vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) });
        const mockCountGet = vi.fn()
            .mockResolvedValueOnce({ data: () => ({ count: 2 }) })
            .mockResolvedValueOnce({ data: () => ({ count: 3 }) });
        const mockOnboardingCount = vi.fn().mockResolvedValue({ data: () => ({ count: 8 }) });
        const mockActiveSubscriptionsGet = vi.fn().mockResolvedValue({ docs: [] });
        const mockEventsCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 999 }) });
        const mockCacheSet = vi.fn().mockResolvedValue(undefined);
        const mockCacheDoc = vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                    total: 777,
                    computedAt: '2026-05-07T05:00:00.000Z',
                    expireAt: '2999-05-07T06:00:00.000Z',
                }),
            }),
            set: mockCacheSet,
        });

        const mockSubscriptionQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: mockCountGet }),
            select: vi.fn().mockReturnValue({ get: mockActiveSubscriptionsGet }),
        };

        mockCollection.mockImplementation((name) => {
            if (name === 'adminStats') {
                return { doc: mockCacheDoc };
            }
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({ get: mockOnboardingCount })
                    }),
                    count: vi.fn().mockReturnValue({ get: mockTotalCount })
                };
            }
            if (name === 'subscriptions') {
                return mockSubscriptionQuery;
            }
            if (name === 'events') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockEventsCountGet })
                };
            }
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result.events).toEqual(expect.objectContaining({
            total: 999,
            cacheStatus: 'refreshed',
        }));
        expect(mockEventsCountGet).toHaveBeenCalled();
        expect(mockCacheSet).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'eventCounts',
            schemaVersion: 1,
            total: 999,
            refreshedBy: 'admin-uid',
        }), { merge: true });
    });

    it('should bypass the cached global route count when refreshRouteCount is true', async () => {
        const request = {
            data: { refreshRouteCount: true },
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const mockTotalCount = vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) });
        const mockCountGet = vi.fn()
            .mockResolvedValueOnce({ data: () => ({ count: 2 }) })
            .mockResolvedValueOnce({ data: () => ({ count: 3 }) });
        const mockOnboardingCount = vi.fn().mockResolvedValue({ data: () => ({ count: 8 }) });
        const mockActiveSubscriptionsGet = vi.fn().mockResolvedValue({ docs: [] });
        const mockEventsCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 999 }) });
        const mockRoutesCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 444 }) });
        const mockEventCacheSet = vi.fn().mockResolvedValue(undefined);
        const mockRouteCacheSet = vi.fn().mockResolvedValue(undefined);
        const mockCacheDoc = vi.fn((docId: string) => ({
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                    total: docId === 'routeCounts' ? 777 : 111,
                    computedAt: '2026-05-07T05:00:00.000Z',
                    expireAt: '2999-05-07T06:00:00.000Z',
                }),
            }),
            set: docId === 'routeCounts' ? mockRouteCacheSet : mockEventCacheSet,
        }));

        const mockSubscriptionQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: mockCountGet }),
            select: vi.fn().mockReturnValue({ get: mockActiveSubscriptionsGet }),
        };

        mockCollection.mockImplementation((name) => {
            if (name === 'adminStats') {
                return { doc: mockCacheDoc };
            }
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({ get: mockOnboardingCount })
                    }),
                    count: vi.fn().mockReturnValue({ get: mockTotalCount })
                };
            }
            if (name === 'subscriptions') {
                return mockSubscriptionQuery;
            }
            if (name === 'events') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockEventsCountGet })
                };
            }
            if (name === 'routes') {
                return {
                    count: vi.fn().mockReturnValue({ get: mockRoutesCountGet })
                };
            }
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result.routes).toEqual(expect.objectContaining({
            total: 444,
            cacheStatus: 'refreshed',
        }));
        expect(mockRoutesCountGet).toHaveBeenCalled();
        expect(mockRouteCacheSet).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'routeCounts',
            schemaVersion: 1,
            total: 444,
            refreshedBy: 'admin-uid',
        }), { merge: true });
        expect(mockEventCacheSet).not.toHaveBeenCalled();
    });

    it('should write refreshed global count caches without depending on admin.firestore.FieldValue', async () => {
        const firestoreMock = mockFirestore as typeof mockFirestore & { FieldValue?: unknown };
        const originalFieldValue = firestoreMock.FieldValue;
        firestoreMock.FieldValue = undefined;

        try {
            const request = {
                data: { refreshEventCount: true, refreshRouteCount: true },
                auth: { uid: 'admin-uid', token: { admin: true } },
                app: { appId: 'mock-app-id' }
            } as unknown as CallableRequest<any>;
            mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

            const mockCountGet = vi.fn()
                .mockResolvedValueOnce({ data: () => ({ count: 0 }) })
                .mockResolvedValueOnce({ data: () => ({ count: 0 }) });
            const mockEventsCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 12 }) });
            const mockRoutesCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 34 }) });
            const mockEventCacheSet = vi.fn().mockResolvedValue(undefined);
            const mockRouteCacheSet = vi.fn().mockResolvedValue(undefined);
            const mockCacheDoc = vi.fn((docId: string) => ({
                get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
                set: docId === 'routeCounts' ? mockRouteCacheSet : mockEventCacheSet,
            }));

            const mockSubscriptionQuery = {
                where: vi.fn().mockReturnThis(),
                count: vi.fn().mockReturnValue({ get: mockCountGet }),
                select: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
            };

            mockCollection.mockImplementation((name) => {
                if (name === 'adminStats') {
                    return { doc: mockCacheDoc };
                }
                if (name === 'users') {
                    return {
                        where: vi.fn().mockReturnValue({
                            count: vi.fn().mockReturnValue({
                                get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
                            })
                        }),
                        count: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
                        })
                    };
                }
                if (name === 'subscriptions') {
                    return mockSubscriptionQuery;
                }
                if (name === 'events') {
                    return {
                        count: vi.fn().mockReturnValue({ get: mockEventsCountGet })
                    };
                }
                if (name === 'routes') {
                    return {
                        count: vi.fn().mockReturnValue({ get: mockRoutesCountGet })
                    };
                }
                return {};
            });

            const result = await (getUserCount as any)(request);

            expect(result.events).toEqual(expect.objectContaining({
                total: 12,
                cacheStatus: 'refreshed',
            }));
            expect(result.routes).toEqual(expect.objectContaining({
                total: 34,
                cacheStatus: 'refreshed',
            }));
            expect(mockEventCacheSet).toHaveBeenCalledWith(expect.objectContaining({
                kind: 'eventCounts',
                updatedAt: 'mock-timestamp',
            }), { merge: true });
            expect(mockRouteCacheSet).toHaveBeenCalledWith(expect.objectContaining({
                kind: 'routeCounts',
                updatedAt: 'mock-timestamp',
            }), { merge: true });
        } finally {
            firestoreMock.FieldValue = originalFieldValue;
        }
    });

    it('counts distinct connected service and active MCP users', async () => {
        const request = {
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<unknown>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const tokenDocument = (collectionName: string, uid: string) => ({
            ref: {
                parent: {
                    parent: {
                        id: uid,
                        parent: { id: collectionName },
                    },
                },
            },
        });
        const mcpConnectionDocument = (uid: string, connectionId: string, data: Record<string, unknown>) => ({
            id: connectionId,
            ref: {
                parent: {
                    parent: { id: uid },
                },
            },
            data: () => data,
        });
        const supersedingConnectionId = createHash('sha256')
            .update('mcp-logical-connection-v1:client-e')
            .digest('base64url');
        const connectionCacheSet = vi.fn().mockResolvedValue(undefined);
        const cacheDoc = vi.fn((docId: string) => ({
            get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
            set: docId === 'connectionCounts' ? connectionCacheSet : vi.fn().mockResolvedValue(undefined),
        }));
        const subscriptionQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }) }),
            select: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        };

        mockCollection.mockImplementation((name) => {
            if (name === 'adminStats') {
                return { doc: cacheDoc };
            }
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) }),
                        }),
                    }),
                    count: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) }),
                    }),
                };
            }
            if (name === 'subscriptions') {
                return subscriptionQuery;
            }
            if (name === 'events' || name === 'routes') {
                return {
                    count: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }) }),
                };
            }
            if (name === 'tokens') {
                return {
                    select: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({
                            docs: [
                                tokenDocument('garminAPITokens', 'user-a'),
                                tokenDocument('garminAPITokens', 'user-a'),
                                tokenDocument('suuntoAppAccessTokens', 'user-b'),
                                tokenDocument('COROSAPIAccessTokens', 'user-c'),
                                tokenDocument('unrelatedTokens', 'ignored-user'),
                            ],
                        }),
                    }),
                };
            }
            if (name === 'mcpConnections') {
                return {
                    select: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({
                            docs: [
                                mcpConnectionDocument('user-a', 'connection-a', { clientId: 'client-a', status: 'active', revokedAtMs: null }),
                                mcpConnectionDocument('user-b', 'pending-connection-b', { clientId: 'client-b', status: 'pending', lastUsedAtMs: null, revokedAtMs: null }),
                                mcpConnectionDocument('user-b', 'connection-b', { clientId: 'client-b', status: 'active', revokedAtMs: null }),
                                mcpConnectionDocument('user-c', 'connection-c', { clientId: 'client-c', status: 'revoked', revokedAtMs: 100 }),
                                mcpConnectionDocument('user-d', 'legacy-connection-d', { clientId: 'client-d', lastUsedAtMs: 200, revokedAtMs: null }),
                                mcpConnectionDocument('user-e', 'legacy-connection-e', { clientId: 'client-e', status: 'active', revokedAtMs: null }),
                                mcpConnectionDocument('user-e', supersedingConnectionId, { clientId: 'client-e', status: 'revoked', revokedAtMs: 100, supersedesLegacy: true }),
                            ],
                        }),
                    }),
                };
            }
            return {};
        });

        const getUserCountHandler = getUserCount as unknown as (input: CallableRequest<unknown>) => Promise<{
            connections: unknown;
        }>;
        const result = await getUserCountHandler(request);

        expect(result.connections).toEqual(expect.objectContaining({
            serviceUsers: 3,
            mcpUsers: 3,
            both: 2,
            providers: {
                Garmin: 1,
                Suunto: 1,
                COROS: 1,
                Wahoo: 0,
            },
            cacheStatus: 'refreshed',
        }));
        expect(connectionCacheSet).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'connectionCounts',
            serviceUsers: 3,
            mcpUsers: 3,
            both: 2,
        }), { merge: true });
    });

    it('returns fresh connection counts from cache without scanning connection documents', async () => {
        const request = {
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<unknown>;
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });

        const tokenSelect = vi.fn();
        const mcpConnectionSelect = vi.fn();
        const subscriptionQuery = {
            where: vi.fn().mockReturnThis(),
            count: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }) }),
            select: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        };
        const connectionCacheGet = vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
                serviceUsers: 6,
                mcpUsers: 4,
                both: 2,
                providers: { Garmin: 3, Suunto: 2, COROS: 1, Wahoo: 0 },
                computedAt: '2026-08-07T13:00:00.000Z',
                expireAt: '2999-08-07T14:00:00.000Z',
            }),
        });

        mockCollection.mockImplementation((name) => {
            if (name === 'adminStats') {
                return {
                    doc: vi.fn((docId: string) => ({
                        get: docId === 'connectionCounts'
                            ? connectionCacheGet
                            : vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
                        set: vi.fn().mockResolvedValue(undefined),
                    })),
                };
            }
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
                        }),
                    }),
                    count: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ data: () => ({ count: 10 }) }),
                    }),
                };
            }
            if (name === 'subscriptions') {
                return subscriptionQuery;
            }
            if (name === 'events' || name === 'routes') {
                return {
                    count: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }) }),
                };
            }
            if (name === 'tokens') {
                return { select: tokenSelect };
            }
            if (name === 'mcpConnections') {
                return { select: mcpConnectionSelect };
            }
            return {};
        });

        const getUserCountHandler = getUserCount as unknown as (input: CallableRequest<unknown>) => Promise<{
            connections: unknown;
        }>;
        const result = await getUserCountHandler(request);

        expect(result.connections).toEqual({
            serviceUsers: 6,
            mcpUsers: 4,
            both: 2,
            providers: { Garmin: 3, Suunto: 2, COROS: 1, Wahoo: 0 },
            cacheStatus: 'fresh',
            computedAt: '2026-08-07T13:00:00.000Z',
            expireAt: '2999-08-07T14:00:00.000Z',
        });
        expect(connectionCacheGet).toHaveBeenCalledOnce();
        expect(tokenSelect).not.toHaveBeenCalled();
        expect(mcpConnectionSelect).not.toHaveBeenCalled();
    });
});
