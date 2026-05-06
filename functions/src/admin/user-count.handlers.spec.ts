import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CallableRequest } from 'firebase-functions/v2/https';
import {
    getUserCount,
    mockListUsers,
    mockCollection,
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
                    data: () => ({ items: [{ plan: { interval: 'month' } }] })
                })),
                ...Array.from({ length: 5 }, () => ({
                    data: () => ({ items: [{ plan: { interval: 'year' } }] })
                }))
            ]
        });
        const mockEventCountGet = vi.fn().mockResolvedValue({
            data: () => ({ count: 1_000_000 })
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
            return {};
        });

        const result = await (getUserCount as any)(request);

        expect(result).toEqual({
            count: 150,
            total: 150,
            pro: 50,
            basic: 50,
            free: 50,
            monthlyPaid: 45,
            yearlyPaid: 5,
            onboardingCompleted: 40,
            events: {
                total: 1_000_000,
            },
            providers: {}
        });
        expect(mockCollection).toHaveBeenCalledWith('users');
        expect(mockCollection).toHaveBeenCalledWith('subscriptions'); // collectionGroup calls this name
        expect(mockCollection).toHaveBeenCalledWith('events');
        expect(mockEventsQuery.count).toHaveBeenCalled();
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

        expect(result.events).toEqual({ total: null });
    });
});
