// Explicit local/test-mode fixture driver. No production project or credential input.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { root, readLocalEnvironment, project } from './local.mjs';
import { assertProTrialCheckout } from './test-mode-verification.mjs';
Object.assign(process.env, readLocalEnvironment());
// Fixture evidence is one local journal; reject overlapping driver processes.
const lockFile = resolve(root, '.local/stripe-billing/fixture-driver.lock');
try { closeSync(openSync(lockFile, 'wx', 0o600)); }
catch { throw new Error('A fixture driver is already running. Run commands sequentially; remove a stale local lock only after verifying that no driver remains.'); }
process.once('exit', () => unlinkSync(lockFile));
const require = createRequire(resolve(root, 'functions/package.json'));
const admin = require('firebase-admin');
const app = admin.initializeApp({ projectId: project }); const db = app.firestore();
db.settings({ ignoreUndefinedProperties: true });
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_BILLING_KEY, { apiVersion: '2026-07-29.dahlia', timeout: 20000 });
const stateFile = resolve(root, '.local/stripe-billing/fixtures.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { run: randomUUID().replaceAll('-', ''), users: {}, results: [] };
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, check, label, deadline = Date.now() + 60000) {
  while (Date.now() < deadline) { const value = await read(); if (check(value)) return value; await pause(500); }
  throw new Error(`Timed out: ${label}`);
}
async function user(label, clock = false) {
  if (state.users[label]) return state.users[label];
  const uid = `billing_${state.run}_${label}`;
  const email = `billing-${state.run}-${label}@example.com`;
  const password = `TestOnly-${randomUUID()}`;
  await app.auth().createUser({ uid, email, password, emailVerified: true, displayName: 'Synthetic Billing Test' });
  await db.doc(`users/${uid}`).set({ email, displayName: 'Synthetic Billing Test', creationDate: admin.firestore.Timestamp.now() });
  const result = { uid, email, password };
  if (clock) {
    const testClock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `QS ${state.run.slice(0, 20)}` });
    const customer = await stripe.customers.create({ email, metadata: { firebaseUID: uid }, test_clock: testClock.id, address: { country: 'FI', postal_code: '00100', city: 'Helsinki', line1: 'Synthetic street 1' } });
    Object.assign(result, { customerId: customer.id, clockId: testClock.id });
    await db.doc(`customers/${uid}`).set({ stripeId: customer.id, email });
  }
  state.users[label] = result; save(); return result;
}
async function token(fixture) {
  const response = await fetch('http://127.0.0.1:9191/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.email, password: fixture.password, returnSecureToken: true }) });
  if (!response.ok) throw new Error('Local sign in failed');
  return (await response.json()).idToken;
}
async function callable(name, fixture, data, region = 'europe-west3') {
  const response = await fetch(`http://127.0.0.1:5101/${project}/${region}/${name}`, { method: 'POST',
    headers: { Authorization: `Bearer ${await token(fixture)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`Callable ${name} failed: ${body.error?.status ?? response.status}`);
  return body.result;
}
async function seed() {
  await db.doc('configuration/stripeBilling').set({ owner: 'native', requestsEnabled: true, webhooksEnabled: true, nativeSince: admin.firestore.Timestamp.fromMillis(1) });
  if (!state.prices) {
    const basic = await stripe.products.create({ name: `QS migration Basic ${state.run}`, metadata: { firebaseRole: 'basic', testRun: state.run } });
    const pro = await stripe.products.create({ name: `QS migration Pro ${state.run}`, metadata: { firebaseRole: 'pro', testRun: state.run } });
    const monthly = await stripe.prices.create({ product: basic.id, unit_amount: 1000, currency: 'eur', recurring: { interval: 'month' }, tax_behavior: 'exclusive', metadata: { trial_days: '7' } });
    const yearly = await stripe.prices.create({ product: pro.id, unit_amount: 10000, currency: 'eur', recurring: { interval: 'year' }, tax_behavior: 'exclusive' });
    const once = await stripe.prices.create({ product: basic.id, unit_amount: 500, currency: 'eur', tax_behavior: 'exclusive' });
    const coupon = await stripe.coupons.create({ percent_off: 25, duration: 'once', name: `QS ${state.run.slice(0, 20)}` });
    const promotion = await stripe.promotionCodes.create({ promotion: { type: 'coupon', coupon: coupon.id }, code: `QSTEST${state.run.slice(0, 10)}` });
    state.prices = { monthly, yearly, once }; state.products = [basic, pro]; state.promotion = promotion.code; save();
  }
  if (!state.prices.proTrial) {
    const pro = state.products.find(product => product.metadata.firebaseRole === 'pro');
    assert.ok(pro, 'Seed a synthetic Pro product first.');
    state.prices.proTrial = await stripe.prices.create({ product: pro.id, unit_amount: 1000, currency: 'eur',
      recurring: { interval: 'month' }, tax_behavior: 'exclusive', metadata: { trial_days: '7' } });
    save();
  }
  const { priceProjections, productProjection } = require('./lib/functions/src/stripe/billing/projections');
  for (const projection of [...state.products.map(productProjection), ...Object.values(state.prices).flatMap(priceProjections)]) await db.doc(projection.path).set(projection.data);
  console.log('Synthetic test catalog and local admission seeded.');
}
async function checkout(label, mode, trial) {
  assert.ok(!trial || mode === 'subscription', 'A trial requires subscription mode.');
  assert.ok(!trial || state.prices.proTrial, 'Run seed to create the Pro trial fixture.');
  const fixture = await user(label); const requestId = randomUUID().replaceAll('-', '');
  const data = { price: mode === 'payment' ? state.prices.once.id : trial ? state.prices.proTrial.id : state.prices.monthly.id, mode,
    success_url: 'http://127.0.0.1:4210/payment/success', cancel_url: 'http://127.0.0.1:4210/payment/cancel',
    allow_promotion_codes: true, automatic_tax: { enabled: true }, metadata: { firebaseUID: fixture.uid },
    checkout_terms_version: 'pro-trial-payment-method-v1',
    ...(trial ? { trial_period_days: 7, payment_method_collection: 'if_required' } : {}) };
  // Authenticated REST create exercises the deployed emulator Rules as a cached client would.
  const field = value => typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { booleanValue: value }
    : typeof value === 'number' ? { integerValue: String(value) } : { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, field(v)])) } };
  const response = await fetch(`http://127.0.0.1:8181/v1/projects/${project}/databases/(default)/documents/customers/${fixture.uid}/checkout_sessions?documentId=${requestId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${await token(fixture)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, field(v)])) }) });
  if (!response.ok) throw new Error(`Checkout request rejected: ${response.status}`);
  const result = await until(async () => (await db.doc(`customers/${fixture.uid}/checkout_sessions/${requestId}`).get()).data(), value => value?.url || value?.error, 'checkout');
  if (result.error) throw new Error(`Checkout failed: ${result.error.code}`);
  fixture.checkout = { requestId, sessionId: result.sessionId, url: result.url };
  fixture.customerId = (await db.doc(`customers/${fixture.uid}`).get()).get('stripeId'); save();
  console.log(`Checkout ready for ${label}; open its URL from the ignored fixtures file.`);
}
async function verify(label) {
  const fixture = state.users[label]; const session = await stripe.checkout.sessions.retrieve(fixture.checkout.sessionId);
  assert.equal(session.status, 'complete'); assert.equal(session.automatic_tax.enabled, true); assert.equal(session.customer, fixture.customerId);
  if (session.mode === 'payment') {
    const payment = await until(async () => (await db.doc(`customers/${fixture.uid}/payments/${session.payment_intent}`).get()).data(), value => value?.status === 'succeeded', 'payment synchronization');
    assert.equal(payment.prices.length, 1); assert.equal(payment.items.length, 1);
  } else {
    // A retry can rebuild the local checkout result. Identify its trial from
    // the immutable original request, never a transient driver flag or label.
    const request = await db.doc(`customers/${fixture.uid}/checkout_sessions/${fixture.checkout.requestId}`).get();
    assert.ok(request.exists, 'The original checkout request is required for verification.');
    const proTrial = request.get('price') === state.prices.proTrial?.id && request.get('trial_period_days') > 0;
    const sub = await until(async () => (await db.doc(`customers/${fixture.uid}/subscriptions/${session.subscription}`).get()).data(), value => ['active', 'trialing'].includes(value?.status), 'subscription synchronization');
    const role = proTrial ? 'pro' : 'basic';
    assert.equal(sub.role, role); assert.ok(sub.current_period_end?.toMillis() > 0);
    if (proTrial) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      const customer = await stripe.customers.retrieve(fixture.customerId);
      const invoice = await stripe.invoices.retrieve(subscription.latest_invoice);
      assertProTrialCheckout({ session, subscription, customer, invoice });
    }
    await until(async () => (await app.auth().getUser(fixture.uid)).customClaims, value => value?.stripeRole === role, 'claim reconciliation');
    await until(async () => (await db.doc(`mail/welcome_email_${session.subscription}`).get()).exists, value => value, 'welcome email outbox');
  }
  const portal = await callable('createStripePortalLink', fixture, { returnUrl: 'http://127.0.0.1:4210/subscriptions' });
  assert.match(portal.url, /^https:\/\/billing[.]stripe[.]com\//);
  const legacy = await callable('ext-firestore-stripe-payments-createPortalLink', fixture, { returnUrl: 'http://127.0.0.1:4210/subscriptions' });
  assert.match(legacy.url, /^https:\/\/billing[.]stripe[.]com\//);
  state.results.push({ case: label, mode: session.mode, passedAt: new Date().toISOString(), sessionStatus: session.status, paymentStatus: session.payment_status, taxStatus: session.automatic_tax.status, discount: session.total_details?.amount_discount, tax: session.total_details?.amount_tax }); save();
  console.log(`Verified ${label}: payment/subscription projection, claims/email where applicable, native and legacy portal.`);
}
async function lifecycle() {
  const fixture = await user('lifecycle', true);
  const readSub = () => stripe.subscriptions.retrieve(fixture.subscriptionId);
  const readProjection = async () => (await db.doc(`customers/${fixture.uid}/subscriptions/${fixture.subscriptionId}`).get()).data();
  const step = async (name, run) => {
    if (state.results.some(r => r.case === name)) return;
    await run(); state.results.push({ case: name, passedAt: new Date().toISOString() }); save(); console.log(`Verified ${name}.`);
  };
  await step('test-clock initial payment and claims', async () => {
    if (!fixture.paymentMethodId) {
      const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: fixture.customerId });
      fixture.paymentMethodId = pm.id; save();
      await stripe.customers.update(fixture.customerId, { invoice_settings: { default_payment_method: pm.id } });
    }
    if (!fixture.subscriptionId) {
      const sub = await stripe.subscriptions.create({ customer: fixture.customerId, items: [{ price: state.prices.monthly.id }],
        default_payment_method: fixture.paymentMethodId, billing_mode: { type: 'classic' }, payment_behavior: 'error_if_incomplete',
        metadata: { firebaseUID: fixture.uid } }, { idempotencyKey: `qs-test-${state.run}-lifecycle-subscription` });
      fixture.subscriptionId = sub.id; save();
    }
    await until(readProjection, value => value?.status === 'active' && value.role === 'basic', 'initial subscription');
    await until(async () => (await app.auth().getUser(fixture.uid)).customClaims, value => value?.stripeRole === 'basic', 'initial claim');
    await until(async () => (await db.doc(`mail/welcome_email_${fixture.subscriptionId}`).get()).exists, Boolean, 'welcome mail');
  });
  const advance = async time => {
    await stripe.testHelpers.testClocks.advance(fixture.clockId, { frozen_time: time });
    await until(() => stripe.testHelpers.testClocks.retrieve(fixture.clockId), clock => clock.status === 'ready', 'clock advancement');
  };
  await step('renewal and invoice synchronization', async () => {
    const before = await readSub(); const end = before.items.data[0].current_period_end;
    await advance(end + 3601);
    await until(readProjection, value => value?.current_period_end?.seconds > end, 'renewed period');
    const invoices = await stripe.invoices.list({ customer: fixture.customerId, limit: 10 });
    const renewal = invoices.data.find(i => i.billing_reason === 'subscription_cycle');
    assert.ok(renewal);
    if (renewal.status === 'draft') await stripe.invoices.finalizeInvoice(renewal.id);
    const current = await stripe.invoices.retrieve(renewal.id);
    if (current.status === 'open') await stripe.invoices.pay(current.id);
    await until(async () => (await db.doc(`customers/${fixture.uid}/subscriptions/${fixture.subscriptionId}/invoices/${renewal.id}`).get()).data(), value => value?.status === 'paid', 'renewal invoice');
  });
  await step('upgrade and downgrade projections and claims', async () => {
    for (const [price, role] of [[state.prices.yearly, 'pro'], [state.prices.monthly, 'basic']]) {
      const current = await readSub();
      await stripe.subscriptions.update(current.id, { items: [{ id: current.items.data[0].id, price: price.id }], proration_behavior: 'none' });
      await until(readProjection, value => value?.role === role && value.price?.id === price.id, `${role} projection`);
      await until(async () => (await app.auth().getUser(fixture.uid)).customClaims, value => value?.stripeRole === role, `${role} claim`);
    }
  });
  await step('payment failure and grace period', async () => {
    const pm = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: fixture.customerId });
    await stripe.subscriptions.update(fixture.subscriptionId, { default_payment_method: pm.id });
    const sub = await readSub(); await advance(sub.items.data[0].current_period_end + 3601);
    const latest = await readSub(); const invoice = await stripe.invoices.retrieve(latest.latest_invoice);
    if (invoice.status === 'draft') await stripe.invoices.finalizeInvoice(invoice.id);
    try { await stripe.invoices.pay(invoice.id); } catch (e) { if (e.type !== 'StripeCardError') throw e; }
    await until(readProjection, value => value?.status === 'past_due', 'past due subscription');
    await until(async () => (await db.doc(`users/${fixture.uid}/system/status`).get()).data(), value => !!value?.gracePeriodUntil, 'grace period');
  });
  await step('payment recovery clears grace', async () => {
    await stripe.subscriptions.update(fixture.subscriptionId, { default_payment_method: fixture.paymentMethodId });
    const sub = await readSub(); await stripe.invoices.pay(sub.latest_invoice, { payment_method: fixture.paymentMethodId });
    await until(readProjection, value => value?.status === 'active', 'recovered subscription');
    await until(async () => (await db.doc(`users/${fixture.uid}/system/status`).get()).data(), value => !!value && !value.gracePeriodUntil, 'cleared grace');
  });
  await step('scheduled cancellation and admin gift', async () => {
    await stripe.subscriptions.update(fixture.subscriptionId, { cancel_at_period_end: true });
    await until(readProjection, value => value?.cancel_at_period_end === true, 'scheduled cancellation');
    const actor = await user('admin'); await app.auth().setCustomUserClaims(actor.uid, { admin: true });
    const preview = await callable('previewAdminSubscriptionGift', actor, { uid: fixture.uid, months: 1 }, 'europe-west2');
    fixture.giftOperationId ??= randomUUID(); save();
    const result = await callable('grantAdminSubscriptionGift', actor, { uid: fixture.uid, months: 1, reason: 'Synthetic migration test',
      notifyUser: false, operationId: fixture.giftOperationId, previewVersion: preview.previewVersion }, 'europe-west2');
    assert.equal(result.status, 'succeeded');
    const sub = await readSub(); assert.equal(sub.cancel_at_period_end, true); assert.equal(sub.items.data[0].price.id, state.prices.monthly.id);
    await until(readProjection, value => value?.trial_end?.seconds === sub.trial_end, 'gift period synchronization');
  });
  await step('cancellation and deletion cleanup', async () => {
    await stripe.subscriptions.cancel(fixture.subscriptionId);
    await until(readProjection, value => value?.status === 'canceled', 'cancellation');
    await app.auth().deleteUser(fixture.uid);
    await until(() => stripe.customers.retrieve(fixture.customerId), value => value.deleted === true, 'remote deletion');
    assert.equal((await db.doc(`customers/${fixture.uid}`).get()).exists, false);
    await until(async () => (await db.doc(`stripeBillingAccounts/${fixture.uid}`).get()).exists, value => !value, 'private journal cleanup');
  });
}
async function policy(label) {
  const fixture = state.users[label];
  const session = await stripe.checkout.sessions.retrieve(fixture.checkout.sessionId);
  const before = await stripe.subscriptions.retrieve(session.subscription);
  assert.equal(before.billing_mode.type, 'classic');
  const renewal = await callable('getUpcomingRenewalAmount', fixture, {}, 'europe-west2');
  assert.equal(renewal.status, 'ready'); assert.equal(renewal.currency, 'EUR');
  const actor = await user('admin'); await app.auth().setCustomUserClaims(actor.uid, { admin: true });
  fixture.giftOperationId ??= randomUUID(); save();
  const preview = await callable('previewAdminSubscriptionGift', actor, { uid: fixture.uid, months: 1 }, 'europe-west2');
  const gift = await callable('grantAdminSubscriptionGift', actor, { uid: fixture.uid, months: 1,
    reason: 'Synthetic native Checkout compatibility test', notifyUser: true,
    operationId: fixture.giftOperationId, previewVersion: preview.previewVersion }, 'europe-west2');
  assert.equal(gift.status, 'succeeded'); assert.equal(gift.notificationStatus, 'queued');
  const after = await stripe.subscriptions.retrieve(session.subscription);
  assert.equal(after.items.data[0].price.id, before.items.data[0].price.id);
  assert.equal(after.cancel_at_period_end, before.cancel_at_period_end);
  const projection = db.doc(`customers/${fixture.uid}/subscriptions/${session.subscription}`);
  await until(async () => (await projection.get()).get('trial_end')?.seconds, value => value === after.trial_end, 'gift projection');
  const receipt = await until(async () => {
    const jobs = await db.collection('stripeBillingJobs').where('uid', '==', fixture.uid).get();
    return jobs.docs.find(d => d.get('state') === 'done' && d.get('event.kind') === 'subscription');
  }, Boolean, 'completed subscription receipt');
  const event = await stripe.events.retrieve(receipt.get('event.eventId'));
  const body = JSON.stringify(event);
  const webhook = `http://127.0.0.1:5101/${project}/europe-west3/stripeBillingWebhook`;
  for (let i = 0; i < 2; i++) {
    const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: process.env.STRIPE_BILLING_WEBHOOK_SECRET });
    assert.equal((await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body })).status, 200);
  }
  assert.ok((await receipt.ref.get()).updateTime.isEqual(receipt.updateTime));
  assert.equal((await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'invalid' }, body })).status, 400);
  const control = db.doc('configuration/stripeBilling');
  await control.update({ requestsEnabled: false });
  try {
    await assert.rejects(() => callable('createStripePortalLink', fixture, { returnUrl: 'http://127.0.0.1:4210/subscriptions' }), /FAILED_PRECONDITION/);
    await assert.rejects(() => callable('ext-firestore-stripe-payments-createPortalLink', fixture, { returnUrl: 'http://127.0.0.1:4210/subscriptions' }), /FAILED_PRECONDITION/);
    await assert.rejects(() => checkout(label, 'payment', false), /Checkout request rejected: 403/);
  } finally { await control.update({ requestsEnabled: true }); }
  state.results.push({ case: 'native classic Checkout gift, renewal, duplicate signatures and maintenance', passedAt: new Date().toISOString() }); save();
  console.log('Verified classic Checkout gift/email, renewal, duplicate/signed ingress, and cached-client maintenance.');
}
async function retryCheckout(label) {
  const fixture = state.users[label];
  const jobs = await db.collection('stripeBillingJobs').where('uid', '==', fixture.uid).get();
  const job = jobs.docs.find(d => d.get('kind') === 'checkout' && d.get('state') === 'pending');
  if (!job) throw new Error('No pending local checkout to retry.');
  // Test-only time advancement for the retained original operation; never a new POST identity.
  await job.ref.update({ dueAt: admin.firestore.Timestamp.now(), recoverAt: admin.firestore.Timestamp.now(), generation: job.get('generation') + 1,
    dispatchedAt: admin.firestore.FieldValue.delete() });
  const ref = db.doc(`customers/${fixture.uid}/checkout_sessions/${job.get('requestId')}`);
  const result = await until(async () => (await ref.get()).data(), value => !!value?.url || value?.error?.code === 'checkout_rejected', 'original checkout retry');
  if (result.error?.code === 'checkout_rejected') throw new Error('Original checkout was definitively rejected; a new browser request may now retry.');
  fixture.checkout = { requestId: ref.id, sessionId: result.sessionId, url: result.url };
  fixture.customerId = (await db.doc(`customers/${fixture.uid}`).get()).get('stripeId'); save();
  console.log('Original checkout is ready; identity and idempotency key were retained.');
}

try {
  const [command, label = 'first'] = process.argv.slice(2);
  if (command === 'seed') await seed();
  else if (command === 'checkout') await checkout(label, process.argv[4] ?? 'subscription', process.argv.includes('--trial'));
  else if (command === 'verify') await verify(label);
  else if (command === 'lifecycle') await lifecycle();
  else if (command === 'policy') await policy(label);
  else if (command === 'retry') await retryCheckout(label);
  else throw new Error('Use seed, checkout LABEL [subscription|payment] [--trial], verify LABEL, policy LABEL, lifecycle, or retry LABEL.');
} catch (error) {
  // Fixed test-driver messages contain no provider bodies, credentials or customer data.
  if (error.type?.startsWith('Stripe')) console.error(`Stripe test fixture failed (${error.type}, ${error.code ?? 'no_code'}, parameter ${error.param ?? 'none'}).`);
  else console.error(error.message);
  process.exitCode = 1;
} finally { await app.delete(); }
