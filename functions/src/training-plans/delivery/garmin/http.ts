import { TrainingDeliveryTransportError } from '../contracts';

export const GARMIN_TRAINING_RESPONSE_BYTES = 2 * 1024 * 1024;
export const GARMIN_TRAINING_TIMEOUT_MS = 10_000;
const BASE = 'https://apis.garmin.com';
const INT64_MAX = 9_223_372_036_854_775_807n;

export interface GarminTrainingRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: string;
}
export interface GarminTrainingResponse { status: number; body: unknown; }
export type GarminTrainingClient = (request: GarminTrainingRequest,
  beforeSend: () => Promise<void>) => Promise<GarminTrainingResponse>;

/** No raw HTTP response, URL, credential or provider error survives this boundary. */
export class GarminTrainingHttpError extends TrainingDeliveryTransportError {
  constructor(kind: TrainingDeliveryTransportError['kind'], public readonly rejected: boolean,
    retryAfterMs = 0, diagnostics: TrainingDeliveryTransportError['diagnostics'] = {}) { super(kind, retryAfterMs, diagnostics); }
}

export function garminId(value: unknown): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) throw new TrainingDeliveryTransportError('uncertain');
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d{0,18}$/.test(String(value))
    || BigInt(value) > INT64_MAX) throw new TrainingDeliveryTransportError('uncertain');
  return String(value);
}

/** Lex strings before numbers, so a title containing JSON-looking text stays untouched.
 * Large integer tokens remain decimal strings; identity validators reject unsafe numbers,
 * fractions, negatives and values beyond the provider's Long range. */
export function parseGarminTrainingJSON(raw: string): unknown {
  // Validate syntax first; quoting must not accidentally repair invalid leading zeroes.
  JSON.parse(raw);
  const protectedJSON = raw.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token =>
    /^-?\d{16,}$/.test(token) ? JSON.stringify(token) : token);
  return JSON.parse(protectedJSON);
}

/** Garmin requires numeric Long fields on the wire, not rounded JS numbers or strings. */
export function garminBody(payload: Record<string, unknown>, ids: Record<string, string> = {}): string {
  if (Object.keys(ids).some(key => !['workoutId', 'ownerId', 'scheduleId'].includes(key)
    || Object.prototype.hasOwnProperty.call(payload, key))) throw new TrainingDeliveryTransportError('terminal');
  const encoded = JSON.stringify(payload);
  return `${encoded.slice(0, -1)}${Object.keys(payload).length && Object.keys(ids).length ? ',' : ''}${Object.entries(ids)
    .map(([key, value]) => `${JSON.stringify(key)}:${garminId(value)}`).join(',')}}`;
}

function validRequest(request: GarminTrainingRequest): boolean {
  const { path, method } = request;
  if (method === 'POST') return path === '/workoutportal/workout/v2' || path === '/training-api/schedule/';
  if (method === 'GET' && /^\/training-api\/schedule\?startDate=\d{4}-\d{2}-\d{2}&endDate=\d{4}-\d{2}-\d{2}$/.test(path)) return true;
  return /^\/training-api\/(workout\/v2|schedule)\/[1-9]\d{0,18}$/.test(path);
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > GARMIN_TRAINING_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('response-limit');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

/** One request only. Durable worker backoff owns retries. Exact host, no redirects. */
export function createGarminTrainingClient(authorize: () => Promise<string>,
  fetcher: typeof fetch = fetch, now: () => number = Date.now,
  capacity?: { reserve(): Promise<void>; defer(untilMs: number): Promise<void> }): GarminTrainingClient {
  return async (request, beforeSend) => {
    if (!validRequest(request)) throw new GarminTrainingHttpError('terminal', true);
    const token = await authorize();
    // Admission precedes the operation-start journal: quota deferral is NOT an uncertain POST.
    await capacity?.reserve();
    await beforeSend();
    const mutating = request.method !== 'GET';
    let httpStatus: number | undefined;
    let failurePhase: 'request' | 'response' | 'decode' = 'request';
    try {
      const response = await fetcher(`${BASE}${request.path}`, {
        method: request.method, redirect: 'error', signal: AbortSignal.timeout(GARMIN_TRAINING_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(request.body === undefined ? {} : { body: request.body }),
      });
      httpStatus = response.status;
      failurePhase = 'response';
      const retry = response.headers.get('retry-after');
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : NaN;
      if (response.status === 429) await capacity?.defer(now() + (Number.isFinite(delay) && delay > 0 ? delay : 86_400_000));
      if (response.status === 404 && ['GET', 'DELETE'].includes(request.method)) {
        await response.body?.cancel();
        return { status: 404, body: null };
      }
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status;
        if (status === 401) throw new GarminTrainingHttpError('auth', true);
        if (status === 403 || status === 412) throw new GarminTrainingHttpError('permission', true);
        if (status === 429 && Number.isFinite(delay) && delay > Number.MAX_SAFE_INTEGER - now()) {
          throw new GarminTrainingHttpError('terminal', true);
        }
        if (status === 429) throw new GarminTrainingHttpError('retryable', true,
          Number.isFinite(delay) && delay > 0 ? delay : 86_400_000);
        if (status === 408 || status >= 500) throw new GarminTrainingHttpError(mutating ? 'uncertain' : 'retryable', false);
        throw new GarminTrainingHttpError('terminal', status >= 400 && status < 500);
      }
      // Only documented synchronous success confirms completion. In particular, 202
      // is not proof a DELETE finished, and an empty GET is not evidence of absence.
      // The schedule contract also permits POST 204. The adapter must inspect by
      // retained workout/date to recover its ID; HTTP success alone is not delivery.
      if (response.status !== 200 && !(response.status === 204 && mutating)) {
        await response.body?.cancel();
        throw new GarminTrainingHttpError(mutating ? 'uncertain' : 'retryable', false);
      }
      failurePhase = 'decode';
      const raw = await readBounded(response);
      const body = raw.trim() ? parseGarminTrainingJSON(raw) : null;
      if (request.method === 'GET' && body === null) throw new GarminTrainingHttpError('retryable', false);
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof GarminTrainingHttpError) throw new GarminTrainingHttpError(error.kind, error.rejected,
        error.retryAfterMs, { httpStatus, failurePhase });
      throw new GarminTrainingHttpError(mutating ? 'uncertain' : 'retryable', false, 0, { httpStatus, failurePhase });
    }
  };
}
