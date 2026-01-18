import { onCall, HttpsError } from 'firebase-functions/v2/https'; // Ensure HttpsError is imported

// ... existing code ...

// ... existing code ...

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
    collection: mockCollection,
    doc: mockDoc
};

vi.mock('firebase-admin', () => {
    const firestoreFn = () => mockFirestore;

    firestoreFn.FieldValue = {
        serverTimestamp: vi.fn().mockReturnValue('SERVER_TIMESTAMP')
    };
    return {
        auth: () => mockAuth,
        firestore: firestoreFn,
    };
});

// Update mock to return the handler
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((optsOrHandler, handler) => {
        return handler || optsOrHandler;
    }),
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));

// Mock Stripe Client
const { mockStripeInstance, mockStripeCustomersSearch, mockStripeCustomersUpdate, mockStripeSubscriptionsList, mockStripeSubscriptionsUpdate, mockStripeProductsRetrieve } = vi.hoisted(() => {
    const search = vi.fn();
    const customersUpdate = vi.fn().mockResolvedValue({}); // Mocks stripe.customers.update
    const list = vi.fn();
    const subscriptionsUpdate = vi.fn().mockResolvedValue({}); // Mocks stripe.subscriptions.update
    const retrieve = vi.fn();
    return {
        mockStripeCustomersSearch: search,
        mockStripeCustomersUpdate: customersUpdate,
        mockStripeSubscriptionsList: list,
        mockStripeSubscriptionsUpdate: subscriptionsUpdate,
        mockStripeProductsRetrieve: retrieve,
        mockStripeInstance: {
            customers: { search, update: customersUpdate },
            subscriptions: { list, update: subscriptionsUpdate },
            products: { retrieve }
        }
    };
});

vi.mock('./client', () => ({
    getStripe: vi.fn().mockResolvedValue(mockStripeInstance)
}));

import { reconcileClaims, linkExistingStripeCustomer, restoreUserClaims } from './claims';

describe('reconcileClaims', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset chain
        mockWhere.mockReturnValue({ orderBy: mockOrderBy });
        mockOrderBy.mockReturnValue({ limit: mockLimit });
        mockLimit.mockReturnValue({ get: mockGet });

        // Explicitly reset collection mock to clear any mockImplementationOnce
        mockCollection.mockReset();
        mockCollection.mockReturnValue({ where: mockWhere, doc: mockDoc });

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

    it('should preserve existing custom claims', async () => {
        // Mock local sub found
        mockGet.mockResolvedValue({
            empty: false,
            docs: [{ data: () => ({ status: 'active', role: 'basic' }) }]
        });

        // Mock existing claims
        mockAuth.getUser.mockResolvedValue({
            customClaims: { admin: true, other: 'data' },
            email: 'test@example.com'
        });

        const result = await reconcileClaims('user1');

        expect(result.role).toBe('basic');
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', {
            admin: true,
            other: 'data',
            stripeRole: 'basic'
        });
    });



    it('should handle null custom claims gracefully', async () => {
        mockGet.mockResolvedValue({
            empty: false,
            docs: [{ data: () => ({ status: 'active', role: 'basic' }) }]
        });

        // Mock null claims
        mockAuth.getUser.mockResolvedValue({
            customClaims: null, // Specific null case finding
            email: 'test@example.com'
        });

        const result = await reconcileClaims('user1');

        expect(result.role).toBe('basic');
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'basic' });
    });

    it('should restore from Stripe if local empty but found in Stripe by email', async () => {
        mockGet.mockResolvedValue({ empty: true });

        mockStripeCustomersSearch.mockResolvedValue({
            data: [{ id: 'cus_123', email: 'test@example.com' }]
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
        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            stripeId: 'cus_123',
            stripeLink: 'https://dashboard.stripe.com/customers/cus_123',
            email: 'test@example.com'
        }), { merge: true });

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

    it('should fallback to product metadata if subscription metadata is missing role', async () => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({ data: [{ id: 'cus_123' }] });
        mockStripeSubscriptionsList.mockResolvedValue({
            data: [{
                id: 'sub_123',
                metadata: {}, // Empty
                items: { data: [{ price: { product: 'prod_fallback' } }] }
            }]
        });
        mockStripeProductsRetrieve.mockResolvedValue({
            id: 'prod_fallback',
            metadata: { role: 'basic' }
        });

        const result = await reconcileClaims('user1');
        expect(result.role).toBe('basic');
        expect(mockStripeProductsRetrieve).toHaveBeenCalledWith('prod_fallback');
    });
});

