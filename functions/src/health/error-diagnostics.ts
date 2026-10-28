const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError']);
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
    const candidate = error as { name?: unknown; code?: unknown; transportCode?: unknown } | null;
    const name = candidate?.name;
    const errorName = typeof name === 'string' && ERROR_NAMES.has(name) ? name : 'UnknownError';
    const code = candidate?.code;
    if (typeof code === 'number' && Number.isSafeInteger(code) && code >= 1 && code <= 16) {
      return { ...base, errorName, failureCategory: 'rpc_error', rpcStatusCode: code };
    }
    const transportCode = typeof code === 'string' && TRANSPORT_CODES.has(code) ? code
      : name === 'AbortError' ? 'ABORT_ERR' : candidate?.transportCode;
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
