import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { assertLocalBillingEnvironment, billingControl, billingEvent, checkoutRequest, projectionUnchanged, returnUrl, safeBillingError } from './model';
import { invoiceProjection, priceProjections, subscriptionProjection } from './projections';
import type Stripe from 'stripe';
import { Decimal } from 'stripe';

const request = { price: 'price_test', mode: 'subscription', success_url: 'https://quantified-self.io/subscriptions?success=true',
  cancel_url: 'https://beta.quantified-self.io/subscriptions', allow_promotion_codes: true,
  automatic_tax: { enabled: true }, metadata: { firebaseUID: 'owner' }, payment_method_collection: 'if_required' };
describe('billing trust boundaries', () => {
  it('defaults to dormant processors and closed admission', () => {
    expect(billingControl()).toEqual({ owner: 'extension', requestsEnabled: false, nativeSince: null });
  });
  it('accepts the existing browser request and one-time payments', () => {
    expect(checkoutRequest(request, 'owner').price).toBe('price_test');
    expect(checkoutRequest({ ...request, mode: 'payment' }, 'owner').mode).toBe('payment');
  });
  it.each([
    { customer: 'cus_foreign' }, { line_items: [] }, { sessionId: 'cs_forged' }, { url: 'https://evil.example' },
    { metadata: { firebaseUID: 'other' } }, { metadata: { firebaseUID: 'owner', role: 'pro' } },
    { trial_period_days: -1 }, { trial_period_days: 731 }, { trial_period_days: 1.5 },
    { mode: 'payment', trial_period_days: 7 }, { automatic_tax: { enabled: false } },
    { promotion_code: 'promo_arbitrary' }, { allow_promotion_codes: false }, { price: 'price_a/path' },
  ])('rejects forged or unsupported request fields %j', change => {
    expect(() => checkoutRequest({ ...request, ...change }, 'owner')).toThrow();
  });
  it.each(['https://evil.example', 'https://quantified-self.io.evil.example', 'https://user@quantified-self.io/',
    'javascript:alert(1)', '//quantified-self.io', 'http://quantified-self.io', 'http://localhost:4200'])('rejects unsafe production return URL %s', url => {
    expect(() => returnUrl(url)).toThrow();
  });
  it('allows loopback URLs only in explicit local mode', () => {
    expect(returnUrl('http://127.0.0.1:4200/subscriptions', true)).toContain('127.0.0.1');
  });
  it('does not reveal raw Stripe failures', () => {
    expect(JSON.stringify(safeBillingError(new Error('sk_live_PRIVATE card PRIVATE email')))).not.toContain('PRIVATE');
  });
  it('rejects partial, hybrid, or live local configurations', () => {
    const valid = { FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-billing',
      ['FIRESTORE_' + 'EMULATOR_HOST']: '127.0.0.1:8080', ['FIREBASE_AUTH_' + 'EMULATOR_HOST']: 'localhost:9099', STRIPE_BILLING_KEY: 'rk_test_fixture' };
    expect(() => assertLocalBillingEnvironment(valid)).not.toThrow();
    for (const change of [{ GCLOUD_PROJECT: 'quantified-self-io' }, { STRIPE_BILLING_KEY: 'sk_live_fixture' },
      { STRIPE_SECRET_KEY: 'sk_live_fixture' }, { ['FIRESTORE_' + 'EMULATOR_HOST']: 'remote:8080' }]) {
      expect(() => assertLocalBillingEnvironment({ ...valid, ...change })).toThrow();
    }
  });
  it('retains only event identifiers, never event-version provider data', () => {
    const event = billingEvent({ id: 'evt_test', type: 'customer.subscription.updated', created: 10, livemode: false,
      data: { object: { id: 'sub_test', customer: 'cus_test', email: 'PRIVATE', metadata: { role: 'admin' } } } });
    expect(event).toEqual({ eventId: 'evt_test', type: 'customer.subscription.updated', created: 10, livemode: false,
      kind: 'subscription', objectId: 'sub_test', customerId: 'cus_test' });
  });
  it.each(['invoice.upcoming', 'invoice.deleted'])('skips nonpersistent %s notifications without poisoning a replay window', type => {
    const event = billingEvent({ id: 'evt_preview', type, created: 10, livemode: false,
      data: { object: { ...(type === 'invoice.deleted' ? { id: 'in_deleted' } : {}), customer: 'cus_test' } } });
    expect(event).toBeNull();
  });
  it('compares projections independently of unrelated application-owned fields', () => {
    const data = { created: Timestamp.fromMillis(1000), role: 'pro', nested: { a: 1, b: 2 } };
    expect(projectionUnchanged({ ...data, gracePeriodUntil: 99 }, { ...data, nested: { b: 2, a: 1 } })).toBe(true);
    expect(projectionUnchanged(data, { ...data, role: 'basic' })).toBe(false);
  });
});
describe('current Stripe API to existing Firestore contract', () => {
  it('normalizes tier amounts from the Stripe SDK without losing decimal precision', () => {
    const price = { id: 'price_tiered', product: 'prod_test', metadata: {}, tiers: [
      { up_to: 100, unit_amount: null, unit_amount_decimal: Decimal.from('0.123456789012'), flat_amount: 0, flat_amount_decimal: Decimal.from('0') },
    ] } as unknown as Stripe.Price;
    expect(priceProjections(price)[0].data.tiers).toEqual([
      { up_to: 100, unit_amount: null, unit_amount_decimal: '0.123456789012', flat_amount: 0, flat_amount_decimal: '0' },
    ]);
  });
  it('uses item periods and trusted product roles while preserving references and dates', () => {
    const db = { doc: (path: string) => ({ path }) };
    const sub = { id: 'sub_test', status: 'trialing', livemode: false, metadata: { role: 'admin' }, created: 1,
      trial_start: 2, trial_end: 3, cancel_at: 4, canceled_at: null, ended_at: null, cancel_at_period_end: true,
      items: { data: [
        { id: 'si_one', current_period_start: 5, current_period_end: 10, quantity: 1, price: { id: 'price_one', product: 'prod_one', metadata: { firebaseRole: 'admin' } } },
        { id: 'si_two', current_period_start: 6, current_period_end: 20, quantity: 1, price: { id: 'price_two', product: 'prod_two', metadata: {} } },
      ], has_more: false } } as unknown as Stripe.Subscription;
    const projection = subscriptionProjection(db as never, 'owner', sub, [{ id: 'prod_one', metadata: { firebaseRole: 'basic' } }] as Stripe.Product[]);
    expect(projection.path).toBe('customers/owner/subscriptions/sub_test');
    expect(projection.data).toMatchObject({ role: 'basic', price: { path: 'products/prod_one/prices/price_one' }, cancel_at_period_end: true });
    expect(projection.data.current_period_start.toMillis()).toBe(5000);
    expect(projection.data.current_period_end.toMillis()).toBe(20000);
    expect(projection.data.trial_end.toMillis()).toBe(3000);
  });
  it('creates a Rules price index with bounded server-authored trial days', () => {
    const price = { id: 'price_test', product: 'prod_test', active: true, type: 'recurring', metadata: { trial_days: '7' } } as unknown as Stripe.Price;
    expect(priceProjections(price)[1]).toEqual({ path: 'stripeBillingPrices/price_test', data: { active: true, product: 'prod_test', mode: 'subscription', trialDays: 7 } });
  });
  it('uses the current invoice parent subscription location', () => {
    const invoice = { id: 'in_test', parent: { subscription_details: { subscription: 'sub_test' } } } as Stripe.Invoice;
    expect(invoiceProjection('owner', invoice)?.path).toBe('customers/owner/subscriptions/sub_test/invoices/in_test');
    expect(invoiceProjection('owner', { ...invoice, parent: null })).toBeNull();
  });
});
