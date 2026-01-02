import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockSetCustomUserClaims = vi.fn();
const mockSet = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ set: mockSet });
const mockAuth = {
    setCustomUserClaims: mockSetCustomUserClaims,
    getUser: vi.fn().mockResolvedValue({ customClaims: {}, email: 'test@example.com' })
};

const mockGet = vi.fn();
const mockLimit = vi.fn().mockReturnValue({ get: mockGet });
const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockCollection = vi.fn().mockReturnValue({
    where: mockWhere,
    doc: mockDoc
});
const mockFirestore = {
    collection: mockCollection
};

vi.mock('firebase-admin', () => ({
    auth: () => mockAuth,
    firestore: () => mockFirestore,
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn(),
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));

// Mock Stripe Client
const { mockStripeInstance, mockStripeCustomersSearch, mockStripeSubscriptionsList, mockStripeProductsRetrieve } = vi.hoisted(() => {
    const search = vi.fn();
    const list = vi.fn();
    const retrieve = vi.fn();
    return {
        mockStripeCustomersSearch: search,
        mockStripeSubscriptionsList: list,
        mockStripeProductsRetrieve: retrieve,
        mockStripeInstance: {
            customers: { search },
            subscriptions: { list },
            products: { retrieve }
        }
    };
});

vi.mock('./client', () => ({
    getStripe: vi.fn().mockResolvedValue(mockStripeInstance)
}));

import { reconcileClaims } from './claims';

describe('reconcileClaims', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset chain
        mockWhere.mockReturnValue({ orderBy: mockOrderBy });
        mockOrderBy.mockReturnValue({ limit: mockLimit });
        mockLimit.mockReturnValue({ get: mockGet });

        // Default auth user
        mockAuth.getUser.mockResolvedValue({ customClaims: {}, email: 'test@example.com' });
    });

    it('should throw "not-found" if no active subscription exists locally or in Stripe', async () => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({ data: [] });

        await expect(reconcileClaims('user1')).rejects.toThrow('No active subscription found');
        expect(mockStripeCustomersSearch).toHaveBeenCalled();
    });

    it('should set claims based on role field (Local)', async () => {
        const expectedRole = 'pro';

        mockGet.mockResolvedValue({
            empty: false,
            docs: [{
                data: () => ({
                    status: 'active',
                    role: 'pro'
                })
            }]
        });

        const result = await reconcileClaims('user1');

        expect(result.role).toBe(expectedRole);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: expectedRole });
    });

    it('should restore from Stripe if local empty but found in Stripe by email', async () => {
        mockGet.mockResolvedValue({ empty: true });

        mockStripeCustomersSearch.mockResolvedValue({
            data: [{ id: 'cus_123' }]
        });

        mockStripeSubscriptionsList.mockResolvedValue({
            data: [{
                id: 'sub_123',
                metadata: { role: 'pro' },
                items: { data: [{ price: { product: 'prod_123' } }] }
            }]
        });

        const result = await reconcileClaims('user1');

        expect(result.role).toBe('pro');
        // Should update firestore link
        expect(mockDoc).toHaveBeenCalledWith('user1');
        expect(mockSet).toHaveBeenCalledWith({
            stripeId: 'cus_123',
            stripeLink: 'https://dashboard.stripe.com/customers/cus_123'
        }, { merge: true });

        // Should set claims
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', expect.objectContaining({ stripeRole: 'pro' }));
    });

    it('should throw failed-precondition if no firebaseRole OR role found', async () => {
        mockGet.mockResolvedValue({
            empty: false,
            docs: [{
                data: () => ({
                    status: 'active',
                    items: [{ price: { id: 'unknown_price' } }],
                    // No firebaseRole AND no role
                })
            }]
        });

        await expect(reconcileClaims('user1')).rejects.toThrow('Subscription found but no role defined in document');
    });
});
