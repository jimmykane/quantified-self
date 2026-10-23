import { randomUUID } from 'node:crypto';
import { guardedBillingStripe } from './guarded-client';
import type Stripe from 'stripe';
import type { Auth } from 'firebase-admin/auth';
import { FieldPath, FieldValue, Timestamp, type DocumentData, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { BILLING_ACCOUNTS, BILLING_CONTROL, BILLING_JOBS, BILLING_LOCKS, BILLING_LEASE_MS,
  BillingContention, BillingError, billingControl, billingId, IDEMPOTENCY_WINDOW_MS,
  projectionUnchanged, returnUrl, stripeId, type BillingEvent, type BillingJob, type CheckoutRequest } from './model';
import { invoiceProjection, paymentProjection, priceProjections, productProjection,
  subscriptionProjection, taxProjection, type Projection } from './projections';

export interface BillingDependencies { db: Firestore; stripe: Stripe; auth: Pick<Auth, 'getUser'>; now?: () => number }
export interface BillingLease { ref: DocumentReference; token: string }
const now = (ctx: BillingDependencies) => ctx.now?.() ?? Date.now();
const accountRef = (db: Firestore, uid: string) => db.collection(BILLING_ACCOUNTS).doc(uid);
const operationRef = (db: Firestore, uid: string, operation: string) => accountRef(db, uid).collection('operations').doc(operation);

/** One customer-wide lease covers checkout, webhook projection, portal and removal. */
export async function acquireBillingLease(db: Firestore, key: string, nowMs = Date.now()): Promise<BillingLease> {
  const ref = db.collection(BILLING_LOCKS).doc(billingId(key));
  const token = randomUUID();
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (((snapshot.get('until') as Timestamp | undefined)?.toMillis() ?? 0) > nowMs) throw new BillingContention();
    tx.set(ref, { token, until: Timestamp.fromMillis(nowMs + BILLING_LEASE_MS) });
  });
  return { ref, token };
}
export async function releaseBillingLease(db: Firestore, lease: BillingLease): Promise<void> {
  await db.runTransaction(async tx => {
    if ((await tx.get(lease.ref)).get('token') === lease.token) {
      // Locks are private leaf records with no subcollections by design.
      tx.delete(lease.ref);
    }
  });
}
async function checkLease(tx: Transaction, lease: BillingLease, time: number): Promise<void> {
  const snapshot = await tx.get(lease.ref);
  if (snapshot.get('token') !== lease.token || snapshot.get('until')?.toMillis() <= time) throw new BillingContention();
}
export async function assertBillingAuthority(ctx: BillingDependencies, lease: BillingLease, uid: string | null,
  customerId?: string | null, admission = false): Promise<void> {
  await ctx.db.runTransaction(async tx => {
    const control = billingControl((await tx.get(ctx.db.doc(BILLING_CONTROL))).data());
    await checkLease(tx, lease, now(ctx));
    if (control.owner !== 'native' || !control.nativeSince || (admission && !control.requestsEnabled)) throw new BillingError('maintenance', true);
    if (uid) {
      const guard = await getUserDeletionGuardStateInTransaction(ctx.db, tx, uid);
      const [account, customer] = await tx.getAll(accountRef(ctx.db, uid), ctx.db.doc(`customers/${uid}`));
      if (guard.shouldSkip || account.get('deleting')) throw new BillingError('account_unavailable');
      if (customerId && customer.get('stripeId') !== customerId) throw new BillingError('customer_conflict');
    }
  });
}

/** Uses only the existing server-owned binding, never email or event metadata. */
export async function resolveBillingOwner(db: Firestore, customerId: string): Promise<string | null> {
  const owners = await db.collection('customers').where('stripeId', '==', customerId).limit(2).get();
  if (owners.size > 1) throw new BillingError('customer_conflict');
  if (owners.empty) return null;
  const uid = owners.docs[0].id;
  return (await getUserDeletionGuardState(db, uid)).shouldSkip ? null : uid;
}
function validateCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer, uid: string): asserts customer is Stripe.Customer {
  if (customer.deleted) throw new BillingError('customer_conflict');
  if ([customer.metadata.firebaseUID, customer.metadata.linkedToUid].some(owner => !!owner && owner !== uid)) throw new BillingError('customer_conflict');
}
interface Operation { key: string; startedAt: Timestamp; params: DocumentData; result?: { id: string; url?: string | null }; rejected?: boolean }

