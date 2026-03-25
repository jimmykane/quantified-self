import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';

// Mock dependencies using vi.hoisted for top-level access
const {
    mockGetUser,
    mockSetCustomUserClaims,
    mockRecursiveDelete,
    mockFirestoreInstance,
    mockAuthInstance
} = vi.hoisted(() => {
    const auth = {
        getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
        setCustomUserClaims: vi.fn().mockResolvedValue(undefined)
    };
    const fs: any = {
        collection: vi.fn(),
        doc: vi.fn(),
        recursiveDelete: vi.fn().mockResolvedValue(undefined),
    };
    fs.Timestamp = {
        now: () => ({
            toMillis: () => Date.now(),
            toDate: () => new Date(),
            toISOString: () => new Date().toISOString()
        }),
        fromDate: (d: Date) => ({
            toDate: () => d,
            toMillis: () => d.getTime(),
            toISOString: () => d.toISOString()
        })
    };
    fs.FieldValue = {
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        delete: () => 'DELETE_SENTINEL'
    };
    fs.FieldPath = {
        documentId: vi.fn(() => '__name__')
    };
    return {
        mockGetUser: auth.getUser,
        mockSetCustomUserClaims: auth.setCustomUserClaims,
        mockAuthInstance: auth,
        mockRecursiveDelete: fs.recursiveDelete,
        mockFirestoreInstance: fs
    };
});

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    const authMock = vi.fn(() => mockAuthInstance);
    const firestoreMock = vi.fn(() => mockFirestoreInstance);
    Object.assign(firestoreMock, mockFirestoreInstance);
    return {
        auth: authMock,
        firestore: firestoreMock
    };
});

// Mock firebase-functions
vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (opts: any, handler: any) => handler
}));

// Import AFTER mocks
import { enforceSubscriptionLimits } from './enforce-subscription-limits';
import * as OAuth2 from '../OAuth2';
import * as Claims from '../stripe/claims';

import { ServiceNames } from '@sports-alliance/sports-lib';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';

