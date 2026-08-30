import { describe, expect, it } from 'vitest';
import {
    adminUserMetricsTestInternals,
    getCanonicalSubscriptionIdentity,
    summarizeActivePaidSubscriptions,
    type SubscriptionDocumentSnapshotLike,
} from './shared/user-metrics';

function subscriptionDocument(
    path: string,
    data: Record<string, unknown>,
): SubscriptionDocumentSnapshotLike {
    return {
        ref: { path },
        data: () => data,
    };
}

describe('admin user metrics subscription provenance', () => {
    it('accepts only direct canonical Stripe subscription documents', () => {
        expect(getCanonicalSubscriptionIdentity(subscriptionDocument(
            'customers/user-1/subscriptions/sub-1',
            {},
        ))).toEqual({ ownerId: 'user-1', subscriptionId: 'sub-1' });

        expect(getCanonicalSubscriptionIdentity(subscriptionDocument(
            'garminAPITokens/user-1/tokens/token-1/subscriptions/forged',
            {},
        ))).toBeNull();
        expect(getCanonicalSubscriptionIdentity(subscriptionDocument(
            'customers/user-1/archive/subscriptions/sub-1',
            {},
        ))).toBeNull();
        expect(getCanonicalSubscriptionIdentity({ data: () => ({}) })).toBeNull();
    });

    it('ignores lookalikes and selects one latest active entitlement per owner', () => {
        const summary = summarizeActivePaidSubscriptions([
            subscriptionDocument(
                'garminAPITokens/attacker/tokens/token-1/subscriptions/forged',
                {
                    role: 'pro',
                    created: 1_900_000_000,
                    cancel_at_period_end: true,
                    items: [{ plan: { interval: 'month' } }],
                },
            ),
            subscriptionDocument(
                'customers/user-1/subscriptions/sub-old',
                {
                    role: 'pro',
                    created: 1_700_000_000,
                    cancel_at_period_end: true,
                    items: [{ plan: { interval: 'month' } }],
                },
            ),
            subscriptionDocument(
                'customers/user-1/subscriptions/sub-new',
                {
                    role: 'basic',
                    created: 1_800_000_000,
                    items: [{ price: { recurring: { interval: 'year' } } }],
                },
            ),
            subscriptionDocument(
                'customers/user-2/subscriptions/sub-pro',
                {
                    role: 'pro',
                    created: { seconds: 1_750_000_000 },
                    cancel_at_period_end: true,
                    items: [{ plan: { interval: 'week' } }],
                },
            ),
        ]);

        expect(summary).toEqual({
            pro: 1,
            basic: 1,
            monthlyPaid: 0,
            yearlyPaid: 1,
            subscriptionCadence: {
                pro: { monthly: 0, yearly: 0, unknown: 1 },
                basic: { monthly: 0, yearly: 1, unknown: 0 },
            },
            cancelScheduled: 2,
            ignoredNonCanonicalDocuments: 1,
            duplicateCanonicalDocuments: 1,
        });
    });

    it('breaks equal-created ties deterministically by subscription document ID', () => {
        const summary = summarizeActivePaidSubscriptions([
            subscriptionDocument(
                'customers/user-1/subscriptions/sub-a',
                {
                    role: 'pro',
                    created: 1_800_000_000,
                    items: [{ plan: { interval: 'month' } }],
                },
            ),
            subscriptionDocument(
                'customers/user-1/subscriptions/sub-b',
                {
                    role: 'basic',
                    created: 1_800_000_000,
                    items: [{ plan: { interval: 'year' } }],
                },
            ),
        ]);

        expect(summary.pro).toBe(0);
        expect(summary.basic).toBe(1);
        expect(summary.subscriptionCadence.basic.yearly).toBe(1);
    });

    it('does not let an unrecognized-role document mask a qualifying paid entitlement', () => {
        const summary = summarizeActivePaidSubscriptions([
            subscriptionDocument(
                'customers/user-1/subscriptions/sub-pro',
                {
                    role: 'pro',
                    created: 1_800_000_000,
                    items: [{ plan: { interval: 'month' } }],
                },
            ),
            subscriptionDocument(
                'customers/user-1/subscriptions/sub-unclassified',
                {
                    role: 'supporter',
                    created: 1_900_000_000,
                    cancel_at_period_end: true,
                    items: [{ plan: { interval: 'year' } }],
                },
            ),
        ]);

        expect(summary.pro).toBe(1);
        expect(summary.basic).toBe(0);
        expect(summary.subscriptionCadence.pro.monthly).toBe(1);
        expect(summary.cancelScheduled).toBe(1);
        expect(summary.duplicateCanonicalDocuments).toBe(0);
    });
});

describe('admin authentication activity plan breakdown', () => {
    it('classifies each activity window from the canonical subscription owner map', async () => {
        const computedAt = new Date('2026-08-26T12:00:00.000Z');
        const before = (days: number) => new Date(computedAt.getTime() - (days * 24 * 60 * 60 * 1000)).toISOString();
        const listUsers = async (_pageSize: number, pageToken?: string) => pageToken
            ? {
                users: [
                    {
                        uid: 'free-30d',
                        disabled: false,
                        customClaims: {},
                        metadata: { lastRefreshTime: before(20) },
                        providerData: [],
                    },
                ],
                pageToken: undefined,
            }
            : {
                users: [
                    {
                        uid: 'pro-24h',
                        disabled: false,
                        customClaims: {},
                        metadata: { lastRefreshTime: before(0.5) },
                        providerData: [],
                    },
                    {
                        uid: 'basic-7d',
                        disabled: false,
                        customClaims: {},
                        metadata: { lastSignInTime: before(3) },
                        providerData: [],
                    },
                    {
                        uid: 'free-7d',
                        disabled: false,
                        customClaims: {},
                        metadata: { lastRefreshTime: before(5) },
                        providerData: [],
                    },
                ],
                pageToken: 'page-2',
            };

        const result = await adminUserMetricsTestInternals.collectAuthenticationMetrics(
            { listUsers } as never,
            computedAt,
            Promise.resolve(new Map([
                ['pro-24h', 'pro' as const],
                ['basic-7d', 'basic' as const],
            ])),
        );

        expect(result.authActivity).toEqual({
            last24Hours: 1,
            last7Days: 3,
            last30Days: 4,
            computedAt: computedAt.toISOString(),
            byPlan: {
                free: { last24Hours: 0, last7Days: 1, last30Days: 2 },
                basic: { last24Hours: 0, last7Days: 1, last30Days: 1 },
                pro: { last24Hours: 1, last7Days: 1, last30Days: 1 },
            },
        });
        expect(result.eligibleAccounts).toBe(4);
    });
});
