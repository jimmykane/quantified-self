import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';
import { checkAndSendSubscriptionEmails as checkAndSendSubscriptionEmailsImpl } from './email-triggers';

// Mock pricing
vi.mock('../shared/pricing', () => ({
    ROLE_HIERARCHY: {
        'free': 0,
        'basic': 1,
        'pro': 2,
        'mystery-tier': 0,
        'hidden_vip': 10,
        'super_pro': 11
    },
    ROLE_DISPLAY_NAMES: {
        'free': 'Free',
        'basic': 'Basic',
        'pro': 'Pro',
        'super_pro': 'Super Pro'
    }
}));

// Mocks
const collectionSpy = vi.fn();
const docSpy = vi.fn();
const getSpy = vi.fn();
const setSpy = vi.fn();
const getUserSpy = vi.fn();
const firestoreDocSpy = vi.fn();
const runTransactionSpy = vi.fn();
const getUserDeletionGuardStateInTransaction = vi.hoisted(() => vi.fn());

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardStateInTransaction,
}));

// Firestore Mock Implementation
const mockFirestore = {
    collection: collectionSpy,
    doc: firestoreDocSpy,
    runTransaction: runTransactionSpy,
};

vi.mock('firebase-admin', () => ({
    initializeApp: vi.fn(),
    firestore: Object.assign(
        vi.fn(() => mockFirestore),
        {
            Timestamp: {
                fromDate: (date: Date) => ({
                    toDate: () => date,
                    toMillis: () => date.getTime(),
                    toISOString: () => date.toISOString()
                })
            }
        }
    ),
    auth: vi.fn()
}));

