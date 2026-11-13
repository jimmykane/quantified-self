import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { stripeAllowsInactivity } from './inactivity-billing';
const fixture = () => ({
    customers: { list: vi.fn().mockResolvedValue({ data: [{ id: 'cus_synthetic' }], has_more: false }),
        retrieve: vi.fn().mockResolvedValue({ id: 'cus_synthetic', metadata: { firebaseUID: 'synthetic' } }) },
    subscriptions: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) },
    subscriptionSchedules: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) },
    checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) } },
});
const check = (stripe: ReturnType<typeof fixture>, customer: string | null = 'cus_synthetic') =>
    stripeAllowsInactivity(stripe as unknown as Stripe, 'synthetic', 'synthetic@example.com', customer);
describe('read-only Stripe inactivity check', () => {
    it('allows a Free account with no customer or a fully ended subscription', async () => {
        const stripe = fixture();
        stripe.subscriptions.list.mockResolvedValue({ data: [{ status: 'canceled' }, { status: 'incomplete_expired' }], has_more: false });
        expect(await check(stripe)).toBe(true);
        stripe.customers.list.mockResolvedValue({ data: [], has_more: false });
        expect(await check(stripe, null)).toBe(true);
    });
    it.each(['active', 'trialing', 'past_due', 'paused', 'unpaid', 'incomplete', 'unknown'])('holds %s subscriptions regardless of role or cancellation scheduling', async status => {
        const stripe = fixture(); stripe.subscriptions.list.mockResolvedValue({ data: [{ status, role: 'free', cancel_at_period_end: true }], has_more: false });
        expect(await check(stripe)).toBe(false);
    });
    it.each(['not_started', 'active', 'unknown'])('protects %s schedules', async status => {
        const stripe = fixture(); stripe.subscriptionSchedules.list.mockResolvedValue({ data: [{ status }], has_more: false });
        expect(await check(stripe)).toBe(false);
    });
    it.each([{ status: 'open', payment_status: 'unpaid' }, { status: 'complete', payment_status: 'unpaid' }, { status: 'unknown' }])('protects unfinished checkout %j', async session => {
        const stripe = fixture(); stripe.checkout.sessions.list.mockResolvedValue({ data: [session], has_more: false });
        expect(await check(stripe)).toBe(false);
    });
    it('protects unbound/duplicate/conflicting customers without linking them', async () => {
        const stripe = fixture(); expect(await check(stripe, null)).toBe(false);
        stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_other' }], has_more: false });
        expect(await check(stripe)).toBe(false);
        stripe.customers.list.mockResolvedValue({ data: [], has_more: false });
        stripe.customers.retrieve.mockResolvedValue({ metadata: { firebaseUID: 'other' } });
        expect(await check(stripe)).toBe(false);
        stripe.customers.retrieve.mockResolvedValue({ deleted: true });
        expect(await check(stripe)).toBe(false);
    });
    it('invalidates an old warning when a membership or checkout existed after it, even if now ended', async () => {
        const stripe = fixture(); stripe.subscriptions.list.mockResolvedValue({ data: [{ status: 'canceled', created: 10, canceled_at: 200 }], has_more: false });
        expect(await stripeAllowsInactivity(stripe as unknown as Stripe, 'synthetic', 'synthetic@example.com', 'cus_synthetic', 100000)).toBe(false);
        stripe.subscriptions.list.mockResolvedValue({ data: [], has_more: false });
        stripe.checkout.sessions.list.mockResolvedValue({ data: [{ status: 'expired', created: 200 }], has_more: false });
        expect(await stripeAllowsInactivity(stripe as unknown as Stripe, 'synthetic', 'synthetic@example.com', 'cus_synthetic', 100000)).toBe(false);
    });
    it('never treats truncated or failed checks as eligibility', async () => {
        for (const key of ['customers', 'subscriptions', 'subscriptionSchedules', 'checkout'] as const) {
            const stripe = fixture(); const mock = key === 'checkout' ? stripe.checkout.sessions.list : stripe[key].list;
            mock.mockResolvedValue({ data: [], has_more: true });
            expect(await check(stripe)).toBe(false);
            mock.mockRejectedValue(new Error('synthetic outage'));
            await expect(check(stripe)).rejects.toThrow('synthetic outage');
        }
    });
});
