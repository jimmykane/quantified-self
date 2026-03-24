import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallableRequest } from 'firebase-functions/v2/https';

const {
    mockGet,
    mockLimit,
    mockOrderBy,
    mockWhere,
    mockCollection,
    mockFirestore
} = vi.hoisted(() => {
    const get = vi.fn();
    const limit = vi.fn().mockReturnValue({ get });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const collection = vi.fn().mockReturnValue({ where });
    const firestore = vi.fn().mockReturnValue({ collection });

    return {
        mockGet: get,
        mockLimit: limit,
        mockOrderBy: orderBy,
        mockWhere: where,
        mockCollection: collection,
        mockFirestore: firestore
    };
});

const { mockStripeInstance, mockRetrieveUpcoming, mockCreatePreview, mockRetrieveSubscription } = vi.hoisted(() => {
    const retrieveUpcoming = vi.fn();
    const createPreview = vi.fn();
    const retrieveSubscription = vi.fn();
    return {
        mockCreatePreview: createPreview,
        mockRetrieveUpcoming: retrieveUpcoming,
        mockRetrieveSubscription: retrieveSubscription,
        mockStripeInstance: {
            invoices: {
                createPreview,
                retrieveUpcoming
            },
            subscriptions: {
                retrieve: retrieveSubscription
            }
        }
    };
});

vi.mock('firebase-admin', () => ({
    firestore: mockFirestore,
    auth: () => ({})
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: unknown) => handler,
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));

vi.mock('./client', () => ({
    getStripe: vi.fn().mockResolvedValue(mockStripeInstance)
}));

import { getUpcomingRenewalAmount } from './get-upcoming-renewal-amount';

const baseRequest = {
    auth: {
        uid: 'user_123'
    },
    app: {
        appId: 'app-check-token'
    }
} as CallableRequest;