describe('checkAndSendSubscriptionEmails', () => {
    let currentSubscriptionData: Record<string, unknown> | undefined;
    let activeSubscriptionData: Array<{ id: string; data: Record<string, unknown> }>;

    const checkAndSendSubscriptionEmails = async (
        uid: string,
        subscriptionId: string,
        before: Record<string, unknown> | undefined,
        after: Record<string, unknown> | undefined,
        eventId: string,
        current = after,
        active = current && ['active', 'trialing'].includes(`${current.status || ''}`)
            ? [{ id: subscriptionId, data: current }]
            : [],
    ) => {
        currentSubscriptionData = current;
        activeSubscriptionData = active;
        await checkAndSendSubscriptionEmailsImpl(uid, subscriptionId, before, after, eventId);
    };

    beforeEach(() => {
        vi.clearAllMocks();

        setSpy.mockResolvedValue({} as any);
        getSpy.mockResolvedValue({ exists: false }); // Default: doc does not exist
        currentSubscriptionData = undefined;
        activeSubscriptionData = [];
        getUserDeletionGuardStateInTransaction.mockResolvedValue({
            shouldSkip: false,
            userExists: true,
            deletionInProgress: false,
        });

        docSpy.mockReturnValue({
            get: getSpy,
            set: setSpy
        });

        const activeQuery = {
            kind: 'active-query',
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
        };
        collectionSpy.mockImplementation((path: string) => {
            if (path === 'mail') {
                return { doc: docSpy };
            }
            if (path.includes('/subscriptions')) {
                return activeQuery;
            }
            return { doc: vi.fn() };
        });
        firestoreDocSpy.mockImplementation((path: string) => ({ kind: 'current-subscription', path }));
        runTransactionSpy.mockImplementation(async (handler: (transaction: {
            get: (ref: { kind?: string; get?: () => Promise<unknown> }) => Promise<unknown>;
            create: (ref: unknown, data: unknown) => void;
        }) => Promise<unknown>) => handler({
            get: async ref => {
                if (ref.kind === 'current-subscription') {
                    return {
                        exists: currentSubscriptionData !== undefined,
                        data: () => currentSubscriptionData,
                    };
                }
                if (ref.kind === 'active-query') {
                    return {
                        empty: activeSubscriptionData.length === 0,
                        docs: activeSubscriptionData.map(subscription => ({
                            id: subscription.id,
                            data: () => subscription.data,
                        })),
                    };
                }
                return ref.get!();
            },
            create: (_ref, data) => {
                setSpy(data);
            },
        }));

        mockFirestore.collection = collectionSpy; // Ensure it's linked

        getUserSpy.mockResolvedValue({ email: 'test@example.com' });

        // Setup auth mock
        (admin.auth as any as ReturnType<typeof vi.fn>).mockReturnValue({
            getUser: getUserSpy
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should queue WELCOME email when subscription becomes active (new)', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = undefined; // Creation
        const after = { status: 'active', role: 'pro' };
        const eventId = 'evt1';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(collectionSpy).toHaveBeenCalledWith('mail');
        expect(docSpy).toHaveBeenCalledWith(`welcome_email_${subId}`);
        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            to: 'test@example.com',
            from: 'Quantified Self <hello@quantified-self.io>',
            replyTo: 'support@quantified-self.io',
            template: {
                name: 'welcome_email',
                data: expect.objectContaining({
                    role: 'Pro',
                    is_trial: false,
                    plan_details_available: true,
                    activity_description: 'Unlimited activities',
                    dashboard_url: 'https://quantified-self.io/dashboard'
                })
            },
            expireAt: expect.any(Object)
        }));
    });

    it('distinguishes a trial activation in the welcome template data', async () => {
        await checkAndSendSubscriptionEmails(
            'user1',
            'sub-trial',
            undefined,
            { status: 'trialing', role: 'basic' },
            'evt-trial'
        );

        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({
                name: 'welcome_email',
                data: expect.objectContaining({ is_trial: true, role: 'Basic' })
            })
        }));
    });

    it('should queue UPGRADE email when role hierarchy increases', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'basic' };
        const after = { status: 'active', role: 'pro' };
        const eventId = 'evt2';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(docSpy).toHaveBeenCalledWith(`upgrade_${eventId}`);
        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            from: 'Quantified Self <hello@quantified-self.io>',
            replyTo: 'support@quantified-self.io',
            template: {
                name: 'subscription_upgrade',
                data: expect.objectContaining({
                    new_role: 'Pro',
                    old_role: 'Basic',
                    plan_details_available: true,
                    device_sync_description: 'Device sync with Garmin, Suunto, and COROS',
                    dashboard_url: 'https://quantified-self.io/dashboard'
                })
            },
            expireAt: expect.any(Object)
        }));
    });

    it('should queue DOWNGRADE email when role hierarchy decreases', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'pro' };
        const after = { status: 'active', role: 'basic' };
        const eventId = 'evt3';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(docSpy).toHaveBeenCalledWith(`downgrade_${eventId}`);
        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            from: 'Quantified Self <hello@quantified-self.io>',
            replyTo: 'support@quantified-self.io',
            template: {
                name: 'subscription_downgrade',
                data: expect.objectContaining({
                    new_role: 'Basic',
                    old_role: 'Pro',
                    activity_description: 'Up to 1,000 activities',
                    route_description: 'Up to 100 saved routes',
                    ai_insights_description: '50 AI Insights requests per billing period',
                    device_sync_will_end: true,
                    membership_url: 'https://quantified-self.io/pricing'
                })
            },
            expireAt: expect.any(Object)
        }));
    });

    it('should skip a role-change email when another subscription still defines the membership', async () => {
        const before = { status: 'active', role: 'pro', created: 100 };
        const after = { status: 'active', role: 'basic', created: 100 };
        const continuingPro = { status: 'active', role: 'pro', created: 200 };

        await checkAndSendSubscriptionEmails(
            'user1',
            'older-subscription',
            before,
            after,
            'evt-shadowed-downgrade',
            after,
            [
                { id: 'newer-pro-subscription', data: continuingPro },
                { id: 'older-subscription', data: after },
            ],
        );

        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should send only the activation email when an inactive subscription changes role on activation', async () => {
        const before = { status: 'canceled', role: 'basic', created: 100 };
        const after = { status: 'active', role: 'pro', created: 100 };

        await checkAndSendSubscriptionEmails(
            'user1',
            'sub-reactivated',
            before,
            after,
            'evt-reactivated-upgrade',
        );

        expect(docSpy).toHaveBeenCalledWith('welcome_email_sub-reactivated');
        expect(docSpy).not.toHaveBeenCalledWith('upgrade_evt-reactivated-upgrade');
        expect(setSpy).toHaveBeenCalledTimes(1);
    });

    it('should queue CANCELLATION email when cancel_at_period_end becomes true', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const futureDate = new Date('2026-01-15T12:00:00.000Z');
        const timestamp = { seconds: Math.floor(futureDate.getTime() / 1000), toDate: () => futureDate };

        const before = { status: 'active', role: 'pro', cancel_at_period_end: false };
        const after = {
            status: 'active',
            role: 'pro',
            cancel_at_period_end: true,
            current_period_end: timestamp
        };
        const eventId = 'evt4';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(docSpy).toHaveBeenCalledWith(`cancellation_${subId}_${timestamp.seconds}`);
        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            from: 'Quantified Self <hello@quantified-self.io>',
            replyTo: 'support@quantified-self.io',
            template: {
                name: 'subscription_cancellation',
                data: expect.objectContaining({
                    role: 'Pro',
                    expiration_date: '15 January 2026',
                    grace_period_end: '14 February 2026',
                    free_activity_description: 'Up to 100 activities',
                    device_sync_will_end: true,
                    membership_url: 'https://quantified-self.io/pricing'
                })
            },
            expireAt: expect.any(Object)
        }));
    });

    it('should skip a stale cancellation event after renewal', async () => {
        const periodEnd = new Date('2026-01-15T12:00:00.000Z');
        const timestamp = { seconds: Math.floor(periodEnd.getTime() / 1000), toDate: () => periodEnd };
        const before = { status: 'active', role: 'pro', cancel_at_period_end: false };
        const after = { status: 'active', role: 'pro', cancel_at_period_end: true, current_period_end: timestamp };
        const current = { ...after, cancel_at_period_end: false };

        await checkAndSendSubscriptionEmails(
            'user1',
            'sub1',
            before,
            after,
            'evt-stale-cancellation',
            current,
            [{ id: 'sub1', data: current }],
        );

        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should skip cancellation mail while another active subscription continues', async () => {
        const periodEnd = new Date('2026-01-15T12:00:00.000Z');
        const timestamp = { seconds: Math.floor(periodEnd.getTime() / 1000), toDate: () => periodEnd };
        const before = { status: 'active', role: 'pro', cancel_at_period_end: false };
        const after = { status: 'active', role: 'pro', cancel_at_period_end: true, current_period_end: timestamp };
        const continuing = {
            status: 'active',
            role: 'basic',
            cancel_at_period_end: false,
            current_period_end: timestamp,
        };

        await checkAndSendSubscriptionEmails(
            'user1',
            'sub1',
            before,
            after,
            'evt-continuing-entitlement',
            after,
            [
                { id: 'sub1', data: after },
                { id: 'sub2', data: continuing },
            ],
        );

        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should queue one cancellation mail for the latest ending subscription', async () => {
        const earlierEnd = new Date('2026-01-15T12:00:00.000Z');
        const laterEnd = new Date('2026-02-01T12:00:00.000Z');
        const earlierTimestamp = { seconds: Math.floor(earlierEnd.getTime() / 1000), toDate: () => earlierEnd };
        const laterTimestamp = { seconds: Math.floor(laterEnd.getTime() / 1000), toDate: () => laterEnd };
        const before = { status: 'active', role: 'pro', cancel_at_period_end: false };
        const after = {
            status: 'active',
            role: 'pro',
            cancel_at_period_end: true,
            current_period_end: earlierTimestamp,
        };
        const laterSubscription = {
            status: 'active',
            role: 'basic',
            cancel_at_period_end: true,
            current_period_end: laterTimestamp,
        };

        await checkAndSendSubscriptionEmails(
            'user1',
            'sub1',
            before,
            after,
            'evt-all-ending',
            after,
            [
                { id: 'sub1', data: after },
                { id: 'sub2', data: laterSubscription },
            ],
        );

        expect(docSpy).toHaveBeenCalledWith(`cancellation_sub2_${laterTimestamp.seconds}`);
        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({
                name: 'subscription_cancellation',
                data: expect.objectContaining({
                    role: 'Basic',
                    expiration_date: '1 February 2026',
                    grace_period_end: '3 March 2026',
                    device_sync_will_end: true,
                }),
            }),
        }));
    });

    it('should NOT queue email if document already exists (idempotency)', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'basic' };
        const after = { status: 'active', role: 'pro' };
        const eventId = 'evt5';

        // Mock existence
        getSpy.mockResolvedValue({ exists: true });

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(docSpy).toHaveBeenCalledWith(`upgrade_${eventId}`);
        expect(setSpy).not.toHaveBeenCalled();
        expect(runTransactionSpy).toHaveBeenCalledTimes(1);
    });

    it('should atomically skip mail creation when deletion starts before queueing', async () => {
        getUserDeletionGuardStateInTransaction.mockResolvedValue({
            shouldSkip: true,
            userExists: true,
            deletionInProgress: true,
        });

        await checkAndSendSubscriptionEmails(
            'user1',
            'sub1',
            { status: 'active', role: 'basic' },
            { status: 'active', role: 'pro' },
            'evt-delete-race',
        );

        expect(getUserDeletionGuardStateInTransaction).toHaveBeenCalled();
        expect(setSpy).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Edge Cases & Negative Tests
    // -------------------------------------------------------------------------

    it('should NOT queue WELCOME email if user was ALREADY active (idempotency/logic check)', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        // Was active before
        const before = { status: 'active', role: 'pro' };
        // Still active
        const after = { status: 'active', role: 'pro' };
        const eventId = 'evt_neg_1';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        // Should check for welcome email?
        // The logic checks: isNowActive && !wasActive
        // isNowActive = true. wasActive = true.
        // So it should NOT enter the welcome block.
        expect(docSpy).not.toHaveBeenCalledWith(`welcome_email_${subId}`);
    });

    it('should NOT queue UPGRADE email if role does not change', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'pro' };
        const after = { status: 'active', role: 'pro' };
        const eventId = 'evt_neg_2';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        // No role change, no email
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should NOT queue CANCELLATION email if already cancelled', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'pro', cancel_at_period_end: true };
        const after = { status: 'active', role: 'pro', cancel_at_period_end: true };
        const eventId = 'evt_neg_3';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        // Condition !before.cancel && after.cancel is false
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should handle missing role gracefully (no upgrade/downgrade)', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active' }; // missing role
        const after = { status: 'active', role: 'pro' };
        const eventId = 'evt_neg_4';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        // oldRole is undefined. Not equal to newRole.
        // But logic requires (oldRole && newRole && ...) ?
        // Implementation:
        // const oldRole = before.role;
        // const newRole = after.role;
        // if (oldRole && newRole && oldRole !== newRole)
        // So it should return early.

        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should NOT crash if user has no email in auth', async () => {
        const uid = 'user_no_email';
        const subId = 'sub1';
        const before = { status: 'active', role: 'basic' };
        const after = { status: 'active', role: 'pro' };
        const eventId = 'evt_neg_5';

        getUserSpy.mockResolvedValue({ email: null });

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        // Should attempt to get user, see no email, and return
        expect(getUserSpy).toHaveBeenCalledWith(uid);
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should properly format display names for Basic/Pro/Free', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'basic' };
        const after = { status: 'active', role: 'pro' };
        const eventId = 'evt_fmt_1';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            template: {
                name: 'subscription_upgrade',
                data: expect.objectContaining({
                    new_role: 'Pro',
                    old_role: 'Basic'
                })
            },
            expireAt: expect.any(Object)
        }));
    });
    it('should use raw role name if display name not found (Unknown Role Upgrade)', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'basic' };
        // 'alien-lord' is not in ROLE_HIERARCHY, so level 0. basic is 1.
        // Wait, if new level is 0 and old is 1, that's a downgrade.
        // Let's test upgrade with something higher than pro if possible, or just custom logic?
        // Actually, if it returns 0, it counts as Free.
        // To test lookup failure but still passing logic, we need to mock ROLE_HIERARCHY to include it but not display name?
        // The mock in line 7 hardcodes the hierarchy.
        // Let's test the Display Name fallback specifically.

        // We can't easily change the mocked hierarchy mid-test without re-importing or using doMock.
        // However, we CAN test the fallback in cancellation which doesn't check hierarchy.
        const after = {
            status: 'active',
            role: 'unknown-role',
            cancel_at_period_end: true,
            current_period_end: { seconds: 123, toDate: () => new Date() }
        };
        const eventId = 'evt_unknown_1';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({
                data: expect.objectContaining({
                    role: 'unknown-role'
                })
            })
        }));
    });

    it('should use raw role name if display name not found (Downgrade)', async () => {
        // Mock hierarchy logic implies:
        // old=basic(1), new=unknown(0). 0 < 1 => Downgrade.
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'basic' };
        const after = { status: 'active', role: 'unknown-role' };
        const eventId = 'evt_unknown_2';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({
                name: 'subscription_downgrade',
                data: expect.objectContaining({
                    new_role: 'unknown-role',
                    plan_details_available: false,
                    activity_description: '',
                    route_description: ''
                })
            })
        }));
    });
    it('should use raw role name for OLD role if display name not found (Upgrade)', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'mystery-tier' };
        const after = { status: 'active', role: 'pro' };
        const eventId = 'evt_unknown_3';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({
                name: 'subscription_upgrade',
                data: expect.objectContaining({
                    old_role: 'mystery-tier',
                    new_role: 'Pro'
                })
            })
        }));
    });
    it('should use raw string for old_role if high-tier role has no display name (Fallback)', async () => {
        const uid = 'user_vip';
        const subId = 'sub_vip';
        const before = { status: 'active', role: 'hidden_vip' };
        const after = { status: 'active', role: 'basic' };
        const eventId = 'evt_fallback_1';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({
                name: 'subscription_downgrade',
                data: expect.objectContaining({
                    old_role: 'hidden_vip', // Fallback!
                    new_role: 'Basic'
                })
            })
        }));
    });

    it('should use raw role name if display name not found (Welcome)', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = undefined;
        const after = { status: 'active', role: 'mystery-tier' };
        const eventId = 'evt_welcome_unknown';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({
                name: 'welcome_email',
                data: expect.objectContaining({
                    role: 'mystery-tier',
                    plan_details_available: false,
                    activity_description: ''
                })
            })
        }));
    });

    it('should use raw role name for NEW role if display name not found (Upgrade)', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const before = { status: 'active', role: 'basic' };
        const after = { status: 'active', role: 'super_pro' };
        const eventId = 'evt_upgrade_unknown';

        await checkAndSendSubscriptionEmails(uid, subId, before, after, eventId);

        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({
                name: 'subscription_upgrade',
                data: expect.objectContaining({
                    old_role: 'Basic',
                    new_role: 'Super Pro' // In our mock, super_pro has a display name
                })
            })
        }));
    });
    it('should NOT queue WELCOME email if user has no email in auth', async () => {
        vi.mocked(admin.auth().getUser).mockResolvedValueOnce({ uid: 'u1', email: undefined } as any);
        await checkAndSendSubscriptionEmails('u1', 's1', undefined, { status: 'active', role: 'pro' }, 'e1');
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should NOT queue UPGRADE email if user has no email in auth', async () => {
        vi.mocked(admin.auth().getUser).mockResolvedValueOnce({ uid: 'u1', email: undefined } as any);
        await checkAndSendSubscriptionEmails('u1', 's1', { role: 'basic' }, { role: 'pro' }, 'e1');
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should NOT queue DOWNGRADE email if user has no email in auth', async () => {
        vi.mocked(admin.auth().getUser).mockResolvedValueOnce({ uid: 'u1', email: undefined } as any);
        await checkAndSendSubscriptionEmails('u1', 's1', { role: 'pro' }, { role: 'basic' }, 'e1');
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should NOT queue CANCELLATION email if user has no email in auth', async () => {
        vi.mocked(admin.auth().getUser).mockResolvedValueOnce({ uid: 'u1', email: undefined } as any);
        await checkAndSendSubscriptionEmails('u1', 's1', { cancel_at_period_end: false }, { cancel_at_period_end: true, current_period_end: { seconds: 123 } }, 'e1');
        expect(setSpy).not.toHaveBeenCalled();
    });
});
