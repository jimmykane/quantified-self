import { TrainingDeliveryTransportError, type TrainingDeliveryTransportDiagnostics } from '../contracts';

export interface SuuntoGuideRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Buffer;
}
export interface SuuntoGuideResponse { status: number; body: unknown; }
export type SuuntoGuideClient = (request: SuuntoGuideRequest, beforeSend: () => Promise<void>) => Promise<SuuntoGuideResponse>;
export class SuuntoGuideHttpError extends TrainingDeliveryTransportError {
  constructor(kind: TrainingDeliveryTransportError['kind'], public readonly rejected: boolean, delay = 0,
    diagnostics: TrainingDeliveryTransportError['diagnostics'] = {}) { super(kind, delay, diagnostics); }
}
// Local memory/time bounds, not Suunto quotas. One attempt; the existing worker owns retry/backoff.
export const GUIDE_RESPONSE_BYTES = 2 * 1024 * 1024;
const GUIDE_REJECTION_BYTES = 8 * 1024;
export function guideId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new TrainingDeliveryTransportError('uncertain');
  return value;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TrainingDeliveryTransportError('uncertain');
  return value as Record<string, unknown>;
}
function valid(request: SuuntoGuideRequest): boolean {
  if (request.method === 'POST') return request.path === '/v2/guides/files' && !!request.body;
  if (request.method === 'GET' && /^\/v2\/guides\/items\?offset=(0|[1-9]\d{0,6})&limit=50$/.test(request.path)) return true;
  return /^\/v2\/guides\/files\/[a-zA-Z0-9_-]{1,128}$/.test(request.path)
    && (request.method !== 'PUT' || !!request.body);
}
async function readBounded(response: Response, limit = GUIDE_RESPONSE_BYTES): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => {}); throw new Error('response-limit'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
/** Suunto documents error.description for Guide validation failures. Interpret it
 * only in memory as fixed structural categories; never log or retain its text. */
function guideRejection(raw: Buffer): TrainingDeliveryTransportDiagnostics {
  if (!raw.length) return { providerRejection: 'empty_response', providerResponseShape: 'empty' };
  let envelope: Record<string, unknown>;
  try { envelope = object(JSON.parse(raw.toString('utf8'))); }
  catch { return { providerRejection: 'unknown_validation', providerResponseShape: 'text' }; }
  const error = envelope.error && typeof envelope.error === 'object' && !Array.isArray(envelope.error)
    ? envelope.error as Record<string, unknown> : null;
  const description = typeof error?.description === 'string' ? error.description.toLowerCase().slice(0, GUIDE_REJECTION_BYTES) : '';
  const field = /\btransitions?\b/.test(description) ? 'guide_transition'
    : /\b(fields?|field[_ -]?type|conditions?)\b/.test(description) ? 'guide_field'
      : /\b(repeat|repetitions?|times)\b/.test(description) ? 'guide_repeat'
        : /\b(steps?|step[_ -]?type)\b/.test(description) ? 'guide_step'
          : /\b(activities|activity|sport)\b/.test(description) ? 'guide_activity'
            : /\b(owner|external[_ -]?id|title|subtitle|date)\b/.test(description) ? 'guide_metadata'
              : /\b(zip|archive|file|image|icon|json)\b/.test(description) ? 'guide_archive' : undefined;
  const validation = /^invalid 'guide\.steps\.\d+(?:\.steps\.\d+)?\.id': step id not allowed inside repeat$/.test(description)
    ? 'forbidden_repeat_step_id'
    : /invalid\s+step\s+type/.test(description) ? 'invalid_step_type'
    : /(?:only|unsupported|invalid).*\b(?:child|nested|repeat.*step)\b|\bonly\b.*\bsteps?\b.*\brepeat\b/.test(description) ? 'invalid_child_step'
        : /invalid\s+field\s+type/.test(description) ? 'invalid_field_type'
          : /invalid\s+condition\s+type/.test(description) ? 'invalid_condition_type'
            : /invalid\s+transition/.test(description) ? 'invalid_transition'
              : /\b(?:times|repeat\s+count|repetition\s+count)\b/.test(description)
                && /\b(invalid|outside|range|greater|less|maximum|minimum|must|between)\b/.test(description)
                ? 'invalid_repeat_count'
                : /\b(repeat|repetitions?)\b/.test(description) && /\b(invalid|unsupported|not allowed)\b/.test(description)
                  ? 'invalid_repeat_structure'
                  : /invalid\s+(?:guide\s+)?json/.test(description) ? 'invalid_guide_json' : 'unclassified';
  const rejection = /\b(missing|required|must be present)\b/.test(description) ? 'missing_parameter'
    : /\b(invalid|unsupported|not allowed|out of range|must be)\b/.test(description) ? 'invalid_parameter' : 'unknown_validation';
  return { providerResponseShape: 'json', providerRejection: rejection, providerValidation: validation,
    ...(field ? { providerField: field } : {}) };
}
async function guideRejectionDiagnostics(response: Response): Promise<TrainingDeliveryTransportDiagnostics> {
  try { return guideRejection(await readBounded(response, GUIDE_REJECTION_BYTES)); }
  catch (error) {
    return error instanceof Error && error.message === 'response-limit'
      ? { providerRejection: 'oversized_response', providerResponseShape: 'oversized' }
      : { providerRejection: 'unreadable_response', providerResponseShape: 'unreadable' };
  }
}
/** APIM authenticates the application subscription separately from the user's
 * OAuth token. A known key rejection cannot be fixed by reconnecting the user.
 * Inspect only the documented signature; never retain or expose the error body. */
async function rejectedSubscriptionKey(response: Response): Promise<boolean> {
  if (/^AzureApiManagementKey(?:\s|$)/i.test(response.headers.get('www-authenticate')?.trim() ?? '')) {
    await response.body?.cancel().catch(() => {});
    return true;
  }
  try {
    const data = object(JSON.parse((await readBounded(response)).toString('utf8')));
    return data.statusCode === 401 && typeof data.message === 'string'
      && /^Access denied due to (?:invalid|missing) subscription key\.(?:\s|$)/.test(data.message);
  } catch { return false; }
}
export function createSuuntoGuideClient(authorize: () => Promise<{ accessToken: string; account: string }>,
  subscriptionKey: () => string, fetcher: typeof fetch = fetch, now: () => number = Date.now): SuuntoGuideClient {
  return async (request, beforeSend) => {
    if (!valid(request) || (request.body && request.body.length > GUIDE_RESPONSE_BYTES)) throw new SuuntoGuideHttpError('terminal', true);
    let key: string;
    try { key = subscriptionKey(); if (!key) throw new Error(); }
    // Missing application configuration is not a revoked user permission. Do not
    // block this connection generation or ask the user to reconnect to fix it.
    catch { throw new SuuntoGuideHttpError('terminal', true); }
    const authority = await authorize();
    await beforeSend();
    const mutating = request.method !== 'GET';
    let httpStatus: number | undefined;
    let failurePhase: 'request' | 'response' | 'decode' = 'request';
    try {
      const response = await fetcher(`https://cloudapi.suunto.com${request.path}`, {
        method: request.method, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${authority.accessToken}`, 'Ocp-Apim-Subscription-Key': key,
          Accept: 'application/json, application/zip', ...(request.body ? { 'Content-Type': 'application/zip' } : {}) },
        ...(request.body ? { body: new Uint8Array(request.body) } : {}),
      });
      httpStatus = response.status; failurePhase = 'response';
      if (response.status === 404 || (response.status === 409 && mutating)) {
        await response.body?.cancel(); return { status: response.status, body: null };
      }
      if (!response.ok) {
        if (response.status === 401) {
          throw new SuuntoGuideHttpError(await rejectedSubscriptionKey(response) ? 'terminal' : 'auth', true);
        }
        const providerDiagnostics = response.status === 400 ? await guideRejectionDiagnostics(response) : {};
        if (response.status !== 400) await response.body?.cancel().catch(() => {});
        const retry = response.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : 0;
        const retryAfter = Number.isSafeInteger(delay) && delay > 0 && delay < Number.MAX_SAFE_INTEGER - now() ? delay : 0;
        if (response.status === 403) throw new SuuntoGuideHttpError('permission', true);
        if (response.status === 429) throw new SuuntoGuideHttpError('deferred', true, retryAfter);
        if (response.status === 408 || response.status >= 500) throw new SuuntoGuideHttpError(mutating ? 'uncertain' : 'retryable', false, retryAfter);
        throw new SuuntoGuideHttpError('terminal', response.status >= 400 && response.status < 500, 0, providerDiagnostics);
      }
      if (response.status !== (request.method === 'POST' ? 201 : 200)) throw new SuuntoGuideHttpError(mutating ? 'uncertain' : 'retryable', false);
      failurePhase = 'decode';
      if (request.method === 'DELETE') { await response.body?.cancel(); return { status: 200, body: null }; }
      const raw = await readBounded(response);
      if (request.method === 'GET' && request.path.startsWith('/v2/guides/files/')) {
        if (!raw.length) throw new Error('empty');
        return { status: 200, body: raw };
      }
      const envelope = object(JSON.parse(raw.toString('utf8')));
      if (envelope.error !== null || envelope.payload === null || envelope.payload === undefined) throw new Error('envelope');
      const rows = Array.isArray(envelope.payload) ? envelope.payload : [envelope.payload];
      if (rows.some(row => object(row).username !== authority.account)) throw new Error('account');
      return { status: response.status, body: envelope.payload };
    } catch (error) {
      if (error instanceof SuuntoGuideHttpError) throw new SuuntoGuideHttpError(error.kind, error.rejected, error.retryAfterMs,
        { ...error.diagnostics, httpStatus, failurePhase });
      throw new SuuntoGuideHttpError(mutating ? 'uncertain' : 'retryable', false, 0, { httpStatus, failurePhase });
    }
  };
}
