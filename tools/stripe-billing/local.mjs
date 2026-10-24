import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync, chmodSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const project = 'demo-stripe-billing';
export const runtimeDirectory = resolve(tmpdir(), `qs-stripe-billing-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`);
export function localEnvironment(values, inherited = process.env) {
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(values.STRIPE_BILLING_KEY ?? '')
    || !/^whsec_[A-Za-z0-9]+$/.test(values.STRIPE_BILLING_WEBHOOK_SECRET ?? '')) {
    throw new Error('Provide only a Stripe test API key and the local listener signing secret.');
  }
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'JAVA_HOME', 'LANG'].filter(k => inherited[k]).map(k => [k, inherited[k]]));
  return { ...env, GOOGLE_APPLICATION_CREDENTIALS: resolve(root, '.local/stripe-billing/no-cloud-credentials.json'), GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: project,
    FIREBASE_CONFIG: JSON.stringify({ projectId: project, storageBucket: `${project}.appspot.com` }),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9191',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9291', FUNCTIONS_EMULATOR: 'true', QS_BILLING_LOCAL: 'true',
    QS_BILLING_FUNCTIONS_HOST: '127.0.0.1:5101', STRIPE_BILLING_KEY: values.STRIPE_BILLING_KEY,
    STRIPE_SECRET_KEY: values.STRIPE_BILLING_KEY, STRIPE_ADMIN_BILLING_KEY: values.STRIPE_BILLING_KEY,
    STRIPE_BILLING_WEBHOOK_SECRET: values.STRIPE_BILLING_WEBHOOK_SECRET };
}
export function readLocalEnvironment() {
  const text = readFileSync(resolve(root, 'functions/.secret.billing-test.local'), 'utf8');
  const values = Object.fromEntries(text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).map(line => {
    const match = /^(STRIPE_BILLING_KEY|STRIPE_BILLING_WEBHOOK_SECRET)=(\S+)$/.exec(line.trim());
    if (!match) throw new Error('Unexpected local credential entry.');
    return [match[1], match[2]];
  }));
  const env = localEnvironment(values);
  mkdirSync(dirname(env.GOOGLE_APPLICATION_CREDENTIALS), { recursive: true, mode: 0o700 });
  // Override well-known user ADC as well as inherited variables. This deliberately
  // invalid local-only credential cannot authenticate to a hosted Google service.
  writeFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, JSON.stringify({ type: 'authorized_user',
    client_id: 'invalid-local-only', client_secret: 'invalid-local-only', refresh_token: 'invalid-local-only' }), { mode: 0o600 });
  return env;
}
export function prepareLocalRuntime(env) {
  const dir = runtimeDirectory; mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(resolve(root, 'functions/lib/functions/src/stripe/billing/handlers.js'))) throw new Error('Build Functions first.');
  for (const [name, target] of [['node_modules', 'functions/node_modules'], ['lib', 'functions/lib']]) {
    if (!existsSync(resolve(dir, name))) symlinkSync(resolve(root, target), resolve(dir, name), 'dir');
  }
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ name: 'qs-billing-local', private: true, main: 'index.js', engines: { node: '22' },
    dependencies: { 'firebase-admin': '^13.7.0', 'firebase-functions': '^7.0.5' } }));
  const secrets = ['STRIPE_BILLING_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_ADMIN_BILLING_KEY', 'STRIPE_BILLING_WEBHOOK_SECRET'];
  writeFileSync(resolve(dir, '.secret.local'), secrets.map(k => `${k}=${env[k]}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(resolve(dir, '.secret.local'), 0o600);
  writeFileSync(resolve(dir, 'index.js'), `
const admin = require('firebase-admin');
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== '${project}') throw new Error('Local billing only');
// Firebase discovery strips custom parent environment. This generated entrypoint
// is local-only and pins every destination before importing application modules.
Object.assign(process.env, require('dotenv').parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'.secret.local'))), {
  GCLOUD_PROJECT:'${project}', GOOGLE_CLOUD_PROJECT:'${project}', QS_BILLING_LOCAL:'true', FUNCTIONS_EMULATOR:'true',
  FIRESTORE_EMULATOR_HOST:'127.0.0.1:8181', FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9191',
  FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9291', QS_BILLING_FUNCTIONS_HOST:'127.0.0.1:5101',
  GOOGLE_APPLICATION_CREDENTIALS:${JSON.stringify(env.GOOGLE_APPLICATION_CREDENTIALS)},
});
require('./lib/functions/src/stripe/billing/model').assertLocalBillingEnvironment(process.env);
admin.initializeApp({projectId: '${project}', storageBucket: '${project}.appspot.com'});
admin.firestore().settings({ignoreUndefinedProperties:true});
Object.assign(exports, require('./lib/functions/src/stripe/billing/handlers'));
Object.defineProperty(exports, 'ext', {enumerable:false,value:{firestore:{stripe:{payments:{createPortalLink:exports['ext-firestore-stripe-payments-createPortalLink']}}}}});
exports.onSubscriptionUpdated = require('./lib/functions/src/stripe/subscriptions').onSubscriptionUpdated;
const claims = require('./lib/functions/src/stripe/claims');
exports.linkExistingStripeCustomer = claims.linkExistingStripeCustomer;
exports.restoreUserClaims = claims.restoreUserClaims;
exports.getUpcomingRenewalAmount = require('./lib/functions/src/stripe/get-upcoming-renewal-amount').getUpcomingRenewalAmount;
const gifts = require('./lib/functions/src/admin/handlers/subscription-gifts.handlers');
exports.previewAdminSubscriptionGift = gifts.previewAdminSubscriptionGift;
exports.grantAdminSubscriptionGift = gifts.grantAdminSubscriptionGift;
// Local-only billing and recursive user/customer slice of native Auth cleanup.
exports.localBillingAuthDeleted = require('firebase-functions/v1').region('europe-west2').auth.user().onDelete(async user => {
  const db=admin.firestore(); await db.doc('userDeletionTombstones/'+user.uid).set({});
  await require('./lib/functions/src/stripe/billing/service').requestBillingDeletion(db,user.uid);
  await db.recursiveDelete(db.doc('users/'+user.uid));
  await db.recursiveDelete(db.doc('customers/'+user.uid));
});
`);
  const config = { functions: [{ source: relative(root, dir), codebase: 'billing-local', runtime: 'nodejs22' }],
    firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, storage: { rules: 'storage.quantified-self-io.rules' },
    emulators: { auth: { host: '127.0.0.1', port: 9191 }, firestore: { host: '127.0.0.1', port: 8181 },
      functions: { host: '127.0.0.1', port: 5101 }, storage: { host: '127.0.0.1', port: 9291 },
      hub: { host: '127.0.0.1', port: 4411 }, logging: { host: '127.0.0.1', port: 4511 },
      eventarc: { host: '127.0.0.1', port: 9311 }, tasks: { host: '127.0.0.1', port: 9511 },
      ui: { enabled: false }, singleProjectMode: true } };
  const configPath = resolve(root, '.billing-test.firebase.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}
async function main() {
  const env = readLocalEnvironment();
  const command = process.argv[2] ?? 'start';
  if (command === 'listen') {
    const cli = process.env.STRIPE_CLI ?? 'stripe';
    const child = spawn(cli, ['listen', '--events', 'customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,invoice.paid,invoice.payment_failed,payment_intent.succeeded,payment_intent.payment_failed,charge.refunded,product.created,product.updated,product.deleted,price.created,price.updated,tax_rate.created,tax_rate.updated,customer.deleted', '--forward-to', `http://127.0.0.1:5101/${project}/europe-west3/stripeBillingWebhook`],
      { cwd: root, env: { ...env, STRIPE_API_KEY: env.STRIPE_BILLING_KEY }, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      const text = chunk.toString(); // Never forward listener secrets or raw provider output.
      if (text.includes('Ready!') && !ready) { ready = true; console.log('Stripe test listener connected.'); }
      if (/\[400\]|\[503\]/.test(text)) console.error('A webhook was rejected; inspect local billing admission.');
    });
    child.on('exit', code => { process.exitCode = code ?? 1; }); return;
  }
  if (command !== 'start' && command !== 'exec') throw new Error('Use start, listen, or exec with a single test command.');
  const config = prepareLocalRuntime(env);
  const args = [command === 'exec' ? 'emulators:exec' : 'emulators:start', '--project', project, '--config', config,
    '--only', 'auth,firestore,functions,storage', '--non-interactive'];
  const statePath = resolve(root, '.local/stripe-billing/emulator-state');
  if (command === 'start') {
    if (existsSync(resolve(statePath, 'firebase-export-metadata.json'))) args.push('--import', statePath);
    args.push(`--export-on-exit=${statePath}`);
  }
  if (command === 'exec') {
    if (process.argv.length !== 4) throw new Error('exec requires one quoted local test command.');
    args.push(process.argv[3]);
  }
  const child = spawn('firebase', args, { env, cwd: root, stdio: 'inherit' });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Local billing setup failed. Verify Node 22, the compiled backend, and the ignored test credential file.'); process.exitCode = 1;
});
