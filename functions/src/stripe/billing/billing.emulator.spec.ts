import { replayBillingJob } from './replay';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { Decimal } from 'stripe';
import { BILLING_ACCOUNTS, BILLING_CONTROL, BILLING_JOBS, billingId, type BillingEvent } from './model';
import { admitBillingCheckout, admitBillingEvent, processBillingJob } from './queue';
import { acquireBillingLease, commitBillingProjections, createBillingCheckout, createBillingPortal, releaseBillingLease, requestBillingDeletion } from './service';
import { billingTransport, dispatchBillingJob } from './dispatch';
import { PROVIDER_MAX_RETRY_COUNT } from '../../shared/queue-config';
import { getBillingStripe } from '../client';
import { processStripeBillingTask } from './handlers';
import { onSubscriptionUpdated } from '../subscriptions';
import { STRIPE_CHECKOUT_TERMS_VERSION } from '../../../../shared/stripe-checkout-terms';

vi.unmock('firebase-admin');
vi.mock('../client', () => ({ getBillingStripe: vi.fn() }));
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
    const product = { id: productId, active: true, metadata: { firebaseRole: 'basic' } as Record<string, string>, name: 'Synthetic billing product',
      description: null, images: [], tax_code: null };
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
        expire: vi.fn(async (id: string, _params: unknown, _options: unknown) => {
          const session = [...sessions.values()].find(s => s.id === id);
          if (!session || session.status !== 'open') throw new Error('not open');
          session.status = 'expired'; session.url = null; return session;
        }),
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
  async function nextRequest(f: Awaited<ReturnType<typeof fixture>>, data = f.request) {
    const requestId = unique(), ref = db.doc(`customers/${f.uid}/checkout_sessions/${requestId}`);
    await ref.set(data);
    const id = (await admitBillingCheckout(db, f.uid, requestId, data, Timestamp.now()))!;
    return { requestId, ref, id, operation: db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${requestId}`) };
  }
  async function changePrice(f: Awaited<ReturnType<typeof fixture>>) {
    f.price.id = `price_${unique()}`;
    await db.doc(`products/${f.product.id}/prices/${f.price.id}`).set(f.price);
    return { ...f.request, price: f.price.id };
  }
  it.each(['annual to monthly', 'Basic to Pro', 'one-time payment'])('safely switches %s, retaining only one open checkout', async scenario => {
    const f = await fixture(scenario === 'one-time payment' ? 'payment' : 'subscription');
    if (scenario === 'annual to monthly') f.price.recurring!.interval = 'year';
    await f.run((await f.admit())!);
    const original = (await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`).get()).data()!;
    if (scenario === 'Basic to Pro') f.product.metadata.firebaseRole = 'pro';
    if (scenario === 'annual to monthly') f.price.recurring!.interval = 'month';
    const next = await nextRequest(f, await changePrice(f));
    const expire = f.stripe.checkout.sessions.expire.getMockImplementation()!;
    f.stripe.checkout.sessions.expire.mockImplementationOnce(async (...args) => {
      expect((await next.operation.get()).get('replacement.sessionId')).toBe(original.result.id);
      expect((await next.ref.get()).get('status')).toBe('updating');
      return expire(...args);
    });
    await f.run(next.id); await f.run(next.id);
    expect((await next.ref.get()).get('sessionId')).not.toBe(original.result.id);
    expect((await next.ref.get()).get('error')).toBeNull();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect([...f.sessions.values()].filter(s => s.status === 'open')).toHaveLength(1);
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`).get()).get('params')).toEqual(original.params);
  });
  it('reconciles a lost expiry response before creating the replacement', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    const expire = f.stripe.checkout.sessions.expire.getMockImplementation()!;
    f.stripe.checkout.sessions.expire.mockImplementationOnce(async (...args) => { await expire(...args); throw new Error('lost response'); });
    await f.run(next.id);
    expect((await next.ref.get()).get('url')).toBeTruthy();
    expect([...f.sessions.values()].filter(s => s.status === 'open')).toHaveLength(1);
  });
  it('retains the replacement and expiry key across an unresolved expiration and retry', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    f.stripe.checkout.sessions.expire.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(f.run(next.id)).rejects.toThrow();
    const frozen = (await next.operation.get()).data();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await db.doc(`${BILLING_JOBS}/${next.id}`).get()).get('state')).toBe('pending');
    await f.readyRetry(next.id); await f.run(next.id);
    expect(f.stripe.checkout.sessions.expire.mock.calls[0]).toEqual(f.stripe.checkout.sessions.expire.mock.calls[1]);
    expect((await next.operation.get()).get('key')).toBe(frozen!.key);
    expect((await next.operation.get()).get('params')).toEqual(frozen!.params);
    expect((await next.ref.get()).get('url')).toBeTruthy();
  });
  it('waits for a confirmed Stripe state when both expiration and reconciliation replies are lost', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    const expire = f.stripe.checkout.sessions.expire.getMockImplementation()!;
    f.stripe.checkout.sessions.expire.mockImplementationOnce(async (...args) => {
      await expire(...args);
      f.stripe.checkout.sessions.retrieve.mockRejectedValueOnce(new Error('reconciliation unavailable'));
      throw new Error('expiration reply lost');
    });
    await expect(f.run(next.id)).rejects.toThrow();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await next.ref.get()).get('url')).toBeUndefined();
    await f.readyRetry(next.id); await f.run(next.id);
    expect((await next.ref.get()).get('url')).toBeTruthy();
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
  });
  it('fences a worker that loses its lease after expiration and resumes from the same journal', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    const expire = f.stripe.checkout.sessions.expire.getMockImplementation()!;
    const lock = db.doc(`stripeBillingLocks/${billingId(`customer:${f.uid}`)}`);
    f.stripe.checkout.sessions.expire.mockImplementationOnce(async (...args) => {
      const result = await expire(...args); await lock.update({ token: 'replacement-owner' }); return result;
    });
    await f.run(next.id);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await lock.get()).get('token')).toBe('replacement-owner');
    const job = await db.doc(`${BILLING_JOBS}/${next.id}`).get();
    expect(job.get('state')).toBe('pending'); expect(job.get('generation')).toBe(1);
    const key = (await next.operation.get()).get('key');
    await lock.update({ until: Timestamp.fromMillis(0) }); await f.readyRetry(next.id);
    await f.run(next.id, job.get('generation'));
    expect((await next.operation.get()).get('key')).toBe(key);
    expect((await next.ref.get()).get('url')).toBeTruthy();
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
  });
  it('recovers a lost replacement-create reply using the same parameters and key', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    const create = f.stripe.checkout.sessions.create.getMockImplementation()!;
    f.stripe.checkout.sessions.create.mockImplementationOnce(async (...args) => { await create(...args); throw new Error('lost response'); });
    await expect(f.run(next.id)).rejects.toThrow();
    await f.readyRetry(next.id); await f.run(next.id);
    expect(f.stripe.checkout.sessions.create.mock.calls[1]).toEqual(f.stripe.checkout.sessions.create.mock.calls[2]);
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect([...f.sessions.values()].filter(s => s.status === 'open')).toHaveLength(1);
  });
  it.each(['before switch', 'during expiration'])('stops when the prior checkout completes %s', async when => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    const previous = [...f.sessions.values()][0]; previous.subscription = f.sub.id;
    if (when === 'before switch') previous.status = 'complete';
    else f.stripe.checkout.sessions.expire.mockImplementationOnce(async () => { previous.status = 'complete'; throw new Error('already complete'); });
    const warn = vi.mocked(logger.warn); warn.mockClear();
    {
      await f.run(next.id);
      expect((await next.ref.get()).get('error.code')).toBe('checkout_completed');
      expect((await db.doc(`${BILLING_JOBS}/${next.id}`).get()).get('state')).toBe('skipped');
      expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    }
    if (when === 'during expiration') {
      expect((await next.operation.get()).get('completed')).toBe(true);
      expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).get('activeCheckout')).toBe(`checkout_${f.requestId}`);
    }
    f.sub.status = 'canceled'; f.stripe.subscriptions.list.mockResolvedValue({ data: [f.sub], has_more: false });
    const returning = await nextRequest(f, await changePrice(f)); await f.run(returning.id);
    expect((await returning.ref.get()).get('url')).toBeTruthy();
    expect((await returning.ref.get()).get('status')).toBe('ready');
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });
  it('allows a returning member after the completed checkout subscription was canceled', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const previous = [...f.sessions.values()][0]; previous.status = 'complete'; previous.subscription = f.sub.id;
    f.sub.status = 'canceled'; f.stripe.subscriptions.list.mockResolvedValue({ data: [f.sub], has_more: false });
    const next = await nextRequest(f, await changePrice(f)); await f.run(next.id);
    expect((await next.ref.get()).get('url')).toBeTruthy();
    expect(f.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });
  it('retains journals when expiration retries are exhausted and never creates another session', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    f.stripe.checkout.sessions.expire.mockRejectedValue(new Error('unavailable'));
    await db.doc(`${BILLING_JOBS}/${next.id}`).update({ attempts: PROVIDER_MAX_RETRY_COUNT - 1 });
    await f.run(next.id);
    expect((await db.doc(`${BILLING_JOBS}/${next.id}`).get()).get('state')).toBe('failed');
    expect((await next.operation.get()).get('replacement')).toBeTruthy();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(await replayBillingJob(db, next.id)).toBe('eligible');
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
  });
  it('does not expire anything when the selected price is invalid', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f)); f.price.active = false;
    await f.run(next.id);
    expect((await next.ref.get()).get('error.code')).toBe('invalid_request');
    expect(f.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect((await next.operation.get()).exists).toBe(false);
  });
  it('does not let an older queued selection undo a newer checkout', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const older = await nextRequest(f, await changePrice(f));
    const newer = await nextRequest(f, await changePrice(f)); await f.run(newer.id);
    await f.run(older.id);
    expect((await older.ref.get()).get('error.code')).toBe('checkout_replaced');
    expect((await db.doc(`${BILLING_JOBS}/${older.id}`).get()).get('state')).toBe('skipped');
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).get('activeCheckout')).toBe(`checkout_${newer.requestId}`);
  });
  it.each(['open', 'expired'])('retains the latest same-offer selection when its checkout is %s', async status => {
    const f = await fixture(); await f.run((await f.admit())!);
    const initialPrice = { ...f.price };
    const olderOffer = await changePrice(f), olderPrice = { ...f.price };
    const older = await nextRequest(f, olderOffer);
    Object.assign(f.price, initialPrice);
    const latest = await nextRequest(f); await f.run(latest.id);
    expect((await latest.ref.get()).get('sessionId')).toBe((await f.ref.get()).get('sessionId'));
    const previous = [...f.sessions.values()][0]; previous.status = status;
    if (status === 'expired') previous.url = null;
    Object.assign(f.price, olderPrice);
    await f.run(older.id);
    expect((await older.ref.get()).get('error.code')).toBe('checkout_replaced');
    expect((await db.doc(`${BILLING_JOBS}/${older.id}`).get()).get('state')).toBe('skipped');
    expect(f.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it('allows the latest same-offer request to retry after recording its selection', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const latest = await nextRequest(f);
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try {
      const first = await createBillingCheckout(f.ctx, lease, f.uid, latest.requestId, f.request);
      expect(await createBillingCheckout(f.ctx, lease, f.uid, latest.requestId, f.request)).toEqual(first);
      expect(first.sessionId).toBe((await f.ref.get()).get('sessionId'));
    } finally { await releaseBillingLease(db, lease); }
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });
  it('lets an older identical selection reuse checkout without changing the latest selection', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const offer = await changePrice(f);
    const older = await nextRequest(f, offer), latest = await nextRequest(f, offer);
    await f.run(latest.id); await f.run(older.id);
    expect((await older.ref.get()).get('sessionId')).toBe((await latest.ref.get()).get('sessionId'));
    expect((await latest.operation.get()).get('selection.requestId')).toBe(latest.requestId);
    expect((await latest.operation.get()).get('selection.createdAt')).toEqual((await latest.ref.get()).createTime);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
  });
  it.each(['expired', 'complete'])('does not recreate a reused checkout after a lost commit when Stripe reports %s', async status => {
    const f = await fixture('payment'); await f.run((await f.admit())!);
    const reused = await nextRequest(f);
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try {
      // Simulate a worker stopping after reuse is journaled, before its public
      // result and job completion can commit.
      await createBillingCheckout(f.ctx, lease, f.uid, reused.requestId, f.request);
    } finally { await releaseBillingLease(db, lease); }
    const previous = [...f.sessions.values()][0]; previous.status = status; previous.url = null;
    await f.run(reused.id);
    expect((await reused.ref.get()).get('error.code')).toBe(status === 'expired' ? 'checkout_expired' : 'checkout_completed');
    expect((await db.doc(`${BILLING_JOBS}/${reused.id}`).get()).get('state')).toBe('skipped');
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await db.doc(`failed_jobs/stripe_billing_${reused.id}`).get()).exists).toBe(false);
    // An explicit later selection may start another one-time purchase.
    const fresh = await nextRequest(f); await f.run(fresh.id);
    expect((await fresh.ref.get()).get('url')).toBeTruthy();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });
  it.each(['expired', 'complete'])('finishes a checkpointed checkout as an expected outcome after it becomes %s', async status => {
    const f = await fixture('payment'), id = (await f.admit())!;
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try { await createBillingCheckout(f.ctx, lease, f.uid, f.requestId, f.request); }
    finally { await releaseBillingLease(db, lease); }
    const previous = [...f.sessions.values()][0]; previous.status = status; previous.url = null;
    await f.run(id);
    expect((await f.ref.get()).get('error.code')).toBe(status === 'expired' ? 'checkout_expired' : 'checkout_completed');
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('skipped');
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).exists).toBe(false);
  });
  it('does not commit a closed reused checkout after losing the customer lease during retrieval', async () => {
    const f = await fixture('payment'); await f.run((await f.admit())!);
    const reused = await nextRequest(f);
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try { await createBillingCheckout(f.ctx, lease, f.uid, reused.requestId, f.request); }
    finally { await releaseBillingLease(db, lease); }
    [...f.sessions.values()][0].status = 'complete';
    const retrieve = f.stripe.checkout.sessions.retrieve.getMockImplementation()!;
    const lock = db.doc(`stripeBillingLocks/${billingId(`customer:${f.uid}`)}`);
    f.stripe.checkout.sessions.retrieve.mockImplementationOnce(async id => {
      const session = await retrieve(id);
      await lock.update({ token: 'replacement-owner', until: Timestamp.fromMillis(Date.now() + 360_000) });
      return session;
    });
    await f.run(reused.id);
    const job = await db.doc(`${BILLING_JOBS}/${reused.id}`).get();
    expect(job.get('state')).toBe('pending'); expect(job.get('generation')).toBe(1);
    expect((await reused.ref.get()).get('error')).toBeUndefined();
    await lock.update({ until: Timestamp.fromMillis(0) }); await f.readyRetry(reused.id);
    await f.run(reused.id, job.get('generation'));
    expect((await reused.ref.get()).get('error.code')).toBe('checkout_completed');
    expect((await db.doc(`${BILLING_JOBS}/${reused.id}`).get()).get('state')).toBe('skipped');
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it('does not revive an older queued selection after Stripe rejects its replacement', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const olderOffer = await changePrice(f), olderPrice = { ...f.price };
    const older = await nextRequest(f, olderOffer);
    const latest = await nextRequest(f, await changePrice(f));
    f.stripe.checkout.sessions.create.mockRejectedValueOnce({ type: 'StripeInvalidRequestError', statusCode: 400 });
    await f.run(latest.id);
    expect((await latest.ref.get()).get('error.code')).toBe('checkout_rejected');
    Object.assign(f.price, olderPrice); await f.run(older.id);
    expect((await older.ref.get()).get('error.code')).toBe('checkout_replaced');
    expect((await db.doc(`${BILLING_JOBS}/${older.id}`).get()).get('state')).toBe('skipped');
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    const fresh = await nextRequest(f, olderOffer); await f.run(fresh.id);
    expect((await fresh.ref.get()).get('url')).toBeTruthy();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(3);
  });
  it.each(['none', 'rejected', 'expired', 'canceled', 'open'])('recovers a lost reservation reply with a %s predecessor', async predecessor => {
    const f = await fixture();
    if (predecessor !== 'none') {
      if (predecessor === 'rejected') f.stripe.checkout.sessions.create.mockRejectedValueOnce({ type: 'StripeInvalidRequestError', statusCode: 400 });
      await f.run((await f.admit())!);
      if (predecessor === 'expired') [...f.sessions.values()][0].status = 'expired';
      if (predecessor === 'canceled') {
        const session = [...f.sessions.values()][0]; session.status = 'complete'; session.subscription = f.sub.id;
        f.sub.status = 'canceled'; f.stripe.subscriptions.list.mockResolvedValue({ data: [f.sub], has_more: false });
      }
    }
    const next = await nextRequest(f, predecessor === 'open' ? await changePrice(f) : f.request);
    const callsBefore = f.stripe.checkout.sessions.create.mock.calls.length;
    const transaction = db.runTransaction.bind(db);
    let injected = false;
    const spy = vi.spyOn(db, 'runTransaction').mockImplementation(async (...args) => {
      const result = await transaction(...args);
      if (!injected && (await next.operation.get()).exists) {
        injected = true;
        throw new Error('synthetic lost reservation reply');
      }
      return result;
    });
    try { await expect(f.run(next.id)).rejects.toThrow(); }
    finally { spy.mockRestore(); }
    expect(injected).toBe(true);
    const frozen = (await next.operation.get()).data()!;
    expect((await db.doc(`${BILLING_JOBS}/${next.id}`).get()).get('state')).toBe('pending');
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).get('activeCheckout')).toBe(`checkout_${next.requestId}`);
    if (predecessor !== 'none') expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`).get())
      .get('replacedBy')).toBe(`checkout_${next.requestId}`);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(callsBefore);
    await f.readyRetry(next.id); await f.run(next.id);
    expect((await db.doc(`${BILLING_JOBS}/${next.id}`).get()).get('state')).toBe('done');
    expect((await next.ref.get()).get('url')).toBeTruthy();
    expect((await next.ref.get()).get('error')).toBeNull();
    expect((await next.operation.get()).get('key')).toBe(frozen.key);
    expect((await next.operation.get()).get('params')).toEqual(frozen.params);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(callsBefore + 1);
    expect(f.stripe.checkout.sessions.create.mock.lastCall![1].idempotencyKey).toBe(frozen.key);
  });
  it('retains selection order when a completed checkout restores its predecessor', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const older = await nextRequest(f);
    const latest = await nextRequest(f, await changePrice(f));
    const previous = [...f.sessions.values()][0]; previous.subscription = f.sub.id;
    f.stripe.checkout.sessions.expire.mockImplementationOnce(async () => {
      previous.status = 'complete'; throw new Error('already complete');
    });
    await f.run(latest.id);
    expect((await latest.ref.get()).get('error.code')).toBe('checkout_completed');
    f.sub.status = 'canceled';
    await f.run(older.id);
    expect((await older.ref.get()).get('error.code')).toBe('checkout_replaced');
    expect((await db.doc(`${BILLING_JOBS}/${older.id}`).get()).get('state')).toBe('skipped');
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it('allows a one-time purchase after a completed subscription checkout', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const previous = [...f.sessions.values()][0]; previous.status = 'complete'; previous.subscription = f.sub.id;
    f.stripe.subscriptions.list.mockResolvedValue({ data: [f.sub], has_more: false });
    f.price.type = 'one_time'; f.price.recurring = null;
    const next = await nextRequest(f, { ...await changePrice(f), mode: 'payment' });
    await f.run(next.id);
    expect((await next.ref.get()).get('status')).toBe('ready');
    expect((await next.ref.get()).get('url')).toBeTruthy();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(f.stripe.checkout.sessions.create.mock.calls[1][0].mode).toBe('payment');
    expect(f.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(f.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });
  it('never resumes an operation superseded by a plan switch', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f)); await f.run(next.id);
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try { await expect(createBillingCheckout(f.ctx, lease, f.uid, f.requestId, f.request)).rejects.toMatchObject({ code: 'checkout_replaced' }); }
    finally { await releaseBillingLease(db, lease); }
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });
  it.each(['rejected', 'expired', 'complete', 'canceled'])('skips a delayed retry of a %s checkout after a later purchase starts', async status => {
    const f = await fixture(status === 'canceled' ? 'subscription' : 'payment'), id = (await f.admit())!;
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try {
      // The provider result is checkpointed, but the worker stops before
      // committing the public result and finishing its job.
      if (status === 'rejected') {
        f.stripe.checkout.sessions.create.mockRejectedValueOnce({ type: 'StripeInvalidRequestError', statusCode: 400 });
        await expect(createBillingCheckout(f.ctx, lease, f.uid, f.requestId, f.request)).rejects.toMatchObject({ code: 'checkout_rejected' });
      } else await createBillingCheckout(f.ctx, lease, f.uid, f.requestId, f.request);
    } finally { await releaseBillingLease(db, lease); }
    const previous = [...f.sessions.values()][0];
    if (previous) { previous.status = status === 'canceled' ? 'complete' : status; previous.url = null; }
    if (status === 'canceled') {
      previous.subscription = f.sub.id;
      f.sub.status = 'canceled'; f.stripe.subscriptions.list.mockResolvedValue({ data: [f.sub], has_more: false });
    }
    const next = await nextRequest(f); await f.run(next.id);
    const successor = (await next.operation.get()).data();
    const warn = vi.mocked(logger.warn); warn.mockClear();
    await f.run(id);
    expect((await f.ref.get()).get('error.code')).toBe('checkout_replaced');
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('skipped');
    expect((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).exists).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).get('activeCheckout')).toBe(`checkout_${next.requestId}`);
    expect((await next.operation.get()).data()).toEqual(successor);
    expect((await next.ref.get()).get('status')).toBe('ready');
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(f.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });
  it('fences replacement creation when the account is deleted during expiration', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    const expire = f.stripe.checkout.sessions.expire.getMockImplementation()!;
    f.stripe.checkout.sessions.expire.mockImplementationOnce(async (...args) => {
      const result = await expire(...args); await db.doc(`userDeletionTombstones/${f.uid}`).set({}); return result;
    });
    await f.run(next.id);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await next.ref.get()).get('sessionId')).toBeUndefined();
    expect((await db.doc(`${BILLING_JOBS}/${next.id}`).get()).exists).toBe(false);
  });
  it('rechecks customer ownership when retrying a pending replacement', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    f.stripe.checkout.sessions.expire.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(f.run(next.id)).rejects.toThrow();
    await db.doc(`customers/${f.uid}`).update({ stripeId: 'cus_changed' });
    await f.readyRetry(next.id); await f.run(next.id);
    expect((await next.ref.get()).get('error.code')).toBe('customer_conflict');
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it('stops a queued replacement retry after account deletion', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const next = await nextRequest(f, await changePrice(f));
    f.stripe.checkout.sessions.expire.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(f.run(next.id)).rejects.toThrow();
    await db.doc(`userDeletionTombstones/${f.uid}`).set({});
    await f.readyRetry(next.id); await f.run(next.id);
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await db.doc(`${BILLING_JOBS}/${next.id}`).get()).exists).toBe(false);
  });
  it('serializes two tabs selecting the same replacement and reuses the new session', async () => {
    const f = await fixture(); await f.run((await f.admit())!);
    const offer = await changePrice(f), a = await nextRequest(f, offer), b = await nextRequest(f, offer);
    await Promise.all([f.run(a.id), f.run(b.id)]);
    for (const next of [a, b]) {
      const job = await db.doc(`${BILLING_JOBS}/${next.id}`).get();
      if (job.get('state') === 'pending') { await f.readyRetry(next.id); await f.run(next.id, job.get('generation')); }
    }
    expect((await a.ref.get()).get('sessionId')).toBe((await b.ref.get()).get('sessionId'));
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });
  it('creates one durable customer and checkout, retaining automatic tax, promotions and trial policy', async () => {
    const f = await fixture();
    const data = { ...f.request, trial_period_days: 7 };
    await f.ref.set(data);
    const id = await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now());
    await f.run(id!); await f.run(id!);
    expect(f.stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ customer: f.customerId, allow_promotion_codes: true,
      automatic_tax: { enabled: true }, payment_method_collection: 'if_required', subscription_data: { billing_mode: { type: 'classic' }, trial_period_days: 7 }, line_items: [{ price: f.price.id, quantity: 1 }] });
    expect((await f.ref.get()).data()).toMatchObject({ sessionId: expect.stringMatching(/^cs_/), url: expect.stringContaining('checkout.stripe.com'), error: null });
    expect((await db.doc(`customers/${f.uid}`).get()).get('stripeId')).toBe(f.customerId);
  });
  it.each(['firebaseRole', 'role'])('requires a payment method for new Pro trials using trusted product %s', async roleKey => {
    const f = await fixture(); f.product.metadata = { [roleKey]: 'pro' };
    const data = { ...f.request, trial_period_days: 7, payment_method_collection: 'if_required', checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    const params = f.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params).toMatchObject({ payment_method_collection: 'always', automatic_tax: { enabled: true }, allow_promotion_codes: true,
      subscription_data: { trial_period_days: 7, billing_mode: { type: 'classic' } } });
    expect(params.payment_method_types).toBeUndefined();
    expect(params.checkout_terms_version).toBeUndefined();
    expect((await f.ref.get()).get('error')).toBeNull();
  });
  it('asks a cached no-card client to refresh before creating a new Pro trial session', async () => {
    const f = await fixture(); f.product.metadata.firebaseRole = 'pro';
    const data = { ...f.request, trial_period_days: 7 };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    expect(f.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect((await f.ref.get()).get('error.code')).toBe('checkout_terms_changed');
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`).get()).exists).toBe(false);
  });
  it('keeps a Basic trial unchanged even when its price claims a Pro role', async () => {
    const f = await fixture(); Object.assign(f.price.metadata, { firebaseRole: 'pro' });
    const data = { ...f.request, trial_period_days: 7, checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    expect(f.stripe.checkout.sessions.create.mock.calls[0][0].payment_method_collection).toBe('if_required');
  });
  it('does not introduce a trial or change a returning Pro payment', async () => {
    const f = await fixture(); f.product.metadata.firebaseRole = 'pro';
    f.stripe.subscriptions.list.mockResolvedValue({ data: [{ status: 'canceled' }], has_more: false });
    await f.run((await f.admit())!);
    expect(f.stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ payment_method_collection: 'if_required' });
    expect(f.stripe.checkout.sessions.create.mock.calls[0][0].subscription_data.trial_period_days).toBeUndefined();
  });
  it.each([true, false])('validates updated trial terms before replacing an open session (card required=%s)', async modern => {
    const f = await fixture();
    if (modern) f.product.metadata.firebaseRole = 'pro';
    const data = { ...f.request, trial_period_days: 7, ...(modern ? { checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION } : {}) };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    f.product.metadata.firebaseRole = 'pro';
    const operation = db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`);
    const frozen = (await operation.get()).data()!;
    const next = unique(), ref = db.doc(`customers/${f.uid}/checkout_sessions/${next}`);
    const other = { ...f.request, trial_period_days: 7, ...(!modern ? { checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION } : {}) };
    await ref.set(other); await f.run((await admitBillingCheckout(db, f.uid, next, other, Timestamp.now()))!);
    if (modern) {
      expect((await ref.get()).get('error.code')).toBe('checkout_terms_changed');
      expect(f.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
      expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    } else {
      expect((await ref.get()).get('url')).toBeTruthy();
      expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
      expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
      expect(f.stripe.checkout.sessions.create.mock.calls[1][0].payment_method_collection).toBe('always');
    }
    expect((await operation.get()).get('params')).toEqual(frozen.params);
    expect((await operation.get()).get('key')).toEqual(frozen.key);
  });
  it.each([true, false])('retries the original trial operation unchanged across a policy rollout (new offer=%s)', async modern => {
    const f = await fixture();
    if (modern) f.product.metadata.firebaseRole = 'pro';
    const data = { ...f.request, trial_period_days: 7, ...(modern ? { checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION } : {}) };
    await f.ref.set(data);
    const create = f.stripe.checkout.sessions.create.getMockImplementation()!;
    f.stripe.checkout.sessions.create.mockImplementationOnce(async (...args) => { await create(...args); throw new Error('lost response'); });
    const id = (await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!;
    await expect(f.run(id)).rejects.toThrow();
    const ref = db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`);
    const original = (await ref.get()).data();
    f.product.metadata.firebaseRole = 'pro';
    await f.readyRetry(id); await f.run(id);
    expect(f.stripe.checkout.sessions.create.mock.calls[0]).toEqual(f.stripe.checkout.sessions.create.mock.calls[1]);
    expect(f.stripe.checkout.sessions.create.mock.calls[1][0].payment_method_collection).toBe(modern ? 'always' : 'if_required');
    expect((await ref.get()).get('params')).toEqual(original!.params);
    expect((await ref.get()).get('key')).toBe(original!.key);
    expect((await f.ref.get()).get('sessionId')).toBeTruthy();
  });
  it.each(['basic', 'pro'])('reuses the same modern %s trial offer without another Stripe create', async role => {
    const f = await fixture(); f.product.metadata.firebaseRole = role;
    const data = { ...f.request, trial_period_days: 7, checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    const next = unique(), ref = db.doc(`customers/${f.uid}/checkout_sessions/${next}`);
    await ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, next, data, Timestamp.now()))!);
    expect((await ref.get()).get('url')).toBeTruthy();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it.each([[0, 7], [7, 0], [7, 14]])('replaces a checkout after validated trial length changes from %s to %s days', async (before, after) => {
    const f = await fixture(); f.product.metadata.firebaseRole = 'pro';
    f.price.metadata.trial_days = String(before);
    const data = { ...f.request, checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION, ...(before ? { trial_period_days: before } : {}) };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    const operation = db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`);
    const original = (await operation.get()).data();
    f.price.metadata.trial_days = String(after);
    const next = unique(), ref = db.doc(`customers/${f.uid}/checkout_sessions/${next}`);
    const offer = { ...f.request, checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION, ...(after ? { trial_period_days: after } : {}) };
    await ref.set(offer); await f.run((await admitBillingCheckout(db, f.uid, next, offer, Timestamp.now()))!);
    expect((await ref.get()).get('url')).toBeTruthy();
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect((await operation.get()).get('params')).toEqual(original!.params);
    expect((await operation.get()).get('key')).toEqual(original!.key);
    expect([...f.sessions.values()][0].status).toBe('expired');
  });
  it('replaces a card-required Pro trial after the trusted product becomes Basic', async () => {
    const f = await fixture(); f.product.metadata.firebaseRole = 'pro';
    const data = { ...f.request, checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION, trial_period_days: 7 };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    f.product.metadata.firebaseRole = 'basic';
    const next = unique(), ref = db.doc(`customers/${f.uid}/checkout_sessions/${next}`);
    await ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, next, data, Timestamp.now()))!);
    expect((await ref.get()).get('url')).toBeTruthy();
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });
  it.each(['canceled', 'past_due'])('rechecks %s subscription history before reusing an open trial', async status => {
    const f = await fixture(); f.product.metadata.firebaseRole = 'pro';
    const data = { ...f.request, checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION, trial_period_days: 7 };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    f.stripe.subscriptions.list.mockResolvedValue({ data: [{ status }], has_more: false });
    const next = unique(), ref = db.doc(`customers/${f.uid}/checkout_sessions/${next}`);
    await ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, next, data, Timestamp.now()))!);
    expect((await ref.get()).get('error.code')).toBe(status === 'canceled' ? 'trial_ineligible' : 'subscription_exists');
    expect((await ref.get()).get('url')).toBeUndefined();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('never replaces a newer reservation while recovering an old operation (confirmed supersession=%s)', async confirmed => {
    const f = await fixture(); f.product.metadata.firebaseRole = 'pro';
    const data = { ...f.request, checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION, trial_period_days: 7 };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    const original = (await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`).get()).data();
    [...f.sessions.values()][0].status = 'expired';
    const next = unique(), ref = db.doc(`customers/${f.uid}/checkout_sessions/${next}`);
    await ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, next, data, Timestamp.now()))!);
    const newer = (await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${next}`).get()).data();
    const originalRef = db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`);
    // Older journals without the supersession marker must still fail closed.
    if (!confirmed) await originalRef.update({ replacedBy: admin.firestore.FieldValue.delete() });
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try {
      await expect(createBillingCheckout(f.ctx, lease, f.uid, f.requestId, data)).rejects.toMatchObject({ code: confirmed ? 'checkout_replaced' : 'operation_uncertain' });
    } finally { await releaseBillingLease(db, lease); }
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).get('activeCheckout')).toBe(`checkout_${next}`);
    expect((await originalRef.get()).data()).toEqual({ ...original, ...(confirmed ? { replacedBy: `checkout_${next}` } : {}) });
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${next}`).get()).data()).toEqual(newer);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });
  it('retains the original checkout when current offer eligibility cannot be read', async () => {
    const f = await fixture(); f.product.metadata.firebaseRole = 'pro';
    const data = { ...f.request, checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION, trial_period_days: 7 };
    await f.ref.set(data); await f.run((await admitBillingCheckout(db, f.uid, f.requestId, data, Timestamp.now()))!);
    f.stripe.subscriptions.list.mockRejectedValueOnce(new Error('history unavailable'));
    const next = unique(), ref = db.doc(`customers/${f.uid}/checkout_sessions/${next}`);
    await ref.set(data);
    const id = (await admitBillingCheckout(db, f.uid, next, data, Timestamp.now()))!;
    await expect(f.run(id)).rejects.toThrow();
    expect((await ref.get()).get('url')).toBeUndefined();
    expect((await ref.get()).get('error.code')).toBe('provider_unavailable');
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('pending');
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).get('activeCheckout')).toBe(`checkout_${f.requestId}`);
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${next}`).get()).exists).toBe(false);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
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
    await Promise.all([f.run(id), f.run(id)]);
    await f.readyRetry(id);
    await f.run(id, (await db.doc(`${BILLING_JOBS}/${id}`).get()).get('generation'));
    const other = unique(); await db.doc(`customers/${f.uid}/checkout_sessions/${other}`).set(f.request);
    const next = await admitBillingCheckout(db, f.uid, other, f.request, Timestamp.now()); await f.run(next!);
    expect(f.stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await db.doc(`customers/${f.uid}/checkout_sessions/${other}`).get()).get('sessionId')).toBe((await f.ref.get()).get('sessionId'));
  });
  it.each(['cus_foreign', null])('refuses a retained checkout with mismatched customer %s', async customer => {
    const f = await fixture(); await f.run((await f.admit())!);
    const original = (await f.ref.get()).get('sessionId');
    f.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: original, status: 'open', customer, url: 'https://checkout.stripe.com/c/pay/foreign',
    });
    const next = unique(); const ref = db.doc(`customers/${f.uid}/checkout_sessions/${next}`);
    await ref.set(f.request);
    const id = (await admitBillingCheckout(db, f.uid, next, f.request, Timestamp.now()))!;
    await f.run(id);
    expect((await ref.get()).get('error.code')).toBe('customer_conflict');
    expect((await ref.get()).get('url')).toBeUndefined();
    expect((await ref.get()).get('sessionId')).toBeUndefined();
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('failed');
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${next}`).get()).exists).toBe(false);
  });
  it.each(['open', 'expired'])('blocks a retained %s checkout after a trusted customer binding changes', async status => {
    const f = await fixture(); await f.run((await f.admit())!);
    const operationRef = db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`);
    const originalOperation = (await operationRef.get()).data();
    const originalSession = [...f.sessions.values()][0]; originalSession.status = status;
    const replacement = `cus_repaired_${f.uid}`;
    await db.doc(`customers/${f.uid}`).update({ stripeId: replacement });
    f.stripe.customers.retrieve.mockResolvedValue({ ...f.customer, id: replacement });
    const next = unique(); const ref = db.doc(`customers/${f.uid}/checkout_sessions/${next}`);
    await ref.set(f.request);
    await f.run((await admitBillingCheckout(db, f.uid, next, f.request, Timestamp.now()))!);
    expect((await ref.get()).get('error.code')).toBe('customer_conflict');
    expect((await ref.get()).get('url')).toBeUndefined();
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect((await operationRef.get()).data()).toEqual(originalOperation);
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).get('activeCheckout')).toBe(`checkout_${f.requestId}`);
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${next}`).get()).exists).toBe(false);
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
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).get('activeCheckout')).toBe(`checkout_${f.requestId}`);
    await replayBillingJob(db, id, true); await f.run(id, 1);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const nextRequest = unique(); await db.doc(`customers/${f.uid}/checkout_sessions/${nextRequest}`).set(f.request);
    await f.run((await admitBillingCheckout(db, f.uid, nextRequest, f.request, Timestamp.now()))!);
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect((await operation.get()).data()).toEqual({ ...rejected, replacedBy: `checkout_${nextRequest}` });
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
  it('replaces Stripe-owned maps while preserving application fields and literal metadata keys', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    const ref = db.doc(`customers/${f.uid}/subscriptions/${f.sub.id}`);
    await ref.set({ metadata: { retained: 'old', removed: 'stale' }, appOwned: { retained: true }, 'stripe_metadata_old.key': 'stale' });
    const projection = { path: ref.path, data: { metadata: { retained: 'new' }, 'stripe_metadata_new.key': 'new' } };
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try {
      await commitBillingProjections(f.ctx, lease, f.uid, f.customerId, [projection]);
      const first = await ref.get();
      expect(first.data()).toEqual({ metadata: { retained: 'new' }, appOwned: { retained: true }, 'stripe_metadata_new.key': 'new' });
      await commitBillingProjections(f.ctx, lease, f.uid, f.customerId, [projection]);
      expect((await ref.get()).updateTime?.isEqual(first.updateTime!)).toBe(true);
    } finally { await releaseBillingLease(db, lease); }
  });
  it('deactivates a deleted product when an earlier update arrives after deletion', async () => {
    const f = await fixture();
    f.stripe.products.retrieve.mockRejectedValue({ code: 'resource_missing' });
    const event = { ...f.event(), kind: 'product' as const, type: 'product.updated', objectId: f.product.id, customerId: null };
    const id = (await admitBillingEvent(db, event))!;
    await f.run(id);
    expect((await db.doc(`products/${f.product.id}`).get()).get('active')).toBe(false);
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('done');
  });
  it('fetches expanded price tiers and commits SDK decimals as lossless strings', async () => {
    const f = await fixture();
    Object.assign(f.price, { nickname: null, billing_scheme: 'tiered', tiers_mode: 'graduated', tax_behavior: 'exclusive',
      tiers: [{ up_to: 100, unit_amount: null, unit_amount_decimal: Decimal.from('0.123456789012'), flat_amount: 0, flat_amount_decimal: Decimal.from('0') }] });
    const event = { ...f.event(), kind: 'price' as const, type: 'price.updated', objectId: f.price.id, customerId: null };
    const id = (await admitBillingEvent(db, event))!; await f.run(id);
    expect(f.stripe.prices.retrieve).toHaveBeenCalledWith(f.price.id, { expand: ['tiers'] });
    const stored = await db.doc(`products/${f.product.id}/prices/${f.price.id}`).get();
    expect(stored.get('tiers')[0].unit_amount_decimal).toBe('0.123456789012');
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('done');
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
  it('cancels surviving active subscriptions after customer-document deletion without recreating the customer', async () => {
    const f = await fixture();
    await admin.auth().createUser({ uid: f.uid, email: `${f.uid}@example.test`, emailVerified: true });
    await admin.auth().setCustomUserClaims(f.uid, { stripeRole: 'pro', unrelated: true });
    const subscriptions = db.collection(`customers/${f.uid}/subscriptions`);
    await subscriptions.doc('active').set({ status: 'active', role: 'pro', created: Timestamp.now(), appOwned: true });
    await subscriptions.doc('trial').set({ status: 'trialing', role: 'basic' });
    await subscriptions.doc('canceled').set({ status: 'canceled', ended_at: Timestamp.fromMillis(1) });
    const before = await subscriptions.doc('active').get();
    await requestBillingDeletion(db, f.uid, f.customerId);
    await f.run(billingId('delete', f.uid));
    expect(f.stripe.customers.del).toHaveBeenCalledWith(f.customerId);
    expect((await subscriptions.where('status', 'in', ['active', 'trialing']).get()).empty).toBe(true);
    expect((await subscriptions.doc('active').get()).data()).toMatchObject({ status: 'canceled', appOwned: true, ended_at: expect.any(Timestamp) });
    expect((await subscriptions.doc('canceled').get()).get('ended_at').toMillis()).toBe(1);
    expect((await db.doc(`customers/${f.uid}`).get()).exists).toBe(false);
    await onSubscriptionUpdated.run({ id: `evt_cancel_${f.uid}`, params: { uid: f.uid, subscriptionId: 'active' },
      data: { before, after: await subscriptions.doc('active').get() } } as Parameters<typeof onSubscriptionUpdated.run>[0]);
    const claims = (await admin.auth().getUser(f.uid)).customClaims;
    expect(claims).toMatchObject({ stripeRole: 'free', unrelated: true });
    expect(claims?.gracePeriodUntil).toBeGreaterThan(Date.now());
    expect((await db.doc(`customers/${f.uid}`).get()).exists).toBe(false);
  });
  it('finishes cancellation across bounded pages without resetting the deletion operation', async () => {
    const f = await fixture(); const id = billingId('delete', f.uid);
    const subscriptions = db.collection(`customers/${f.uid}/subscriptions`);
    const batch = db.batch();
    for (let i = 0; i < 101; i++) batch.set(subscriptions.doc(`sub_${i}`), { status: 'active', role: 'pro' });
    await batch.commit();
    await requestBillingDeletion(db, f.uid, f.customerId);
    await expect(f.run(id)).resolves.toBeUndefined();
    expect((await subscriptions.where('status', '==', 'active').get()).size).toBe(1);
    const job = db.doc(`${BILLING_JOBS}/${id}`);
    expect((await job.get()).get('state')).toBe('pending');
    expect((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).exists).toBe(false);
    await f.readyRetry(id);
    await f.run(id, 1);
    expect((await subscriptions.where('status', '==', 'active').get()).empty).toBe(true);
    expect((await job.get()).get('state')).toBe('done');
    expect((await job.get()).get('generation')).toBe(1);
  });
  it('does not recreate subscriptions when Auth cleanup begins during Stripe customer deletion', async () => {
    const f = await fixture();
    const subscription = db.doc(`customers/${f.uid}/subscriptions/${f.sub.id}`);
    await subscription.set({ status: 'active', role: 'pro' });
    await requestBillingDeletion(db, f.uid, f.customerId);
    f.stripe.customers.del.mockImplementationOnce(async () => {
      await db.doc(`userDeletionTombstones/${f.uid}`).set({});
      await db.recursiveDelete(db.doc(`customers/${f.uid}`));
      return { id: f.customerId, deleted: true };
    });
    await f.run(billingId('delete', f.uid));
    expect((await subscription.get()).exists).toBe(false);
    expect((await db.doc(`customers/${f.uid}`).get()).exists).toBe(false);
  });
  it('does not cancel records for a replacement binding created during remote deletion', async () => {
    const f = await fixture();
    const subscription = db.doc(`customers/${f.uid}/subscriptions/${f.sub.id}`);
    await subscription.set({ status: 'active', role: 'pro' });
    await requestBillingDeletion(db, f.uid, f.customerId);
    f.stripe.customers.del.mockImplementationOnce(async () => {
      await db.doc(`customers/${f.uid}`).set({ stripeId: 'cus_replacement' });
      return { id: f.customerId, deleted: true };
    });
    const id = billingId('delete', f.uid);
    await f.run(id);
    expect((await subscription.get()).get('status')).toBe('active');
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('error')).toBe('customer_conflict');
  });
  it('keeps subscriptions intact until remote customer deletion is confirmed', async () => {
    const f = await fixture(); const id = billingId('delete', f.uid);
    const subscription = db.doc(`customers/${f.uid}/subscriptions/${f.sub.id}`);
    await subscription.set({ status: 'active', role: 'pro' });
    await requestBillingDeletion(db, f.uid, f.customerId);
    f.stripe.customers.del.mockRejectedValueOnce(new Error('uncertain deletion reply'));
    await expect(f.run(id)).rejects.toThrow();
    expect((await subscription.get()).get('status')).toBe('active');
    await f.readyRetry(id); await f.run(id);
    expect((await subscription.get()).get('status')).toBe('canceled');
  });
  it('treats a delayed invoice event after one-off draft deletion as completed work', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    const invoices = { retrieve: vi.fn().mockRejectedValue({ code: 'resource_missing' }) };
    Object.assign(f.stripe, { invoices });
    const id = (await admitBillingEvent(db, { ...f.event(), type: 'invoice.created', kind: 'invoice', objectId: `in_${f.uid}` }))!;
    await f.run(id);
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('done');
    expect((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).exists).toBe(false);
  });
  it('retains invoice lookup permission failures for retry instead of treating them as deleted drafts', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    Object.assign(f.stripe, { invoices: { retrieve: vi.fn().mockRejectedValue({ code: 'permission_denied' }) } });
    const id = (await admitBillingEvent(db, { ...f.event(), type: 'invoice.created', kind: 'invoice', objectId: `in_${f.uid}` }))!;
    await expect(f.run(id)).rejects.toThrow();
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('pending');
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('attempts')).toBe(1);
  });
  it('stops cleanup customer recovery if billing ownership changes during the Stripe lookup', async () => {
    const f = await fixture();
    f.stripe.customers.create.mockRejectedValueOnce(new Error('uncertain customer creation'));
    await expect(f.run((await f.admit())!)).rejects.toThrow();
    await db.doc(`userDeletionTombstones/${f.uid}`).set({});
    await requestBillingDeletion(db, f.uid);
    f.stripe.customers.search.mockImplementationOnce(async () => {
      await db.doc(BILLING_CONTROL).update({ owner: 'extension' });
      return { data: [], has_more: false };
    });
    try {
      await expect(f.run(billingId('delete', f.uid))).rejects.toThrow();
      expect(f.stripe.customers.create).toHaveBeenCalledTimes(1);
      expect(f.stripe.customers.del).not.toHaveBeenCalled();
      expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/customer`).get()).get('result')).toBeUndefined();
    } finally { await db.doc(BILLING_CONTROL).update({ owner: 'native' }); }
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
  it('retains a late customer deletion identity when Auth cleanup is already removing the private journal', async () => {
    const f = await fixture(); const id = billingId('delete', f.uid);
    await db.doc(`userDeletionTombstones/${f.uid}`).set({});
    // Auth cleanup can see an already removed customer root before its delete
    // event delivers the only copy of the legacy Stripe customer identity.
    await requestBillingDeletion(db, f.uid);
    const remove = db.recursiveDelete.bind(db);
    let lateEventDelivered = false;
    const spy = vi.spyOn(db, 'recursiveDelete').mockImplementation(async (ref, writer) => {
      if (!lateEventDelivered && ref.path === `${BILLING_ACCOUNTS}/${f.uid}/operations`) {
        lateEventDelivered = true;
        await requestBillingDeletion(db, f.uid, f.customerId);
      }
      return remove(ref, writer);
    });
    try { await expect(f.run(id)).resolves.toBeUndefined(); }
    finally { spy.mockRestore(); }
    expect(lateEventDelivered).toBe(true);
    const job = db.doc(`${BILLING_JOBS}/${id}`);
    expect((await job.get()).get('deleteIds')).toContain(f.customerId);
    expect((await job.get()).get('state')).toBe('pending');
    expect((await db.doc(`${BILLING_ACCOUNTS}/${f.uid}`).get()).exists).toBe(false);
    await f.readyRetry(id);
    await f.run(id, 1);
    expect(f.stripe.customers.del).toHaveBeenCalledWith(f.customerId);
    expect((await job.get()).exists).toBe(false);
  });
  it('does not reopen an exhausted deletion from duplicate lifecycle events', async () => {
    const f = await fixture(); const id = billingId('delete', f.uid);
    await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    await requestBillingDeletion(db, f.uid);
    const ref = db.doc(`${BILLING_JOBS}/${id}`);
    await ref.update({ attempts: PROVIDER_MAX_RETRY_COUNT - 1 });
    f.stripe.customers.del.mockRejectedValueOnce(new Error('temporary deletion failure'));
    await f.run(id);
    expect((await ref.get()).get('state')).toBe('failed');
    await requestBillingDeletion(db, f.uid, f.customerId);
    await requestBillingDeletion(db, f.uid);
    expect((await ref.get()).get('state')).toBe('failed');
    expect((await ref.get()).get('attempts')).toBe(PROVIDER_MAX_RETRY_COUNT);
    expect((await ref.get()).get('generation')).toBe(0);
    expect(await replayBillingJob(db, id, true)).toBe('requeued');
    await f.run(id, 1);
    expect((await ref.get()).get('state')).toBe('done');
    await requestBillingDeletion(db, f.uid, f.customerId);
    expect((await ref.get()).get('state')).toBe('done');
    expect((await ref.get()).get('generation')).toBe(1);
  });
  it.each(['done', 'failed'])('retains newly discovered identities after a %s deletion', async state => {
    const f = await fixture(); const id = billingId('delete', f.uid);
    await requestBillingDeletion(db, f.uid, f.customerId);
    const ref = db.doc(`${BILLING_JOBS}/${id}`);
    if (state === 'failed') {
      await ref.update({ attempts: PROVIDER_MAX_RETRY_COUNT - 1 });
      f.stripe.customers.del.mockRejectedValueOnce(new Error('temporary deletion failure'));
    }
    await f.run(id);
    expect((await ref.get()).get('state')).toBe(state);
    const lateCustomerId = `cus_late_${f.uid}`;
    await requestBillingDeletion(db, f.uid, lateCustomerId);
    expect((await ref.get()).get('deleteIds')).toEqual(expect.arrayContaining([f.customerId, lateCustomerId]));
    if (state === 'failed') {
      expect((await ref.get()).get('state')).toBe('failed');
      expect((await ref.get()).get('attempts')).toBe(PROVIDER_MAX_RETRY_COUNT);
      expect(await replayBillingJob(db, id, true)).toBe('requeued');
    } else expect((await ref.get()).get('state')).toBe('pending');
    await f.run(id, 1);
    expect(f.stripe.customers.del).toHaveBeenCalledWith(lateCustomerId);
    expect((await ref.get()).get('state')).toBe('done');
  });
  it('removes the retained deletion fence when Auth cleanup follows completed customer-document cleanup', async () => {
    const f = await fixture(); const id = billingId('delete', f.uid);
    await requestBillingDeletion(db, f.uid, f.customerId);
    await f.run(id);
    const ref = db.doc(`${BILLING_JOBS}/${id}`);
    const account = db.doc(`${BILLING_ACCOUNTS}/${f.uid}`);
    expect((await ref.get()).get('state')).toBe('done');
    expect((await account.get()).get('deleted')).toBe(true);
    await db.doc(`userDeletionTombstones/${f.uid}`).set({});
    await requestBillingDeletion(db, f.uid);
    expect((await ref.get()).get('state')).toBe('pending');
    await f.run(id, 1);
    expect((await ref.get()).exists).toBe(false);
    expect((await account.get()).exists).toBe(false);
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
  it('does not charge earlier transport contention against the first provider attempt', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    const id = (await admitBillingEvent(db, f.event()))!;
    vi.mocked(getBillingStripe).mockResolvedValue(f.ctx.stripe);
    f.stripe.subscriptions.retrieve.mockRejectedValueOnce(new Error('temporary provider outage'));
    const request = { data: { id, generation: 0 }, retryCount: PROVIDER_MAX_RETRY_COUNT - 1,
      executionCount: PROVIDER_MAX_RETRY_COUNT, queueName: 'processStripeBillingTask', id: 'synthetic-task', scheduledTime: new Date().toISOString(), retryReason: 'UNAVAILABLE' };
    await expect(processStripeBillingTask.run(request as any)).rejects.toThrow();
    const job = await db.doc(`${BILLING_JOBS}/${id}`).get();
    expect(job.get('state')).toBe('pending');
    expect(job.get('attempts')).toBe(1);
    expect((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).exists).toBe(false);
    await f.readyRetry(id); await processStripeBillingTask.run({ ...request, retryCount: PROVIDER_MAX_RETRY_COUNT } as any);
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('state')).toBe('done');
    expect(f.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
  });
  it('bounds repeated enqueue failures with durable backoff, terminal records and explicit replay', async () => {
    const f = await fixture(); const id = (await f.admit())!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    const transport = { enqueue: vi.fn().mockRejectedValue(new Error('PRIVATE dispatch response')), exists: vi.fn() };
    await ref.update({ recoveries: PROVIDER_MAX_RETRY_COUNT - 2 });
    await dispatchBillingJob(db, id, transport);
    let job = await ref.get();
    expect(job.get('state')).toBe('pending');
    expect(job.get('recoveries')).toBe(PROVIDER_MAX_RETRY_COUNT - 1);
    expect(job.get('dispatchRetryAt').toMillis()).toBeGreaterThan(Date.now());
    await dispatchBillingJob(db, id, transport); // Duplicate creation delivery respects saved backoff.
    expect(transport.enqueue).toHaveBeenCalledTimes(1);
    await ref.update({ dispatchRetryAt: Timestamp.fromMillis(0), recoverAt: Timestamp.fromMillis(0) });
    await dispatchBillingJob(db, id, transport, true);
    job = await ref.get();
    expect(job.get('state')).toBe('failed');
    expect(job.get('attempts')).toBe(0);
    expect(job.get('recoveries')).toBe(PROVIDER_MAX_RETRY_COUNT);
    const failure = (await db.doc(`failed_jobs/stripe_billing_${id}`).get()).data();
    expect(failure?.error).toBe('retry_exhausted');
    expect(JSON.stringify(failure)).not.toContain('PRIVATE');
    expect((await f.ref.get()).get('error.code')).toBe('retry_exhausted');
    expect(await replayBillingJob(db, id, true)).toBe('requeued');
    expect((await ref.get()).get('dispatchRetryAt')).toBeUndefined();
    expect((await ref.get()).get('recoveries')).toBe(0);
  });
  it('bounds getTask failures without assuming that a reserved task is missing', async () => {
    const f = await fixture(); const id = (await f.admit())!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    await ref.update({ dispatchedAt: Timestamp.now(), recoveries: PROVIDER_MAX_RETRY_COUNT - 1 });
    const transport = { enqueue: vi.fn(), exists: vi.fn().mockRejectedValue(new Error('permission denied')) };
    await dispatchBillingJob(db, id, transport, true);
    expect(transport.enqueue).not.toHaveBeenCalled();
    expect((await ref.get()).get('generation')).toBe(0);
    expect((await ref.get()).get('state')).toBe('failed');
    expect((await f.ref.get()).get('error.code')).toBe('retry_exhausted');
  });
  it('does not write retry failures or recreate checkout during deletion in a failed enqueue', async () => {
    const f = await fixture(); const id = (await f.admit())!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    await ref.update({ recoveries: PROVIDER_MAX_RETRY_COUNT - 1 });
    const transport = { exists: vi.fn(), enqueue: vi.fn(async () => {
      await requestBillingDeletion(db, f.uid);
      await db.recursiveDelete(db.doc(`customers/${f.uid}`));
      throw new Error('ambiguous dispatch reply');
    }) };
    await dispatchBillingJob(db, id, transport);
    expect((await ref.get()).get('recoveries')).toBe(PROVIDER_MAX_RETRY_COUNT - 1);
    expect((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).exists).toBe(false);
    expect((await f.ref.get()).exists).toBe(false);
  });
  it('recovers dispatch failure with the same task identity and rotates only a verified missing reservation', async () => {
    const f = await fixture(); const id = (await f.admit())!;
    const transport = { enqueue: vi.fn().mockRejectedValueOnce(new Error('outage')).mockResolvedValue(undefined), exists: vi.fn().mockResolvedValue(false) };
    await dispatchBillingJob(db, id, transport);
    expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).get('dispatchedAt')).toBeUndefined();
    await db.doc(`${BILLING_JOBS}/${id}`).update({ dispatchRetryAt: Timestamp.fromMillis(0) });
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
    const job = db.doc(`${BILLING_JOBS}/${id}`);
    const dispatchTime = (await job.get()).get('dueAt').toMillis() + 1;
    Object.assign(f.ctx, { now: () => dispatchTime });
    await db.doc(BILLING_CONTROL).update({ owner: 'extension' });
    try { expect(await f.admit()).toBeNull(); await f.run(id); expect(f.stripe.customers.create).not.toHaveBeenCalled(); }
    finally { await db.doc(BILLING_CONTROL).update({ owner: 'native' }); }
    expect((await job.get()).get('attempts')).toBe(0);
    expect((await job.get()).get('leaseUntil')).toBeUndefined();
    await f.run(id); expect((await f.ref.get()).get('url')).toBeTruthy();
  });
  it('does not consume a provider attempt before the scheduled dispatch time', async () => {
    const f = await fixture(); const id = (await f.admit())!;
    const job = db.doc(`${BILLING_JOBS}/${id}`);
    const scheduledTime = Date.now() + 60_000;
    await job.update({ dueAt: Timestamp.fromMillis(scheduledTime) });
    let dispatchTime = scheduledTime - 60_000;
    Object.assign(f.ctx, { now: () => dispatchTime });
    await expect(f.run(id)).resolves.toBeUndefined();
    expect((await job.get()).get('attempts')).toBe(0);
    expect((await job.get()).get('dueAt').toMillis()).toBe(scheduledTime);
    expect((await job.get()).get('generation')).toBe(1);
    expect(f.stripe.customers.create).not.toHaveBeenCalled();
    dispatchTime = scheduledTime;
    await f.run(id, 1);
    expect((await job.get()).get('attempts')).toBe(1);
    expect((await job.get()).get('state')).toBe('done');
  });
  it.each(['customer', 'catalog'])('durably defers %s contention once, without error logs or failure budgets', async scope => {
    const f = await fixture();
    const id = scope === 'customer' ? (await f.admit())! : (await admitBillingEvent(db, {
      ...f.event(), kind: 'product', type: 'product.updated', objectId: f.product.id, customerId: null,
    }))!;
    const ref = db.doc(`${BILLING_JOBS}/${id}`);
    await ref.update({ recoveries: 3, dispatchedAt: Timestamp.now() });
    const lease = await acquireBillingLease(db, scope === 'customer' ? `customer:${f.uid}` : 'catalog');
    vi.mocked(getBillingStripe).mockResolvedValue(f.ctx.stripe);
    vi.mocked(logger.warn).mockClear(); vi.mocked(logger.error).mockClear();
    const before = Date.now();
    try {
      // Exercise the task entrypoint as well as simultaneous duplicate delivery.
      await Promise.all([processStripeBillingTask.run({ data: { id, generation: 0 } } as any), f.run(id)]);
      const deferred = (await ref.get()).data()!;
      expect(deferred).toMatchObject({ state: 'pending', generation: 1, attempts: 0, recoveries: 3 });
      expect(deferred.dueAt.toMillis()).toBeGreaterThanOrEqual(before + 5_000);
      expect(deferred.dueAt.toMillis()).toBeLessThanOrEqual(Date.now() + 10_000);
      expect(deferred.recoverAt.isEqual(deferred.dueAt)).toBe(true);
      expect(deferred.dispatchedAt).toBeUndefined();
      expect(deferred.lease).toBeUndefined();
      expect((await f.ref.get()).get('error')).toBeUndefined();
      expect((await db.doc(`failed_jobs/stripe_billing_${id}`).get()).exists).toBe(false);
      expect(f.stripe.customers.create).not.toHaveBeenCalled();
      expect(f.stripe.products.retrieve).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled(); expect(logger.error).not.toHaveBeenCalled();
      const transport = { enqueue: vi.fn(), exists: vi.fn() };
      await dispatchBillingJob(db, id, transport);
      expect(transport.enqueue).toHaveBeenCalledExactlyOnceWith(id, 1, deferred.dueAt.toDate());
      await f.run(id); // An old task retry cannot consume the new generation.
      expect((await ref.get()).get('attempts')).toBe(0);
    } finally { await releaseBillingLease(db, lease); }
    await f.readyRetry(id); await f.run(id, 1);
    expect((await ref.get()).data()).toMatchObject({ state: 'done', generation: 1, attempts: 1, recoveries: 3 });
  });
  it('preserves an active writer while a different webhook for its customer is deferred', async () => {
    const f = await fixture(); await db.doc(`customers/${f.uid}`).set({ stripeId: f.customerId });
    const first = (await admitBillingEvent(db, f.event()))!, second = (await admitBillingEvent(db, f.event()))!;
    let unblock!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { unblock = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    f.stripe.subscriptions.retrieve.mockImplementationOnce(async () => { started(); await waiting; return f.sub; });
    const running = f.run(first);
    try {
      await entered;
      const claim = (await db.doc(`${BILLING_JOBS}/${first}`).get()).data();
      await Promise.all([f.run(first), f.run(second)]);
      expect((await db.doc(`${BILLING_JOBS}/${first}`).get()).data()).toEqual(claim);
      expect((await db.doc(`${BILLING_JOBS}/${second}`).get()).data()).toMatchObject({ generation: 1, attempts: 0 });
      expect(f.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    } finally { unblock(); await running; }
    expect((await db.doc(`${BILLING_JOBS}/${first}`).get()).get('state')).toBe('done');
    await f.readyRetry(second); await f.run(second, 1);
    expect((await db.doc(`${BILLING_JOBS}/${second}`).get()).get('state')).toBe('done');
    expect(f.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
  });
  it('keeps a short local contention retry undispatched until local recovery can deliver it', async () => {
    const f = await fixture(); const id = (await f.admit())!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try { await f.run(id); } finally { await releaseBillingLease(db, lease); }
    // Keep this transport check in the future even on a slow emulator host;
    // the contention cases above verify the actual 5–10 second delay.
    const dueAt = Timestamp.fromMillis(Date.now() + 60_000);
    await ref.update({ dueAt, recoverAt: dueAt });
    vi.stubEnv('QS_BILLING_LOCAL', 'true'); vi.stubEnv('STRIPE_BILLING_KEY', 'rk_test_synthetic');
    vi.stubEnv('GCLOUD_PROJECT', 'demo-stripe-billing-tests');
    const localFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe(`http://127.0.0.1:5001/${process.env.GCLOUD_PROJECT}/europe-west3/processStripeBillingTask`);
      const { data } = JSON.parse(init!.body as string);
      await f.run(data.id, data.generation);
      return new Response(null, { status: 200 });
    });
    vi.mocked(logger.warn).mockClear(); vi.mocked(logger.error).mockClear();
    try {
      const transport = billingTransport();
      const time = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(time);
      try {
        // Sending even slightly early would make the worker create an
        // unnecessary successor generation instead of honoring its due time.
        expect(await transport.enqueue(id, 1, new Date(time + 500))).toBe('deferred');
      } finally { clock.mockRestore(); }
      await dispatchBillingJob(db, id, transport);
      const deferred = (await ref.get()).data()!;
      expect(deferred.dispatchedAt).toBeUndefined();
      expect(deferred.recoverAt.isEqual(dueAt)).toBe(true);
      expect(deferred.recoveries ?? 0).toBe(0);
      expect(localFetch).not.toHaveBeenCalled();
      // Make only this synthetic job due, then exercise the recovery path used
      // by the local command without changing its generation or journal.
      await ref.update({ dueAt: Timestamp.fromMillis(0), recoverAt: Timestamp.fromMillis(0) });
      await dispatchBillingJob(db, id, transport, true);
      expect((await ref.get()).data()).toMatchObject({ state: 'done', generation: 1, attempts: 1 });
      expect((await ref.get()).get('recoveries') ?? 0).toBe(0);
      expect(localFetch).toHaveBeenCalledTimes(1);
      expect(f.stripe.customers.create).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled(); expect(logger.error).not.toHaveBeenCalled();
    } finally { localFetch.mockRestore(); vi.unstubAllEnvs(); }
  });
  it.each(['generation', 'claim'])('fences a late local deferral against a concurrent %s change', async change => {
    const f = await fixture(); const id = (await f.admit())!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    let concurrent: admin.firestore.DocumentData | undefined;
    const transport = { exists: vi.fn(), enqueue: vi.fn(async () => {
      await ref.update(change === 'generation' ? { generation: 1 } : {
        lease: 'synthetic-active-worker', leaseUntil: Timestamp.fromMillis(Date.now() + 60_000), attempts: 1,
      });
      concurrent = (await ref.get()).data();
      return 'deferred' as const;
    }) };
    await dispatchBillingJob(db, id, transport);
    expect((await ref.get()).data()).toEqual(concurrent);
    expect(f.stripe.customers.create).not.toHaveBeenCalled();
  });
  it('preserves concurrent dispatch backoff when local delivery is deferred', async () => {
    const f = await fixture(); const id = (await f.admit())!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    const retryAt = Timestamp.fromMillis(Date.now() + 900_000);
    await dispatchBillingJob(db, id, { exists: vi.fn(), enqueue: vi.fn(async () => {
      await ref.update({ dispatchRetryAt: retryAt, recoverAt: retryAt, recoveries: 2 });
      return 'deferred' as const;
    }) });
    const pending = (await ref.get()).data()!;
    expect(pending).toMatchObject({ state: 'pending', generation: 0, attempts: 0, recoveries: 2 });
    expect(pending.dispatchRetryAt.isEqual(retryAt)).toBe(true);
    expect(pending.recoverAt.isEqual(retryAt)).toBe(true);
    expect(pending.dispatchedAt).toBeUndefined();
  });
  it.each([false, true])('keeps retry durability when the deferral write fails (committed: %s)', async committed => {
    const f = await fixture(); const id = (await f.admit())!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    const transaction = db.runTransaction.bind(db);
    const spy = vi.spyOn(db, 'runTransaction').mockImplementationOnce(transaction).mockImplementationOnce(async (...args) => {
      if (committed) await transaction(...args);
      throw new Error('synthetic lost Firestore reply');
    });
    try { await expect(f.run(id)).rejects.toThrow('synthetic lost Firestore reply'); }
    finally { spy.mockRestore(); await releaseBillingLease(db, lease); }
    expect((await ref.get()).data()).toMatchObject({ state: 'pending', generation: committed ? 1 : 0, attempts: 0 });
    expect(f.stripe.customers.create).not.toHaveBeenCalled();
    if (committed) { await f.run(id); expect(f.stripe.customers.create).not.toHaveBeenCalled(); }
    await f.readyRetry(id); await f.run(id, committed ? 1 : 0);
    expect((await ref.get()).get('state')).toBe('done');
    expect(f.stripe.customers.create).toHaveBeenCalledTimes(1);
  });
  it('preserves provider backoff and the frozen checkout operation during contention', async () => {
    const f = await fixture(); const id = (await f.admit())!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    const create = f.stripe.checkout.sessions.create.getMockImplementation()!;
    f.stripe.checkout.sessions.create.mockImplementationOnce(async (...args) => { await create(...args); throw new Error('lost Stripe reply'); });
    const failureStarted = Date.now();
    await expect(f.run(id)).rejects.toThrow();
    const failed = (await ref.get()).data()!;
    expect(failed.dueAt.toMillis()).toBeGreaterThanOrEqual(failureStarted + 900_000);
    const operation = db.doc(`${BILLING_ACCOUNTS}/${f.uid}/operations/checkout_${f.requestId}`);
    const frozen = (await operation.get()).data();
    const retryAt = Timestamp.fromMillis(failed.dueAt.toMillis() + 60_000);
    await ref.update({ recoveries: 2, dispatchRetryAt: retryAt });
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    vi.mocked(logger.warn).mockClear(); vi.mocked(logger.error).mockClear();
    try { await f.run(id); } finally { await releaseBillingLease(db, lease); }
    expect((await ref.get()).data()).toMatchObject({ generation: 1, attempts: 1, recoveries: 2, error: failed.error });
    expect((await ref.get()).get('dueAt').isEqual(retryAt)).toBe(true);
    expect((await operation.get()).data()).toEqual(frozen);
    expect(logger.warn).not.toHaveBeenCalled(); expect(logger.error).not.toHaveBeenCalled();
    await f.readyRetry(id); await f.run(id, 1);
    expect(f.stripe.checkout.sessions.create.mock.calls[0]).toEqual(f.stripe.checkout.sessions.create.mock.calls[1]);
    expect(f.sessions.size).toBe(1);
    expect((await ref.get()).get('state')).toBe('done');
  });
  it('does not let an earlier dispatch completion overwrite the contention successor', async () => {
    const f = await fixture(); const id = (await f.admit())!; const ref = db.doc(`${BILLING_JOBS}/${id}`);
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try {
      await dispatchBillingJob(db, id, { exists: vi.fn(), enqueue: vi.fn(async () => { await f.run(id); }) });
      expect((await ref.get()).get('generation')).toBe(1);
      expect((await ref.get()).get('dispatchedAt')).toBeUndefined();
      expect((await ref.get()).get('recoverAt').isEqual((await ref.get()).get('dueAt'))).toBe(true);
    } finally { await releaseBillingLease(db, lease); }
  });
  it.each(['tombstone', 'missing-user', 'deleting'])('guards %s accounts during contention while retaining deletion work', async guard => {
    const f = await fixture(); const id = (await f.admit())!;
    if (guard === 'deleting') await requestBillingDeletion(db, f.uid, f.customerId);
    if (guard === 'tombstone') await db.doc(`userDeletionTombstones/${f.uid}`).set({});
    if (guard === 'missing-user') await db.recursiveDelete(db.doc(`users/${f.uid}`));
    const deletionId = billingId('delete', f.uid);
    const lease = await acquireBillingLease(db, `customer:${f.uid}`);
    try {
      await f.run(id);
      expect((await db.doc(`${BILLING_JOBS}/${id}`).get()).exists).toBe(false);
      await requestBillingDeletion(db, f.uid, f.customerId);
      await f.run(deletionId);
      expect((await db.doc(`${BILLING_JOBS}/${deletionId}`).get()).data()).toMatchObject({ state: 'pending', generation: 1, attempts: 0 });
      expect(f.stripe.customers.create).not.toHaveBeenCalled();
      expect(f.stripe.customers.del).not.toHaveBeenCalled();
    } finally { await releaseBillingLease(db, lease); }
    await f.readyRetry(deletionId); await f.run(deletionId, 1);
    expect(f.stripe.customers.del).toHaveBeenCalledWith(f.customerId);
    expect((await db.doc(`customers/${f.uid}`).get()).exists).toBe(false);
  });
  it('does not let an expired lease release the replacement owner', async () => {
    const lease = await acquireBillingLease(db, 'test-lock', 1);
    const replacement = await acquireBillingLease(db, 'test-lock', Date.now());
    await releaseBillingLease(db, lease);
    expect((await replacement.ref.get()).get('token')).toBe(replacement.token);
    await releaseBillingLease(db, replacement);
  });
});
