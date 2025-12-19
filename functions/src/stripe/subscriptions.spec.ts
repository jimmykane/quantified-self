import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

// Mock dependencies using vi.hoisted to avoid initialization errors
const { mockReconcileClaims } = vi.hoisted(() => ({
    mockReconcileClaims: vi.fn()
}));

vi.mock('./claims', () => ({
    reconcileClaims: mockReconcileClaims
}));

// Mock firebase-functions BEFORE imports
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (opts: any, handler: any) => handler
}));

const testEnv = { cleanup: () => { } };

// Import AFTER mocks
import { onSubscriptionUpdated } from './subscriptions';

describe('onSubscriptionUpdated', () => {
    let firestoreSpy: any;
    let collectionSpy: any;
    let docSpy: any;
    let setSpy: any;
    let updateSpy: any;
    let getSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();

        setSpy = vi.fn().mockResolvedValue({} as any);
        updateSpy = vi.fn().mockResolvedValue({} as any);
        getSpy = vi.fn();

        docSpy = vi.fn().mockReturnValue({
            get: getSpy,
            set: setSpy,
            update: updateSpy
        });

        const mockQuery = (docs: any[]) => ({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                empty: docs.length === 0,
                docs: docs
            })
        });

        collectionSpy = vi.fn().mockImplementation((path: string) => {
            if (path.includes('subscriptions')) return mockQuery([]);
            return mockQuery([]);
        });

        firestoreSpy = vi.spyOn(admin, 'firestore').mockReturnValue({
            collection: collectionSpy,
            doc: docSpy,
        } as any);

        (admin.firestore as any).Timestamp = {
            fromDate: (date: Date) => ({ toDate: () => date }),
            now: () => ({ toMillis: () => Date.now() })
        };
        (admin.firestore as any).FieldValue = {
            delete: () => 'DELETE_SENTINEL',
            serverTimestamp: () => 'SERVER_TIMESTAMP'
        };
    });

    it('should set gracePeriodUntil if no active subscriptions and not already set', async () => {
        const uid = 'user123';
        const event = {
            params: { uid, subscriptionId: 'sub456' }
        } as any;

        // Mock reconcileClaims result
        mockReconcileClaims.mockResolvedValue({ role: 'free' });

        // Mock no active subscriptions
        collectionSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: true })
        });

        // Mock user doc (no grace period yet)
        getSpy.mockResolvedValue({
            exists: true,
            data: () => ({})
        });

        await onSubscriptionUpdated(event);

        expect(mockReconcileClaims).toHaveBeenCalledWith(uid);
        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            gracePeriodUntil: expect.anything(),
            lastDowngradedAt: 'SERVER_TIMESTAMP'
        }), { merge: true });
    });

    it('should NOT set gracePeriodUntil if already set', async () => {
        const uid = 'user123';
        const event = {
            params: { uid, subscriptionId: 'sub456' }
        } as any;

        mockReconcileClaims.mockResolvedValue({ role: 'free' });

        // No active subs
        collectionSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: true })
        });

        // User ALREADY has grace period
        getSpy.mockResolvedValue({
            exists: true,
            data: () => ({ gracePeriodUntil: new Date() })
        });

        await onSubscriptionUpdated(event);

        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should clear gracePeriodUntil if active subscription is found', async () => {
        const uid = 'user123';
        const event = {
            params: { uid, subscriptionId: 'sub456' }
        } as any;

        mockReconcileClaims.mockResolvedValue({ role: 'pro' });

        // ACTIVE sub found
        collectionSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: false })
        });

        await onSubscriptionUpdated(event);

        expect(updateSpy).toHaveBeenCalledWith({
            gracePeriodUntil: 'DELETE_SENTINEL',
            lastDowngradedAt: 'DELETE_SENTINEL'
        });

        // Should call reconcileClaims again to be sure
        expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
    });

    // --------------------------------------------------------------------------------
    // Email Trigger Tests
    // --------------------------------------------------------------------------------
    describe('Welcome Email Trigger', () => {
        let authSpy: any;
        let getUserSpy: any;

        beforeEach(() => {
            getUserSpy = vi.fn();
            authSpy = vi.spyOn(admin, 'auth').mockReturnValue({
                getUser: getUserSpy,
                setCustomUserClaims: vi.fn(),
            } as any);
        });

        it('should queue a welcome email if active subscription found and not already sent', async () => {
            const uid = 'user_email_test';
            const subId = 'sub_active_1';
            const event = { params: { uid, subscriptionId: subId } } as any;

            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            // Mock active subscription with firebaseRole
            collectionSpy.mockImplementation((path: string) => {
                if (path === `customers/${uid}/subscriptions`) {
                    return {
                        where: vi.fn().mockReturnThis(),
                        orderBy: vi.fn().mockReturnThis(),
                        limit: vi.fn().mockReturnThis(),
                        get: vi.fn().mockResolvedValue({
                            empty: false,
                            docs: [{
                                id: subId,
                                data: () => ({ firebaseRole: 'pro' })
                            }]
                        })
                    };
                }
                if (path === 'mail') {
                    // Mock mail collection check
                    return {
                        doc: (docId: string) => ({
                            get: vi.fn().mockResolvedValue({ exists: false }),
                            set: setSpy
                        })
                    };
                }
                return { where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ empty: true }) };
            });

            // Mock user email
            getUserSpy.mockResolvedValue({ email: 'test@example.com' });

            await onSubscriptionUpdated(event);

            // Expect mail set to be called
            expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
                to: 'test@example.com',
                template: expect.objectContaining({
                    name: 'welcome_email',
                    data: { role: 'pro' }
                })
            }));
        });

        it('should NOT queue email if it was already sent', async () => {
            const uid = 'user_email_sent';
            const subId = 'sub_active_2';
            const event = { params: { uid, subscriptionId: subId } } as any;

            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            collectionSpy.mockImplementation((path: string) => {
                if (path === `customers/${uid}/subscriptions`) {
                    return {
                        where: vi.fn().mockReturnThis(),
                        limit: vi.fn().mockReturnThis(),
                        get: vi.fn().mockResolvedValue({
                            empty: false,
                            docs: [{ id: subId, data: () => ({ firebaseRole: 'pro' }) }]
                        })
                    };
                }
                if (path === 'mail') {
                    return {
                        doc: (docId: string) => ({
                            get: vi.fn().mockResolvedValue({ exists: true }),
                            set: setSpy
                        })
                    };
                }
                return { doc: () => ({ get: vi.fn(), set: vi.fn() }) };
            });

            await onSubscriptionUpdated(event);

            // Expect mail set NOT to be called
            expect(setSpy).not.toHaveBeenCalled();
        });

        it('should NOT queue email if user has no email address', async () => {
            const uid = 'user_no_email';
            const subId = 'sub_active_3';
            const event = { params: { uid, subscriptionId: subId } } as any;

            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            collectionSpy.mockImplementation((path: string) => {
                if (path === `customers/${uid}/subscriptions`) {
                    return {
                        where: vi.fn().mockReturnThis(),
                        limit: vi.fn().mockReturnThis(),
                        get: vi.fn().mockResolvedValue({
                            empty: false,
                            docs: [{ id: subId, data: () => ({ firebaseRole: 'pro' }) }]
                        })
                    };
                }
                if (path === 'mail') {
                    return {
                        doc: () => ({
                            get: vi.fn().mockResolvedValue({ exists: false }),
                            set: setSpy
                        })
                    };
                }
                return { doc: () => ({ get: vi.fn(), set: vi.fn() }) };
            });

            getUserSpy.mockResolvedValue({ email: null });

            await onSubscriptionUpdated(event);

            expect(setSpy).not.toHaveBeenCalled();
        });
    });
});

