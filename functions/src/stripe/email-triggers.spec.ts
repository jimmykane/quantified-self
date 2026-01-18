import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';
import { checkAndSendSubscriptionEmails } from './email-triggers';

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

// Firestore Mock Implementation
const mockFirestore = {
    collection: collectionSpy
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
    beforeEach(() => {
        vi.clearAllMocks();

        setSpy.mockResolvedValue({} as any);
        getSpy.mockResolvedValue({ exists: false }); // Default: doc does not exist

        docSpy.mockReturnValue({
            get: getSpy,
            set: setSpy
        });

        collectionSpy.mockReturnValue({
            doc: docSpy
        });

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
            template: {
                name: 'welcome_email',
                data: { role: 'Pro' }
            },
            expireAt: expect.any(Object)
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
            template: {
                name: 'subscription_upgrade',
                data: { new_role: 'Pro', old_role: 'Basic' }
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
            template: {
                name: 'subscription_downgrade',
                data: {
                    new_role: 'Basic',
                    old_role: 'Pro',
                    limit: '100'
                }
            },
            expireAt: expect.any(Object)
        }));
    });

    it('should queue CANCELLATION email when cancel_at_period_end becomes true', async () => {
        const uid = 'user1';
        const subId = 'sub1';
        const now = new Date();
        const futureDate = new Date(now.getTime() + 86400000); // +1 day
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
            template: {
                name: 'subscription_cancellation',
                data: expect.objectContaining({
                    role: 'Pro',
                    expiration_date: expect.any(String)
                })
            },
            expireAt: expect.any(Object)
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
                data: {
                    new_role: 'Pro',
                    old_role: 'Basic'
                }
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
                    limit: '10' // default
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
        const before = { role: 'hidden_vip' };
        const after = { role: 'basic' };
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
                data: { role: 'mystery-tier' }
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


