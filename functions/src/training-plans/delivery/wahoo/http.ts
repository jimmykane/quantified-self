import { TrainingDeliveryTransportError, type TrainingDeliveryProviderField,
  type TrainingDeliveryTransportDiagnostics } from '../contracts';
import { WAHOO_API_BASE_URL } from '../../../wahoo/constants';

export interface WahooTrainingRequest { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: string; }
export interface WahooTrainingResponse { status: number; body: unknown; }
export type WahooTrainingClient = (request: WahooTrainingRequest, beforeSend: () => Promise<void>) => Promise<WahooTrainingResponse>;
export class WahooTrainingHttpError extends TrainingDeliveryTransportError {
  constructor(kind: TrainingDeliveryTransportError['kind'], public readonly rejected: boolean, delay = 0,
    diagnostics: TrainingDeliveryTransportError['diagnostics'] = {}) { super(kind, delay, diagnostics); }
}
export const WAHOO_TRAINING_RESPONSE_BYTES = 2 * 1024 * 1024;
export const WAHOO_TRAINING_REJECTION_BYTES = 16 * 1024;
const WAHOO_TRAINING_REJECTION_READ_MS = 500;
export function wahooId(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d{0,18}$/.test(String(value))
    || (typeof value === 'number' && !Number.isSafeInteger(value))) throw new TrainingDeliveryTransportError('uncertain');
  return String(value);
}
export function wahooObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TrainingDeliveryTransportError('uncertain');
  return value as Record<string, unknown>;
}
function parse(raw: string): unknown {
  JSON.parse(raw); // Validate syntax before preserving large identity integers losslessly.
  return JSON.parse(raw.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    token => /^-?\d{16,}$/.test(token) ? JSON.stringify(token) : token));
}
function valid(request: WahooTrainingRequest): boolean {
  if (request.method === 'POST') return /^\/v1\/(plans|workouts)$/.test(request.path) && !!request.body;
  if (request.method === 'GET' && (/^\/v1\/plans\?external_id=qs-plan-[A-Za-z0-9_-]{43}$/.test(request.path)
    || /^\/v1\/workouts\?page=[1-5]&per_page=100$/.test(request.path)
    || /^\/v1\/workouts\/[1-9]\d{0,18}\/plans$/.test(request.path))) return true;
  return /^\/v1\/(plans|workouts)\/[1-9]\d{0,18}$/.test(request.path) && (request.method !== 'PUT' || !!request.body);
}
class ResponseLimitError extends Error {}
class ResponseReadTimeoutError extends Error {}
async function readBounded(response: Response, limit = WAHOO_TRAINING_RESPONSE_BYTES, timeoutMs = 0): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
  try {
    while (true) {
      const remaining = deadline ? deadline - Date.now() : 0;
      if (deadline && remaining <= 0) throw new ResponseReadTimeoutError();
      let timer: NodeJS.Timeout | undefined;
      const read = reader.read();
      const next = deadline ? Promise.race([read, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ResponseReadTimeoutError()), remaining);
      })]) : read;
      const { value, done } = await next.finally(() => { if (timer) clearTimeout(timer); });
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        try { void reader.cancel().catch(() => {}); } catch { /* Keep the bounded classification. */ }
        throw new ResponseLimitError();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    try { void reader.cancel().catch(() => {}); } catch { /* The diagnostic classification still has a known response status. */ }
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* A timed-out read can retain the lock until cancellation settles. */ }
  }
}
function providerField(value: string): TrainingDeliveryProviderField | undefined {
  if (/provider[_\W]*updated[_\W]*at/.test(value)) return 'plan_provider_updated_at';
  if (/external[_\W]*id/.test(value)) return 'plan_external_id';
  if (/file[_\W]*name/.test(value)) return 'plan_filename';
  if (/\bdescription\b/.test(value)) return 'plan_description';
  if (/\b(intervals?|header|workout[_\s-]*type|exit[_\s-]*trigger|intensity[_\s-]*type)\b/.test(value)) return 'plan_payload';
  if (/\bfile\b|plan\[file\]|data:application\/json/.test(value)) return 'plan_file';
  return undefined;
}
function classifyRejection(raw: string): TrainingDeliveryTransportDiagnostics {
  const trimmed = raw.trim();
  if (!trimmed) return { providerRejection: 'empty_response', providerResponseShape: 'empty' };
  let shape: 'json' | 'text' = 'text';
  try { JSON.parse(trimmed); shape = 'json'; } catch { /* Only the response shape is retained. */ }
  // The provider text is used only in memory to select fixed enums. It is never
  // returned, persisted, included in an Error message, or written to logs.
  const normalized = trimmed.toLowerCase().slice(0, WAHOO_TRAINING_REJECTION_BYTES);
  const field = providerField(normalized);
  const access = /not(?: currently| yet)? approved|unapproved|approval required|not authori[sz]ed|unauthori[sz]ed|not allowed|forbidden|access denied|not enabled|permission (?:denied|required)|does not have permission|lacks permission|entitlement/.test(normalized);
  const application = /\b(app|application|client)\b/.test(normalized);
  const plan = /\bplans?\b/.test(normalized);
  const missing = /can't be blank|cannot be blank|must not be blank|is blank|is required|required parameter|missing parameter|parameter is missing|is missing|must be present|not present/.test(normalized);
  const invalid = /\binvalid\b|not valid|malformed|unprocessable|unsupported|must be (?:a|an|one|valid)|could not parse|can't be parsed|cannot be parsed|parse error/.test(normalized);
  const providerRejection = application && access ? 'application_not_approved'
    : plan && access ? 'plan_access_unavailable'
      : missing ? 'missing_parameter' : invalid ? 'invalid_parameter' : 'unknown_validation';
  return { providerRejection, providerResponseShape: shape, ...(field ? { providerField: field } : {}) };
}
async function rejectionDiagnostics(response: Response): Promise<TrainingDeliveryTransportDiagnostics> {
  try { return classifyRejection(await readBounded(response, WAHOO_TRAINING_REJECTION_BYTES, WAHOO_TRAINING_REJECTION_READ_MS)); }
  catch (error) {
    return error instanceof ResponseLimitError
      ? { providerRejection: 'oversized_response', providerResponseShape: 'oversized' }
      : { providerRejection: 'unreadable_response', providerResponseShape: 'unreadable' };
  }
}
async function discardBody(response: Response): Promise<void> {
  // Once status establishes an outcome, a stream cleanup failure must not turn
  // a known rejection or accepted DELETE into an ambiguous provider write.
  try { await response.body?.cancel(); } catch { /* Keep the known HTTP outcome. */ }
}
function retryDelay(response: Response, now: number): number {
  const retry = response.headers.get('retry-after');
  const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now : 0;
  const resets = (response.headers.get('x-ratelimit-reset') ?? '').split(',').map(value => /^\d+$/.test(value.trim()) ? Number(value) * 1000 : 0);
  const result = Math.max(0, Number.isFinite(delay) ? delay : 0, ...resets);
  return Number.isSafeInteger(result) && result < Number.MAX_SAFE_INTEGER - now ? result : 86_400_000;
}
/** Exact host/path, bounded responses, no redirect or local retry. The shared worker
 * owns retries; neither external_id nor workout_token makes a POST idempotent. */
