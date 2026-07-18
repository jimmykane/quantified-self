import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Mock dependencies using vi.hoisted to avoid initialization errors
const {
    mockReconcileClaims,
    mockCheckAndSendEmails,
    mockLogger,
    mockIsServiceDisconnectPendingForUser,
    mockClearServiceDisconnectPending,
    firestoreTriggerState,
} = vi.hoisted(() => ({
    mockReconcileClaims: vi.fn(),
    mockCheckAndSendEmails: vi.fn(),
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    },
    mockIsServiceDisconnectPendingForUser: vi.fn(),
    mockClearServiceDisconnectPending: vi.fn(),
    firestoreTriggerState: {
        options: undefined as unknown,
    },
}));

vi.mock('./claims', () => ({
    reconcileClaims: mockReconcileClaims
}));

vi.mock('./email-triggers', () => ({
    checkAndSendSubscriptionEmails: mockCheckAndSendEmails
}));

vi.mock('../service-disconnect-pending', () => ({
    isServiceDisconnectPendingForUser: mockIsServiceDisconnectPendingForUser,
    clearServiceDisconnectPending: mockClearServiceDisconnectPending,
}));

vi.mock('firebase-functions/logger', () => mockLogger);

// Mock firebase-functions BEFORE imports
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (options: unknown, handler: unknown) => {
        firestoreTriggerState.options = options;
        return handler;
    }
}));

// Import AFTER mocks
import { onSubscriptionUpdated } from './subscriptions';

