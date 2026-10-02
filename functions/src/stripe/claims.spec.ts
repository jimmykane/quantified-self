import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

// Mock dependencies
const mockSetCustomUserClaims = vi.fn();
const mockSet = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockGetDoc = vi.fn();
let userExists = true;
let systemStatusData: Record<string, unknown> = {};
let deletionMarkerState: 'missing' | 'active' | 'expired' = 'missing';
let customerData: Record<string, unknown> = {};

const getDocSnapshot = (path?: string) => {
    if (path?.startsWith('userDeletionTombstones/')) {
        if (deletionMarkerState === 'missing') {
            return {
                exists: false,
                data: () => ({})
            };
        }

        return {
            exists: true,
            data: () => deletionMarkerState === 'expired'
                ? { expireAt: { toMillis: () => Date.now() - 1000 } }
                : { expireAt: { toMillis: () => Date.now() + 60_000 } }
        };
    }

    if (path?.includes('/system/status')) {
        return {
            exists: true,
            data: () => systemStatusData
        };
    }

    if (path?.startsWith('users/')) {
        return {
            exists: userExists,
            data: () => ({})
        };
    }

    if (path?.startsWith('customers/')) {
        return { exists: true, data: () => customerData };
    }

    return {
        exists: true,
        data: () => ({})
    };
};

const mockDoc = vi.fn((path?: string) => ({
    set: mockSet,
    get: () => mockGetDoc(path),
    update: mockUpdate,
    delete: mockDelete
}));
const mockAuth = {
    setCustomUserClaims: mockSetCustomUserClaims,
    getUser: vi.fn().mockResolvedValue({ customClaims: {}, email: 'test@example.com', emailVerified: true })
};

const mockCustomerOwnersGet = vi.fn();
const mockCustomerOwnersWhere = vi.fn().mockReturnValue({ get: mockCustomerOwnersGet });
const mockGet = vi.fn();
const mockLimit = vi.fn().mockReturnValue({ get: mockGet });
const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockRunTransaction = vi.fn();
const mockCollection = vi.fn((path?: string) => {
    if (path?.includes('subscriptions')) {
        return {
            where: mockWhere
        };
    }

    return {
        where: path === 'customers' ? mockCustomerOwnersWhere : mockWhere,
        doc: (id: string) => mockDoc(`${path}/${id}`)
    };
});
const mockFirestore = {
    collection: mockCollection,
    doc: mockDoc,
    runTransaction: mockRunTransaction
};

vi.mock('firebase-admin', () => {
    const firestoreFn = () => mockFirestore;

    return {
        auth: () => mockAuth,
        firestore: firestoreFn,
    };
});

vi.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        serverTimestamp: vi.fn().mockReturnValue('SERVER_TIMESTAMP')
    }
}));

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
const { mockStripeInstance, mockStripeCustomersSearch, mockStripeCustomersRetrieve, mockStripeCustomersUpdate, mockStripeSubscriptionsList, mockStripeSubscriptionsUpdate, mockStripeProductsRetrieve } = vi.hoisted(() => {
    const search = vi.fn();
    const customersRetrieve = vi.fn();
    const customersUpdate = vi.fn().mockResolvedValue({}); // Mocks stripe.customers.update
    const list = vi.fn();
    const subscriptionsUpdate = vi.fn().mockResolvedValue({}); // Mocks stripe.subscriptions.update
    const retrieve = vi.fn();
    return {
        mockStripeCustomersSearch: search,
        mockStripeCustomersRetrieve: customersRetrieve,
        mockStripeCustomersUpdate: customersUpdate,
        mockStripeSubscriptionsList: list,
        mockStripeSubscriptionsUpdate: subscriptionsUpdate,
        mockStripeProductsRetrieve: retrieve,
        mockStripeInstance: {
            customers: { search, retrieve: customersRetrieve, update: customersUpdate },
            subscriptions: { list, update: subscriptionsUpdate },
            products: { retrieve }
        }
    };
});

vi.mock('./client', () => ({
    getStripe: vi.fn().mockResolvedValue(mockStripeInstance)
}));

import { reconcileClaims, linkExistingStripeCustomer, restoreUserClaims } from './claims';

