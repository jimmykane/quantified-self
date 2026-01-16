import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';

// Mock dependencies using vi.hoisted for top-level access
const {
    mockSetCustomUserClaims,
    mockRecursiveDelete,
    mockFirestoreInstance,
    mockAuthInstance
} = vi.hoisted(() => {
    const auth = {
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
    return {
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

import { ServiceNames } from '@sports-alliance/sports-lib';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';

describe('enforceSubscriptionLimits', () => {
    let deauthorizeServiceSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();

        deauthorizeServiceSpy = vi.spyOn(OAuth2, 'deauthorizeServiceForUser').mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Helper to create mock query results
    const mockQuery = (docs: any[], count = 0) => ({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
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

    it('should skip if no users are found in any token collection', async () => {
        mockFirestoreInstance.collection.mockReturnValue(mockQuery([]));

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(mockFirestoreInstance.doc).not.toHaveBeenCalled();
    });

    it('should skip cleanup if user is within grace period', async () => {
        const futureDate = new Date(Date.now() + 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
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
    });

    it('should initialize grace period if missing (Fail-safe)', async () => {
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
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
    });

    it('should disconnect and prune (Free user, limits exceeded)', async () => {
        const pastDate = new Date(Date.now() - 100000);

        // Setup User1: Free, 12 events (limit 10)
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            // single query for subs
            if (path.includes('subscriptions')) return mockQuery([]); // No active subs = Free
            if (path.includes('events')) {
                const docs = [
                    { id: 'event1', ref: { id: 'event1' } },
                    { id: 'event2', ref: { id: 'event2' } }
                ];
                return mockQuery(docs, 12);
            }
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) });
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        // Expect deauthorize calls
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.COROSAPI);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.GarminAPI);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'free' });

        // Verify pruning matches older events logic
        expect(mockRecursiveDelete).toHaveBeenCalledTimes(2);
    });

    it('should respect Basic limits (100 events)', async () => {
        const pastDate = new Date(Date.now() - 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path.includes('subscriptions')) {
                // Return Basic subscription
                return mockQuery([{ data: () => ({ role: 'basic' }) }]);
            }
            if (path.includes('events')) {
                // 105 events, limit 100
                const docs = Array(5).fill(0).map((_, i) => ({ id: `ev${i}`, ref: { id: `ev${i}` } }));
                return mockQuery(docs, 105);
            }
            return mockQuery([]);
        });

        // Basic users logic implies they are NOT pro, so if their grace period expires, they ALSO get disconnected?
        // Logic check: "if (!isPro) { ... disconnect ... }"
        // Yes, current code disconnects Basic users if they have no grace period.
        // We will give them a valid grace period to test ONLY pruning logic here.
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

        // Should prune excess 5 events (105 - 100)
        expect(mockRecursiveDelete).toHaveBeenCalledTimes(5);
    });

    it('should skip pruning for Pro users', async () => {
        // Pro users have limit = Infinity
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path.includes('subscriptions')) {
                return mockQuery([{ data: () => ({ role: 'pro' }) }]);
            }
            if (path.includes('events')) {
                // 1000 events
                return mockQuery([], 1000);
            }
            return mockQuery([]);
        });

        mockFirestoreInstance.doc.mockImplementation(() => mockDoc({})); // No system doc needed really

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        // Pro users are excluded from disconnect logic
        expect(deauthorizeServiceSpy).not.toHaveBeenCalled();
        // Limit infinity -> no pruning
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully during user processing', async () => {
        // Setup 2 users, one fails
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }, { id: 'user2' }]);
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
});
