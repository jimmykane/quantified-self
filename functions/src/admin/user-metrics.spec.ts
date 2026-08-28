import { describe, expect, it } from 'vitest';
import {
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
