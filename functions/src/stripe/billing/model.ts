import { createHash } from 'node:crypto';
import { Timestamp, type DocumentData } from 'firebase-admin/firestore';

export const BILLING_REGION = 'europe-west3';
export const BILLING_CONTROL = 'configuration/stripeBilling';
export const BILLING_JOBS = 'stripeBillingJobs';
export const BILLING_ACCOUNTS = 'stripeBillingAccounts';
export const BILLING_LOCKS = 'stripeBillingLocks';
export const BILLING_PRICES = 'stripeBillingPrices';
export const BILLING_TASK = 'processStripeBillingTask';
export const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Stripe guarantees keys for at least 24h. Leave an hour of margin; absence
// from Search after this deadline is never permission to repeat a POST.
export const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const BILLING_LEASE_MS = 360_000; // Greater than the 300-second worker.

export type BillingErrorCode = 'invalid_request' | 'maintenance' | 'account_unavailable'
  | 'customer_conflict' | 'subscription_exists' | 'trial_ineligible'
  | 'operation_uncertain' | 'provider_unavailable' | 'retry_exhausted' | 'checkout_rejected';
const MESSAGES: Record<BillingErrorCode, string> = {
  invalid_request: 'This checkout request is not supported. Please refresh and try again.',
  maintenance: 'Billing is temporarily unavailable. Your existing subscription continues normally.',
  account_unavailable: 'This account is no longer available for billing.',
  customer_conflict: 'Your billing account needs support before you can continue.',
  subscription_exists: 'You already have a subscription. Please use Manage subscription.',
  trial_ineligible: 'This trial is no longer available. Please refresh the pricing page.',
  operation_uncertain: 'Your previous billing request needs review. Please contact support before trying again.',
  provider_unavailable: 'Billing is taking longer than expected. Your request is retained; please try checking it again later.',
  retry_exhausted: 'We could not complete your billing request. Please contact support.',
  checkout_rejected: 'Stripe could not open checkout. Please refresh and try again, or contact support if this continues.',
};
export class BillingError extends Error {
  constructor(public readonly code: BillingErrorCode, public readonly retryable = false) { super(MESSAGES[code]); }
}
export class BillingContention extends Error { constructor() { super('billing_busy'); } }
export function safeBillingError(error: unknown): { code: BillingErrorCode; message: string } {
  const code = error instanceof BillingError ? error.code : 'provider_unavailable';
  return { code, message: MESSAGES[code] };
}
export function billingId(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && /^[a-z]+_[a-zA-Z0-9_]+$/.test(value)) return value;
  if (value && typeof value === 'object' && 'id' in value) return stripeId(value.id);
  return null;
}
export function seconds(value: unknown): Timestamp | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Timestamp.fromMillis(Math.round(value * 1000)) : null;
}
export interface BillingControl { owner: 'extension' | 'native'; requestsEnabled: boolean; nativeSince: Timestamp | null }
export function billingControl(value?: DocumentData): BillingControl {
  return { owner: value?.owner === 'native' ? 'native' : 'extension',
    requestsEnabled: value?.requestsEnabled === true,
    nativeSince: value?.nativeSince instanceof Timestamp ? value.nativeSince : null };
}

export function assertLocalBillingEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.FUNCTIONS_EMULATOR !== 'true' && env.QS_BILLING_LOCAL !== 'true') return;
  if (!/^demo-[a-z0-9-]+$/.test(env.GCLOUD_PROJECT ?? '')
    || !/^(127\.0\.0\.1|localhost):\d+$/.test(env.FIRESTORE_EMULATOR_HOST ?? '')
    || !/^(127\.0\.0\.1|localhost):\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST ?? '')
    || !/^(sk|rk)_test_/.test(env.STRIPE_BILLING_KEY ?? '')) {
    throw new Error('Billing emulation requires a demo project, loopback Auth/Firestore, and a Stripe test key.');
  }
  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_ADMIN_BILLING_KEY']) {
    if (env[key] && !/^(sk|rk)_test_/.test(env[key]!)) throw new Error('Live Stripe credentials are forbidden in billing emulation.');
  }
}

