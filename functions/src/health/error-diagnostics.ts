const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'FirebaseError', 'GoogleError', 'ApiError', 'FetchError', 'RequestError', 'AbortError', 'TimeoutError',
  'TokenRefreshInProgressError', 'TokenRefreshSupersededError']);
const REFRESH_CONTENTION_NAMES = new Set(['TokenRefreshInProgressError', 'TokenRefreshSupersededError']);
const RPC_CODES = ['ok', 'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found',
  'already-exists', 'permission-denied', 'resource-exhausted', 'failed-precondition', 'aborted',
  'out-of-range', 'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated'];
const TRANSPORT_CODES = new Set(['ABORT_ERR', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET',
  'ECONNREFUSED', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND']);
const FAILURE_STAGES = new Set(['queue_validation', 'token_resolution', 'lifecycle_check', 'queue_claim',
  'provider_sync', 'token_refresh', 'identity_request', 'callback_request', 'callback_mapping',
  'result_assembly', 'health_write', 'window_checkpoint', 'sync_state_write', 'failure_state_write']);

/** Classify original errors without copying messages, stacks, causes, paths or provider data. */
export function getHealthFailureTelemetry(
  error: unknown, stage: string, elapsedMs: number,
): Record<string, string | number> {
  const base = {
    errorName: 'UnknownError', failureCategory: 'unclassified',
    failureStage: FAILURE_STAGES.has(stage) ? stage : 'unknown',
    processingElapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.min(1_800_000, Math.round(elapsedMs))) : 0,
  };
  try {
    const candidate = error as {
      name?: unknown; code?: unknown; transportCode?: unknown; cause?: { code?: unknown };
    } | null;
    const name = candidate?.name;
    const errorName = typeof name === 'string' && ERROR_NAMES.has(name) ? name : 'UnknownError';
    if (stage === 'token_refresh' && typeof name === 'string' && REFRESH_CONTENTION_NAMES.has(name)) {
      return { ...base, errorName, failureCategory: 'expected_contention' };
    }
    const code = candidate?.code;
    const rpcCode = typeof code === 'string' && code.length <= 32
      ? RPC_CODES.indexOf(code.toLowerCase().replace(/_/g, '-')) : code;
    if (typeof rpcCode === 'number' && Number.isSafeInteger(rpcCode) && rpcCode >= 1 && rpcCode <= 16) {
      return { ...base, errorName, failureCategory: 'rpc_error', rpcStatusCode: rpcCode };
    }
    const transportCode = typeof code === 'string' && TRANSPORT_CODES.has(code) ? code
      : name === 'AbortError' ? 'ABORT_ERR' : candidate?.transportCode ?? candidate?.cause?.code;
    return {
      ...base, errorName,
      ...(typeof transportCode === 'string' && TRANSPORT_CODES.has(transportCode)
        ? { failureCategory: 'transport_error', transportCode } : {}),
    };
  } catch {
    // Diagnostics must not interfere with retry accounting, even for hostile error accessors.
    return base;
  }
}
