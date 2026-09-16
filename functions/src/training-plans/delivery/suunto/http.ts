import { TrainingDeliveryTransportError } from '../contracts';

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
async function readBounded(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > GUIDE_RESPONSE_BYTES) { await reader.cancel(); throw new Error('response-limit'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
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
        await response.body?.cancel();
        const retry = response.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : 0;
        const retryAfter = Number.isSafeInteger(delay) && delay > 0 && delay < Number.MAX_SAFE_INTEGER - now() ? delay : 0;
        if (response.status === 401) throw new SuuntoGuideHttpError('auth', true);
        if (response.status === 403) throw new SuuntoGuideHttpError('permission', true);
        if (response.status === 429) throw new SuuntoGuideHttpError('deferred', true, retryAfter);
        if (response.status === 408 || response.status >= 500) throw new SuuntoGuideHttpError(mutating ? 'uncertain' : 'retryable', false, retryAfter);
        throw new SuuntoGuideHttpError('terminal', response.status >= 400 && response.status < 500);
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
      if (error instanceof SuuntoGuideHttpError) throw new SuuntoGuideHttpError(error.kind, error.rejected, error.retryAfterMs, { httpStatus, failurePhase });
      throw new SuuntoGuideHttpError(mutating ? 'uncertain' : 'retryable', false, 0, { httpStatus, failurePhase });
    }
  };
}
