import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifyCheckoutSessionRequest } from '../../../shared/stripe-checkout-session';

type TestCallableRequest = {
    auth?: { uid: string };
    app?: { appId: string };
    data?: VerifyCheckoutSessionRequest;
};

const {
    mockCustomerDocGet,
    mockCollection,
    mockDoc,
    mockFirestore
} = vi.hoisted(() => {
    const customerDocGet = vi.fn();
    const doc = vi.fn().mockReturnValue({ get: customerDocGet });
    const collection = vi.fn().mockReturnValue({ doc });
    const firestore = vi.fn().mockReturnValue({ collection });

    return {
        mockCustomerDocGet: customerDocGet,
        mockCollection: collection,
        mockDoc: doc,
        mockFirestore: firestore
    };
});

const { mockRetrieveSession, mockStripeInstance } = vi.hoisted(() => {
    const retrieveSession = vi.fn();
    return {
        mockRetrieveSession: retrieveSession,
        mockStripeInstance: {
            checkout: {
                sessions: {
                    retrieve: retrieveSession
                }
            }
        }
    };
});

vi.mock('firebase-admin', () => ({
    firestore: mockFirestore
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

vi.mock('firebase-functions/logger', () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
}));

vi.mock('./client', () => ({
    getStripe: vi.fn().mockResolvedValue(mockStripeInstance)
}));

import { verifyCheckoutSession } from './verify-checkout-session';

const baseRequest: TestCallableRequest = {
    auth: { uid: 'user_123' },
    app: { appId: 'app-check-token' },
    data: { sessionId: 'cs_test_verified123' }
};

describe('verifyCheckoutSession', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCustomerDocGet.mockResolvedValue({
            data: () => ({ stripeId: 'cus_user_123' })
        });
        mockRetrieveSession.mockResolvedValue({
            id: 'cs_test_verified123',
            mode: 'payment',
            status: 'complete',
            payment_status: 'paid',
            metadata: { firebaseUID: 'user_123' },
            customer: 'cus_user_123',
            amount_total: 4999,
            currency: 'eur',
            line_items: {
                data: [{
                    price: {
                        id: 'price_lifetime',
                        currency: 'eur',
                        metadata: {},
                        product: {
                            id: 'prod_lifetime',
                            metadata: { role: 'pro' }
                        }
                    }
                }]
            }
        });
    });

    it('should throw unauthenticated when called without auth', async () => {
        const handler = verifyCheckoutSession as unknown as (req: TestCallableRequest) => Promise<unknown>;

        await expect(handler({ app: baseRequest.app, data: baseRequest.data }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockRetrieveSession).not.toHaveBeenCalled();
    });

    it('should throw failed-precondition when App Check is missing', async () => {
        const handler = verifyCheckoutSession as unknown as (req: TestCallableRequest) => Promise<unknown>;

        await expect(handler({ auth: baseRequest.auth, data: baseRequest.data }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockRetrieveSession).not.toHaveBeenCalled();
    });

    it('should return server-derived purchase analytics fields for a paid payment checkout', async () => {
        const handler = verifyCheckoutSession as unknown as (req: TestCallableRequest) => Promise<unknown>;

        const result = await handler(baseRequest);

        expect(result).toEqual({
            verified: true,
            transactionId: 'cs_test_verified123',
            mode: 'payment',
            isTrialCheckout: false,
            priceId: 'price_lifetime',
            currency: 'EUR',
            value: 49.99,
            role: 'pro'
        });
        expect(mockRetrieveSession).toHaveBeenCalledWith('cs_test_verified123', {
            expand: ['line_items.data.price.product']
        });
        expect(mockCollection).not.toHaveBeenCalled();
    });

    it('should reject a complete Checkout session that belongs to another Firebase user', async () => {
        mockRetrieveSession.mockResolvedValueOnce({
            id: 'cs_test_otheruser',
            mode: 'payment',
            status: 'complete',
            payment_status: 'paid',
            metadata: { firebaseUID: 'other_user' },
            customer: 'cus_other_user',
            amount_total: 4999,
            currency: 'eur',
            line_items: {
                data: [{
                    price: {
                        id: 'price_lifetime',
                        product: {
                            metadata: { role: 'pro' }
                        }
                    }
                }]
            }
        });

        const handler = verifyCheckoutSession as unknown as (req: TestCallableRequest) => Promise<unknown>;

        await expect(handler({
            ...baseRequest,
            data: { sessionId: 'cs_test_otheruser' }
        })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockCollection).not.toHaveBeenCalled();
        expect(mockDoc).not.toHaveBeenCalled();
    });

    it('should not let customer fallback override an explicit Firebase UID mismatch', async () => {
        mockRetrieveSession.mockResolvedValueOnce({
            id: 'cs_test_explicituidmismatch',
            mode: 'payment',
            status: 'complete',
            payment_status: 'paid',
            metadata: { firebaseUID: 'other_user' },
            customer: 'cus_user_123',
            amount_total: 4999,
            currency: 'eur'
        });

        const handler = verifyCheckoutSession as unknown as (req: TestCallableRequest) => Promise<unknown>;

        await expect(handler({
            ...baseRequest,
            data: { sessionId: 'cs_test_explicituidmismatch' }
        })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockCollection).not.toHaveBeenCalled();
        expect(mockDoc).not.toHaveBeenCalled();
    });

    it('should allow ownership through the mirrored Stripe customer id when session metadata is absent', async () => {
        mockRetrieveSession.mockResolvedValueOnce({
            id: 'cs_test_subscription123',
            mode: 'subscription',
            status: 'complete',
            payment_status: 'paid',
            metadata: {},
            customer: 'cus_user_123',
            amount_total: 999,
            currency: 'usd',
            line_items: {
                data: [{
                    price: {
                        id: 'price_basic_monthly',
                        metadata: { firebaseRole: 'basic' },
                        product: {
                            metadata: {}
                        }
                    }
                }]
            }
        });

        const handler = verifyCheckoutSession as unknown as (req: TestCallableRequest) => Promise<unknown>;

        const result = await handler({
            ...baseRequest,
            data: { sessionId: 'cs_test_subscription123' }
        });

        expect(result).toEqual({
            verified: true,
            transactionId: 'cs_test_subscription123',
            mode: 'subscription',
            isTrialCheckout: false,
            priceId: 'price_basic_monthly',
            currency: 'USD',
            value: 9.99,
            role: 'basic'
        });
    });

    it('should verify but mark no-card subscription trials so analytics can suppress purchase logging', async () => {
        mockRetrieveSession.mockResolvedValueOnce({
            id: 'cs_test_trial123',
            mode: 'subscription',
            status: 'complete',
            payment_status: 'no_payment_required',
            metadata: { firebaseUID: 'user_123' },
            customer: 'cus_user_123',
            amount_total: 0,
            currency: 'eur',
            line_items: {
                data: [{
                    price: {
                        id: 'price_pro_trial',
                        product: {
                            metadata: { role: 'pro' }
                        }
                    }
                }]
            }
        });

        const handler = verifyCheckoutSession as unknown as (req: TestCallableRequest) => Promise<unknown>;

        const result = await handler({
            ...baseRequest,
            data: { sessionId: 'cs_test_trial123' }
        });

        expect(result).toMatchObject({
            verified: true,
            transactionId: 'cs_test_trial123',
            mode: 'subscription',
            isTrialCheckout: true,
            value: 0
        });
    });

    it('should reject incomplete or unpaid checkout sessions', async () => {
        mockRetrieveSession.mockResolvedValueOnce({
            id: 'cs_test_unpaid123',
            mode: 'payment',
            status: 'open',
            payment_status: 'unpaid',
            metadata: { firebaseUID: 'user_123' },
            amount_total: 4999,
            currency: 'eur'
        });

        const handler = verifyCheckoutSession as unknown as (req: TestCallableRequest) => Promise<unknown>;

        await expect(handler({
            ...baseRequest,
            data: { sessionId: 'cs_test_unpaid123' }
        })).rejects.toMatchObject({ code: 'failed-precondition' });
    });
});