beforeEach(() => {
    vi.clearAllMocks();
    mockGetDoc.mockReset();
    mockRunTransaction.mockReset();
    userExists = true;
    systemStatusData = {};
    deletionMarkerState = 'missing';
    customerData = {};
    mockCustomerOwnersGet.mockReset().mockResolvedValue({ docs: [] });
    mockCustomerOwnersWhere.mockReturnValue({ get: mockCustomerOwnersGet });
    // Reset chain
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ get: mockGet });
    mockGetDoc.mockImplementation((path?: string) => Promise.resolve(getDocSnapshot(path)));
    mockRunTransaction.mockImplementation(async (updateFunction: (transaction: {
        get: (docRef: { get: () => Promise<unknown> }) => Promise<unknown>;
        set: (_docRef: unknown, data: unknown, options: unknown) => void;
        delete: (_docRef: unknown) => void;
    }) => Promise<unknown>) => updateFunction({
        get: (docRef) => docRef.get(),
        set: (_docRef, data, options) => {
            mockSet(data, options);
        },
        delete: (_docRef) => {
            mockDelete();
        }
    }));

    // Explicitly reset collection mock to clear any mockImplementationOnce
    mockCollection.mockReset();
    mockCollection.mockImplementation((path?: string) => {
        if (path?.includes('subscriptions')) {
            return {
                where: mockWhere
            };
        }

        return {
            where: path === 'customers' ? mockCustomerOwnersWhere : mockWhere,
            doc: (id: string) => mockDoc(`${path}/${id}`)
        };
    });

    // Default auth user
    mockAuth.getUser.mockReset().mockResolvedValue({ customClaims: {}, email: 'test@example.com', emailVerified: true });
    mockStripeCustomersSearch.mockReset().mockResolvedValue({ data: [] });
    mockStripeCustomersRetrieve.mockReset().mockResolvedValue({ id: 'cus_deleted', deleted: true });
    mockStripeCustomersUpdate.mockReset().mockResolvedValue({});
    mockStripeSubscriptionsUpdate.mockReset().mockResolvedValue({});
    mockStripeSubscriptionsList.mockReset().mockResolvedValue({ data: [] });
    mockStripeProductsRetrieve.mockReset().mockResolvedValue({ id: 'prod_123', metadata: { firebaseRole: 'pro' } });
});

