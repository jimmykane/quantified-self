import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

// Mock dependencies using vi.hoisted to avoid initialization errors
const { mockReconcileClaims, mockCheckAndSendEmails, mockLogger } = vi.hoisted(() => ({
    mockReconcileClaims: vi.fn(),
    mockCheckAndSendEmails: vi.fn(),
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

vi.mock('./claims', () => ({
    reconcileClaims: mockReconcileClaims
}));

vi.mock('./email-triggers', () => ({
    checkAndSendSubscriptionEmails: mockCheckAndSendEmails
}));

vi.mock('firebase-functions/logger', () => mockLogger);

// Mock firebase-functions BEFORE imports
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (opts: unknown, handler: unknown) => handler
}));

// Import AFTER mocks
import { onSubscriptionUpdated } from './subscriptions';

describe('onSubscriptionUpdated', () => {
    let firestoreSpy: ReturnType<typeof vi.spyOn>;
    let collectionSpy: ReturnType<typeof vi.fn>;
    let docSpy: ReturnType<typeof vi.fn>;
    let setSpy: ReturnType<typeof vi.fn>;
    let updateSpy: ReturnType<typeof vi.fn>;
    let getSpy: ReturnType<typeof vi.fn>;
    let authSpy: ReturnType<typeof vi.spyOn>;

    const createMockEvent = (uid: string, subscriptionId: string, beforeData?: unknown, afterData?: unknown) => ({
        id: `evt_${Date.now()}`,
        params: { uid, subscriptionId },
        data: beforeData || afterData ? {
            before: { data: () => beforeData },
            after: { data: () => afterData }
        } : undefined
    });

    const setupUserExists = (exists: boolean, userData?: Record<string, unknown>) => {
        // First call is for user doc check, subsequent calls may be for system/status
        getSpy.mockImplementation(() => Promise.resolve({
            exists,
            data: () => userData || {}
        }));
    };

    const setupSubscriptionsQuery = (hasActiveSubscription: boolean) => {
        collectionSpy.mockImplementation((path: string) => {
            if (path.includes('subscriptions')) {
                return {
                    where: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({
                        empty: !hasActiveSubscription,
                        docs: hasActiveSubscription ? [{ id: 'sub_123' }] : []
                    })
                };
            }
            return {
                doc: docSpy
            };
        });
    };

    beforeEach(() => {
        vi.clearAllMocks();

        setSpy = vi.fn().mockResolvedValue({});
        updateSpy = vi.fn().mockResolvedValue({});
        getSpy = vi.fn();

        docSpy = vi.fn().mockReturnValue({
            get: getSpy,
            set: setSpy,
            update: updateSpy
        });

        collectionSpy = vi.fn().mockImplementation((path: string) => {
            if (path.includes('subscriptions')) {
                return {
                    where: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
                };
            }
            return { doc: docSpy };
        });

        firestoreSpy = vi.spyOn(admin, 'firestore').mockReturnValue({
            collection: collectionSpy,
            doc: docSpy,
        } as unknown as admin.firestore.Firestore);

        (admin.firestore as unknown as Record<string, unknown>).Timestamp = {
            fromDate: (date: Date) => ({ toDate: () => date }),
            now: () => ({ toMillis: () => Date.now() })
        };
        (admin.firestore as unknown as Record<string, unknown>).FieldValue = {
            delete: () => 'DELETE_SENTINEL',
            serverTimestamp: () => 'SERVER_TIMESTAMP'
        };

        authSpy = vi.spyOn(admin, 'auth').mockReturnValue({
            getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
            setCustomUserClaims: vi.fn().mockResolvedValue(undefined)
        } as unknown as admin.auth.Auth);
    });

    // --------------------------------------------------------------------------------
    // User Existence Check Tests (NEW - Prevents Orphaned Subcollections)
    // --------------------------------------------------------------------------------
    describe('User Existence Check', () => {
        it('should skip processing if user document does not exist', async () => {
            const uid = 'deleted_user_123';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(false);

            await onSubscriptionUpdated(event);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('no longer exists in Firestore')
            );
            expect(mockReconcileClaims).not.toHaveBeenCalled();
            expect(setSpy).not.toHaveBeenCalled();
            expect(updateSpy).not.toHaveBeenCalled();
        });

        it('should not write to system/status subcollection if user was deleted', async () => {
            const uid = 'deleted_user_456';
            const event = createMockEvent(uid, 'sub789');

            setupUserExists(false);

            await onSubscriptionUpdated(event);

            // Verify no writes happened to any document
            expect(setSpy).not.toHaveBeenCalled();
            expect(updateSpy).not.toHaveBeenCalled();

            // Verify reconcileClaims was never called
            expect(mockReconcileClaims).not.toHaveBeenCalled();

            // Verify email triggers were never called
            expect(mockCheckAndSendEmails).not.toHaveBeenCalled();
        });

        it('should proceed normally if user document exists', async () => {
            const uid = 'existing_user_123';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(true);
            setupSubscriptionsQuery(true); // Has active subscription
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event);

            expect(mockReconcileClaims).toHaveBeenCalledWith(uid);
        });

        it('should log appropriate message when skipping deleted user', async () => {
            const uid = 'orphan_prevention_test';
            const event = createMockEvent(uid, 'sub_orphan');

            setupUserExists(false);

            await onSubscriptionUpdated(event);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                `[onSubscriptionUpdated] User ${uid} no longer exists in Firestore. Skipping to prevent orphaned subcollections.`
            );
        });
    });

    // --------------------------------------------------------------------------------
    // Grace Period Tests
    // --------------------------------------------------------------------------------
    describe('Grace Period Management', () => {
        it('should set gracePeriodUntil if no active subscriptions and not already set', async () => {
            const uid = 'user123';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(true, {});
            setupSubscriptionsQuery(false); // No active subscriptions
            mockReconcileClaims.mockResolvedValue({ role: 'free' });

            await onSubscriptionUpdated(event);

            expect(mockReconcileClaims).toHaveBeenCalledWith(uid);
            expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
                gracePeriodUntil: expect.anything(),
                lastDowngradedAt: 'SERVER_TIMESTAMP'
            }), { merge: true });
        });

        it('should NOT set gracePeriodUntil if already set', async () => {
            const uid = 'user123';
            const event = createMockEvent(uid, 'sub456');

            const existingGracePeriod = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            setupUserExists(true, { gracePeriodUntil: existingGracePeriod });
            setupSubscriptionsQuery(false);
            mockReconcileClaims.mockResolvedValue({ role: 'free' });

            await onSubscriptionUpdated(event);

            // setSpy should not be called for grace period since it already exists
            expect(setSpy).not.toHaveBeenCalled();
        });

        it('should clear gracePeriodUntil if active subscription is found', async () => {
            const uid = 'user123';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(true, { gracePeriodUntil: new Date() });
            setupSubscriptionsQuery(true); // Active subscription found
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event);

            expect(updateSpy).toHaveBeenCalledWith({
                gracePeriodUntil: 'DELETE_SENTINEL',
                lastDowngradedAt: 'DELETE_SENTINEL'
            });

            // Should call reconcileClaims twice (initial + after clearing grace period)
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
        });

        it('should handle update error gracefully when clearing grace period', async () => {
            const uid = 'user123';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(true);
            setupSubscriptionsQuery(true);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });
            updateSpy.mockRejectedValueOnce(new Error('Update failed'));

            // Should not throw
            await expect(onSubscriptionUpdated(event)).resolves.not.toThrow();
        });
    });

    // --------------------------------------------------------------------------------
    // Subscription Status Tests
    // --------------------------------------------------------------------------------
    describe('Subscription Status Handling', () => {
        it('should reconcile claims for active subscription', async () => {
            const uid = 'active_user';
            const event = createMockEvent(uid, 'sub_active');

            setupUserExists(true);
            setupSubscriptionsQuery(true);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event);

            expect(mockReconcileClaims).toHaveBeenCalledWith(uid);
        });

        it('should handle trialing subscription as active', async () => {
            const uid = 'trialing_user';
            const event = createMockEvent(uid, 'sub_trial');

            setupUserExists(true);
            // Subscription query uses 'in' ['active', 'trialing']
            collectionSpy.mockImplementation((path: string) => {
                if (path.includes('subscriptions')) {
                    return {
                        where: vi.fn().mockReturnThis(),
                        limit: vi.fn().mockReturnThis(),
                        get: vi.fn().mockResolvedValue({
                            empty: false,
                            docs: [{ id: 'sub_trial', data: () => ({ status: 'trialing' }) }]
                        })
                    };
                }
                return { doc: docSpy };
            });
            mockReconcileClaims.mockResolvedValue({ role: 'basic' });

            await onSubscriptionUpdated(event);

            // Should try to clear grace period (subscription is active)
            expect(updateSpy).toHaveBeenCalled();
        });
    });

    // --------------------------------------------------------------------------------
    // Error Handling Tests
    // --------------------------------------------------------------------------------
    describe('Error Handling', () => {
        it('should handle reconcileClaims not-found error gracefully', async () => {
            const uid = 'no_active_sub_user';
            const event = createMockEvent(uid, 'sub_canceled');

            setupUserExists(true, {});
            mockReconcileClaims.mockRejectedValue({ code: 'not-found', message: 'No active subscription found' });

            // Mock auth for fallback
            authSpy.mockReturnValue({
                getUser: vi.fn().mockResolvedValue({ customClaims: { stripeRole: 'pro' } }),
                setCustomUserClaims: vi.fn().mockResolvedValue(undefined)
            } as unknown as admin.auth.Auth);

            await expect(onSubscriptionUpdated(event)).resolves.not.toThrow();

            // Should set grace period in catch block
            expect(setSpy).toHaveBeenCalled();
        });

        it('should log error for unexpected exceptions', async () => {
            const uid = 'error_user';
            const event = createMockEvent(uid, 'sub_error');

            setupUserExists(true);
            const unexpectedError = new Error('Unexpected database error');
            mockReconcileClaims.mockRejectedValue(unexpectedError);

            await onSubscriptionUpdated(event);

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error for user'),
                unexpectedError
            );
        });

        it('should handle "No active subscription found" message in error', async () => {
            const uid = 'message_error_user';
            const event = createMockEvent(uid, 'sub_msg_error');

            setupUserExists(true, {});
            mockReconcileClaims.mockRejectedValue({ message: 'No active subscription found for user' });

            authSpy.mockReturnValue({
                getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
                setCustomUserClaims: vi.fn().mockResolvedValue(undefined)
            } as unknown as admin.auth.Auth);

            await expect(onSubscriptionUpdated(event)).resolves.not.toThrow();
        });
    });

    // --------------------------------------------------------------------------------
    // Email Trigger Tests
    // --------------------------------------------------------------------------------
    describe('Email Triggers', () => {
        it('should call checkAndSendSubscriptionEmails with correct data', async () => {
            const uid = 'user_email_test';
            const subId = 'sub_active_1';
            const beforeData = { role: 'basic', status: 'active' };
            const afterData = { role: 'pro', status: 'active' };

            const event = createMockEvent(uid, subId, beforeData, afterData);

            setupUserExists(true);
            setupSubscriptionsQuery(true);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event);

            expect(mockCheckAndSendEmails).toHaveBeenCalledWith(
                uid,
                subId,
                beforeData,
                afterData,
                event.id
            );
        });

        it('should NOT call checkAndSendSubscriptionEmails if user does not exist', async () => {
            const uid = 'deleted_user_email';
            const event = createMockEvent(uid, 'sub_email', { status: 'active' }, { status: 'canceled' });

            setupUserExists(false);

            await onSubscriptionUpdated(event);

            expect(mockCheckAndSendEmails).not.toHaveBeenCalled();
        });

        it('should skip email check if event.data is undefined', async () => {
            const uid = 'user_no_data';
            const event = {
                id: 'evt_no_data',
                params: { uid, subscriptionId: 'sub_no_data' },
                data: undefined
            };

            setupUserExists(true);
            setupSubscriptionsQuery(true);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event);

            expect(mockCheckAndSendEmails).not.toHaveBeenCalled();
        });

        it('should pass before and after data to email trigger', async () => {
            const uid = 'upgrade_user';
            const subId = 'sub_upgrade';
            const beforeData = { status: 'trialing', role: 'free' };
            const afterData = { status: 'active', role: 'pro' };

            const event = createMockEvent(uid, subId, beforeData, afterData);

            setupUserExists(true);
            setupSubscriptionsQuery(true);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event);

            expect(mockCheckAndSendEmails).toHaveBeenCalledWith(
                uid,
                subId,
                beforeData,
                afterData,
                expect.any(String)
            );
        });
    });

    // --------------------------------------------------------------------------------
    // Integration-like Tests
    // --------------------------------------------------------------------------------
    describe('Full Flow Tests', () => {
        it('should handle complete downgrade flow: active -> canceled -> grace period', async () => {
            const uid = 'downgrade_user';
            const event = createMockEvent(uid, 'sub_downgrade',
                { status: 'active', role: 'pro' },
                { status: 'canceled', role: 'free' }
            );

            setupUserExists(true, {});
            setupSubscriptionsQuery(false); // No active subscriptions after cancel
            mockReconcileClaims.mockResolvedValue({ role: 'free' });

            await onSubscriptionUpdated(event);

            // Should reconcile claims
            expect(mockReconcileClaims).toHaveBeenCalledWith(uid);

            // Should set grace period
            expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
                gracePeriodUntil: expect.anything()
            }), { merge: true });

            // Should trigger emails
            expect(mockCheckAndSendEmails).toHaveBeenCalled();
        });

        it('should handle complete upgrade flow: canceled -> active -> clear grace period', async () => {
            const uid = 'upgrade_user';
            const event = createMockEvent(uid, 'sub_upgrade',
                { status: 'canceled' },
                { status: 'active' }
            );

            setupUserExists(true, { gracePeriodUntil: new Date() });
            setupSubscriptionsQuery(true); // Now has active subscription
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event);

            // Should clear grace period
            expect(updateSpy).toHaveBeenCalledWith({
                gracePeriodUntil: 'DELETE_SENTINEL',
                lastDowngradedAt: 'DELETE_SENTINEL'
            });

            // Should reconcile claims twice
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
        });
    });
});