async function reserveOperation(ctx: BillingDependencies, lease: BillingLease, uid: string, name: string, params: DocumentData): Promise<Operation> {
  return ctx.db.runTransaction(async tx => {
    await checkLease(tx, lease, now(ctx));
    const guard = await getUserDeletionGuardStateInTransaction(ctx.db, tx, uid);
    const root = accountRef(ctx.db, uid);
    const ref = operationRef(ctx.db, uid, name);
    const [account, operation, control] = await tx.getAll(root, ref, ctx.db.doc(BILLING_CONTROL));
    if (billingControl(control.data()).owner !== 'native') throw new BillingError('maintenance', true);
    if (guard.shouldSkip || account.get('deleting')) throw new BillingError('account_unavailable');
    if (operation.exists) return operation.data() as Operation;
    const key = billingId(uid, name, randomUUID());
    const data: Operation = { key, startedAt: Timestamp.fromMillis(now(ctx)), params };
    tx.set(root, { uid }, { merge: true });
    tx.create(ref, data);
    return data;
  });
}
async function checkpointOperation(ctx: BillingDependencies, lease: BillingLease, uid: string, name: string, key: string, result: Operation['result']): Promise<void> {
  await ctx.db.runTransaction(async tx => {
    await checkLease(tx, lease, now(ctx));
    const ref = operationRef(ctx.db, uid, name);
    const saved = await tx.get(ref);
    if (!saved.exists || saved.get('key') !== key) throw new BillingError('operation_uncertain');
    // Deliberate cleanup exception: retain an acknowledged remote identity even
    // after user deletion. This private tree survives until the deletion job
    // removes the remote customer; it never recreates a public user descendant.
    tx.update(ref, { result });
  });
}
async function recoverCustomer(ctx: BillingDependencies, operation: Operation, uid: string): Promise<Stripe.Customer> {
  const candidates = await ctx.stripe.customers.search({ query: `metadata['qsBillingOperation']:'${operation.key}'`, limit: 2 });
  if (candidates.data.length > 1 || candidates.has_more) throw new BillingError('operation_uncertain');
  if (candidates.data[0]) {
    validateCustomer(candidates.data[0], uid);
    return candidates.data[0];
  }
  if (now(ctx) - operation.startedAt.toMillis() >= IDEMPOTENCY_WINDOW_MS) throw new BillingError('operation_uncertain');
  return ctx.stripe.customers.create({ ...operation.params, metadata: { firebaseUID: uid, qsBillingOperation: operation.key } }, { idempotencyKey: operation.key });
}
export async function ensureBillingCustomer(ctx: BillingDependencies, lease: BillingLease, uid: string): Promise<string> {
  await assertBillingAuthority(ctx, lease, uid);
  const customerRef = ctx.db.doc(`customers/${uid}`);
  const boundId = stripeId((await customerRef.get()).get('stripeId'));
  if (boundId) {
    validateCustomer(await ctx.stripe.customers.retrieve(boundId), uid);
    const owners = await ctx.db.collection('customers').where('stripeId', '==', boundId).limit(2).get();
    if (owners.size !== 1 || owners.docs[0].id !== uid) throw new BillingError('customer_conflict');
    await assertBillingAuthority(ctx, lease, uid, boundId);
    return boundId;
  }
  const user = await ctx.auth.getUser(uid);
  const ref = operationRef(ctx.db, uid, 'customer');
  const existing = await ref.get();
  const operation = await reserveOperation(ctx, lease, uid, 'customer', {
    ...(user.email ? { email: user.email } : {}), ...(user.phoneNumber ? { phone: user.phoneNumber } : {}),
    ...(user.displayName ? { name: user.displayName } : {}),
  });
  await assertBillingAuthority(ctx, lease, uid);
  const customer = operation.result?.id ? await ctx.stripe.customers.retrieve(operation.result.id)
    : existing.exists ? await recoverCustomer(ctx, operation, uid)
      : await ctx.stripe.customers.create({ ...operation.params, metadata: { firebaseUID: uid, qsBillingOperation: operation.key } }, { idempotencyKey: operation.key });
  validateCustomer(customer, uid);
  await checkpointOperation(ctx, lease, uid, 'customer', operation.key, { id: customer.id });
  await ctx.db.runTransaction(async tx => {
    await checkLease(tx, lease, now(ctx));
    const guard = await getUserDeletionGuardStateInTransaction(ctx.db, tx, uid);
    const [current, account, owners, control] = await Promise.all([tx.get(customerRef), tx.get(accountRef(ctx.db, uid)),
      tx.get(ctx.db.collection('customers').where('stripeId', '==', customer.id).limit(2)), tx.get(ctx.db.doc(BILLING_CONTROL))]);
    if (billingControl(control.data()).owner !== 'native') throw new BillingError('maintenance', true);
    if (guard.shouldSkip || account.get('deleting')) throw new BillingError('account_unavailable');
    if ((current.get('stripeId') && current.get('stripeId') !== customer.id) || owners.docs.some(d => d.id !== uid)) throw new BillingError('customer_conflict');
    tx.set(customerRef, { stripeId: customer.id, email: customer.email ?? null,
      stripeLink: `https://dashboard.stripe.com${customer.livemode ? '' : '/test'}/customers/${customer.id}` }, { merge: true });
    tx.set(accountRef(ctx.db, uid), { customerId: customer.id }, { merge: true });
  });
  return customer.id;
}

