import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
    getAdminRequest,
    getSubscriptionHistoryTrend,
    getUserGrowthTrend,
    mockCollection,
} from './test-utils/admin-test-harness';

describe('getSubscriptionHistoryTrend Cloud Function', () => {
    const toSeconds = (value: string): number => Math.floor(new Date(value).getTime() / 1000);
    const getRequest = (data: Record<string, unknown> = {}) => ({
        data,
        auth: { uid: 'admin-uid', token: { admin: true } },
        app: { appId: 'mock-app-id' }
    } as unknown as CallableRequest<any>);

    const setupTrendCollectionMocks = (createdValues: unknown[], periodEndValues: unknown[]) => {
        const newSubscriptionsQuery = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                docs: createdValues.map((createdEntry) => ({
                    data: () => {
                        if (createdEntry && typeof createdEntry === 'object') {
                            return createdEntry as Record<string, unknown>;
                        }
                        return { created: createdEntry };
                    }
                }))
            })
        };
        const plannedCancellationsQuery = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                docs: periodEndValues.map((periodEndEntry) => ({
                    data: () => {
                        if (periodEndEntry && typeof periodEndEntry === 'object') {
                            return periodEndEntry as Record<string, unknown>;
                        }
                        return {
                            current_period_end: periodEndEntry,
                            cancel_at_period_end: true,
                            status: 'active'
                        };
                    }
                }))
            })
        };

        mockCollection.mockImplementation((name: string) => {
            if (name === 'subscriptions') {
                return {
                    where: vi.fn((field: string) => {
                        if (field === 'created') {
                            return newSubscriptionsQuery;
                        }
                        return plannedCancellationsQuery;
                    })
                };
            }

            return {
                where: vi.fn().mockReturnThis(),
                count: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        data: () => ({ count: 0 })
                    })
                }),
                get: vi.fn().mockResolvedValue({ docs: [] })
            };
        });
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return 12 chronological buckets with net values', async () => {
        setupTrendCollectionMocks(
            [
                { created: toSeconds('2025-04-10T00:00:00Z'), role: 'basic' },
                { created: toSeconds('2025-06-05T00:00:00Z'), role: 'pro' },
                { created: toSeconds('2026-03-01T00:00:00Z'), role: 'basic' }
            ],
            [
                { current_period_end: toSeconds('2025-06-20T00:00:00Z'), cancel_at_period_end: true, status: 'active', role: 'pro' },
                { current_period_end: toSeconds('2026-02-10T00:00:00Z'), cancel_at_period_end: true, status: 'active', role: 'basic' }
            ]
        );

        const result: any = await (getSubscriptionHistoryTrend as any)(getRequest({ months: 12 }));
        const bucketByKey = new Map(result.buckets.map((bucket: any) => [bucket.key, bucket]));
        const keys = result.buckets.map((bucket: any) => bucket.key);

        expect(result.months).toBe(12);
        expect(result.buckets).toHaveLength(12);
        expect(keys).toEqual([...keys].sort());
        expect(result.buckets[0].key).toBe('2025-04');
        expect(result.buckets[result.buckets.length - 1].key).toBe('2026-03');

        expect(bucketByKey.get('2025-04')).toEqual(expect.objectContaining({
            newSubscriptions: 1,
            plannedCancellations: 0,
            net: 1,
            basicNet: 1,
            proNet: 0
        }));
        expect(bucketByKey.get('2025-06')).toEqual(expect.objectContaining({
            newSubscriptions: 1,
            plannedCancellations: 1,
            net: 0,
            basicNet: 0,
            proNet: 0
        }));
        expect(bucketByKey.get('2026-02')).toEqual(expect.objectContaining({
            newSubscriptions: 0,
            plannedCancellations: 1,
            net: -1,
            basicNet: -1,
            proNet: 0
        }));
        expect(bucketByKey.get('2026-03')).toEqual(expect.objectContaining({
            newSubscriptions: 1,
            plannedCancellations: 0,
            net: 1,
            basicNet: 1,
            proNet: 0
        }));

        expect(result.totals).toEqual(expect.objectContaining({
            newSubscriptions: 3,
            plannedCancellations: 2,
            net: 1,
            basicNewSubscriptions: 2,
            basicPlannedCancellations: 1,
            basicNet: 1,
            proNewSubscriptions: 1,
            proPlannedCancellations: 1,
            proNet: 0
        }));
    });

    it('should enforce default and max months bounds', async () => {
        setupTrendCollectionMocks([], []);

        const defaultResult: any = await (getSubscriptionHistoryTrend as any)(getRequest());
        expect(defaultResult.months).toBe(12);
        expect(defaultResult.buckets).toHaveLength(12);

        const maxResult: any = await (getSubscriptionHistoryTrend as any)(getRequest({ months: 200 }));
        expect(maxResult.months).toBe(24);
        expect(maxResult.buckets).toHaveLength(24);
    });

    it('should fail when required query indexes are missing', async () => {
        const missingIndexError = Object.assign(new Error('The query requires an index.'), { code: 9 });
        const failedQuery = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            get: vi.fn().mockRejectedValue(missingIndexError)
        };

        mockCollection.mockImplementation((name: string) => {
            if (name === 'subscriptions') {
                return {
                    where: vi.fn().mockReturnValue(failedQuery)
                };
            }

            return {
                where: vi.fn().mockReturnThis(),
                count: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        data: () => ({ count: 0 })
                    })
                }),
                get: vi.fn().mockResolvedValue({ docs: [] })
            };
        });

        await expect((getSubscriptionHistoryTrend as any)(getRequest({ months: 12 })))
            .rejects.toThrow('Failed to get subscription history trend');
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        const request = { auth: null } as unknown as CallableRequest<any>;
        await expect((getSubscriptionHistoryTrend as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } },
            app: { appId: 'mock-app-id' },
            data: {}
        } as unknown as CallableRequest<any>;
        await expect((getSubscriptionHistoryTrend as any)(request)).rejects.toThrow('Only admins can call this function.');
    });
});