describe('linkExistingStripeCustomer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAuth.getUser.mockResolvedValue({ customClaims: {}, email: 'test@example.com' });
    });

    it('should throw unauthenticated error if no auth context', async () => {
        const req = { auth: null } as any;
        await expect((linkExistingStripeCustomer as any)(req)).rejects.toThrow('The function must be called while authenticated');
    });

    it('should return linked: false if user has no email', async () => {
        mockAuth.getUser.mockResolvedValue({ customClaims: {}, email: null });
        const req = { auth: { uid: 'userNoEmail' } } as any;

        const result = await (linkExistingStripeCustomer as any)(req);
        expect(result).toEqual({ linked: false });
    });

    it('should return linked: false if no Stripe customer found', async () => {
        mockStripeCustomersSearch.mockResolvedValue({ data: [] });
        const req = { auth: { uid: 'user1' } } as any;

        const result = await (linkExistingStripeCustomer as any)(req);
        expect(result).toEqual({ linked: false });
    });

    it('should return linked: true if customer with active subscription found', async () => {
        mockStripeCustomersSearch.mockResolvedValue({
            data: [{ id: 'cus_existing', email: 'test@example.com' }]
        });
        mockStripeSubscriptionsList.mockResolvedValue({
            data: [{
                id: 'sub_existing',
                metadata: { role: 'basic' },
                items: { data: [{ price: { product: 'prod_123' } }] }
            }]
        });

        const req = { auth: { uid: 'user1' } } as any;
        const result = await (linkExistingStripeCustomer as any)(req);
        expect(result).toEqual({ linked: true, role: 'basic' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', expect.objectContaining({ stripeRole: 'basic' }));
    });

    it('should handle internal errors gracefully by rethrowing generic HttpsError', async () => {
        mockAuth.getUser.mockRejectedValue(new Error('Auth Down'));
        const req = { auth: { uid: 'user1' } } as any;

        await expect((linkExistingStripeCustomer as any)(req)).rejects.toThrow('Auth Down');
    });

    it('should rethrow HttpsError as is', async () => {
        // Force HttpsError inside implementation.
        // E.g. unauthenticated is thrown at top, but we want one from deeper?
        // Actually the code catches HttpsError from findAndLinkStripeCustomerByEmail or others?
        // findAndLink... doesn't verify auth, but getUser does?
        // Let's mock getUser to throw HttpsError?
        const httpsError = new HttpsError('permission-denied', 'Test Error');
        mockAuth.getUser.mockRejectedValue(httpsError);

        const req = { auth: { uid: 'user1' } } as any;
        await expect((linkExistingStripeCustomer as any)(req)).rejects.toThrow('Test Error');
    });

    it('should use default error message if error has no message property', async () => {
        // Mock getUser to throw an empty object-like error (no message)
        mockAuth.getUser.mockRejectedValue({});

        const req = { auth: { uid: 'user1' } } as any;
        await expect((linkExistingStripeCustomer as any)(req)).rejects.toThrow('Failed to check for existing subscription');
    });
});

