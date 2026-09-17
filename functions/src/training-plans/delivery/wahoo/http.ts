import { TrainingDeliveryTransportError } from '../contracts';
import { WAHOO_API_BASE_URL } from '../../../wahoo/constants';

export interface WahooTrainingRequest { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: string; }
export interface WahooTrainingResponse { status: number; body: unknown; }
export type WahooTrainingClient = (request: WahooTrainingRequest, beforeSend: () => Promise<void>) => Promise<WahooTrainingResponse>;
export class WahooTrainingHttpError extends TrainingDeliveryTransportError {
  constructor(kind: TrainingDeliveryTransportError['kind'], public readonly rejected: boolean, delay = 0,
    diagnostics: TrainingDeliveryTransportError['diagnostics'] = {}) { super(kind, delay, diagnostics); }
}
export const WAHOO_TRAINING_RESPONSE_BYTES = 2 * 1024 * 1024;
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
async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > WAHOO_TRAINING_RESPONSE_BYTES) { await reader.cancel(); throw new Error('response-limit'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
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
        await discardBody(response);
        if (response.status === 401) throw new WahooTrainingHttpError('auth', true);
        // Required user grants were already checked. A generic 403 is not proof
        // that reconnecting will fix an application approval/access problem.
        if (response.status === 403) throw new WahooTrainingHttpError('provider_access', true);
        if (response.status === 408 || response.status >= 500) throw new WahooTrainingHttpError(mutating ? 'uncertain' : 'retryable', false, delay);
        throw new WahooTrainingHttpError('terminal', true);
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
      if (error instanceof WahooTrainingHttpError) throw new WahooTrainingHttpError(error.kind, error.rejected, error.retryAfterMs, { httpStatus, failurePhase });
      throw new WahooTrainingHttpError(mutating ? 'uncertain' : 'retryable', false, 0, { httpStatus, failurePhase });
    }
  };
}
