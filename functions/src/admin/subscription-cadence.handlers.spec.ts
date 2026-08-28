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

describe('getUserCount subscription cadence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });
    });

    afterEach(() => {
        mockCollection.mockReset();
    });

    it('splits monthly, yearly, and unknown active subscriptions by paid tier', async () => {
        const countSnapshot = (count: number) => ({ data: () => ({ count }) });
        const countGet = (count: number) => vi.fn().mockResolvedValue(countSnapshot(count));
        const subscriptionDoc = (uid: string, subscriptionId: string, data: Record<string, unknown>) => ({
            ref: { path: `customers/${uid}/subscriptions/${subscriptionId}` },
            data: () => data,
        });
        const activeSubscriptionDocs = [
            subscriptionDoc('pro-monthly', 'sub-1', { role: 'pro', created: 1_700_000_001, items: [{ plan: { interval: 'month' } }] }),
            subscriptionDoc('pro-yearly', 'sub-2', { role: 'pro', created: 1_700_000_002, items: [{ price: { recurring: { interval: 'year' } } }] }),
            subscriptionDoc('pro-unknown', 'sub-3', { role: 'pro', created: 1_700_000_003, items: [{ plan: { interval: 'week' } }] }),
            subscriptionDoc('basic-monthly-1', 'sub-4', { role: 'basic', created: 1_700_000_004, items: [{ plan: { interval: 'month' } }] }),
            subscriptionDoc('basic-monthly-2', 'sub-5', { role: 'basic', created: 1_700_000_005, items: [{ price: { recurring: { interval: 'month' } } }] }),
            subscriptionDoc('basic-yearly', 'sub-6', { role: 'basic', created: 1_700_000_006, items: [{ plan: { interval: 'year' } }] }),
        ];
        const emptyCacheDoc = {
            get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
            set: vi.fn().mockResolvedValue(undefined),
        };

        mockCollection.mockImplementation((path: string) => {
            if (path === 'users') {
                return {
                    count: vi.fn().mockReturnValue({ get: countGet(8) }),
                    where: vi.fn().mockReturnValue({
                        count: vi.fn().mockReturnValue({ get: countGet(5) }),
                    }),
                };
            }

            if (path === 'subscriptions') {
                const where = vi.fn(() => query);
                const select = vi.fn().mockImplementation((...fields: string[]) => ({
                    get: vi.fn().mockResolvedValue({
                        docs: fields.includes('items') ? activeSubscriptionDocs : [],
                    }),
                }));
                const query = { where, select };
                return query;
            }

            if (path === 'adminStats') {
                return { doc: vi.fn().mockReturnValue(emptyCacheDoc) };
            }

            if (path === 'events' || path === 'routes') {
                return {
                    count: vi.fn().mockReturnValue({ get: countGet(path === 'events' ? 100 : 10) }),
                };
            }

            return {
                count: vi.fn().mockReturnValue({ get: countGet(0) }),
                where: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({ docs: [] }),
                }),
            };
        });

        const result = await invokeGetUserCount(getAdminRequest<UserCountRequest>());

        expect(result.monthlyPaid).toBe(3);
        expect(result.yearlyPaid).toBe(2);
        expect(result.subscriptionCadence).toEqual({
            pro: { monthly: 1, yearly: 1, unknown: 1 },
            basic: { monthly: 2, yearly: 1, unknown: 0 },
        });
        expect(result.subscriptionCadence.pro.monthly + result.subscriptionCadence.basic.monthly)
            .toBe(result.monthlyPaid);
        expect(result.subscriptionCadence.pro.yearly + result.subscriptionCadence.basic.yearly)
            .toBe(result.yearlyPaid);
    });
});