describe('enforceSubscriptionLimits', () => {
    let deauthorizeServiceSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockGetUser.mockResolvedValue({ customClaims: {} });
        deauthorizeServiceSpy = vi.spyOn(OAuth2, 'deauthorizeServiceForUser').mockResolvedValue(undefined);
        vi.spyOn(Claims, 'reconcileClaims').mockResolvedValue({ role: 'free' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Helper to create mock query results
    const mockQuery = (docs: any[], count = 0) => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
            empty: docs.length === 0,
            docs: docs,
            forEach: (cb: any) => docs.forEach(cb),
            data: () => ({ count })
        }),
        count: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ data: () => ({ count }) })
        })
    });

    // Helper to create mock documents
    const mockDoc = (data: any = {}) => ({
        get: vi.fn().mockResolvedValue({
            exists: Object.keys(data).length > 0,
            data: () => data
        }),
        set: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        ref: { id: 'mockId' }
    });

    const mockUserDoc = (id: string, data: any = {}) => ({
        id,
        data: () => data
    });

    it('should skip if no users are found in any token collection', async () => {
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === 'users') return mockQuery([]);
            return mockQuery([]);
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(mockFirestoreInstance.doc).not.toHaveBeenCalled();
    });

    it('should process connected-token users even when users/{uid} does not exist', async () => {
        const orphanSystemDoc = mockDoc({});

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'orphan1' }]);
            if (path === 'users') return mockQuery([]);
            if (path.includes('subscriptions')) return mockQuery([]);
            if (path.includes('events')) return mockQuery([], 0);
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/orphan1/system/status') return orphanSystemDoc;
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('orphan1', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('orphan1', ServiceNames.COROSAPI);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('orphan1', ServiceNames.GarminAPI);

        expect(orphanSystemDoc.set).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
        expect(Claims.reconcileClaims).not.toHaveBeenCalled();
    });

    it('should skip cleanup if user is within grace period', async () => {
        const futureDate = new Date(Date.now() + 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1')]);
            return mockQuery([]);
        });

        // Mock system doc fetch for grace period
        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(futureDate) });
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();

        // VERIFY: We now expect reconcileClaims to be called even if doc exists
        expect(Claims.reconcileClaims).toHaveBeenCalledWith('user1');
    });

    it('should handle reconcileClaims failures gracefully', async () => {
        const futureDate = new Date(Date.now() + 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }, { id: 'user2' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1'), mockUserDoc('user2')]);
            return mockQuery([]);
        });

        // Mock system docs
        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path.includes('system/status')) return mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(futureDate) });
            return mockDoc({});
        });

        // Make reconcileClaims fail for user1
        vi.spyOn(Claims, 'reconcileClaims')
            .mockRejectedValueOnce(new Error('Sync Error')) // user1 fail
            .mockResolvedValue({ role: 'free' });           // user2 pass

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        // Expect user2 to still be processed (Claims.reconcileClaims called twice)
        expect(Claims.reconcileClaims).toHaveBeenCalledTimes(2);
        expect(Claims.reconcileClaims).toHaveBeenCalledWith('user1');
        expect(Claims.reconcileClaims).toHaveBeenCalledWith('user2');

        // Verify logs contain error for user1 (implicitly handled by the catch block in the function)
    });

    it('should initialize grace period if missing (Fail-safe)', async () => {
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1')]);
            return mockQuery([]);
        });

        const systemDocSetSpy = vi.fn().mockResolvedValue({});
        const systemDocMock = {
            get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
            set: systemDocSetSpy,
            ref: { id: 'status' }
        };

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return systemDocMock;
            return mockDoc({});
        });



        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(mockFirestoreInstance.doc).toHaveBeenCalledWith('users/user1/system/status');
        expect(systemDocSetSpy).toHaveBeenCalledWith(expect.objectContaining({
            gracePeriodUntil: expect.anything(),
            lastDowngradedAt: 'SERVER_TIMESTAMP'
        }), { merge: true });

        // Verify reconcileClaims is called
        expect(Claims.reconcileClaims).toHaveBeenCalledWith('user1');
    });

    it('should disconnect and clear claims when grace period has expired (free user)', async () => {
        const pastDate = new Date(Date.now() - 100000);
        const systemDoc = mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) });

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1')]);
            if (path.includes('subscriptions')) return mockQuery([]); // No active subs = Free
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return systemDoc;
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        // Expect deauthorize calls
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.COROSAPI);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.GarminAPI);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'free' });
        expect(systemDoc.set).toHaveBeenCalledWith({
            gracePeriodUntil: 'DELETE_SENTINEL',
            lastDowngradedAt: 'DELETE_SENTINEL'
        }, { merge: true });
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
    });

    it('should disconnect basic users when grace period has expired', async () => {
        const pastDate = new Date(Date.now() - 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1', { hasSubscribedOnce: true })]);
            if (path.includes('subscriptions')) {
                // Return Basic subscription
                return mockQuery([{ data: () => ({ role: 'basic' }) }]);
            }
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') {
                return mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) });
            }
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        // Should disconnect because grace period expired (Basic is not Pro)
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.COROSAPI);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.GarminAPI);
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
    });

    it('should skip deauthorization and event cleanup for Pro users', async () => {
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1', { hasSubscribedOnce: true })]);
            if (path.includes('subscriptions')) {
                return mockQuery([{ data: () => ({ role: 'pro' }) }]);
            }
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation(() => mockDoc({}));

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(deauthorizeServiceSpy).not.toHaveBeenCalled();
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
    });

    it('should skip disconnect/claim rewrites for non-connected free users', async () => {
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === 'users') return mockQuery([mockUserDoc('user2')]);
            if (path.includes('subscriptions')) return mockQuery([]);
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user2/system/status') return mockDoc({});
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(deauthorizeServiceSpy).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
    });

    it('should initialize grace period for non-connected users with paid history and no active subscription', async () => {
        const systemDocSetSpy = vi.fn().mockResolvedValue({});
        const systemDocMock = {
            get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
            set: systemDocSetSpy,
            ref: { id: 'status' }
        };

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === 'users') return mockQuery([mockUserDoc('user3', { hasSubscribedOnce: true })]);
            if (path.includes('subscriptions')) return mockQuery([]);
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user3/system/status') return systemDocMock;
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(systemDocSetSpy).toHaveBeenCalledWith(expect.objectContaining({
            gracePeriodUntil: expect.anything(),
            lastDowngradedAt: 'SERVER_TIMESTAMP'
        }), { merge: true });
        expect(Claims.reconcileClaims).toHaveBeenCalledWith('user3');
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
        expect(deauthorizeServiceSpy).not.toHaveBeenCalled();
    });

    it('should paginate across users with document-id cursors', async () => {
        const startAfterSpy = vi.fn().mockReturnThis();
        const firstPageUsers = Array.from({ length: 500 }, (_, index) => mockUserDoc(`user${index}`));
        const secondPageUsers = [mockUserDoc('user500')];
        let userPageCalls = 0;

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === 'users') {
                return {
                    select: vi.fn().mockReturnThis(),
                    orderBy: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    startAfter: startAfterSpy,
                    get: vi.fn().mockImplementation(async () => {
                        userPageCalls += 1;
                        if (userPageCalls === 1) {
                            return {
                                empty: false,
                                docs: firstPageUsers,
                                forEach: (cb: any) => firstPageUsers.forEach(cb),
                                data: () => ({ count: 0 })
                            };
                        }

                        return {
                            empty: false,
                            docs: secondPageUsers,
                            forEach: (cb: any) => secondPageUsers.forEach(cb),
                            data: () => ({ count: 0 })
                        };
                    })
                };
            }
            if (path.includes('subscriptions')) return mockQuery([]);
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation(() => mockDoc({}));

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(startAfterSpy).toHaveBeenCalledTimes(1);
    });

    it('should not query events collection for over-limit free users', async () => {
        const pastDate = new Date(Date.now() - 100000);
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1', { hasSubscribedOnce: true })]);
            if (path.includes('subscriptions')) return mockQuery([]);
            if (path.includes('events')) throw new Error('events query should not be called');
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') {
                return mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) });
            }
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(mockRecursiveDelete).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully during user processing', async () => {
        // Setup 2 users, one fails
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }, { id: 'user2' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1'), mockUserDoc('user2')]);
            return mockQuery([]);
        });

        // Mock doc fetch to throw for user1
        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path.includes('user1')) throw new Error('Firestore Error');
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        // user2 should still process (triggering fail-safe setup as fallback for no data)
        expect(mockFirestoreInstance.doc).toHaveBeenCalledWith('users/user2/system/status');
    });

    it('should handle errors during deauthorization steps', async () => {
        const pastDate = new Date(Date.now() - 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1')]);
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation(() =>
            mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) })
        );

        // Make one deauth fail
        deauthorizeServiceSpy.mockImplementation(async (uid: string, service: string) => {
            if (service === ServiceNames.SuuntoApp) throw new Error('Deauth Error');
            return Promise.resolve();
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        // Should have called all deauths despite error
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.COROSAPI);
    });

    it('should continue when clearing grace-period state or claims fails', async () => {
        const pastDate = new Date(Date.now() - 100000);
        const systemDoc = {
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) })
            }),
            set: vi.fn().mockRejectedValue(new Error('system set failed')),
            update: vi.fn().mockResolvedValue({}),
            ref: { id: 'status' }
        };

        mockGetUser.mockRejectedValueOnce(new Error('auth getUser failed'));

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1', { hasSubscribedOnce: true })]);
            if (path.includes('subscriptions')) return mockQuery([]);
            if (path.includes('events')) return mockQuery([], 10);
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return systemDoc;
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(systemDoc.set).toHaveBeenCalled();
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.COROSAPI);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.GarminAPI);
    });

    it('should preserve unrelated claims while clearing subscription access', async () => {
        const pastDate = new Date(Date.now() - 100000);
        const systemDoc = mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) });

        mockGetUser.mockResolvedValue({
            customClaims: {
                admin: true,
                gracePeriodUntil: pastDate.getTime() + 1000,
                someOtherClaim: 'keep-me'
            }
        });

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1')]);
            if (path.includes('subscriptions')) return mockQuery([]);
            if (path.includes('events')) return mockQuery([], 10);
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return systemDoc;
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', {
            admin: true,
            someOtherClaim: 'keep-me',
            stripeRole: 'free'
        });
        expect(systemDoc.set).toHaveBeenCalledWith({
            gracePeriodUntil: 'DELETE_SENTINEL',
            lastDowngradedAt: 'DELETE_SENTINEL'
        }, { merge: true });
    });

    it('should fall back to empty claims when the auth user has no custom claims', async () => {
        const pastDate = new Date(Date.now() - 100000);
        const systemDoc = mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) });

        mockGetUser.mockResolvedValue({
            uid: 'user1'
        });

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1')]);
            if (path.includes('subscriptions')) return mockQuery([]);
            if (path.includes('events')) return mockQuery([], 10);
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return systemDoc;
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', {
            stripeRole: 'free'
        });
    });

    it('should continue deauthorization when COROS and Garmin deauth fail', async () => {
        const pastDate = new Date(Date.now() - 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path === 'users') return mockQuery([mockUserDoc('user1')]);
            if (path.includes('subscriptions')) return mockQuery([]);
            if (path.includes('events')) return mockQuery([], 10);
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') {
                return mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) });
            }
            return mockDoc({});
        });

        deauthorizeServiceSpy.mockImplementation(async (uid: string, service: string) => {
            if (service === ServiceNames.COROSAPI || service === ServiceNames.GarminAPI) {
                throw new Error(`Deauth Error: ${service}`);
            }

            return Promise.resolve();
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.COROSAPI);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.GarminAPI);
    });
});
