import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { flowForSelection, freshDelivery, instant, report } from './cohort.mjs';

const manifest = process.argv[2];
if (!manifest) throw new Error('Usage: node tools/onboarding-results/run.mjs /path/to/manifest.json');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const config = await read(manifest);
async function rows(path) {
  const input = await read(resolve(dirname(manifest), path));
  if (!Array.isArray(input)) throw new Error('Expected a JSON array of input records.');
  return input;
}

const cutover = instant(config.cutover);
const from = instant(config.from);
const until = instant(config.until);
const asOf = instant(config.asOf);
if (from < cutover || from >= until || until > asOf) throw new Error('Expected cutover <= from < until <= asOf.');
const events = (await rows(config.events)).filter(row => instant(row.at) >= cutover && instant(row.at) <= asOf);
const owners = new Set();
const syncOwners = new Set();
for (const row of events) {
  const flow = flowForSelection(row.name);
  if (!flow || instant(row.at) < from || instant(row.at) >= until) continue;
  if (typeof row.uid !== 'string' || !row.uid || row.uid.includes('/')) throw new Error('Invalid account identifier.');
  owners.add(row.uid);
  if (flow === 'sync') syncOwners.add(row.uid);
}

let app;
function database() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Live reconciliation needs explicit GOOGLE_APPLICATION_CREDENTIALS for production.');
  }
  app ??= initializeApp({ credential: applicationDefault(), projectId: 'quantified-self-io' });
  return getFirestore(app);
}

async function retainedReceipts() {
  const receipts = [];
  if (!syncOwners.size) return receipts;
  // Page by finalization time, including deliveries from requests queued earlier.
  const base = database().collection('activitySyncQueue').where('processedAt', '>=', from)
    .where('processedAt', '<=', asOf).orderBy('processedAt')
    .select('userID', 'processedAt', 'successProcessedAt', 'resultStatus', 'destinationInfoCode');
  let cursor;
  for (;;) {
    const page = await (cursor ? base.startAfter(cursor) : base).limit(500).get();
    for (const doc of page.docs) {
      const row = doc.data();
      if (syncOwners.has(row.userID) && freshDelivery(row)) {
        receipts.push({ uid: row.userID, at: row.successProcessedAt ?? row.processedAt });
      }
    }
    if (page.size < 500) return receipts;
    cursor = page.docs.at(-1);
  }
}

async function renewalRequests() {
  if (!config.cancellations) return { events: null };
  const input = await rows(config.cancellations);
  const requests = input.filter(row => row.reason === 'cancellation_requested' && instant(row.at) >= from && instant(row.at) <= asOf);
  if (requests.some(row => typeof row.customer !== 'string' || !row.customer)) throw new Error('Missing Stripe customer on a cancellation request.');
  if (!requests.length || !owners.size) return { events: [] };
  const db = database();
  const byCustomer = new Map();
  const ids = [...owners];
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map(uid => db.collection('customers').doc(uid));
    const snapshots = await db.getAll(...refs, { fieldMask: ['stripeId'] });
    for (const snap of snapshots) {
      const customer = snap.get('stripeId');
      if (!customer) continue;
      if (byCustomer.has(customer)) throw new Error('Ambiguous customer binding. Resolve before reporting.');
      byCustomer.set(customer, snap.id);
    }
  }
  return {
    events: requests.filter(row => byCustomer.has(row.customer)).map(row => ({ uid: byCustomer.get(row.customer), at: row.at })),
    selectedAccountsWithoutStripeBinding: ids.length - byCustomer.size,
  };
}

try {
  const deliveries = config.deliveries ? await rows(config.deliveries) : await retainedReceipts();
  const billing = await renewalRequests();
  const flows = report({
    ...config, events, deliveries, cancellations: billing.events,
    completeReceipts: Boolean(config.deliveries) && config.completeReceipts === true,
  });
  console.log(JSON.stringify({
    from: config.from, until: config.until, asOf: config.asOf,
    selectedAccountsWithoutStripeBinding: billing.selectedAccountsWithoutStripeBinding, flows,
  }, null, 2));
} finally {
  if (app) await deleteApp(app);
}