describe('reconcileClaims', () => {
    it('should return "free" if no active subscription exists locally or in Stripe', async () => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({ data: [] });
        systemStatusData = {};

        const result = await reconcileClaims('user1');
        expect(result.role).toBe('free');
        expect(mockStripeCustomersSearch).toHaveBeenCalled();
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', expect.objectContaining({ stripeRole: 'free' }));
    });

    it('should skip claim reconciliation when the user is marked for deletion', async () => {
        deletionMarkerState = 'active';
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

        expect(result.role).toBe('free');
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
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
        expect(mockCollection).toHaveBeenCalledWith('customers');
        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            stripeId: 'cus_123',
            stripeLink: 'https://dashboard.stripe.com/customers/cus_123',
            email: 'test@example.com'
        }), { merge: true });

        // Should set claims
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', expect.objectContaining({ stripeRole: 'pro' }));
    });

    it('should skip users/{uid}/system/status reads and writes when users/{uid} is missing', async () => {
        mockGet.mockResolvedValue({
            empty: false,
            docs: [{
                data: () => ({
                    status: 'active',
                    role: 'basic'
                })
            }]
        });

        userExists = false;

        const result = await reconcileClaims('missingUser');

        expect(result.role).toBe('basic');
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('missingUser', { stripeRole: 'basic' });
        expect(mockGetDoc.mock.calls.map((call) => call[0])).not.toContain('users/missingUser/system/status');
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('should skip claimsUpdatedAt write when deletion starts before the final status write', async () => {
        mockGet.mockResolvedValue({
            empty: false,
            docs: [{
                data: () => ({
                    status: 'active',
                    role: 'basic'
                })
            }]
        });

        mockGetDoc
            .mockResolvedValueOnce({ exists: false, data: () => ({}) }) // initial deletion marker check
            .mockResolvedValueOnce({ exists: true, data: () => ({}) }) // users/{uid}
            .mockResolvedValueOnce({ exists: false, data: () => ({}) }) // pre-claims deletion marker check
            .mockResolvedValueOnce({ exists: true, data: () => ({}) }) // users/{uid}/system/status
            .mockResolvedValueOnce({ // transaction deletion marker check
                exists: true,
                data: () => ({ expireAt: { toMillis: () => Date.now() + 60_000 } })
            })
            .mockResolvedValueOnce({ exists: true, data: () => ({}) }); // transaction users/{uid}

        const result = await reconcileClaims('user1');

        expect(result.role).toBe('basic');
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'basic' });
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('should default to "free" role if no firebaseRole OR role found in subscription', async () => {
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
        systemStatusData = {};

        const result = await reconcileClaims('user1');
        expect(result.role).toBe('free');
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', expect.objectContaining({ stripeRole: 'free' }));
    });

    it('should fallback to product metadata if subscription metadata is missing role', async () => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({ data: [{ id: 'cus_123', email: 'test@example.com' }] });
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
    it('should throw unauthenticated error if no auth context', async () => {
        const req = { auth: null, app: { appId: 'test' } } as any;
        await expect((linkExistingStripeCustomer as any)(req)).rejects.toThrow('The function must be called while authenticated');
    });

    it('should throw failed-precondition error if no app context', async () => {
        const req = { auth: { uid: 'user1' }, app: null } as any;
        await expect((linkExistingStripeCustomer as any)(req)).rejects.toThrow('App Check verification failed.');
    });

    it('should return linked: false if user has no email', async () => {
        mockAuth.getUser.mockResolvedValue({ customClaims: {}, email: null });
        const req = { auth: { uid: 'userNoEmail' }, app: { appId: 'test' } } as any;

        const result = await (linkExistingStripeCustomer as any)(req);
        expect(result).toEqual({ linked: false });
    });

    it('should return linked: false if no Stripe customer found', async () => {
        mockStripeCustomersSearch.mockResolvedValue({ data: [] });
        const req = { auth: { uid: 'user1' }, app: { appId: 'test' } } as any;

        const result = await (linkExistingStripeCustomer as any)(req);
        expect(result).toEqual({ linked: false });
    });

    it('should return linked: true if customer with active subscription found', async () => {
        mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_123', metadata: { firebaseRole: 'basic' } });
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

        const req = { auth: { uid: 'user1' }, app: { appId: 'test' } } as any;
        const result = await (linkExistingStripeCustomer as any)(req);
        expect(result).toEqual({ linked: true, role: 'basic' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', expect.objectContaining({ stripeRole: 'basic' }));
    });

    it('should handle internal errors gracefully by rethrowing generic HttpsError', async () => {
        mockAuth.getUser.mockRejectedValue(new Error('Auth Down'));
        const req = { auth: { uid: 'user1' }, app: { appId: 'test' } } as any;

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

        const req = { auth: { uid: 'user1' }, app: { appId: 'test' } } as any;
        await expect((linkExistingStripeCustomer as any)(req)).rejects.toThrow('Test Error');
    });

    it('should use default error message if error has no message property', async () => {
        // Mock getUser to throw an empty object-like error (no message)
        mockAuth.getUser.mockRejectedValue({});

        const req = { auth: { uid: 'user1' }, app: { appId: 'test' } } as any;
        await expect((linkExistingStripeCustomer as any)(req)).rejects.toThrow('Failed to check for existing subscription');
    });
});

describe('restoreUserClaims', () => {
    it('should throw unauthenticated error if no auth context', async () => {
        const req = { auth: null, app: { appId: 'test' } } as any;
        await expect((restoreUserClaims as any)(req)).rejects.toThrow('The function must be called while authenticated');
    });

    it('should throw failed-precondition error if no app context', async () => {
        const req = { auth: { uid: 'user1' }, app: null } as any;
        await expect((restoreUserClaims as any)(req)).rejects.toThrow('App Check verification failed.');
    });

    it('should call reconcileClaims and return result', async () => {
        // Mock local sub found
        mockGet.mockResolvedValue({
            empty: false,
            docs: [{ data: () => ({ status: 'active', role: 'pro' }) }]
        });

        const req = { auth: { uid: 'user1' }, app: { appId: 'test' } } as any;
        const result = await (restoreUserClaims as any)(req);

        expect(result).toEqual({ success: true, role: 'pro' });
        expect(mockSetCustomUserClaims).toHaveBeenCalled();
    });

    it('should wrap unknown errors in HttpsError', async () => {
        // Mock get/limit chain to throw using mockImplementationOnce
        mockCollection.mockImplementationOnce(() => { throw new Error('DB Fail'); });

        const req = { auth: { uid: 'user1' }, app: { appId: 'test' } } as any;
        await expect((restoreUserClaims as any)(req)).rejects.toThrow('DB Fail');
    });

    it('should return "free" role via restoreUserClaims if no active subscription found', async () => {
        // Mock reconcileClaims to return 'free' (indirectly by mocking the database states it depends on)
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({ data: [] });
        systemStatusData = {};

        const req = { auth: { uid: 'user1' }, app: { appId: 'test' } } as any;
        const result = await (restoreUserClaims as any)(req);

        expect(result).toEqual({ success: true, role: 'free' });
    });

    it('should use default error message if error has no message property', async () => {
        // Mock to throw an object without message
        mockCollection.mockImplementationOnce(() => { throw {}; });

        const req = { auth: { uid: 'user1' }, app: { appId: 'test' } } as any;
        await expect((restoreUserClaims as any)(req)).rejects.toThrow('Failed to reconcile claims');
    });
});

// Mock for findAndLinkStripeCustomerByEmail coverage (No active sub found for existing customer)
describe('reconcileClaims (Complex Scenarios)', () => {
    it('should return "free" role if Stripe customer found but no active subscription', async () => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({
            data: [{ id: 'cus_no_sub', email: 'test@example.com' }]
        });
        mockStripeSubscriptionsList.mockResolvedValue({ data: [] }); // No subs
        systemStatusData = {};

        const result = await reconcileClaims('user1');
        expect(result.role).toBe('free');
    });

    it('should handle expanded product object in subscription item', async () => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({
            data: [{ id: 'cus_expanded', email: 'test@example.com' }]
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
            data: [{ id: 'cus_firebase_role', email: 'test@example.com' }]
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
        mockAuth.getUser.mockResolvedValue({ customClaims: undefined, email: 'test@example.com', emailVerified: true });

        const result = await reconcileClaims('user1');
        expect(result.role).toBe('basic');
        // Verify setCustomUserClaims was called with just stripeRole (merging undefined defaults to empty)
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'basic' });
    });
});

describe('Stripe email recovery ownership', () => {
    const request = {
        auth: { uid: 'user1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
        app: { appId: 'test' }
    };
    const customer = { id: 'cus_paid', email: 'test@example.com', metadata: {} };
    const subscription = { id: 'sub_paid', metadata: { role: 'pro' }, items: { data: [{ price: { product: 'prod_paid' } }] } };

    beforeEach(() => {
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersSearch.mockResolvedValue({ data: [customer] });
        mockStripeSubscriptionsList.mockResolvedValue({ data: [subscription] });
        mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_paid', metadata: { firebaseRole: 'pro' } });
    });

    const expectNoAcquisition = () => {
        expect(mockSet).not.toHaveBeenCalledWith(expect.objectContaining({ stripeId: expect.anything() }), expect.anything());
        expect(mockStripeCustomersUpdate).not.toHaveBeenCalled();
        expect(mockStripeSubscriptionsUpdate).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).not.toHaveBeenCalledWith('user1', expect.objectContaining({ stripeRole: 'pro' }));
    };

    it.each([false, undefined])('rejects email recovery when server emailVerified is %s, regardless of token/provider hints', async (emailVerified) => {
        mockAuth.getUser.mockResolvedValue({ email: 'test@example.com', emailVerified, customClaims: {} });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expect(await (restoreUserClaims as any)(request)).toEqual({ success: true, role: 'free' });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
        expect(mockStripeCustomersRetrieve).not.toHaveBeenCalled();
        expectNoAcquisition();
    });

    it('preserves local paid restoration for an unverified email', async () => {
        mockAuth.getUser.mockResolvedValue({ email: 'test@example.com', emailVerified: false, customClaims: {} });
        mockGet.mockResolvedValue({ empty: false, docs: [{ data: () => ({ role: 'pro', status: 'active' }) }] });

        expect(await (restoreUserClaims as any)(request)).toEqual({ success: true, role: 'pro' });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'pro' });
    });

    it('preserves grace claims when unverified email recovery is skipped', async () => {
        const gracePeriodUntil = Date.now() + 60_000;
        systemStatusData = { gracePeriodUntil: { toMillis: () => gracePeriodUntil } };
        mockAuth.getUser.mockResolvedValue({ email: 'test@example.com', emailVerified: false, customClaims: { admin: true } });

        expect(await reconcileClaims('user1')).toEqual({ role: 'free' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { admin: true, stripeRole: 'free', gracePeriodUntil });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
        expectNoAcquisition();
    });

    it.each([
        ['customer', { firebaseUID: 'other-user' }],
        ['customer', { linkedToUid: 'other-user' }],
        ['customer', { firebaseUID: 'user1', linkedToUid: 'other-user' }],
        ['customer', { firebaseUID: 'other-user', linkedToUid: 'user1' }],
        ['subscription', { firebaseUID: 'other-user' }],
        ['subscription', { linkedToUid: 'other-user' }],
        ['subscription', { firebaseUID: 'user1', linkedToUid: 'other-user' }],
        ['subscription', { firebaseUID: 'other-user', linkedToUid: 'user1' }],
    ])('rejects conflicting %s ownership %j', async (source, metadata) => {
        if (source === 'customer') {
            mockStripeCustomersSearch.mockResolvedValue({ data: [{ ...customer, metadata }] });
        } else {
            mockStripeSubscriptionsList.mockResolvedValue({ data: [{ ...subscription, metadata: { ...metadata, role: 'pro' } }] });
        }

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoAcquisition();
    });

    it('rejects a customer owned by another Firestore UID, even when the caller also appears in the query', async () => {
        mockCustomerOwnersGet.mockResolvedValue({ docs: [{ id: 'user1' }, { id: 'other-user' }] });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expect(mockCustomerOwnersWhere).toHaveBeenCalledWith('stripeId', '==', 'cus_paid');
        expectNoAcquisition();
    });

    it('does not overwrite the caller\'s different Stripe customer binding', async () => {
        customerData = { stripeId: 'cus_original' };

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoAcquisition();
    });

    it.each([null, 'someone-else@example.com'])('rejects a search result whose email is %s', async (email) => {
        mockStripeCustomersSearch.mockResolvedValue({ data: [{ ...customer, email }] });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expect(mockStripeSubscriptionsList).not.toHaveBeenCalled();
        expectNoAcquisition();
    });

    it('recovers an unbound legacy customer with a verified email', async () => {
        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'pro' });
        expect(mockStripeCustomersUpdate).toHaveBeenCalledWith('cus_paid', expect.objectContaining({
            metadata: expect.objectContaining({ firebaseUID: 'user1', linkedToUid: 'user1' })
        }));
        expect(mockStripeSubscriptionsUpdate).toHaveBeenCalledWith('sub_paid', expect.objectContaining({
            metadata: expect.objectContaining({ firebaseUID: 'user1', linkedToUid: 'user1' })
        }));
    });

    it('recovers the same UID with consistent existing bindings and case-insensitive email matching', async () => {
        const metadata = { firebaseUID: 'user1', linkedToUid: 'user1' };
        customerData = { stripeId: 'cus_paid' };
        mockCustomerOwnersGet.mockResolvedValue({ docs: [{ id: 'user1' }] });
        mockStripeCustomersSearch.mockResolvedValue({ data: [{ ...customer, email: 'TEST@example.com', metadata }] });
        mockStripeCustomersRetrieve.mockResolvedValue({ ...customer, email: 'TEST@example.com', metadata });
        mockStripeSubscriptionsList.mockResolvedValue({ data: [{ ...subscription, metadata: { ...metadata, role: 'pro' } }] });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'pro' });
    });

    it('does not link or rewrite Stripe metadata when no role can be resolved', async () => {
        mockStripeSubscriptionsList.mockResolvedValue({ data: [{ ...subscription, metadata: {} }] });
        mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_paid', metadata: {} });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoAcquisition();
    });

    it.each(['missing root', 'active deletion'])('does not acquire a customer for a user with %s', async (state) => {
        userExists = state !== 'missing root';
        deletionMarkerState = state === 'active deletion' ? 'active' : 'missing';

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoAcquisition();
    });

    it('fails closed if ownership reads fail', async () => {
        mockCustomerOwnersGet.mockRejectedValue(new Error('Ownership read failed'));

        await expect((linkExistingStripeCustomer as any)(request)).rejects.toThrow('Ownership read failed');
        expectNoAcquisition();
    });

    it('rechecks ownership on a transaction retry before any Stripe updates or claims', async () => {
        mockRunTransaction.mockImplementationOnce(async (updateFunction) => {
            await updateFunction({ get: (ref: { get: () => Promise<unknown> }) => ref.get(), set: vi.fn() });
            expect(mockStripeCustomersUpdate).not.toHaveBeenCalled();
            expect(mockStripeSubscriptionsUpdate).not.toHaveBeenCalled();
            expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
            mockCustomerOwnersGet.mockResolvedValue({ docs: [{ id: 'other-user' }] });
            return updateFunction({ get: (ref: { get: () => Promise<unknown> }) => ref.get(), set: mockSet });
        });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expect(mockCustomerOwnersGet).toHaveBeenCalledTimes(2);
        expectNoAcquisition();
    });
});