describe('onSubscriptionUpdated', () => {
    type DeletionMarkerState = boolean | 'expired';

    let collectionSpy: ReturnType<typeof vi.fn>;
    let docSpy: ReturnType<typeof vi.fn>;
    let setSpy: ReturnType<typeof vi.fn>;
    let deleteSpy: ReturnType<typeof vi.fn>;
    let updateSpy: ReturnType<typeof vi.fn>;
    let runTransactionSpy: ReturnType<typeof vi.fn>;
    let authSpy: ReturnType<typeof vi.spyOn>;
    let userExists: boolean;
    let systemStatusData: Record<string, unknown>;
    let hasActiveSubscription: boolean;
    let activeSubscriptionData: Record<string, unknown>[];
    let deletionMarkerSequence: DeletionMarkerState[];

    const createMockEvent = (uid: string, subscriptionId: string, beforeData?: unknown, afterData?: unknown) => ({
        id: `evt_${Date.now()}`,
        params: { uid, subscriptionId },
        data: beforeData || afterData ? {
            before: { data: () => beforeData },
            after: { data: () => afterData }
        } : undefined
    });

    const setupUserExists = (exists: boolean, userData?: Record<string, unknown>) => {
        userExists = exists;
        systemStatusData = userData || {};
    };

    const setupSubscriptionsQuery = (
        activeSubscriptionExists: boolean,
        subscriptions?: Record<string, unknown>[],
    ) => {
        hasActiveSubscription = activeSubscriptionExists;
        activeSubscriptionData = activeSubscriptionExists
            ? subscriptions || [{ status: 'active', role: 'pro', cancel_at_period_end: false }]
            : [];
    };

    const setupDeletionMarkerSequence = (...states: DeletionMarkerState[]) => {
        deletionMarkerSequence = [...states];
    };

    const getDeletionMarkerState = (): DeletionMarkerState => {
        if (deletionMarkerSequence.length === 0) {
            return false;
        }

        return deletionMarkerSequence.shift() ?? false;
    };

    const getDocSnapshot = (path: string) => {
        if (path.startsWith('userDeletionTombstones/')) {
            const markerState = getDeletionMarkerState();
            if (markerState === false) {
                return {
                    exists: false,
                    data: () => ({})
                };
            }

            return {
                exists: true,
                data: () => markerState === 'expired'
                    ? { expireAt: { toMillis: () => Date.now() - 1000 } }
                    : { expireAt: { toMillis: () => Date.now() + 60_000 } }
            };
        }

        if (path.includes('/system/status')) {
            return {
                exists: true,
                data: () => systemStatusData
            };
        }

        if (path.startsWith('users/')) {
            return {
                exists: userExists,
                data: () => ({})
            };
        }

        return {
            exists: false,
            data: () => ({})
        };
    };

    it('retries transient subscription lifecycle failures', () => {
        expect(firestoreTriggerState.options).toEqual(expect.objectContaining({
            document: 'customers/{uid}/subscriptions/{subscriptionId}',
            region: 'europe-west3',
            memory: '512MiB',
            concurrency: 5,
            retry: true,
        }));
    });

    beforeEach(() => {
        vi.clearAllMocks();

        setSpy = vi.fn().mockResolvedValue({});
        deleteSpy = vi.fn().mockResolvedValue({});
        updateSpy = vi.fn().mockResolvedValue({});
        runTransactionSpy = vi.fn(async (updateFunction: (transaction: {
            get: (docRef: { get: () => Promise<unknown> }) => Promise<unknown>;
            set: (_docRef: unknown, data: unknown, options: unknown) => void;
            delete: (_docRef: unknown) => void;
        }) => Promise<unknown>) => updateFunction({
            get: (docRef) => docRef.get(),
            set: (_docRef, data, options) => {
                setSpy(data, options);
            },
            delete: (_docRef) => {
                deleteSpy();
            }
        }));

        userExists = true;
        systemStatusData = {};
        hasActiveSubscription = false;
        activeSubscriptionData = [];
        deletionMarkerSequence = [];
        mockIsServiceDisconnectPendingForUser.mockResolvedValue(false);
        mockClearServiceDisconnectPending.mockResolvedValue(undefined);

        docSpy = vi.fn((path: string) => ({
            get: vi.fn(() => Promise.resolve(getDocSnapshot(path))),
            set: (data: unknown, options: unknown) => setSpy(data, options),
            delete: () => deleteSpy(),
            update: (data: unknown) => updateSpy(data)
        }));

        collectionSpy = vi.fn().mockImplementation((path: string) => {
            if (path.includes('subscriptions')) {
                const query = {
                    where: vi.fn(() => query),
                    orderBy: vi.fn(() => query),
                    limit: vi.fn(() => query),
                    get: vi.fn().mockResolvedValue({
                        empty: !hasActiveSubscription,
                        docs: activeSubscriptionData.map((data, index) => ({
                            id: `sub_${index + 1}`,
                            data: () => data,
                        }))
                    })
                };
                return query;
            }
            return {
                doc: (id: string) => docSpy(`${path}/${id}`)
            };
        });

        vi.spyOn(admin, 'firestore').mockReturnValue({
            collection: collectionSpy,
            doc: docSpy,
            runTransaction: runTransactionSpy,
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
        it('should delete expired markers and continue processing', async () => {
            const uid = 'expired_marker_user';
            const event = createMockEvent(uid, 'sub_expired_marker');

            setupUserExists(true);
            setupSubscriptionsQuery(true);
            setupDeletionMarkerSequence('expired', false);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event as any);

            expect(deleteSpy).toHaveBeenCalledTimes(1);
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
            expect(setSpy).toHaveBeenCalled();
        });

        it('should skip processing if the user is marked for deletion', async () => {
            const uid = 'deleted_marker_user';
            const event = createMockEvent(uid, 'sub_marker');

            setupUserExists(true);
            setupDeletionMarkerSequence(true);

            await onSubscriptionUpdated(event);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                `[onSubscriptionUpdated] User ${uid} is marked for deletion. Skipping subscription processing.`
            );
            expect(mockReconcileClaims).not.toHaveBeenCalled();
            expect(setSpy).not.toHaveBeenCalled();
            expect(updateSpy).not.toHaveBeenCalled();
            expect(mockCheckAndSendEmails).not.toHaveBeenCalled();
        });

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

            await onSubscriptionUpdated(event as any);

            // Should call reconcileClaims twice: once at the top, and once after checking/updating grace period
            // Since setupSubscriptionsQuery(true) is called, it goes to the 'else' branch (clearing grace period).
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
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

            // Should call reconcileClaims twice: once at the top, and once after setting grace period
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
            expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
                gracePeriodUntil: expect.anything(),
                lastDowngradedAt: 'SERVER_TIMESTAMP'
            }), { merge: true });
        });

        it('should skip the grace period write if the user is marked for deletion mid-flight', async () => {
            const uid = 'user_deleting_during_grace_period';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(true, {});
            setupSubscriptionsQuery(false);
            setupDeletionMarkerSequence(false, true);
            mockReconcileClaims.mockResolvedValue({ role: 'free' });

            await onSubscriptionUpdated(event);

            expect(setSpy).not.toHaveBeenCalled();
            expect(mockReconcileClaims).toHaveBeenCalledTimes(1);
            expect(mockCheckAndSendEmails).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                `[onSubscriptionUpdated] User ${uid} was marked for deletion before updating grace state. Skipping follow-up processing.`
            );
        });

        it('should skip the active-subscription status write if deletion starts mid-flight', async () => {
            const uid = 'active_user_deleting_mid_flight';
            const event = createMockEvent(
                uid,
                'sub456',
                { status: 'active', role: 'pro', cancel_at_period_end: false },
                { status: 'active', role: 'pro', cancel_at_period_end: true },
            );

            setupUserExists(true, {});
            setupSubscriptionsQuery(true, [{
                status: 'active',
                role: 'pro',
                cancel_at_period_end: true,
                current_period_end: new Date('2026-01-15T12:00:00.000Z'),
            }]);
            setupDeletionMarkerSequence(false, true);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event as any);

            expect(setSpy).not.toHaveBeenCalled();
            expect(mockReconcileClaims).toHaveBeenCalledTimes(1);
            expect(mockCheckAndSendEmails).not.toHaveBeenCalled();
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

            expect(setSpy).toHaveBeenCalledWith({
                gracePeriodUntil: 'DELETE_SENTINEL',
                scheduledGracePeriodUntil: 'DELETE_SENTINEL',
                lastDowngradedAt: 'DELETE_SENTINEL',
            }, { merge: true });

            // Should call reconcileClaims twice (initial + after clearing grace period)
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
        });

        it('should store the cancellation grace deadline before the active subscription ends', async () => {
            const periodEnd = new Date('2026-01-15T12:00:00.000Z');
            const event = createMockEvent(
                'user123',
                'sub456',
                { status: 'active', role: 'pro', cancel_at_period_end: false, current_period_end: periodEnd },
                { status: 'active', role: 'pro', cancel_at_period_end: true, current_period_end: periodEnd },
            );

            setupUserExists(true);
            setupSubscriptionsQuery(true, [{
                status: 'active',
                role: 'pro',
                cancel_at_period_end: true,
                current_period_end: periodEnd,
            }]);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event as any);

            expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
                gracePeriodUntil: 'DELETE_SENTINEL',
                scheduledGracePeriodUntil: expect.anything(),
                lastDowngradedAt: 'DELETE_SENTINEL',
            }), { merge: true });
            const scheduledWrite = setSpy.mock.calls[0][0].scheduledGracePeriodUntil;
            expect(scheduledWrite.toDate()).toEqual(new Date('2026-02-14T12:00:00.000Z'));
        });

        it('should ignore a stale cancellation event after the current subscription has renewed', async () => {
            const periodEnd = new Date('2026-01-15T12:00:00.000Z');
            const event = createMockEvent(
                'user123',
                'sub456',
                { status: 'active', role: 'pro', cancel_at_period_end: false, current_period_end: periodEnd },
                { status: 'active', role: 'pro', cancel_at_period_end: true, current_period_end: periodEnd },
            );

            setupUserExists(true, { scheduledGracePeriodUntil: new Date('2026-02-14T12:00:00.000Z') });
            setupSubscriptionsQuery(true, [{
                status: 'active',
                role: 'pro',
                cancel_at_period_end: false,
                current_period_end: new Date('2026-02-15T12:00:00.000Z'),
            }]);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event as any);

            expect(setSpy).toHaveBeenCalledWith({
                gracePeriodUntil: 'DELETE_SENTINEL',
                scheduledGracePeriodUntil: 'DELETE_SENTINEL',
                lastDowngradedAt: 'DELETE_SENTINEL',
            }, { merge: true });
        });

        it('should use the latest deadline when every active subscription is ending', async () => {
            const firstPeriodEnd = new Date('2026-01-15T12:00:00.000Z');
            const lastPeriodEnd = new Date('2026-01-20T12:00:00.000Z');
            const event = createMockEvent(
                'user123',
                'sub456',
                { status: 'active', role: 'pro', cancel_at_period_end: false, current_period_end: firstPeriodEnd },
                { status: 'active', role: 'pro', cancel_at_period_end: true, current_period_end: firstPeriodEnd },
            );

            setupUserExists(true);
            setupSubscriptionsQuery(true, [
                {
                    status: 'active',
                    role: 'pro',
                    cancel_at_period_end: true,
                    current_period_end: firstPeriodEnd,
                },
                {
                    status: 'active',
                    role: 'basic',
                    cancel_at_period_end: true,
                    current_period_end: lastPeriodEnd,
                },
            ]);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event as any);

            const scheduledWrite = setSpy.mock.calls[0][0].scheduledGracePeriodUntil;
            expect(scheduledWrite.toDate()).toEqual(new Date('2026-02-19T12:00:00.000Z'));
        });

        it('should promote the stored cancellation deadline when the subscription ends', async () => {
            const scheduledGracePeriodUntil = new Date('2026-02-14T12:00:00.000Z');
            const event = createMockEvent(
                'user123',
                'sub456',
                { status: 'active', role: 'pro', cancel_at_period_end: true },
                { status: 'canceled', role: 'pro', cancel_at_period_end: true },
            );

            setupUserExists(true, { scheduledGracePeriodUntil });
            setupSubscriptionsQuery(false);
            mockReconcileClaims.mockResolvedValue({ role: 'free' });

            await onSubscriptionUpdated(event as any);

            expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
                gracePeriodUntil: expect.anything(),
                scheduledGracePeriodUntil: 'DELETE_SENTINEL',
                lastDowngradedAt: 'SERVER_TIMESTAMP',
            }), { merge: true });
            const promotedWrite = setSpy.mock.calls[0][0].gracePeriodUntil;
            expect(promotedWrite.toDate()).toEqual(scheduledGracePeriodUntil);
        });

        it('should derive the canonical deadline from the ending subscription when no schedule was stored', async () => {
            const periodEnd = new Date('2026-01-15T12:00:00.000Z');
            const event = createMockEvent(
                'user123',
                'sub456',
                {
                    status: 'active',
                    role: 'pro',
                    cancel_at_period_end: true,
                    current_period_end: periodEnd,
                },
                {
                    status: 'canceled',
                    role: 'pro',
                    cancel_at_period_end: true,
                    current_period_end: periodEnd,
                },
            );

            setupUserExists(true, {});
            setupSubscriptionsQuery(false);
            mockReconcileClaims.mockResolvedValue({ role: 'free' });

            await onSubscriptionUpdated(event as any);

            const graceWrite = setSpy.mock.calls[0][0].gracePeriodUntil;
            expect(graceWrite.toDate()).toEqual(new Date('2026-02-14T12:00:00.000Z'));
        });

        it('should clear pending disconnects when a Pro subscription is restored', async () => {
            const uid = 'pro_restored_user';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(true, { gracePeriodUntil: new Date() });
            setupSubscriptionsQuery(true);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });
            mockIsServiceDisconnectPendingForUser.mockImplementation(async (_uid: string, serviceName: ServiceNames) => (
                serviceName === ServiceNames.SuuntoApp || serviceName === ServiceNames.WahooAPI
            ));

            await onSubscriptionUpdated(event);

            expect(mockClearServiceDisconnectPending).toHaveBeenCalledWith(uid, ServiceNames.SuuntoApp);
            expect(mockClearServiceDisconnectPending).toHaveBeenCalledWith(uid, ServiceNames.WahooAPI);
            expect(mockClearServiceDisconnectPending).not.toHaveBeenCalledWith(uid, ServiceNames.COROSAPI);
            expect(mockClearServiceDisconnectPending).not.toHaveBeenCalledWith(uid, ServiceNames.GarminAPI);
        });

        it('should not clear pending disconnects for a non-Pro active subscription', async () => {
            const uid = 'basic_active_user';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(true, { gracePeriodUntil: new Date() });
            setupSubscriptionsQuery(true);
            mockReconcileClaims.mockResolvedValue({ role: 'basic' });
            mockIsServiceDisconnectPendingForUser.mockResolvedValue(true);

            await onSubscriptionUpdated(event);

            expect(mockClearServiceDisconnectPending).not.toHaveBeenCalled();
        });

        it('should clear pending disconnects when an active grace period is set', async () => {
            const uid = 'grace_restored_user';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(true, {});
            setupSubscriptionsQuery(false);
            mockReconcileClaims.mockResolvedValue({ role: 'free' });
            mockIsServiceDisconnectPendingForUser.mockImplementation(async (_uid: string, serviceName: ServiceNames) => (
                serviceName === ServiceNames.GarminAPI
            ));

            await onSubscriptionUpdated(event);

            expect(mockClearServiceDisconnectPending).toHaveBeenCalledWith(uid, ServiceNames.GarminAPI);
            expect(mockClearServiceDisconnectPending).not.toHaveBeenCalledWith(uid, ServiceNames.SuuntoApp);
            expect(mockClearServiceDisconnectPending).not.toHaveBeenCalledWith(uid, ServiceNames.COROSAPI);
        });

        it('should surface transaction failures instead of continuing from partial state', async () => {
            const uid = 'user123';
            const event = createMockEvent(uid, 'sub456');

            setupUserExists(true);
            setupSubscriptionsQuery(true);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });
            const transactionFailure = new Error('Transaction failed');
            runTransactionSpy.mockRejectedValueOnce(transactionFailure);

            await expect(onSubscriptionUpdated(event)).rejects.toBe(transactionFailure);
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

            await onSubscriptionUpdated(event as any);

            // Should call reconcileClaims twice: once at the top, and once after clearing grace period (since sub query mocks active sub)
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
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
                return {
                    doc: (id: string) => docSpy(`${path}/${id}`)
                };
            });
            mockReconcileClaims.mockResolvedValue({ role: 'basic' });

            await onSubscriptionUpdated(event as any);

            // Should clear grace period (subscription is active)
            expect(setSpy).toHaveBeenCalled();
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
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
            // Explicitly mock exactly two calls
            mockReconcileClaims
                .mockRejectedValueOnce({ code: 'not-found', message: 'No active subscription found' }) // 1st call
                .mockResolvedValueOnce({ role: 'free' }); // 2nd call (inside grace period block)

            // Mock auth for fallback
            authSpy.mockReturnValue({
                getUser: vi.fn().mockResolvedValue({ customClaims: { stripeRole: 'pro' } }),
                setCustomUserClaims: vi.fn().mockResolvedValue(undefined)
            } as unknown as admin.auth.Auth);

            await expect(onSubscriptionUpdated(event as any)).resolves.not.toThrow();

            // Should set grace period in catch block or after
            expect(setSpy).toHaveBeenCalled();
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
        });

        it('should reject unexpected reconciliation failures so the event retries', async () => {
            const uid = 'error_user';
            const event = createMockEvent(uid, 'sub_error');

            setupUserExists(true);
            const unexpectedError = new Error('Unexpected database error');
            mockReconcileClaims.mockRejectedValueOnce(unexpectedError);

            await expect(onSubscriptionUpdated(event as any)).rejects.toBe(unexpectedError);

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('retrying the subscription event'),
                unexpectedError
            );
            expect(mockReconcileClaims).toHaveBeenCalledTimes(1);
            expect(runTransactionSpy).not.toHaveBeenCalled();
        });

        it('should handle "No active subscription found" message in error', async () => {
            const uid = 'message_error_user';
            const event = createMockEvent(uid, 'sub_msg_error');

            setupUserExists(true, {});
            // Explicitly mock both calls
            mockReconcileClaims
                .mockRejectedValueOnce({ message: 'No active subscription found for user' }) // 1st call
                .mockResolvedValueOnce({ role: 'free' }); // 2nd call

            authSpy.mockReturnValue({
                getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
                setCustomUserClaims: vi.fn().mockResolvedValue(undefined)
            } as unknown as admin.auth.Auth);

            await expect(onSubscriptionUpdated(event as any)).resolves.not.toThrow();
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
        });
        it('should handle user without customClaims defined', async () => {
            const uid = 'no_claims_user';
            const event = createMockEvent(uid, 'sub_no_claims');

            setupUserExists(true, {});
            // Explicitly mock both calls
            mockReconcileClaims
                .mockRejectedValueOnce({ code: 'not-found' }) // 1st call
                .mockResolvedValueOnce({ role: 'free' }); // 2nd call

            authSpy.mockReturnValue({
                getUser: vi.fn().mockResolvedValue({ customClaims: undefined }), // No claims
                setCustomUserClaims: vi.fn().mockResolvedValue(undefined)
            } as unknown as admin.auth.Auth);

            await expect(onSubscriptionUpdated(event as any)).resolves.not.toThrow();
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
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

            await onSubscriptionUpdated(event as any);

            // Should reconcile claims twice
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);

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

            await onSubscriptionUpdated(event as any);

            // Should reconcile claims twice
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
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

            await onSubscriptionUpdated(event as any);

            // Should reconcile claims twice
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);

            expect(mockCheckAndSendEmails).toHaveBeenCalledWith(
                uid,
                subId,
                beforeData,
                afterData,
                expect.any(String)
            );
        });

        it('should skip email triggers if the user is marked for deletion before emails are checked', async () => {
            const uid = 'user_deleted_before_emails';
            const subId = 'sub_upgrade';
            const beforeData = { role: 'basic', status: 'active' };
            const afterData = { role: 'pro', status: 'active' };

            const event = createMockEvent(uid, subId, beforeData, afterData);

            setupUserExists(true);
            setupSubscriptionsQuery(true);
            setupDeletionMarkerSequence(false, false, true);
            mockReconcileClaims.mockResolvedValue({ role: 'pro' });

            await onSubscriptionUpdated(event as any);

            expect(setSpy).toHaveBeenCalled();
            expect(mockCheckAndSendEmails).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                `[onSubscriptionUpdated] User ${uid} was marked for deletion before email processing. Skipping email triggers.`
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

            await onSubscriptionUpdated(event as any);

            // Should reconcile claims twice
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);

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
            expect(setSpy).toHaveBeenCalledWith({
                gracePeriodUntil: 'DELETE_SENTINEL',
                scheduledGracePeriodUntil: 'DELETE_SENTINEL',
                lastDowngradedAt: 'DELETE_SENTINEL',
            }, { merge: true });

            // Should reconcile claims twice
            expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
        });
    });
});
