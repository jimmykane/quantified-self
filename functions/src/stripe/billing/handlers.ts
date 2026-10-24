import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getBillingStripe } from '../client';
import { FUNCTION_SECRET_BINDINGS } from '../../secrets';
import { PROVIDER_CLOUD_TASK_RETRY_CONFIG, QUEUE_SCHEDULE } from '../../shared/queue-config';
import { BILLING_JOBS, BILLING_REGION, BillingError, billingEvent, safeBillingError } from './model';
import { admitBillingCheckout, admitBillingEvent, observeBilling, processBillingJob, writeCheckoutError } from './queue';
import { createBillingPortal, requestBillingDeletion } from './service';
import { billingTransport, dispatchBillingJob, recoverBillingJobs } from './dispatch';

const base = { region: BILLING_REGION, memory: '512MiB' as const, timeoutSeconds: 300 };
export const createStripeCheckoutSession = onDocumentCreated({ ...base, retry: true,
  document: 'customers/{uid}/checkout_sessions/{requestId}' }, async event => {
  if (!event.data) return;
  try { await admitBillingCheckout(admin.firestore(), event.params.uid, event.params.requestId,
    event.data.data(), event.data.createTime, process.env.FUNCTIONS_EMULATOR === 'true'); }
  catch (error) {
    if (!(error instanceof BillingError) || error.retryable) throw new Error('billing_checkout_admission_failed');
    await writeCheckoutError(admin.firestore(), event.params.uid, event.params.requestId, error);
    observeBilling('checkout_failure');
  }
});

const portalOptions = { ...base, timeoutSeconds: 60,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true',
  cors: ['https://quantified-self.io', 'https://beta.quantified-self.io', /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/],
  secrets: FUNCTION_SECRET_BINDINGS.createStripePortalLink };
const portalHandler = async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (!request.data || Object.keys(request.data).some(key => key !== 'returnUrl')) throw new HttpsError('invalid-argument', 'A return URL is required.');
  try { return await createBillingPortal({ db: admin.firestore(), stripe: await getBillingStripe(), auth: admin.auth() },
    request.auth.uid, request.data.returnUrl, process.env.FUNCTIONS_EMULATOR === 'true'); }
  catch (error) { throw new HttpsError('failed-precondition', safeBillingError(error).message); }
};
export const createStripePortalLink = onCall(portalOptions, portalHandler);
const legacyPortal = onCall(portalOptions, portalHandler);
// Deploy this alias only AFTER the extension's Gen 1 callable is retired.
// Separate endpoint objects share the handler and callable/Auth/App Check policy.
export { legacyPortal as 'ext-firestore-stripe-payments-createPortalLink' };

export const stripeBillingWebhook = onRequest({ ...base, timeoutSeconds: 60, invoker: 'public',
  secrets: FUNCTION_SECRET_BINDINGS.stripeBillingWebhook }, async (request, response) => {
  if (request.method !== 'POST') { response.sendStatus(405); return; }
  if (!request.rawBody || request.rawBody.length > 1024 * 1024) { response.sendStatus(413); return; }
  let event;
  try {
    const { default: Stripe } = await import('stripe');
    const signature = request.header('stripe-signature');
    if (!signature || !process.env.STRIPE_BILLING_WEBHOOK_SECRET) throw new Error('missing_signature');
    event = Stripe.webhooks.constructEvent(request.rawBody, signature, process.env.STRIPE_BILLING_WEBHOOK_SECRET);
    const local = process.env.GCLOUD_PROJECT?.startsWith('demo-') === true;
    if (event.livemode === local || event.account) throw new Error('wrong_stripe_account_mode');
  } catch { observeBilling('admission_failure'); response.sendStatus(400); return; }
  try {
    const reference = billingEvent(event);
    if (reference) await admitBillingEvent(admin.firestore(), reference);
    observeBilling('accepted'); // Durable admission / deliberate unsupported skip only.
    response.status(200).send({ received: true });
  } catch { observeBilling('admission_failure'); response.sendStatus(503); }
});

export const dispatchStripeBillingJob = onDocumentWritten({ ...base, retry: true,
  document: `${BILLING_JOBS}/{id}` }, async event => {
  const after = event.data?.after;
  if (!after?.exists || after.get('state') !== 'pending') return;
  if (event.data?.before.exists && event.data.before.get('generation') === after.get('generation')) return;
  await dispatchBillingJob(admin.firestore(), event.params.id, billingTransport());
});
export const recoverStripeBillingJobs = onSchedule({ ...base, schedule: QUEUE_SCHEDULE }, async () => {
  await recoverBillingJobs(admin.firestore(), billingTransport());
});
export const processStripeBillingTask = onTaskDispatched<{ id: string; generation: number }>({ ...base,
  invoker: 'private', retryConfig: PROVIDER_CLOUD_TASK_RETRY_CONFIG,
  rateLimits: { maxConcurrentDispatches: 10, maxDispatchesPerSecond: 10 }, concurrency: 1,
  secrets: FUNCTION_SECRET_BINDINGS.processStripeBillingTask }, async request => {
  await processBillingJob({ db: admin.firestore(), stripe: await getBillingStripe(), auth: admin.auth() },
    request.data?.id, request.data?.generation);
});
export const deleteStripeCustomerOnDocumentDeleted = onDocumentDeleted({ ...base, retry: true,
  document: 'customers/{uid}' }, async event => {
  await requestBillingDeletion(admin.firestore(), event.params.uid, event.data?.get('stripeId'));
});
