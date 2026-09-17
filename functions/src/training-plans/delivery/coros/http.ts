import { parseCOROSJSON } from '../../../coros/json';
import { PRODUCTION_URL } from '../../../coros/constants';
import { TrainingDeliveryBatchAdmissionChangedError, TrainingDeliveryBatchError,
  TrainingDeliveryTransportError } from '../contracts';

export const COROS_TRAINING_TIMEOUT_MS = 10_000;
export const COROS_TRAINING_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface CorosTrainingRequest {
  path: '/coros/tp/list/push' | '/coros/tp/workout/deleteById';
  data?: string;
  workoutIds?: string;
}

export interface CorosTrainingResponse {
  status: number;
  body: unknown;
}

export type CorosTrainingClient = (request: CorosTrainingRequest,
  beforeSend: () => Promise<void>) => Promise<CorosTrainingResponse>;

export class CorosTrainingHttpError extends TrainingDeliveryBatchError {
  constructor(kind: TrainingDeliveryTransportError['kind'], rejected: boolean,
    delay = 0, diagnostics: TrainingDeliveryTransportError['diagnostics'] = {}) {
    super(kind, rejected, delay, diagnostics);
  }
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > COROS_TRAINING_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('response_limit');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

function retryAfterMs(response: Response, now: number): number {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isSafeInteger(delay) && delay > 0 && delay < Number.MAX_SAFE_INTEGER - now ? delay : 0;
}

/** Production host only, one form-encoded POST and no redirect/retry. The
 * durable worker owns retry decisions and journals request start beforehand. */
export function createCorosTrainingClient(authorize: () => Promise<{ accessToken: string; account: string }>,
  fetcher: typeof fetch = fetch, now: () => number = Date.now): CorosTrainingClient {
  return async (request, beforeSend) => {
    if ((request.path === '/coros/tp/list/push') === (typeof request.data !== 'string')
      || (request.path === '/coros/tp/workout/deleteById') === (typeof request.workoutIds !== 'string')) {
      throw new CorosTrainingHttpError('terminal', true);
    }
    let authority: { accessToken: string; account: string };
    try {
      authority = await authorize();
    } catch (error) {
      if (error instanceof CorosTrainingHttpError) throw error;
      if (error instanceof TrainingDeliveryTransportError) {
        throw new CorosTrainingHttpError(error.kind, true, error.retryAfterMs,
          { ...error.diagnostics, failurePhase: 'request' });
      }
      throw new CorosTrainingHttpError('retryable', true, 0, { failurePhase: 'request' });
    }
    const body = new URLSearchParams({ token: authority.accessToken, openId: authority.account,
      ...(request.data !== undefined ? { data: request.data } : {}),
      ...(request.workoutIds !== undefined ? { workoutIds: request.workoutIds } : {}) });
    try {
      await beforeSend();
    } catch (error) {
      if (error instanceof TrainingDeliveryBatchAdmissionChangedError) throw error;
      if (error instanceof CorosTrainingHttpError) throw error;
      if (error instanceof TrainingDeliveryTransportError) {
        throw new CorosTrainingHttpError(error.kind, true, error.retryAfterMs, error.diagnostics);
      }
      throw new CorosTrainingHttpError('retryable', true);
    }
    let httpStatus: number | undefined;
    let phase: 'request' | 'response' | 'decode' = 'request';
    try {
      const response = await fetcher(`${PRODUCTION_URL}${request.path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(COROS_TRAINING_TIMEOUT_MS),
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      httpStatus = response.status;
      phase = 'response';
      const delay = retryAfterMs(response, now());
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 401) throw new CorosTrainingHttpError('auth', true);
        if (response.status === 403) throw new CorosTrainingHttpError('provider_access', true);
        if (response.status === 429) throw new CorosTrainingHttpError('deferred', true, delay);
        // The mutating request already left QS. A timeout or server failure is
        // not proof that COROS rejected it, so automatic replay is unsafe.
        if (response.status === 408 || response.status >= 500) throw new CorosTrainingHttpError('uncertain', false, delay);
        throw new CorosTrainingHttpError('terminal', true);
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new CorosTrainingHttpError('uncertain', false);
      }
      phase = 'decode';
      const raw = await readBounded(response);
      if (!raw.trim()) throw new Error('empty_response');
      return { status: response.status, body: parseCOROSJSON(raw) };
    } catch (error) {
      if (error instanceof CorosTrainingHttpError) {
        throw new CorosTrainingHttpError(error.kind, error.rejected, error.retryAfterMs, { httpStatus, failurePhase: phase });
      }
      throw new CorosTrainingHttpError('uncertain', false, 0, { httpStatus, failurePhase: phase });
    }
  };
}