export function createWahooTrainingClient(authorize: () => Promise<{ accessToken: string; account: string; assertCurrent(): Promise<void> }>,
  fetcher: typeof fetch = fetch, now: () => number = Date.now,
  capacity?: { reserve(): Promise<void>; defer(untilMs: number): Promise<void> }): WahooTrainingClient {
  return async (request, beforeSend) => {
    if (!valid(request) || (request.body && Buffer.byteLength(request.body) > WAHOO_TRAINING_RESPONSE_BYTES)) throw new WahooTrainingHttpError('terminal', true);
    const authority = await authorize();
    await capacity?.reserve();
    // Recheck rotating credentials before the caller journals and performs the
    // final intent/lease guard. No asynchronous work intervenes between that final
    // guard and fetch, so a Stop during credential checks cannot start a stale POST.
    try { await authority.assertCurrent(); }
    catch (error) { throw new WahooTrainingHttpError(error instanceof TrainingDeliveryTransportError ? error.kind : 'retryable', true,
      error instanceof TrainingDeliveryTransportError ? error.retryAfterMs : 0); }
    await beforeSend();
    const mutating = request.method !== 'GET';
    let httpStatus: number | undefined;
    let failurePhase: 'request' | 'response' | 'decode' = 'request';
    try {
      const response = await fetcher(`${WAHOO_API_BASE_URL}${request.path}`, {
        method: request.method, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${authority.accessToken}`, Accept: 'application/json',
          ...(request.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(request.body ? { body: request.body } : {}),
      });
      httpStatus = response.status; failurePhase = 'response';
      const delay = retryDelay(response, now());
      const exhausted = (response.headers.get('x-ratelimit-remaining') ?? '').split(',').some(value => /^0$/.test(value.trim()));
      if (response.status === 429 || (exhausted && delay > 0)) {
        // Failure to persist a quota delay must not erase a known HTTP outcome.
        try { await capacity?.defer(now() + (delay || 300_000)); } catch { /* Worker also retains the delay. */ }
      }
      if (response.status === 429) { await discardBody(response); throw new WahooTrainingHttpError('deferred', true, delay || 300_000); }
      if (response.status === 404 && ['GET', 'DELETE'].includes(request.method)) {
        await discardBody(response); return { status: 404, body: null };
      }
      if (!response.ok) {
        const providerDiagnostics = response.status === 422 ? await rejectionDiagnostics(response) : {};
        if (response.status !== 422) await discardBody(response);
        if (response.status === 401) throw new WahooTrainingHttpError('auth', true);
        // Required user grants were already checked. A generic 403 is not proof
        // that reconnecting will fix an application approval/access problem.
        if (response.status === 403) throw new WahooTrainingHttpError('provider_access', true);
        if (response.status === 408 || response.status >= 500) throw new WahooTrainingHttpError(mutating ? 'uncertain' : 'retryable', false, delay);
        if (['application_not_approved', 'plan_access_unavailable'].includes(providerDiagnostics.providerRejection ?? '')) {
          throw new WahooTrainingHttpError('provider_access', true, 0, providerDiagnostics);
        }
        throw new WahooTrainingHttpError('terminal', true, 0, providerDiagnostics);
      }
      if (response.status !== 200 && !(request.method === 'POST' && response.status === 201)
        && !(mutating && request.method !== 'POST' && response.status === 204)) {
        await discardBody(response); throw new WahooTrainingHttpError(mutating ? 'uncertain' : 'retryable', false);
      }
      if (request.method === 'DELETE') { await discardBody(response); return { status: response.status, body: null }; }
      failurePhase = 'decode';
      const raw = await readBounded(response);
      const body = raw.trim() ? parse(raw) : null;
      if (request.method === 'GET' && body === null) throw new Error('empty');
      const rows = Array.isArray(body) ? body : body && typeof body === 'object' && Array.isArray(wahooObject(body).workouts)
        ? wahooObject(body).workouts as unknown[] : body ? [body] : [];
      for (const row of rows) {
        const value = wahooObject(row);
        if (value.user_id !== undefined && wahooId(value.user_id) !== authority.account) throw new Error('account');
      }
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof WahooTrainingHttpError) throw new WahooTrainingHttpError(error.kind, error.rejected, error.retryAfterMs,
        { ...error.diagnostics, httpStatus, failurePhase });
      throw new WahooTrainingHttpError(mutating ? 'uncertain' : 'retryable', false, 0, { httpStatus, failurePhase });
    }
  };
}