describe('getUpcomingRenewalAmount', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'sub_123',
                    data: () => ({})
                }
            ]
        });
        (mockStripeInstance.invoices as { createPreview: typeof mockCreatePreview }).createPreview = mockCreatePreview;
        (mockStripeInstance.invoices as { retrieveUpcoming: typeof mockRetrieveUpcoming }).retrieveUpcoming = mockRetrieveUpcoming;

        mockCreatePreview.mockResolvedValue({
            amount_due: 2500,
            currency: 'usd'
        });
        mockRetrieveSubscription.mockResolvedValue({
            discount: null
        });
        mockRetrieveUpcoming.mockResolvedValue({
            amount_due: 2500,
            currency: 'usd'
        });
    });

    it('should throw unauthenticated when called without auth', async () => {
        const handler = getUpcomingRenewalAmount as unknown as (req: Partial<CallableRequest>) => Promise<unknown>;
        await expect(handler({ app: { appId: 'test' } })).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw failed-precondition when app check is missing', async () => {
        const handler = getUpcomingRenewalAmount as unknown as (req: Partial<CallableRequest>) => Promise<unknown>;
        await expect(handler({ auth: { uid: 'user_123' } })).rejects.toThrow('App Check verification failed.');
    });

    it('should return no_upcoming_charge when user has no active or trialing subscriptions', async () => {
        mockGet.mockResolvedValueOnce({
            empty: true,
            docs: []
        });

        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(baseRequest);

        expect(result).toEqual({ status: 'no_upcoming_charge' });
        expect(mockRetrieveUpcoming).not.toHaveBeenCalled();
    });

    it('should return ready with amountMinor and currency when Stripe upcoming invoice exists', async () => {
        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(baseRequest);

        expect(result).toEqual({
            status: 'ready',
            amountMinor: 2500,
            currency: 'USD'
        });
        expect(mockCreatePreview).toHaveBeenCalledWith({
            subscription: 'sub_123'
        });
        expect(mockRetrieveUpcoming).not.toHaveBeenCalled();
        expect(mockCollection).toHaveBeenCalledWith('customers/user_123/subscriptions');
        expect(mockWhere).toHaveBeenCalledWith('status', 'in', ['active', 'trialing']);
        expect(mockOrderBy).toHaveBeenCalledWith('created', 'desc');
        expect(mockLimit).toHaveBeenCalledWith(25);
    });

    it('should return subtotal as next payment amount when upcoming invoice is fully discounted and subscription has no long-running discount', async () => {
        mockCreatePreview.mockResolvedValueOnce({
            amount_due: 0,
            subtotal: 399,
            currency: 'eur'
        });
        mockRetrieveSubscription.mockResolvedValueOnce({
            discount: null
        });

        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(baseRequest);

        expect(result).toEqual({
            status: 'ready',
            amountMinor: 399,
            currency: 'EUR'
        });
        expect(mockRetrieveSubscription).toHaveBeenCalledWith('sub_123', {
            expand: ['discount.coupon']
        });
    });

    it('should keep zero amount when a long-running discount exists', async () => {
        mockCreatePreview.mockResolvedValueOnce({
            amount_due: 0,
            subtotal: 399,
            currency: 'eur'
        });
        mockRetrieveSubscription.mockResolvedValueOnce({
            discount: {
                coupon: {
                    duration: 'repeating'
                }
            }
        });

        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(baseRequest);

        expect(result).toEqual({
            status: 'ready',
            amountMinor: 0,
            currency: 'EUR'
        });
    });

    it('should return unavailable when no resolvable Stripe subscription id exists', async () => {
        mockGet.mockResolvedValueOnce({
            empty: false,
            docs: [
                {
                    id: 'not_a_stripe_subscription_id',
                    data: () => ({})
                }
            ]
        });

        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(baseRequest);

        expect(result).toEqual({ status: 'unavailable' });
        expect(mockCreatePreview).not.toHaveBeenCalled();
        expect(mockRetrieveUpcoming).not.toHaveBeenCalled();
    });

    it('should choose latest period end when created timestamps are tied', async () => {
        mockGet.mockResolvedValueOnce({
            empty: false,
            docs: [
                {
                    id: 'sub_older_period',
                    data: () => ({
                        created: new Date('2026-01-01T00:00:00Z'),
                        current_period_end: new Date('2026-02-01T00:00:00Z')
                    })
                },
                {
                    id: 'sub_newer_period',
                    data: () => ({
                        created: new Date('2026-01-01T00:00:00Z'),
                        current_period_end: new Date('2026-03-01T00:00:00Z')
                    })
                }
            ]
        });

        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        await handler(baseRequest);

        expect(mockCreatePreview).toHaveBeenCalledWith({
            subscription: 'sub_newer_period'
        });
    });

    it('should choose lexicographically higher subscription id when created and period end are tied', async () => {
        mockGet.mockResolvedValueOnce({
            empty: false,
            docs: [
                {
                    id: 'sub_aaa',
                    data: () => ({
                        created: new Date('2026-01-01T00:00:00Z'),
                        current_period_end: new Date('2026-03-01T00:00:00Z')
                    })
                },
                {
                    id: 'sub_zzz',
                    data: () => ({
                        created: new Date('2026-01-01T00:00:00Z'),
                        current_period_end: new Date('2026-03-01T00:00:00Z')
                    })
                }
            ]
        });

        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        await handler(baseRequest);

        expect(mockCreatePreview).toHaveBeenCalledWith({
            subscription: 'sub_zzz'
        });
    });

    it('should fallback to retrieveUpcoming when createPreview is unavailable', async () => {
        (mockStripeInstance.invoices as { createPreview?: typeof mockCreatePreview }).createPreview = undefined;

        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(baseRequest);

        expect(result).toEqual({
            status: 'ready',
            amountMinor: 2500,
            currency: 'USD'
        });
        expect(mockRetrieveUpcoming).toHaveBeenCalledWith({
            subscription: 'sub_123'
        });
    });

    it('should return no_upcoming_charge when Stripe reports no upcoming invoice', async () => {
        mockCreatePreview.mockRejectedValueOnce({
            code: 'invoice_upcoming_none',
            message: 'No upcoming invoice available'
        });

        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(baseRequest);

        expect(result).toEqual({ status: 'no_upcoming_charge' });
    });

    it('should return unavailable when Stripe upcoming invoice retrieval fails unexpectedly', async () => {
        mockCreatePreview.mockRejectedValueOnce(new Error('Stripe API unavailable'));

        const handler = getUpcomingRenewalAmount as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(baseRequest);

        expect(result).toEqual({ status: 'unavailable' });
    });
});