async function checkoutParameters(ctx: BillingDependencies, lease: BillingLease, uid: string, customer: string, request: CheckoutRequest): Promise<Stripe.Checkout.SessionCreateParams> {
  await assertBillingAuthority(ctx, lease, uid, customer);
  const price = await ctx.stripe.prices.retrieve(request.price);
  const productId = stripeId(price.product);
  if (!productId || !price.active || (price.type === 'recurring') !== (request.mode === 'subscription')) throw new BillingError('invalid_request');
  await assertBillingAuthority(ctx, lease, uid, customer);
  const product = await ctx.stripe.products.retrieve(productId);
  const [registeredPrice, registeredProduct] = await ctx.db.getAll(ctx.db.doc(`products/${productId}/prices/${price.id}`), ctx.db.doc(`products/${productId}`));
  if (!product.active || registeredPrice.get('active') !== true || registeredProduct.get('active') !== true) throw new BillingError('invalid_request');
  let trialDays: number | undefined;
  if (request.mode === 'subscription') {
    await assertBillingAuthority(ctx, lease, uid, customer);
    const history = await ctx.stripe.subscriptions.list({ customer, status: 'all', limit: 100 });
    if (history.has_more) throw new BillingError('customer_conflict');
    if (history.data.some(s => !['canceled', 'incomplete_expired'].includes(s.status))) throw new BillingError('subscription_exists');
    const offeredDays = Number(price.metadata.trial_days);
    if (request.trial_period_days !== undefined) {
      if (history.data.length || !Number.isInteger(offeredDays) || offeredDays !== request.trial_period_days) throw new BillingError('trial_ineligible');
      trialDays = offeredDays;
    }
  }
  const params: Stripe.Checkout.SessionCreateParams = {
    customer, mode: request.mode, line_items: [{ price: price.id, quantity: 1 }],
    success_url: request.success_url, cancel_url: request.cancel_url,
    allow_promotion_codes: true, automatic_tax: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    metadata: { firebaseUID: uid },
    // Expiry and every other POST argument are frozen in the operation journal.
    expires_at: Math.floor(now(ctx) / 1000) + 3600,
    ...(request.mode === 'subscription' ? { payment_method_collection: 'if_required' as const,
      // Gifts extend classic subscriptions; the pinned API otherwise defaults to flexible.
      subscription_data: { billing_mode: { type: 'classic' as const }, metadata: { firebaseUID: uid }, ...(trialDays ? { trial_period_days: trialDays } : {}) } }
      : { payment_intent_data: { metadata: { firebaseUID: uid } } }),
  };
  return params;
}

