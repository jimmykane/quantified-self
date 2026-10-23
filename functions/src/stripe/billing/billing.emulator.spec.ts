import { replayBillingJob } from './replay';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { BILLING_ACCOUNTS, BILLING_CONTROL, BILLING_JOBS, billingId, type BillingEvent } from './model';
import { admitBillingCheckout, admitBillingEvent, processBillingJob } from './queue';
import { acquireBillingLease, createBillingPortal, releaseBillingLease, requestBillingDeletion } from './service';
import { dispatchBillingJob } from './dispatch';
import { PROVIDER_MAX_RETRY_COUNT } from '../../shared/queue-config';

vi.unmock('firebase-admin');
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
const unique = () => randomUUID().replaceAll('-', '');
describe.skipIf(!enabled)('native Stripe billing transactions', { timeout: 30_000 }, () => {
  let db: admin.firestore.Firestore;
  beforeAll(async () => {
    for (const host of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST])
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host ?? '')) throw new Error('Loopback required');
    admin.initializeApp({ projectId: 'demo-stripe-billing-tests' }); db = admin.firestore();
    await db.doc(BILLING_CONTROL).set({ owner: 'native', requestsEnabled: true, webhooksEnabled: true, nativeSince: Timestamp.fromMillis(1) });
  });
  afterAll(async () => { await admin.app().delete(); });

  async function fixture(mode: 'subscription' | 'payment' = 'subscription') {
    const uid = unique(), requestId = unique(), customerId = `cus_${uid}`, priceId = `price_${uid}`, productId = `prod_${uid}`;
    const customer = { id: customerId, livemode: false, metadata: { firebaseUID: uid }, email: 'synthetic@example.com' };
    const price = { id: priceId, product: productId, type: mode === 'subscription' ? 'recurring' : 'one_time', active: true,
      unit_amount: 1000, currency: 'eur', recurring: mode === 'subscription' ? { interval: 'month', interval_count: 1 } : null, metadata: { trial_days: '7' } };
    const product = { id: productId, active: true, metadata: { firebaseRole: 'basic' }, name: 'Synthetic billing product' };
    const sub = { id: `sub_${uid}`, customer: customerId, status: 'active', created: 100,
      livemode: false, metadata: {}, cancel_at_period_end: false, trial_start: null, trial_end: null, cancel_at: null, canceled_at: null, ended_at: null,
      items: { data: [{ id: 'si_fixture', price, quantity: 1, current_period_start: 100, current_period_end: 200 }], has_more: false } };
    let acceptedCustomer = false;
    const sessions = new Map<string, any>();
    const stripe = {
      customers: {
        create: vi.fn(async (_params: unknown, _opts: unknown) => { acceptedCustomer = true; return customer; }),
        retrieve: vi.fn(async () => customer), search: vi.fn(async () => ({ data: acceptedCustomer ? [customer] : [], has_more: false })),
        del: vi.fn(async () => ({ id: customerId, deleted: true })),
      },
      prices: { retrieve: vi.fn(async () => price) }, products: { retrieve: vi.fn(async () => product) },
      subscriptions: { list: vi.fn(async () => ({ data: [] as any[], has_more: false })), retrieve: vi.fn(async () => sub) },
      checkout: { sessions: {
        create: vi.fn(async (params: any, opts: any) => {
          if (!sessions.has(opts.idempotencyKey)) sessions.set(opts.idempotencyKey, { id: `cs_${opts.idempotencyKey}`, status: 'open', customer: params.customer,
            url: 'https://checkout.stripe.com/c/pay/synthetic', metadata: params.metadata });
          return sessions.get(opts.idempotencyKey);
        }),
        retrieve: vi.fn(async (id: string) => [...sessions.values()].find(s => s.id === id)),
        list: vi.fn(async () => ({ data: [...sessions.values()], has_more: false })),
      } },
      billingPortal: { sessions: { create: vi.fn(async () => ({ url: 'https://billing.stripe.com/p/session/synthetic' })) } },
    };
    await db.doc(`users/${uid}`).set({ synthetic: true });
    await db.doc(`products/${productId}`).set(product);
    await db.doc(`products/${productId}/prices/${priceId}`).set(price);
    const request = { price: priceId, mode, success_url: 'https://quantified-self.io/subscriptions', cancel_url: 'https://quantified-self.io/subscriptions',
      automatic_tax: { enabled: true }, allow_promotion_codes: true, metadata: { firebaseUID: uid } };
    const ref = db.doc(`customers/${uid}/checkout_sessions/${requestId}`);
    await ref.set(request);
    const ctx = { db, stripe: stripe as unknown as Stripe, auth: { getUser: vi.fn(async () => ({ uid, email: 'synthetic@example.com' })) } as any };
    const admit = () => admitBillingCheckout(db, uid, requestId, request, Timestamp.now());
    const run = (id: string, generation = 0) => processBillingJob(ctx, id, generation);
    const readyRetry = (id: string) => db.collection(BILLING_JOBS).doc(id).update({ dueAt: Timestamp.fromMillis(0) });
    const event = (): BillingEvent => ({ eventId: `evt_${unique()}`, type: 'customer.subscription.updated', objectId: sub.id,
      customerId, created: 1, livemode: false, kind: 'subscription' });
    return { uid, requestId, customerId, customer, product, price, sub, stripe, ctx, request, ref, admit, run, readyRetry, event, sessions };
  }
  it('creates one durable customer and checkout, retaining automatic tax, promotions and trial policy', async () => {
    const f = await fixture();
    const data = { ...f.request, trial_period_days: 7 };
    await f.ref.set(data);
    const id = await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now());
    await f.run(id!); await f.run(id!);
    expect(f.stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ customer: f.customerId, allow_promotion_codes: true,
      automatic_tax: { enabled: true }, subscription_data: { billing_mode: { type: 'classic' }, trial_period_days: 7 }, line_items: [{ price: f.price.id, quantity: 1 }] });
    expect((await f.ref.get()).data()).toMatchObject({ sessionId: expect.stringMatching(/^cs_/), url: expect.stringContaining('checkout.stripe.com'), error: null });
    expect((await db.doc(`customers/${f.uid}`).get()).get('stripeId')).toBe(f.customerId);
  });
  it('reuses a returning customer and supports one-time payment checkout', async () => {
    const f = await fixture('payment');
    await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    await f.run((await f.admit())!);
    expect(f.stripe.customers.create).not.toHaveBeenCalled();
    expect(f.stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ mode: 'payment', payment_intent_data: { metadata: { firebaseUID: f.uid } } });
  });
  it('persists paid Checkout line items with Stripe SDK decimal values as JSON strings', async () => {
    const f = await fixture('payment'); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    class StripeDecimal { toJSON() { return '500.00'; } }
    const payment = { id: `pi_${unique()}`, customer: f.customerId, amount: 500, amount_received: 500,
      status: 'succeeded', currency: 'eur', created: 123, description: null, metadata: {}, latest_charge: null };
    Object.assign(f.stripe, { paymentIntents: { retrieve: vi.fn(async () => payment) } });
    f.stripe.checkout.sessions.list.mockResolvedValue({ data: [{ id: 'cs_payment' }], has_more: false });
    Object.assign(f.stripe.checkout.sessions, { listLineItems: vi.fn(async () => ({ has_more: false,
      data: [{ id: 'li_payment', quantity: 1, amount_total: 500, price: { ...f.price, unit_amount_decimal: new StripeDecimal() } }] })) });
    const event = { ...f.event(), kind: 'payment' as const, type: 'payment_intent.succeeded', objectId: payment.id };
    await f.run((await admitBillingEvent(db, event))!);
    const stored = (await db.doc(`customers/${f.uid}/payments/${payment.id}`).get()).data();
    expect(stored?.status).toBe('succeeded');
    expect(stored?.items[0].price.unit_amount_decimal).toBe('500.00');
    expect(stored?.prices[0].path).toBe(`products/${f.product.id}/prices/${f.price.id}`);
  });
  it('serializes simultaneous customer checkouts and reuses the open session across request documents', async () => {
    const f = await fixture(); const id = (await f.admit())!;
    const outcomes = await Promise.allSettled([f.run(id), f.run(id)]);
    expect(outcomes.some(o => o.status === 'fulfilled')).toBe(true);
    await f.run(id);
    const other = unique(); await db.doc(`customers/${f.uid}/checkout_sessions/${other}`).set(f.request);
    const next = await admitBillingCheckout(db, f.uid, other, f.request, Timestamp.now()); await f.run(next!);
    expect(f.stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await db.doc(`customers/${f.uid}/checkout_sessions/${other}`).get()).get('sessionId')).toBe((await f.ref.get()).get('sessionId'));
  });
  it('recovers an accepted customer after a lost reply without a replacement create', async () => {
    const f = await fixture(); const create = f.stripe.customers.create.getMockImplementation()!;
    f.stripe.customers.create.mockImplementationOnce(async (...args) => { await create(...args); throw new Error('lost response'); });
    const id = (await f.admit())!; await expect(f.run(id)).rejects.toThrow();
    await f.readyRetry(id); await f.run(id);
    expect(f.stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(f.stripe.customers.search).toHaveBeenCalledTimes(1);
    expect((await f.ref.get()).get('sessionId')).toBeTruthy();
  });
  it('retries an uncertain checkout with the identical frozen parameters and key', async () => {
    const f = await fixture(); const create = f.stripe.checkout.sessions.create.getMockImplementation()!;
    f.stripe.checkout.sessions.create.mockImplementationOnce(async (...args) => { await create(...args); throw new Error('lost response'); });
    const id = (await f.admit())!; await expect(f.run(id)).rejects.toThrow();
    await f.readyRetry(id); await f.run(id);
    expect(f.stripe.checkout.sessions.create.mock.calls[0]).toEqual(f.stripe.checkout.sessions.create.mock.calls[1]);
    expect(f.sessions.size).toBe(1);
  });
  it('blocks blind create after the Stripe idempotency window', async () => {
    const f = await fixture(); f.stripe.checkout.sessions.create.mockRejectedValue(new Error('timeout'));
    const id = (await f.admit())!; await expect(f.run(id)).rejects.toThrow();
    await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`).update({ startedAt: Timestamp.fromMillis(Date.now() - 24 * 3_600_000) });
    await f.readyRetry(id); await f.run(id);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await f.ref.get()).get('error.code')).toBe('operation_uncertain');
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('failed');
  });
  it('retains a confirmed rejected checkout and permits only a new browser request to try again', async () => {
    const f = await fixture();
    f.stripe.checkout.sessions.create.mockRejectedValueOnce({ type: 'StripeInvalidRequestError', statusCode: 400 });
    const id = (await f.admit())!; await f.run(id);
    const operation = db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`);
    const rejected = (await operation.get()).data();
    expect(rejected?.rejected).toBe(true);
    expect((await f.ref.get()).get('error.code')).toBe('checkout_rejected');
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).get('activeCheckout')).toBeUndefined();
    await replayBillingJob(db, id, true); await f.run(id, 1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const nextRequest = unique(); await db.doc(`customers/${f.uid}/checkout_sessions/${nextRequest}`).set(f.request);
    await f.run((await admitBillingCheckout(db, f.uid, nextRequest, f.request, Timestamp.now()))!);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect((await operation.get()).data()).toEqual(rejected);
    expect((await db.doc(`customers/${f.uid}/checkout_sessions/${nextRequest}`).get()).get('sessionId')).toBeTruthy();
  });
  it.each([409, 500])('does not replace a checkout after an uncertain HTTP %s outcome', async statusCode => {
    const f = await fixture();
    f.stripe.checkout.sessions.create.mockRejectedValue({ type: 'StripeInvalidRequestError', statusCode });
    await expect(f.run((await f.admit())!)).rejects.toThrow();
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`).get()).get('rejected')).toBeUndefined();
    const next = unique(); await db.doc(`customers/${f.uid}/checkout_sessions/${next}`).set(f.request);
    await f.run((await admitBillingCheckout(db, f.uid, next, f.request, Timestamp.now()))!);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it.each(['active', 'trialing', 'past_due'])('refuses another subscription when current status is %s', async status => {
    const f = await fixture(); f.stripe.subscriptions.list.mockResolvedValue({ data: [{ ...f.sub, status }], has_more: false });
    await f.run((await f.admit())!);
    expect(f.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect((await f.ref.get()).get('error.code')).toBe('subscription_exists');
  });
  it('refuses a repeated trial even when the browser requests it', async () => {
    const f = await fixture(); f.stripe.subscriptions.list.mockResolvedValue({ data: [{ ...f.sub, status: 'canceled' }], has_more: false });
    const data = { ...f.request, trial_period_days: 7 }; await f.ref.set(data);
    await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    expect((await f.ref.get()).get('error.code')).toBe('trial_ineligible');
  });
  it('deduplicates and refetches reordered subscription events without unchanged writes', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    const event = f.event(); const id = (await admitBillingEvent(db, event))!;
    expect(await admitBillingEvent(db, event)).toBe(id); await f.run(id);
    const subRef = db.doc(`customers/${f.uid}/subscriptions/${f.sub.id}`);
    const committed = (await subRef.get()).updateTime;
    await f.run((await admitBillingEvent(db, { ...f.event(), created: 0 }))!);
    expect((await subRef.get()).updateTime?.isEqual(committed!)).toBe(true);
    f.sub.status = 'canceled'; f.sub.cancel_at_period_end = true;
    await f.run((await admitBillingEvent(db, f.event()))!);
    expect((await subRef.get()).get('status')).toBe('canceled');
  });
  it('does not accept a foreign or ambiguous customer binding', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    await db.doc(`customers/${unique()}`).set({ stripeId: f.customerId });
    await expect(admitBillingEvent(db, f.event())).rejects.toThrow();
    await f.run((await f.admit())!); expect(f.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('does not rewrite claims, grace fields or subscription emails itself', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    const subRef = db.doc(`customers/${f.uid}/subscriptions/${f.sub.id}`); await subRef.set({ appOwned: true });
    await f.run((await admitBillingEvent(db, f.event()))!);
    expect((await subRef.get()).get('appOwned')).toBe(true);
    expect((await db.doc(`users/${f.uid}`).get()).data()).toEqual({ synthetic: true });
  });
  it('does not recreate public documents after deletion during customer creation; cleanup removes the accepted customer', async () => {
    const f = await fixture(); const create = f.stripe.customers.create.getMockImplementation()!;
    f.stripe.customers.create.mockImplementationOnce(async (...args) => {
      const result = await create(...args);
      await db.doc(`userDeletionTombstones/${f.uid}`).set({}); await requestBillingDeletion(db, f.uid);
      return result;
    });
    await f.run((await f.admit())!);
    expect((await db.doc(`customers/${f.uid}`).get()).exists).toBe(false);
    await f.run(billingId('delete', f.uid));
    expect(f.stripe.customers.del).toHaveBeenCalledWith(f.customerId);
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/customer`).get()).exists).toBe(false);
  });
  it.each(['auth-first', 'document-first'])('preserves deletion identity with %s ordering', async ordering => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    await db.doc(`userDeletionTombstones/${f.uid}`).set({});
    if (ordering === 'auth-first') await requestBillingDeletion(db, f.uid);
    await db.recursiveDelete(db.doc(`customers/${f.uid}`));
    await requestBillingDeletion(db, f.uid, f.customerId);
    if (ordering === 'document-first') await requestBillingDeletion(db, f.uid);
    await f.run(billingId('delete', f.uid));
    expect(f.stripe.customers.del).toHaveBeenCalledWith(f.customerId);
    expect((await db.doc(`customers/${f.uid}`).get()).exists).toBe(false);
  });
  it('fences webhook projection when deletion begins during the API request', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    f.stripe.subscriptions.retrieve.mockImplementationOnce(async () => {
      await db.doc(`userDeletionTombstones/${f.uid}`).set({}); await db.recursiveDelete(db.doc(`customers/${f.uid}`)); return f.sub;
    });
    await f.run((await admitBillingEvent(db, f.event()))!);
    expect((await db.doc(`customers/${f.uid}/subscriptions/${f.sub.id}`).get()).exists).toBe(false);
  });
  it('fences checkout results and clears all operational descendants after deletion during checkout', async () => {
    const f = await fixture(); const create = f.stripe.checkout.sessions.create.getMockImplementation()!;
    f.stripe.checkout.sessions.create.mockImplementationOnce(async (...args) => {
      const session = await create(...args);
      await db.doc(`userDeletionTombstones/${f.uid}`).set({});
      await requestBillingDeletion(db, f.uid);
      await db.recursiveDelete(db.doc(`customers/${f.uid}`));
      return session;
    });
    await f.run((await f.admit())!);
    await f.run(billingId('delete', f.uid));
    expect((await f.ref.get()).exists).toBe(false);
    expect((await db.collection(BILLING_JOBS).where('uid', '==', f.uid).get()).empty).toBe(true);
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).listCollections()).length).toBe(0);
  });
  it('does not dispatch or record failures for a queued retry after customer-document deletion', async () => {
    const f = await fixture(); const id = (await f.admit())!;
    await requestBillingDeletion(db, f.uid);
    const transport = { enqueue: vi.fn(), exists: vi.fn() };
    await dispatchBillingJob(db, id, transport, true);
    await f.run(id);
    expect(transport.enqueue).not.toHaveBeenCalled(); expect(transport.exists).not.toHaveBeenCalled();
    expect(f.stripe.customers.create).not.toHaveBeenCalled();
    expect((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).exists).toBe(false);
  });
  it('does not record a terminal failure if deletion starts while Stripe fails', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    f.stripe.subscriptions.retrieve.mockImplementationOnce(async () => {
      await requestBillingDeletion(db, f.uid); throw new Error('provider failure after deletion');
    });
    const id = (await admitBillingEvent(db, f.event()))!;
    await db.doc(`${BILLING_JOBS}/${id}`).update({ attempts: PROVIDER_MAX_RETRY_COUNT - 1 });
    await f.run(id);
    expect((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).exists).toBe(false);
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).exists).toBe(false);
  });
  it('covers the provider retry budget and commits a terminal failure only at exhaustion', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    f.stripe.subscriptions.retrieve.mockRejectedValue(new Error('PRIVATE provider response'));
    const id = (await admitBillingEvent(db, f.event()))!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    await ref.update({ attempts: PROVIDER_MAX_RETRY_COUNT - 2 });
    await expect(f.run(id)).rejects.toThrow(); expect((await ref.get()).get('state')).toBe('pending');
    await f.readyRetry(id); await f.run(id);
    expect((await ref.get()).get('attempts')).toBe(PROVIDER_MAX_RETRY_COUNT);
    expect((await ref.get()).get('state')).toBe('failed');
    expect(JSON.stringify((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).data())).not.toContain('PRIVATE');
    expect(await replayBillingJob(db, id)).toBe('eligible');
    expect((await ref.get()).get('state')).toBe('failed');
    expect(await replayBillingJob(db, id, true)).toBe('requeued');
    expect((await ref.get()).get('generation')).toBe(1);
    await db.doc(`userDeletionTombstones/${f.uid}`).set({});
    await ref.update({ state: 'failed' });
    expect(await replayBillingJob(db, id, true)).toBe('ineligible');
  });
  it('recovers dispatch failure with the same task identity and rotates only a verified missing reservation', async () => {
    const f = await fixture(); const id = (await f.admit())!;
    const transport = { enqueue: vi.fn().mockRejectedValueOnce(new Error('outage')).mockResolvedValue(undefined), exists: vi.fn().mockResolvedValue(false) };
    await expect(dispatchBillingJob(db, id, transport)).rejects.toThrow();
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('dispatchedAt')).toBeUndefined();
    await dispatchBillingJob(db, id, transport);
    expect(transport.enqueue.mock.calls.map(c => c.slice(0, 2))).toEqual([[id, 0], [id, 0]]);
    await dispatchBillingJob(db, id, transport, true);
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('generation')).toBe(1);
  });
  it('uses the portal contract and enforces maintenance on the server', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    expect(await createBillingPortal(f.ctx, f.uid, 'https://quantified-self.io/subscriptions')).toEqual({ url: 'https://billing.stripe.com/p/session/synthetic' });
    await db.doc(BILLING_CONTROL).update({ requestsEnabled: false });
    try { await expect(createBillingPortal(f.ctx, f.uid, 'https://quantified-self.io/subscriptions')).rejects.toThrow('temporarily'); }
    finally { await db.doc(BILLING_CONTROL).update({ requestsEnabled: true }); }
  });
  it('leaves extension-owned requests dormant and retains queued work while paused', async () => {
    const f = await fixture(); const id = (await f.admit())!;
    await db.doc(BILLING_CONTROL).update({ owner: 'extension' });
    try { expect(await f.admit()).toBeNull(); await f.run(id); expect(f.stripe.customers.create).not.toHaveBeenCalled(); }
    finally { await db.doc(BILLING_CONTROL).update({ owner: 'native' }); }
    await f.run(id); expect((await f.ref.get()).get('url')).toBeTruthy();
  });
  it('does not let an expired lease release the replacement owner', async () => {
    const lease = await acquireBillingLease(db, 'test-lock', 1);
    const replacement = await acquireBillingLease(db, 'test-lock', Date.now());
    await releaseBillingLease(db, lease);
    expect((await replacement.ref.get()).get('token')).toBe(replacement.token);
    await releaseBillingLease(db, replacement);
  });
});