describe('getUserGrowthTrend Cloud Function', () => {
    const toSeconds = (value: string): number => Math.floor(new Date(value).getTime() / 1000);
    const getRequest = (data: Record<string, unknown> = {}) => ({
        data,
        auth: { uid: 'admin-uid', token: { admin: true } },
        app: { appId: 'mock-app-id' }
    } as unknown as CallableRequest<any>);

    const setupUserGrowthCollectionMocks = (entries: unknown[]) => {
        const usersQuery = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                docs: entries.map((entry) => ({
                    data: () => entry as Record<string, unknown>
                }))
            })
        };

        mockCollection.mockImplementation((name: string) => {
            if (name === 'users') {
                return usersQuery;
            }

            return {
                where: vi.fn().mockReturnThis(),
                count: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        data: () => ({ count: 0 })
                    })
                }),
                get: vi.fn().mockResolvedValue({ docs: [] })
            };
        });
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return 12 chronological buckets with registered and onboarded values', async () => {
        setupUserGrowthCollectionMocks([
            { creationDate: toSeconds('2025-04-10T00:00:00Z'), onboardingCompleted: true },
            { creationDate: toSeconds('2025-06-05T00:00:00Z'), onboardingCompleted: false },
            { creationDate: toSeconds('2026-03-01T00:00:00Z'), onboardingCompleted: true },
            { creationDate: toSeconds('2026-04-01T00:00:00Z'), onboardingCompleted: true }
        ]);

        const result: any = await (getUserGrowthTrend as any)(getRequest({ months: 12 }));
        const bucketByKey = new Map(result.buckets.map((bucket: any) => [bucket.key, bucket]));
        const keys = result.buckets.map((bucket: any) => bucket.key);

        expect(result.months).toBe(12);
        expect(result.buckets).toHaveLength(12);
        expect(keys).toEqual([...keys].sort());
        expect(result.buckets[0].key).toBe('2025-04');
        expect(result.buckets[result.buckets.length - 1].key).toBe('2026-03');

        expect(bucketByKey.get('2025-04')).toEqual(expect.objectContaining({
            registeredUsers: 1,
            onboardedUsers: 1
        }));
        expect(bucketByKey.get('2025-06')).toEqual(expect.objectContaining({
            registeredUsers: 1,
            onboardedUsers: 0
        }));
        expect(bucketByKey.get('2026-03')).toEqual(expect.objectContaining({
            registeredUsers: 1,
            onboardedUsers: 1
        }));
        expect(result.totals).toEqual({
            registeredUsers: 3,
            onboardedUsers: 2
        });
    });

    it('should enforce default and max months bounds', async () => {
        setupUserGrowthCollectionMocks([]);

        const defaultResult: any = await (getUserGrowthTrend as any)(getRequest());
        expect(defaultResult.months).toBe(12);
        expect(defaultResult.buckets).toHaveLength(12);

        const maxResult: any = await (getUserGrowthTrend as any)(getRequest({ months: 200 }));
        expect(maxResult.months).toBe(24);
        expect(maxResult.buckets).toHaveLength(24);
    });

    it('should fail when growth query errors', async () => {
        const growthQueryError = new Error('growth query failed');
        const failedQuery = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            get: vi.fn().mockRejectedValue(growthQueryError)
        };

        mockCollection.mockImplementation((name: string) => {
            if (name === 'users') {
                return failedQuery;
            }

            return {
                where: vi.fn().mockReturnThis(),
                count: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        data: () => ({ count: 0 })
                    })
                }),
                get: vi.fn().mockResolvedValue({ docs: [] })
            };
        });

        await expect((getUserGrowthTrend as any)(getRequest({ months: 12 })))
            .rejects.toThrow('Failed to get user growth trend');
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        const request = { auth: null } as unknown as CallableRequest<any>;
        await expect((getUserGrowthTrend as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } },
            app: { appId: 'mock-app-id' },
            data: {}
        } as unknown as CallableRequest<any>;
        await expect((getUserGrowthTrend as any)(request)).rejects.toThrow('Only admins can call this function.');
    });
});