export async function createBillingCheckout(ctx: BillingDependencies, lease: BillingLease, uid: string, requestId: string, request: CheckoutRequest): Promise<{ sessionId: string; url: string; customerId: string }> {
  const customer = await ensureBillingCustomer(ctx, lease, uid);
  const name = `checkout_${requestId}`;
  const root = accountRef(ctx.db, uid);
  const active = (await root.get()).get('activeCheckout') as string | undefined;
  if (active && active !== name) {
    const previous = (await operationRef(ctx.db, uid, active).get()).data() as Operation | undefined;
    if (previous) {
      if (!previous.result?.id) throw new BillingError('operation_uncertain');
      await assertBillingAuthority(ctx, lease, uid, customer);
      const session = await ctx.stripe.checkout.sessions.retrieve(previous.result.id);
      if (session.status === 'open') {
        const lineItems = previous.params.line_items as { price: string }[];
        if (previous.params.mode !== request.mode || lineItems[0]?.price !== request.price) throw new BillingError('operation_uncertain');
        if (!session.url) throw new BillingError('operation_uncertain');
        await assertBillingAuthority(ctx, lease, uid, customer);
        return { sessionId: session.id, url: session.url, customerId: customer };
      }
    }
  }
  const saved = (await operationRef(ctx.db, uid, name).get()).data() as Operation | undefined;
  const params = saved?.params ?? await checkoutParameters(ctx, lease, uid, customer, request);
  const operation = saved ?? await reserveOperation(ctx, lease, uid, name, params);
  if (operation.rejected) throw new BillingError('checkout_rejected');
  await ctx.db.runTransaction(async tx => {
    await checkLease(tx, lease, now(ctx));
    const guard = await getUserDeletionGuardStateInTransaction(ctx.db, tx, uid);
    const [account, control] = await tx.getAll(root, ctx.db.doc(BILLING_CONTROL));
    if (billingControl(control.data()).owner !== 'native') throw new BillingError('maintenance', true);
    if (guard.shouldSkip || account.get('deleting')) throw new BillingError('account_unavailable');
    tx.update(root, { activeCheckout: name });
  });
  await assertBillingAuthority(ctx, lease, uid, customer);
  let session: Stripe.Checkout.Session;
  if (operation.result) session = await ctx.stripe.checkout.sessions.retrieve(operation.result.id);
  else if (now(ctx) - operation.startedAt.toMillis() >= IDEMPOTENCY_WINDOW_MS) {
    const candidates = await ctx.stripe.checkout.sessions.list({ customer, created: { gte: Math.floor(operation.startedAt.toMillis() / 1000) - 1 }, limit: 100 });
    const matches = candidates.data.filter(s => s.metadata?.qsBillingOperation === operation.key);
    if (matches.length !== 1 || candidates.has_more) throw new BillingError('operation_uncertain');
    session = matches[0];
  } else {
    try {
      session = await ctx.stripe.checkout.sessions.create({ ...operation.params,
        metadata: { firebaseUID: uid, qsBillingOperation: operation.key, integration_identifier: 'quantified-self-billing-qsmigrap' } }, { idempotencyKey: operation.key });
    } catch (error) {
      const failure = error as { type?: string; statusCode?: number };
      // A cached, definitive content rejection can survive a configuration fix.
      // Never classify transport errors, 409s, idempotency errors or 5xx this way.
      if (failure.type !== 'StripeInvalidRequestError' || failure.statusCode !== 400) throw error;
      const candidates = await ctx.stripe.checkout.sessions.list({ customer,
        created: { gte: Math.floor(operation.startedAt.toMillis() / 1000) - 1 }, limit: 100 });
      const matches = candidates.data.filter(s => s.metadata?.qsBillingOperation === operation.key);
      if (candidates.has_more || matches.length > 1) throw new BillingError('operation_uncertain');
      if (matches[0]) session = matches[0];
      else {
        await ctx.db.runTransaction(async tx => {
          await checkLease(tx, lease, now(ctx));
          const guard = await getUserDeletionGuardStateInTransaction(ctx.db, tx, uid);
          const ref = operationRef(ctx.db, uid, name);
          const [account, current, control] = await tx.getAll(root, ref, ctx.db.doc(BILLING_CONTROL));
          if (guard.shouldSkip || account.get('deleting')) throw new BillingError('account_unavailable');
          if (billingControl(control.data()).owner !== 'native') throw new BillingError('maintenance', true);
          if (current.get('key') !== operation.key || current.get('result')) throw new BillingError('operation_uncertain');
          tx.update(ref, { rejected: true });
          if (account.get('activeCheckout') === name) tx.update(root, { activeCheckout: FieldValue.delete() });
        });
        // Retain the rejected operation unchanged. Only a new browser request
        // may reserve a new operation after this confirmed unsuccessful outcome.
        throw new BillingError('checkout_rejected');
      }
    }
  }
  if (stripeId(session.customer) !== customer) throw new BillingError('customer_conflict');
  await checkpointOperation(ctx, lease, uid, name, operation.key, { id: session.id, url: session.url });
  await assertBillingAuthority(ctx, lease, uid, customer);
  if (!session.url || session.status !== 'open') throw new BillingError('operation_uncertain');
  return { sessionId: session.id, url: session.url, customerId: customer };
}