describe('UID-bound Stripe recovery', () => {
    const request = { auth: { uid: 'user1' }, app: { appId: 'test' } };
    const metadata = { firebaseUID: 'user1', linkedToUid: 'user1' };
    const customer = { id: 'cus_owned', email: 'previous-email@example.com', metadata };
    const subscription = { id: 'sub_owned', metadata: { ...metadata, role: 'pro' }, items: { data: [{ price: { product: 'prod_owned' } }] } };

    beforeEach(() => {
        mockAuth.getUser.mockResolvedValue({
            email: 'current-email@example.com', emailVerified: false,
            providerData: [{ providerId: 'github.com' }], customClaims: { stripeRole: 'pro', admin: true }
        });
        customerData = { stripeId: customer.id };
        mockGet.mockResolvedValue({ empty: true });
        mockCustomerOwnersGet.mockResolvedValue({ docs: [{ id: 'user1' }] });
        mockStripeCustomersRetrieve.mockResolvedValue(customer);
        mockStripeSubscriptionsList.mockResolvedValue({ data: [subscription] });
        mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_owned', metadata: { firebaseRole: 'pro' } });
    });

    const expectNoLinkChanges = () => {
        expect(mockSet).not.toHaveBeenCalledWith(expect.objectContaining({ stripeId: expect.anything() }), expect.anything());
        expect(mockStripeCustomersUpdate).not.toHaveBeenCalled();
        expect(mockStripeSubscriptionsUpdate).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    };

    it.each([false, undefined, true])('restores an owned Pro subscription with server emailVerified=%s when local synchronization is missing', async (emailVerified) => {
        mockAuth.getUser.mockResolvedValue({ email: 'current-email@example.com', emailVerified, customClaims: { admin: true } });

        expect(await (restoreUserClaims as any)(request)).toEqual({ success: true, role: 'pro' });
        expect(mockStripeCustomersRetrieve).toHaveBeenCalledWith('cus_owned');
        expect(mockStripeSubscriptionsList).toHaveBeenCalledWith({ customer: 'cus_owned', status: 'active', limit: 1 });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'pro', admin: true });
    });

    it('recovers the owned customer before checkout without using the unverified email', async () => {
        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'pro' });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
        expect(mockStripeCustomersRetrieve).toHaveBeenCalledWith('cus_owned');
    });

    it('recovers an existing binding when the Auth account has no email', async () => {
        mockAuth.getUser.mockResolvedValue({ email: null, emailVerified: false, customClaims: {} });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'pro' });
        expect(await (restoreUserClaims as any)(request)).toEqual({ success: true, role: 'pro' });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
    });

    it('accepts a server-owned binding with legacy metadata missing', async () => {
        mockStripeCustomersRetrieve.mockResolvedValue({ ...customer, metadata: {} });
        mockStripeSubscriptionsList.mockResolvedValue({ data: [{ ...subscription, metadata: { role: 'pro' } }] });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'pro' });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
    });

    it.each([
        ['customer', { firebaseUID: 'other-user', linkedToUid: 'user1' }],
        ['customer', { firebaseUID: 'user1', linkedToUid: 'other-user' }],
        ['subscription', { firebaseUID: 'other-user', linkedToUid: 'user1' }],
        ['subscription', { firebaseUID: 'user1', linkedToUid: 'other-user' }],
    ])('rejects a bound customer with conflicting %s metadata %j', async (source, conflictingMetadata) => {
        if (source === 'customer') {
            mockStripeCustomersRetrieve.mockResolvedValue({ ...customer, metadata: conflictingMetadata });
        } else {
            mockStripeSubscriptionsList.mockResolvedValue({ data: [{ ...subscription, metadata: { ...conflictingMetadata, role: 'pro' } }] });
        }

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoLinkChanges();
    });

    it('rejects a bound customer also assigned to another Firestore UID', async () => {
        mockCustomerOwnersGet.mockResolvedValue({ docs: [{ id: 'user1' }, { id: 'other-user' }] });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoLinkChanges();
    });

    it.each([undefined, 'cus_replacement'])('does not restore if the trusted binding becomes %s before the transaction', async (stripeId) => {
        let customerReads = 0;
        mockGetDoc.mockImplementation(async (path?: string) => {
            if (path === 'customers/user1') {
                customerReads += 1;
                return { exists: true, data: () => ({ stripeId: customerReads === 1 ? customer.id : stripeId }) };
            }
            return getDocSnapshot(path);
        });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoLinkChanges();
    });

    it('rejects a retrieved customer ID that differs from the trusted binding', async () => {
        mockStripeCustomersRetrieve.mockResolvedValue({ ...customer, id: 'cus_someone_else' });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expect(mockStripeSubscriptionsList).not.toHaveBeenCalled();
        expectNoLinkChanges();
    });

    it.each(['deleted', 'missing'])('skips a %s Stripe customer without falling back to email or failing background reconciliation', async (state) => {
        if (state === 'deleted') {
            mockStripeCustomersRetrieve.mockResolvedValue({ id: customer.id, deleted: true });
        } else {
            mockStripeCustomersRetrieve.mockRejectedValue({ code: 'resource_missing' });
        }

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoLinkChanges();
        expect(await reconcileClaims('user1')).toEqual({ role: 'free' });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
    });

    it('does not downgrade claims or try email matching when the bound Stripe lookup fails', async () => {
        mockStripeCustomersRetrieve.mockRejectedValue(new Error('Stripe unavailable'));

        await expect((restoreUserClaims as any)(request)).rejects.toThrow('Stripe unavailable');
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
        expectNoLinkChanges();
    });

    it('reconciles a bound customer without an active subscription to free', async () => {
        mockStripeSubscriptionsList.mockResolvedValue({ data: [] });

        expect(await (restoreUserClaims as any)(request)).toEqual({ success: true, role: 'free' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'free', admin: true });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
        expect(mockStripeCustomersUpdate).not.toHaveBeenCalled();
    });

    it.each(['missing root', 'active deletion'])('skips bound customer recovery with %s', async (state) => {
        userExists = state !== 'missing root';
        deletionMarkerState = state === 'active deletion' ? 'active' : 'missing';

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoLinkChanges();
    });

    it.each(['customer', 'subscription'])('does not grant claims after a %s update failure and permits a same-UID retry', async (source) => {
        const update = source === 'customer' ? mockStripeCustomersUpdate : mockStripeSubscriptionsUpdate;
        update.mockRejectedValueOnce(new Error('Stripe unavailable'));

        await expect((linkExistingStripeCustomer as any)(request)).rejects.toThrow('Stripe unavailable');
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'pro' });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
    });
});

