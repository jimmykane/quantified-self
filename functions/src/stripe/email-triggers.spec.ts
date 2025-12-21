import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';
import { checkAndSendSubscriptionEmails } from './email-triggers';

// Mock pricing
vi.mock('../shared/pricing', () => ({
    ROLE_HIERARCHY: {
        'free': 0,
        'basic': 1,
        'pro': 2
    }
}));

describe('checkAndSendSubscriptionEmails', () => {
    let firestoreSpy: any;
    let authSpy: any;
    let collectionSpy: any;
    let docSpy: any;
    let getSpy: any;
    let setSpy: any;
    let getUserSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();

        setSpy = vi.fn().mockResolvedValue({} as any);
        getSpy = vi.fn().mockResolvedValue({ exists: false }); // Default: doc does not exist

        docSpy = vi.fn().mockReturnValue({
            get: getSpy,
            set: setSpy
        });

        collectionSpy = vi.fn().mockReturnValue({
            doc: docSpy
        });

        firestoreSpy = vi.spyOn(admin, 'firestore').mockReturnValue({
            collection: collectionSpy
        } as any);

        getUserSpy = vi.fn().mockResolvedValue({ email: 'test@example.com' });
        authSpy = vi.spyOn(admin, 'auth').mockReturnValue({
            getUser: getUserSpy
        } as any);
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
                data: { role: 'pro' }
            }
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
            }
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
            }
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
            }
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
            }
        }));
    });
});