export async function createBillingPortal(ctx: BillingDependencies, uid: string, target: unknown, local = false): Promise<{ url: string }> {
  const url = returnUrl(target, local);
  const lease = await acquireBillingLease(ctx.db, `customer:${uid}`, now(ctx));
  try {
    await assertBillingAuthority(ctx, lease, uid, null, true);
    const customer = stripeId((await ctx.db.doc(`customers/${uid}`).get()).get('stripeId'));
    if (!customer) throw new BillingError('customer_conflict');
    validateCustomer(await ctx.stripe.customers.retrieve(customer), uid);
    if (await resolveBillingOwner(ctx.db, customer) !== uid) throw new BillingError('customer_conflict');
    await assertBillingAuthority(ctx, lease, uid, customer, true);
    const session = await ctx.stripe.billingPortal.sessions.create({ customer, return_url: url });
    await assertBillingAuthority(ctx, lease, uid, customer, true);
    return { url: session.url };
  } finally { await releaseBillingLease(ctx.db, lease); }
}

async function subscriptionProjections(ctx: BillingDependencies, uid: string, id: string, customer: string): Promise<Projection[]> {
  const sub = await ctx.stripe.subscriptions.retrieve(id);
  if (stripeId(sub.customer) !== customer) throw new BillingError('customer_conflict');
  const productIds = [...new Set(sub.items.data.map(i => stripeId(i.price.product)))];
  if (productIds.some(id => !id) || productIds.length > 20) throw new BillingError('invalid_request');
  const products = await Promise.all(productIds.map(id => ctx.stripe.products.retrieve(id!)));
  return [subscriptionProjection(ctx.db, uid, sub, products)];
}
async function fetchPaymentProjection(ctx: BillingDependencies, uid: string, payment: Stripe.PaymentIntent): Promise<Projection> {
  const projection = paymentProjection(uid, payment);
  const sessions = await ctx.stripe.checkout.sessions.list({ payment_intent: payment.id, limit: 2 });
  if (sessions.has_more || sessions.data.length > 1) throw new BillingError('customer_conflict');
  if (sessions.data.length) {
    const items = await ctx.stripe.checkout.sessions.listLineItems(sessions.data[0].id, { limit: 100 });
    if (items.has_more) throw new BillingError('invalid_request');
    // Stripe 22 can return Decimal instances (for example unit_amount_decimal).
    // Its JSON representation preserves the legacy string contract and removes
    // SDK prototypes before the Firestore writer validates nested line items.
    projection.data.items = JSON.parse(JSON.stringify(items.data));
    projection.data.prices = items.data.map(item => {
      if (!item.price || !stripeId(item.price.product)) throw new BillingError('invalid_request');
      return ctx.db.doc(`products/${stripeId(item.price.product)}/prices/${item.price.id}`);
    });
  }
  return projection;
}
export async function fetchBillingProjections(ctx: BillingDependencies, event: BillingEvent, uid: string | null): Promise<Projection[]> {
  const stripe = ctx.stripe;
  if (event.kind === 'product') {
    try { return [productProjection(await stripe.products.retrieve(event.objectId))]; }
    // A delayed product.updated can arrive after deletion. Current provider
    // state wins regardless of the event type or order.
    catch (e) { if ((e as { code?: string }).code === 'resource_missing') return [{ path: `products/${event.objectId}`, data: { active: false, deleted: true } }]; throw e; }
  }
  if (event.kind === 'price') return priceProjections(await stripe.prices.retrieve(event.objectId, { expand: ['tiers'] }));
  if (event.kind === 'tax_rate') return [taxProjection(await stripe.taxRates.retrieve(event.objectId))];
  if (!uid || !event.customerId) return [];
  const checkCustomer = (value: unknown) => { if (stripeId(value) !== event.customerId) throw new BillingError('customer_conflict'); };
  if (event.kind === 'subscription') return subscriptionProjections(ctx, uid, event.objectId, event.customerId);
  if (event.kind === 'customer') {
    const customer = await stripe.customers.retrieve(event.customerId);
    return customer.deleted ? [{ path: `customers/${uid}`, data: { stripeDeleted: true } }] : [];
  }
  if (event.kind === 'invoice') {
    const invoice = await stripe.invoices.retrieve(event.objectId);
    checkCustomer(invoice.customer);
    const projection = invoiceProjection(uid, invoice);
    const sub = stripeId(invoice.parent?.subscription_details?.subscription);
    return [...(projection ? [projection] : []), ...(sub ? await subscriptionProjections(ctx, uid, sub, event.customerId) : [])];
  }
  if (event.kind === 'checkout') {
    const session = await stripe.checkout.sessions.retrieve(event.objectId);
    checkCustomer(session.customer);
    const projections: Projection[] = [];
    const sub = stripeId(session.subscription);
    const payment = stripeId(session.payment_intent);
    if (sub) projections.push(...await subscriptionProjections(ctx, uid, sub, event.customerId));
    if (payment) {
      const intent = await stripe.paymentIntents.retrieve(payment, { expand: ['latest_charge'] });
      checkCustomer(intent.customer);
      projections.push(await fetchPaymentProjection(ctx, uid, intent));
    }
    return projections;
  }
  let paymentId = event.objectId;
  if (event.kind === 'charge') {
    const charge = await stripe.charges.retrieve(event.objectId);
    checkCustomer(charge.customer);
    const id = stripeId(charge.payment_intent);
    if (!id) return [];
    paymentId = id;
  }
  const payment = await stripe.paymentIntents.retrieve(paymentId, { expand: ['latest_charge'] });
  checkCustomer(payment.customer);
  return [await fetchPaymentProjection(ctx, uid, payment)];
}