describe('Stripe recovery entitlement authority', () => {
    const request = { auth: { uid: 'user1' }, app: { appId: 'test' } };
    const customer = { id: 'cus_buyer', email: 'test@example.com', metadata: { firebaseUID: 'user1' } };
    const subscription = {
        id: 'sub_basic', metadata: { firebaseUID: 'user1', role: 'pro' },
        items: { data: [{ price: { product: 'prod_basic' } }] }
    };

    beforeEach(() => {
        customerData = { stripeId: customer.id };
        mockAuth.getUser.mockResolvedValue({
            email: customer.email, emailVerified: false,
            providerData: [{ providerId: 'github.com' }], customClaims: { stripeRole: 'basic', admin: true }
        });
        mockGet.mockResolvedValue({ empty: true });
        mockStripeCustomersRetrieve.mockResolvedValue(customer);
        mockStripeCustomersSearch.mockResolvedValue({ data: [customer] });
        mockCustomerOwnersGet.mockResolvedValue({ docs: [{ id: 'user1' }] });
        mockStripeSubscriptionsList.mockResolvedValue({ data: [subscription] });
        mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_basic', metadata: { firebaseRole: 'basic' } });
    });

    const expectNoRecoveryChanges = () => {
        expect(mockSet).not.toHaveBeenCalledWith(expect.objectContaining({ stripeId: expect.anything() }), expect.anything());
        expect(mockStripeCustomersUpdate).not.toHaveBeenCalled();
        expect(mockStripeSubscriptionsUpdate).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    };

    describe.each(['bound UID', 'verified email'])('%s', (source) => {
        beforeEach(() => {
            if (source === 'verified email') {
                customerData = {};
                mockAuth.getUser.mockResolvedValue({ email: customer.email, emailVerified: true, customClaims: { admin: true } });
                mockCustomerOwnersGet.mockResolvedValue({ docs: [] });
            }
        });

        it.each([{ role: 'pro' }, { firebaseRole: 'pro' }, { role: 'pro', firebaseRole: 'pro' }, { role: 'admin' }])(
            'ignores caller-supplied subscription role %j when the purchased product is Basic', async (metadata) => {
                mockStripeSubscriptionsList.mockResolvedValue({ data: [{ ...subscription, metadata: { firebaseUID: 'user1', ...metadata } }] });

                expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'basic' });
                expect(mockStripeProductsRetrieve).toHaveBeenCalledWith('prod_basic');
                expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'basic', admin: true });
            }
        );
    });

    it('uses the product role through restoreUserClaims when local synchronization is missing', async () => {
        expect(await (restoreUserClaims as any)(request)).toEqual({ success: true, role: 'basic' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'basic', admin: true });
        expect(mockStripeCustomersSearch).not.toHaveBeenCalled();
    });

    it('keeps a local Basic entitlement when the pre-checkout callable sees forged Pro metadata', async () => {
        mockGet.mockResolvedValue({ empty: false, docs: [{ data: () => ({ status: 'active', role: 'basic' }) }] });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'basic' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'basic', admin: true });
    });

    it.each(['free', 'basic', 'pro'])('recovers the supported product role %s independently of subscription metadata', async (role) => {
        mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_basic', metadata: { firebaseRole: role } });
        mockStripeSubscriptionsList.mockResolvedValue({ data: [{ ...subscription, metadata: { firebaseUID: 'user1', role: 'free' } }] });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: role, admin: true });
    });

    it('retains the legacy product role alias', async () => {
        mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_basic', metadata: { role: 'basic' } });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'basic' });
    });

    it('prefers the extension canonical firebaseRole over a conflicting legacy product role', async () => {
        mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_basic', metadata: { firebaseRole: 'basic', role: 'pro' } });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'basic' });
    });

    it('does not use price metadata to override the extension product entitlement', async () => {
        mockStripeSubscriptionsList.mockResolvedValue({ data: [{
            ...subscription, items: { data: [{ price: { product: 'prod_basic', metadata: { firebaseRole: 'pro', role: 'pro' } } }] }
        }] });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: true, role: 'basic' });
    });

    it.each([{}, { firebaseRole: 'admin' }, { firebaseRole: 'admin', role: 'pro' }])(
        'does not acquire or grant access for missing or unsupported product role %j', async (metadata) => {
            mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_basic', metadata });

            expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
            expectNoRecoveryChanges();
        }
    );

    it('does not grant access from subscription metadata when there is no purchased product', async () => {
        mockStripeSubscriptionsList.mockResolvedValue({ data: [{ ...subscription, items: { data: [] } }] });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expect(mockStripeProductsRetrieve).not.toHaveBeenCalled();
        expectNoRecoveryChanges();
    });

    it('does not grant access for a deleted product', async () => {
        mockStripeProductsRetrieve.mockResolvedValue({ id: 'prod_basic', deleted: true });

        expect(await (linkExistingStripeCustomer as any)(request)).toEqual({ linked: false });
        expectNoRecoveryChanges();
    });

    it.each(['Stripe unavailable', 'No such product'])('preserves existing claims when product lookup fails: %s', async (message) => {
        mockStripeProductsRetrieve.mockRejectedValue(new Error(message));

        await expect((restoreUserClaims as any)(request)).rejects.toThrow(message);
        expectNoRecoveryChanges();
    });
});