describe('restoreUserClaims', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAuth.getUser.mockResolvedValue({ customClaims: {}, email: 'test@example.com' });
    });

    it('should throw unauthenticated error if no auth context', async () => {
        const req = { auth: null } as any;
        await expect((restoreUserClaims as any)(req)).rejects.toThrow('The function must be called while authenticated');
    });

    it('should call reconcileClaims and return result', async () => {
        // Mock local sub found
        mockGet.mockResolvedValue({
            empty: false,
            docs: [{ data: () => ({ status: 'active', role: 'pro' }) }]
        });

        const req = { auth: { uid: 'user1' } } as any;
        const result = await (restoreUserClaims as any)(req);

        expect(result).toEqual({ success: true, role: 'pro' });
        expect(mockSetCustomUserClaims).toHaveBeenCalled();
    });

    it('should wrap unknown errors in HttpsError', async () => {
        // Mock get/limit chain to throw using mockImplementationOnce
        mockCollection.mockImplementationOnce(() => { throw new Error('DB Fail'); });

        const req = { auth: { uid: 'user1' } } as any;
        await expect((restoreUserClaims as any)(req)).rejects.toThrow('DB Fail');
    });

    it('should rethrow HttpsError as is', async () => {
        // Mock reconcileClaims to throw HttpsError
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({ data: [] });

        const req = { auth: { uid: 'user1' } } as any;
        await expect((restoreUserClaims as any)(req)).rejects.toThrow('No active subscription found');
    });

    it('should use default error message if error has no message property', async () => {
        // Mock to throw an object without message
        mockCollection.mockImplementationOnce(() => { throw {}; });

        const req = { auth: { uid: 'user1' } } as any;
        await expect((restoreUserClaims as any)(req)).rejects.toThrow('Failed to reconcile claims');
    });
});

// Mock for findAndLinkStripeCustomerByEmail coverage (No active sub found for existing customer)
describe('reconcileClaims (Complex Scenarios)', () => {
    it('should ignore Stripe customer if no active subscription found (findAndLink... return false)', async () => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({
            data: [{ id: 'cus_no_sub', email: 'test@example.com' }]
        });
        mockStripeSubscriptionsList.mockResolvedValue({ data: [] }); // No subs

        await expect(reconcileClaims('user1')).rejects.toThrow('No active subscription found');
    });

    it('should handle expanded product object in subscription item', async () => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({
            data: [{ id: 'cus_expanded' }]
        });
        mockStripeSubscriptionsList.mockResolvedValue({
            data: [{
                id: 'sub_expanded',
                metadata: {},
                items: {
                    data: [{
                        price: {
                            product: { id: 'prod_expanded', metadata: { role: 'pro' } } // Object, not string
                        }
                    }]
                }
            }]
        });

        // When product is expanded, we might verify we use its ID or metadata directly?
        // The code does: productId = ... ? product : product.id; 
        // Then await stripe.products.retrieve(productId).
        // If we provide the object, the code extracts ID.
        // THEN it calls retrieve. So we must mock retrieve to return the same metadata.
        mockStripeProductsRetrieve.mockResolvedValue({
            id: 'prod_expanded',
            metadata: { role: 'pro' }
        });

        const result = await reconcileClaims('user1');
        expect(result.role).toBe('pro');
        expect(mockStripeProductsRetrieve).toHaveBeenCalledWith('prod_expanded');
    });

    it('should use firebaseRole from product metadata if role is missing', async () => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({
            data: [{ id: 'cus_firebase_role' }]
        });
        mockStripeSubscriptionsList.mockResolvedValue({
            data: [{
                id: 'sub_firebase_role',
                metadata: {},
                items: {
                    data: [{
                        price: {
                            product: { id: 'prod_firebase_role', metadata: { firebaseRole: 'basic' } }
                        }
                    }]
                }
            }]
        });

        mockStripeProductsRetrieve.mockResolvedValue({
            id: 'prod_firebase_role',
            metadata: { firebaseRole: 'basic' }
        });

        // Also mock getUser with undefined customClaims to cover that branch
        mockAuth.getUser.mockResolvedValue({ customClaims: undefined, email: 'test@example.com' });

        const result = await reconcileClaims('user1');
        expect(result.role).toBe('basic');
        // Verify setCustomUserClaims was called with just stripeRole (merging undefined defaults to empty)
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'basic' });
    });
});