export async function commitBillingProjections(ctx: BillingDependencies, lease: BillingLease, uid: string | null,
  customerId: string | null, projections: Projection[], finish?: { ref: DocumentReference; generation: number }): Promise<boolean> {
  return ctx.db.runTransaction(async tx => {
    await checkLease(tx, lease, now(ctx));
    const control = billingControl((await tx.get(ctx.db.doc(BILLING_CONTROL))).data());
    if (control.owner !== 'native') throw new BillingError('maintenance', true);
    if (uid) {
      const guard = await getUserDeletionGuardStateInTransaction(ctx.db, tx, uid);
      const [customer, account] = await tx.getAll(ctx.db.doc(`customers/${uid}`), accountRef(ctx.db, uid));
      if (guard.shouldSkip || account.get('deleting')) return false;
      if (customer.get('stripeId') !== customerId) throw new BillingError('customer_conflict');
    }
    const refs = projections.map(p => ctx.db.doc(p.path));
    const snapshots = refs.length ? await tx.getAll(...refs) : [];
    if (finish) {
      if (projections.some((p, i) => p.path.includes('/checkout_sessions/') && !snapshots[i].exists)) return false;
      const job = await tx.get(finish.ref);
      if (!job.exists || job.get('state') !== 'pending' || job.get('generation') !== finish.generation) return false;
    }
    projections.forEach((p, i) => {
      const existing = snapshots[i].data();
      const removedMetadata = Object.keys(existing ?? {}).filter(key => key.startsWith('stripe_metadata_') && !(key in p.data));
      if (removedMetadata.length || !projectionUnchanged(existing, p.data)) {
        const patch = { ...p.data, ...Object.fromEntries(removedMetadata.map(key => [key, FieldValue.delete()])) };
        // Replace each provider-owned field completely, including maps whose
        // keys Stripe removed. Preserve unrelated application-owned fields.
        tx.set(refs[i], patch, { mergeFields: Object.keys(patch).map(key => new FieldPath(key)) });
      }
    });
    if (finish) tx.update(finish.ref, { state: 'done', expireAt: Timestamp.fromMillis(now(ctx) + 30 * 86_400_000), lease: FieldValue.delete(), leaseUntil: FieldValue.delete() });
    return true;
  });
}

