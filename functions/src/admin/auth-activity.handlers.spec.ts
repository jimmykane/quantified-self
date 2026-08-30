import type { CallableRequest } from 'firebase-functions/v2/https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserCountRequest, UserCountResponse } from './shared/types';
import {
    getAdminRequest,
    getUserCount,
    mockCollection,
    mockListUsers,
} from './test-utils/admin-test-harness';

type GetUserCountHandler = (
    request: CallableRequest<UserCountRequest>,
) => Promise<UserCountResponse>;

const invokeGetUserCount = getUserCount as unknown as GetUserCountHandler;

describe('getUserCount authentication activity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
        mockCollection.mockReset();
    });

    it('aggregates recent authentication activity across Auth pages', async () => {
        vi.useFakeTimers();
        const now = new Date('2026-08-26T12:00:00.000Z');
        vi.setSystemTime(now);
        const beforeNow = (milliseconds: number) => new Date(now.getTime() - milliseconds).toISOString();
        const afterNow = (milliseconds: number) => new Date(now.getTime() + milliseconds).toISOString();
        const user = (uid: string, overrides: Record<string, unknown>) => ({
            uid,
            providerData: [],
            disabled: false,
            customClaims: {},
            metadata: {},
            ...overrides,
        });

        mockListUsers
            .mockResolvedValueOnce({
                users: [
                    user('recent-refresh', {
                        metadata: {
                            lastSignInTime: beforeNow(2 * 60 * 60 * 1000),
                            lastRefreshTime: beforeNow(60 * 60 * 1000),
                        },
                    }),
                    user('exactly-24-hours', {
                        metadata: { lastSignInTime: beforeNow(24 * 60 * 60 * 1000) },
                    }),
                    user('newer-sign-in', {
                        metadata: {
                            lastSignInTime: beforeNow(3 * 24 * 60 * 60 * 1000),
                            lastRefreshTime: beforeNow(8 * 24 * 60 * 60 * 1000),
                        },
                    }),
                    user('exactly-7-days', {
                        metadata: { lastRefreshTime: beforeNow(7 * 24 * 60 * 60 * 1000) },
                    }),
                    user('admin-user', {
                        customClaims: { admin: true },
                        metadata: { lastRefreshTime: beforeNow(60 * 60 * 1000) },
                    }),
                ],
                pageToken: 'next-page',
            })
            .mockResolvedValueOnce({
                users: [
                    user('active-30-days', {
                        metadata: { lastRefreshTime: beforeNow(20 * 24 * 60 * 60 * 1000) },
                    }),
                    user('exactly-30-days', {
                        metadata: { lastRefreshTime: beforeNow(30 * 24 * 60 * 60 * 1000) },
                    }),
                    user('outside-30-days', {
                        metadata: { lastRefreshTime: beforeNow((30 * 24 * 60 * 60 * 1000) + 1) },
                    }),
                    user('disabled-user', {
                        disabled: true,
                        metadata: { lastRefreshTime: beforeNow(60 * 60 * 1000) },
                    }),
                    user('invalid-date', {
                        metadata: { lastRefreshTime: 'not-a-date' },
                    }),
                    user('future-date', {
                        metadata: {
                            lastSignInTime: beforeNow(2 * 24 * 60 * 60 * 1000),
                            lastRefreshTime: afterNow(60 * 60 * 1000),
                        },
                    }),
                ],
                pageToken: undefined,
            });

        mockCollection.mockReturnValue({
            count: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 100 }) }) }),
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    docs: [
                        {
                            ref: { path: 'customers/recent-refresh/subscriptions/sub-pro' },
                            data: () => ({ role: 'pro', created: 2, items: [{ plan: { interval: 'month' } }] }),
                        },
                        {
                            ref: { path: 'customers/newer-sign-in/subscriptions/sub-basic' },
                            data: () => ({ role: 'basic', created: 1, items: [{ plan: { interval: 'year' } }] }),
                        },
                    ],
                }),
            }),
            get: vi.fn().mockResolvedValue({ empty: true }),
        });

        const result = await invokeGetUserCount(getAdminRequest<UserCountRequest>());

        expect(result.authActivity).toEqual({
            last24Hours: 2,
            last7Days: 5,
            last30Days: 7,
            computedAt: now.toISOString(),
            byPlan: {
                free: { last24Hours: 1, last7Days: 3, last30Days: 5 },
                basic: { last24Hours: 0, last7Days: 1, last30Days: 1 },
                pro: { last24Hours: 1, last7Days: 1, last30Days: 1 },
            },
        });
        expect(mockListUsers).toHaveBeenNthCalledWith(1, 1000, undefined);
        expect(mockListUsers).toHaveBeenNthCalledWith(2, 1000, 'next-page');
    });
});
