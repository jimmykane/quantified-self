import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, readLocalEnvironment } from './local.mjs';
export function parseOptions(args) {
  const options = {};
  for (const arg of args) {
    if (['--execute', '--local', '--catalog', '--recover'].includes(arg) && !options[arg.slice(2)]) options[arg.slice(2)] = true;
    else {
      const match = /^--(project|confirm-project|event|job|since|until)=(.+)$/.exec(arg);
      if (!match || options[match[1]] !== undefined) throw new Error('Unknown or duplicate option.');
      options[match[1]] = match[2];
    }
  }
  if (!/^[a-z][a-z0-9-]{5,62}$/.test(options.project ?? '')) throw new Error('An explicit project is required.');
  if (options.local && options.project !== 'demo-stripe-billing') throw new Error('Local project must be demo-stripe-billing.');
  if (options.project.startsWith('demo-') && !options.local) throw new Error('Demo projects require --local.');
  if (options.execute && options['confirm-project'] !== options.project) throw new Error('Execution requires exact project confirmation.');
  if ([options.catalog, options.recover, options.event, options.job, options.since].filter(Boolean).length !== 1) throw new Error('Select exactly one operation.');
  if (options.recover && !options.local) throw new Error('Manual recovery is local only; production uses its scheduler.');
  if (options.since) {
    const since = Date.parse(options.since), until = Date.parse(options.until ?? '');
    if (!Number.isFinite(since) || !Number.isFinite(until) || since >= until || until > Date.now() || since < Date.now() - 30 * 86400000)
      throw new Error('Event window must be ordered, in the past, and within 30 days.');
  }
  if (options.event && !/^evt_[a-zA-Z0-9]+$/.test(options.event)) throw new Error('Invalid event identity.');
  if (options.job && !/^[a-f0-9]{64}$/.test(options.job)) throw new Error('Invalid job identity.');
  return options;
}
export async function main(args) {
  const options = parseOptions(args);
  if (options.local) Object.assign(process.env, readLocalEnvironment());
  else if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.QS_BILLING_LOCAL)
    throw new Error('Mixed local/cloud environment is forbidden.');
  const require = createRequire(resolve(root, 'functions/package.json'));
  const admin = require('firebase-admin');
  const app = admin.initializeApp({ projectId: options.project }); const db = app.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  const model = require('./lib/functions/src/stripe/billing/model');
  try {
    if (options.job) {
      const { replayBillingJob } = require('./lib/functions/src/stripe/billing/replay');
      console.log(JSON.stringify({ execute: !!options.execute, result: await replayBillingJob(db, options.job, !!options.execute) })); return;
    }
    if (options.recover) {
      if (options.execute) { const { recoverBillingJobs, billingTransport } = require('./lib/functions/src/stripe/billing/dispatch'); await recoverBillingJobs(db, billingTransport()); }
      console.log(JSON.stringify({ execute: !!options.execute, operation: 'bounded local dispatch recovery' })); return;
    }
    const key = process.env.STRIPE_BILLING_KEY;
    if (!key || !(options.local ? /^(sk|rk)_test_/ : /^(sk|rk)_live_/).test(key)) throw new Error('Billing key mode must match the explicit environment.');
    const Stripe = require('stripe'); const stripe = new Stripe(key, { apiVersion: '2026-07-29.dahlia', timeout: 20000 });
    if (options.catalog) {
      const { priceProjections, productProjection } = require('./lib/functions/src/stripe/billing/projections');
      const prices = await stripe.prices.list({ limit: 100, expand: ['data.product', 'data.tiers'] });
      if (prices.has_more) throw new Error('Catalog exceeds bounded page; do not apply a partial seed.');
      const projections = prices.data.flatMap(price => [productProjection(price.product), ...priceProjections(price)]);
      if (options.execute) {
        const batch = db.batch(); for (const projection of projections) batch.set(db.doc(projection.path), projection.data, { merge: true }); await batch.commit();
      }
      console.log(JSON.stringify({ execute: !!options.execute, prices: prices.data.length, operation: 'catalog seed' })); return;
    }
    const events = options.event ? { data: [await stripe.events.retrieve(options.event)], has_more: false }
      : await stripe.events.list({ created: { gte: Math.floor(Date.parse(options.since) / 1000), lt: Math.floor(Date.parse(options.until) / 1000) }, limit: 100 });
    if (events.has_more) throw new Error('Window exceeds 100 events. Narrow it; no partial replay was made.');
    const references = events.data.map(event => {
      if (event.account || event.livemode === !!options.local) throw new Error('Event account/mode mismatch.');
      return model.billingEvent(event);
    }).filter(Boolean);
    if (options.execute) {
      const { admitBillingEvent } = require('./lib/functions/src/stripe/billing/queue');
      for (const reference of references) await admitBillingEvent(db, reference);
    }
    console.log(JSON.stringify({ execute: !!options.execute, supportedEvents: references.length, totalEvents: events.data.length }));
  } finally { await app.delete(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => {
  console.error('Billing operation failed. Check explicit arguments, environment and bounded scope; no provider payload or credential was printed.'); process.exitCode = 1;
});