/** Both Auth and customer-document removal stage the same deletion operation. */
export async function requestBillingDeletion(db: Firestore, uid: string, deletedCustomerId?: string | null): Promise<void> {
  await db.runTransaction(async tx => {
    const control = billingControl((await tx.get(db.doc(BILLING_CONTROL))).data());
    if (control.owner !== 'native') return;
    const [customer, account] = await tx.getAll(db.doc(`customers/${uid}`), accountRef(db, uid));
    if (deletedCustomerId && customer.get('stripeId') && customer.get('stripeId') !== deletedCustomerId) return;
    const ids = [...new Set([deletedCustomerId, stripeId(customer.get('stripeId')), stripeId(account.get('customerId'))].filter((id): id is string => !!id))];
    const jobRef = db.collection(BILLING_JOBS).doc(billingId('delete', uid));
    const prior = await tx.get(jobRef);
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid);
    const priorIds = (prior.get('deleteIds') ?? []) as string[];
    const deleteIds = [...new Set([...priorIds, ...(account.get('deleteIds') ?? []) as string[], ...ids])];
    const addedIds = deleteIds.some(id => !priorIds.includes(id));
    tx.set(accountRef(db, uid), { uid, deleting: true, ...(ids.length ? { deleteIds: FieldValue.arrayUnion(...ids) } : {}) }, { merge: true });
    if (prior.exists && ['pending', 'failed'].includes(prior.get('state'))) {
      // The outbox survives recursive journal cleanup. A late lifecycle event
      // must retain its identity there without resetting terminal retry budgets.
      if (addedIds) tx.update(jobRef, { deleteIds });
    } else if (!prior.exists || addedIds || guard.shouldSkip || !account.get('deleted')) {
      const timestamp = Timestamp.now();
      tx.set(jobRef, { kind: 'delete', uid, customerId: null, deleteIds, state: 'pending', createdAt: timestamp,
        dueAt: timestamp, recoverAt: timestamp, attempts: 0, generation: (prior.get('generation') ?? -1) + 1 } satisfies BillingJob);
    }
  });
}

export async function deleteBillingCustomer(ctx: BillingDependencies, lease: BillingLease, uid: string): Promise<string[]> {
  const root = accountRef(ctx.db, uid);
  const [account, job] = await ctx.db.getAll(root, ctx.db.collection(BILLING_JOBS).doc(billingId('delete', uid)));
  if (job.get('kind') !== 'delete' || job.get('state') !== 'pending') throw new BillingContention();
  const operation = (await operationRef(ctx.db, uid, 'customer').get()).data() as Operation | undefined;
  // A prior attempt may already have removed the account journal before a late
  // customer-document event added another identity to the retained deletion job.
  const ids = new Set<string>([...(account.get('deleteIds') ?? []), ...(job.get('deleteIds') ?? [])]);
  const assertDeletionAuthority = (customerId?: string) => ctx.db.runTransaction(async tx => {
    await checkLease(tx, lease, now(ctx));
    const control = billingControl((await tx.get(ctx.db.doc(BILLING_CONTROL))).data());
    if (control.owner !== 'native' || !control.nativeSince) throw new BillingError('maintenance', true);
    if (customerId) {
      const owners = await tx.get(ctx.db.collection('customers').where('stripeId', '==', customerId).limit(2));
      if (owners.docs.some(d => d.id !== uid)) throw new BillingError('customer_conflict');
    }
  });
  if (operation) {
    if (operation.result) ids.add(operation.result.id);
    else {
      // Cleanup is the sole exception to the active-user gate: recover the
      // original possibly accepted POST, then remove that exact remote object.
      const stripe = guardedBillingStripe(ctx.stripe, () => assertDeletionAuthority());
      const recovered = await recoverCustomer({ ...ctx, stripe }, operation, uid);
      await checkpointOperation(ctx, lease, uid, 'customer', operation.key, { id: recovered.id });
      ids.add(recovered.id);
    }
  }
  for (const id of ids) {
    await assertDeletionAuthority(id);
    try { await ctx.stripe.customers.del(id); }
    catch (e) { if ((e as { code?: string }).code !== 'resource_missing') throw e; }
  }
  // No writer can acquire this customer's lease during cleanup. New admissions
  // also see deleting=true, while deleted users fail the shared tombstone guard.
  const jobs = await ctx.db.collection(BILLING_JOBS).where('uid', '==', uid).limit(200).get();
  for (const job of jobs.docs) if (job.get('kind') !== 'delete') {
    await ctx.db.recursiveDelete(ctx.db.collection('failed_jobs').doc(`stripe_billing_${job.id}`));
    await ctx.db.recursiveDelete(job.ref);
  }
  if (jobs.size === 200) throw new BillingError('provider_unavailable', true);
  await ctx.db.recursiveDelete(root.collection('operations'));
  // Keep the fence if an administrator removed only the customer document.
  // Auth deletion removes the private root after all remote work is complete.
  if ((await getUserDeletionGuardState(ctx.db, uid)).shouldSkip) await ctx.db.recursiveDelete(root);
  else await root.update({ deleteIds: [], deleted: true });
  return [...ids];
}
