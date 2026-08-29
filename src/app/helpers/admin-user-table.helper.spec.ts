import { describe, expect, it } from 'vitest';
import type { AdminUser } from '../services/admin.service';
import { buildAdminUserTableRows } from './admin-user-table.helper';

function user(overrides: Partial<AdminUser> = {}): AdminUser {
    return {
        uid: 'u1',
        email: 'user@example.com',
        customClaims: {},
        metadata: { creationTime: '2026-01-02T00:00:00.000Z', lastSignInTime: '2026-02-03T12:30:00.000Z' },
        disabled: false,
        providerIds: ['password'],
        ...overrides,
    };
}

describe('admin user table helper', () => {
    it('precomputes role, subscription, service, and date presentation', () => {
        const rows = buildAdminUserTableRows([user({
            customClaims: { stripeRole: 'pro' },
            subscription: { status: 'active', cancel_at_period_end: true, current_period_end: { seconds: 1767225600, nanoseconds: 0 } },
            connectedServices: [{ provider: 'garmin', connectedAt: '2026-01-10T00:00:00.000Z' }],
        })], 'en-US');

        expect(rows[0]).toMatchObject({
            role: 'pro',
            isAdmin: false,
            subscriptionState: 'scheduled',
            subscriptionLabel: 'Cancel Scheduled',
            subscriptionDetails: expect.stringContaining('Ends'),
            createdLabel: expect.any(String),
            lastLoginLabel: expect.any(String),
        });
        expect(rows[0].connectedServices[0]).toMatchObject({ provider: 'garmin', connectedAtLabel: expect.any(String) });
        expect(rows[0].connectedServices[0].sourceServiceName).not.toBeNull();
    });

    it('represents canceled and never-subscribed users without template methods', () => {
        const rows = buildAdminUserTableRows([
            user({ uid: 'canceled', hasSubscribedOnce: true }),
            user({ uid: 'never', customClaims: { admin: true } }),
        ], 'en-US');

        expect(rows[0]).toMatchObject({ subscriptionState: 'canceled', subscriptionLabel: 'Canceled' });
        expect(rows[1]).toMatchObject({ subscriptionState: 'never', subscriptionLabel: 'Never Subscribed', isAdmin: true });
    });
});