export function returnUrl(value: unknown, local = false): string {
  if (typeof value !== 'string' || value.length > 2048) throw new BillingError('invalid_request');
  let url: URL;
  try { url = new URL(value); } catch { throw new BillingError('invalid_request'); }
  const allowed = ['https://quantified-self.io', 'https://beta.quantified-self.io'].includes(url.origin)
    || (local && ['localhost', '127.0.0.1'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol));
  if (!allowed || url.username || url.password) throw new BillingError('invalid_request');
  return value;
}
export interface CheckoutRequest {
  price: string; mode: 'subscription' | 'payment'; success_url: string; cancel_url: string;
  trial_period_days?: number;
}
const CHECKOUT_FIELDS = ['price', 'mode', 'success_url', 'cancel_url', 'allow_promotion_codes',
  'automatic_tax', 'metadata', 'payment_method_collection', 'trial_period_days'];
export function checkoutRequest(data: DocumentData, uid: string, local = false): CheckoutRequest {
  if (!data || Object.keys(data).some(k => !CHECKOUT_FIELDS.includes(k))
    || typeof data.price !== 'string' || !/^price_[a-zA-Z0-9]+$/.test(data.price)
    || !['subscription', 'payment'].includes(data.mode)
    || data.allow_promotion_codes !== true || data.automatic_tax?.enabled !== true
    || Object.keys(data.automatic_tax ?? {}).length !== 1
    || data.metadata?.firebaseUID !== uid || Object.keys(data.metadata ?? {}).length !== 1
    || (data.payment_method_collection !== undefined && data.payment_method_collection !== 'if_required')
    || (data.trial_period_days !== undefined && (!Number.isInteger(data.trial_period_days)
      || data.trial_period_days < 1 || data.trial_period_days > 730 || data.mode !== 'subscription'))) {
    throw new BillingError('invalid_request');
  }
  return { price: data.price, mode: data.mode, success_url: returnUrl(data.success_url, local),
    cancel_url: returnUrl(data.cancel_url, local),
    ...(data.trial_period_days === undefined ? {} : { trial_period_days: data.trial_period_days }) };
}

export type BillingEventKind = 'subscription' | 'checkout' | 'invoice' | 'payment' | 'charge' | 'product' | 'price' | 'tax_rate' | 'customer';
export interface BillingEvent { eventId: string; type: string; kind: BillingEventKind; objectId: string; customerId: string | null; created: number; livemode: boolean }
// Store identifiers only. Event-version payloads are never used as a projection.
export function billingEvent(event: { id: string; type: string; created: number; livemode: boolean; data: { object: unknown } }): BillingEvent | null {
  const object = event.data.object as Record<string, unknown>;
  const kind: BillingEventKind | null = event.type.startsWith('customer.subscription.') ? 'subscription'
    : event.type.startsWith('checkout.session.') ? 'checkout'
    : event.type.startsWith('invoice.') ? 'invoice'
    : event.type.startsWith('payment_intent.') ? 'payment'
    : event.type === 'charge.refunded' ? 'charge'
    : event.type.startsWith('product.') ? 'product'
    : event.type.startsWith('price.') ? 'price'
    : event.type.startsWith('tax_rate.') ? 'tax_rate'
    : event.type === 'customer.deleted' ? 'customer' : null;
  if (!kind) return null;
  const objectId = stripeId(object?.id);
  if (!objectId || !/^evt_[a-zA-Z0-9]+$/.test(event.id)) throw new BillingError('invalid_request');
  return { eventId: event.id, type: event.type, kind, objectId,
    customerId: kind === 'customer' ? objectId : stripeId(object.customer), created: event.created, livemode: event.livemode };
}

export interface BillingJob {
  kind: 'event' | 'checkout' | 'delete'; uid: string | null; customerId: string | null;
  event?: BillingEvent; requestId?: string; request?: CheckoutRequest;
  state: 'pending' | 'done' | 'failed' | 'skipped'; createdAt: Timestamp;
  dueAt: Timestamp; recoverAt: Timestamp; attempts: number; generation: number;
  recoveries?: number; dispatchedAt?: Timestamp; lease?: string; leaseUntil?: Timestamp;
  expireAt?: Timestamp; error?: BillingErrorCode;
}

function comparable(value: unknown): unknown {
  if (value instanceof Timestamp) return { timestamp: [value.seconds, value.nanoseconds] };
  if (value && typeof value === 'object' && 'path' in value && typeof value.path === 'string') return { reference: value.path };
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, comparable(v)]));
  return value;
}
export function projectionUnchanged(existing: DocumentData | undefined, patch: DocumentData): boolean {
  return !!existing && Object.keys(patch).every(k => JSON.stringify(comparable(existing[k])) === JSON.stringify(comparable(patch[k])));
}
