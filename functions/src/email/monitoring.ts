import * as logger from 'firebase-functions/logger';

export type EmailSource = 'transactional' | 'marketing';
export type EmailState = 'queued' | 'pending' | 'processing' | 'retry' | 'smtp_accepted' | 'smtp_partial' | 'error' | 'unknown';
export const EMAIL_PROBE_LIMIT = 20;
export const EMAIL_PROBE_TIMEOUT_MS = 5_000;
// State/time fields and inert source markers only; never fetch bodies, addresses or SMTP error text.
export const EMAIL_MONITORING_FIELDS = ['queuedAt', 'delivery.state', 'delivery.startTime',
  'delivery.leaseExpireTime', 'delivery.attempts', 'marketing.campaignId', 'marketing.testCampaignId'];

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function timestampMs(value: unknown): number | null {
  try {
    const n = typeof object(value).toMillis === 'function' ? (value as { toMillis(): number }).toMillis() : NaN;
    return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
  } catch { return null; }
}

/** Supported extension states only. SUCCESS is SMTP acceptance, never an inbox/open claim. */
export function emailState(data: Record<string, unknown>): EmailState {
  const delivery = object(data.delivery);
  if (data.delivery !== undefined && (data.delivery === null || typeof data.delivery !== 'object' || Array.isArray(data.delivery))) return 'unknown';
  if (delivery.state === undefined) return 'queued';
  if (delivery.state === 'PENDING') return 'pending';
  if (delivery.state === 'PROCESSING') return 'processing';
  if (delivery.state === 'RETRY') return 'retry';
  if (delivery.state === 'ERROR') return 'error';
  if (delivery.state === 'SUCCESS') {
    const info = object(delivery.info);
    return [info.rejected, info.pending].some(value => Array.isArray(value) && value.length > 0) ? 'smtp_partial' : 'smtp_accepted';
  }
  return 'unknown';
}
export function emailSource(data: Record<string, unknown>): EmailSource {
  const marketing = object(data.marketing);
  // Unsaved admin test mail deliberately has a null campaignId.
  return Object.prototype.hasOwnProperty.call(marketing, 'campaignId') && (marketing.campaignId === null || typeof marketing.campaignId === 'string')
    || typeof marketing.testCampaignId === 'string' ? 'marketing' : 'transactional';
}

/** Read-only classification of actual mail. Retries age from the latest write, not their old creation. */
export function emailEligibility(mail: FirebaseFirestore.DocumentSnapshot, now: number): { source: EmailSource; kind: 'due' | 'excluded' | 'unknown'; ageMs?: number } {
  const data = mail.data() || {};
  const source = emailSource(data);
  if (!mail.exists) return { source, kind: 'excluded' };
  const state = emailState(data);
  if (['smtp_accepted', 'smtp_partial', 'error'].includes(state)) return { source, kind: 'excluded' };
  const delivery = object(data.delivery);
  if (delivery.attempts !== undefined && (!Number.isSafeInteger(delivery.attempts) || Number(delivery.attempts) < 0)) return { source, kind: 'unknown' };
  const resend = state === 'retry' || state === 'pending' && Number(delivery.attempts) > 0;
  const dueAt = state === 'processing' ? timestampMs(delivery.leaseExpireTime)
    : resend ? timestampMs(mail.updateTime)
      : state === 'pending' || state === 'queued' ? data.queuedAt === undefined ? timestampMs(mail.createTime) : timestampMs(data.queuedAt) : null;
  if (dueAt === null || !Number.isFinite(now) || now < 0) return { source, kind: 'unknown' };
  if (dueAt > now) return { source, kind: state === 'processing' ? 'excluded' : 'unknown' };
  return { source, kind: 'due', ageMs: Math.min(365 * 86_400_000, Math.floor(now - dueAt)) };
}

function emit(event: string, fields: Record<string, string | number | boolean>, warning = false): void {
  // Logging is observational and cannot retry a mail or alter delivery.
  try { (warning ? logger.warn : logger.info)('[EmailDelivery]', { telemetryVersion: 1, event, ...fields }); } catch { /* best effort */ }
}
export function recordEmailTransition(before: Record<string, unknown>, after: Record<string, unknown>): void {
  const state = emailState(after);
  if (emailState(before) === state && object(before.delivery).attempts === object(after.delivery).attempts) return;
  emit('state_observed', { source: emailSource(after), state }, ['error', 'smtp_partial', 'unknown'].includes(state));
}
export function recordEmailOperation(operation: 'dispatch' | 'tracking', outcome: 'completed' | 'failed', submitted = 0): void {
  emit('operation', { operation, outcome, submitted: Number.isFinite(submitted) ? Math.max(0, Math.min(25, Math.floor(submitted))) : 0 }, outcome === 'failed');
}
export function recordMarketingDeferral(reason: 'daily_cap' | 'schedule' | 'suppression'): void {
  emit('dispatch_deferred', { reason });
}
export interface EmailSample { sampled: number; unknownSample: number; excludedSample: number; truncated: boolean; dueSample?: number; ageLowerBoundMs?: number }
function bounded(value: number, maximum: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : 0; }
export function recordEmailSample(source: EmailSource, sample?: EmailSample): void {
  emit(sample ? 'outbox_sample' : 'outbox_sample_unavailable', { source, ...(sample ? {
    sampled: bounded(sample.sampled, EMAIL_PROBE_LIMIT), unknownSample: bounded(sample.unknownSample, EMAIL_PROBE_LIMIT),
    excludedSample: bounded(sample.excludedSample, EMAIL_PROBE_LIMIT), truncated: sample.truncated === true,
    ...(sample.dueSample !== undefined ? { dueSample: bounded(sample.dueSample, EMAIL_PROBE_LIMIT) } : {}),
    ...(sample.ageLowerBoundMs !== undefined ? { ageLowerBoundMs: bounded(sample.ageLowerBoundMs, 365 * 86_400_000) } : {}),
  } : {}) }, !sample);
}
