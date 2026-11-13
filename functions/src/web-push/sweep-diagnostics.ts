export type NotificationSweepStage = 'initialization' | 'configuration' | 'signing_key' | 'due_query' | 'account_processing' | 'backlog_probe';

const GRPC_CODES = [
  'ok', 'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found',
  'already-exists', 'permission-denied', 'resource-exhausted', 'failed-precondition',
  'aborted', 'out-of-range', 'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated',
];
const SDK_CODES = new Set([
  'remote-config/internal-error', 'remote-config/unknown-error', 'remote-config/invalid-argument',
  'remote-config/aborted', 'remote-config/already-exists', 'remote-config/failed-precondition',
  'remote-config/not-found', 'remote-config/out-of-range', 'remote-config/permission-denied',
  'remote-config/resource-exhausted', 'remote-config/unauthenticated',
  'app/network-error', 'app/network-timeout', 'app/invalid-credential',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE',
]);

/** Project only fixed status codes; messages, stacks, URLs, identifiers and error payloads stay private. */
export function notificationSweepErrorCode(error: unknown): string {
  try {
    if (!error || typeof error !== 'object') return 'unknown';
    const { code, statusCode, status } = error as { code?: unknown; statusCode?: unknown; status?: unknown };
    if (typeof code === 'number' && Number.isInteger(code) && GRPC_CODES[code]) return GRPC_CODES[code];
    if (typeof code === 'string' && code.length <= 64) {
      if (SDK_CODES.has(code)) return code;
      const normalized = code.toLowerCase().replace(/^firestore\//, '').replace(/_/g, '-');
      if (/^\d{1,2}$/.test(normalized) && GRPC_CODES[Number(normalized)]) return GRPC_CODES[Number(normalized)];
      if (GRPC_CODES.includes(normalized)) return normalized;
    }
    const httpStatus = [code, statusCode, status].find(value => typeof value === 'number'
      && Number.isInteger(value) && value >= 400 && value <= 599);
    return httpStatus === undefined ? 'unknown' : `http-${httpStatus}`;
  } catch { return 'unknown'; }
}

/** Extract fixed classifications from SDK errors without exposing their messages or response bodies. */
export function notificationConfigurationFailureDetails(error: unknown, elapsedMs: number): Record<string, string | number | boolean> {
  const code = notificationSweepErrorCode(error);
  const details: Record<string, string | number | boolean> = {
    configurationOperation: 'get_client_template',
    configurationElapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.min(120_000, Math.round(elapsedMs))) : 0,
    configurationFailureKind: code === 'remote-config/resource-exhausted' ? 'resource_exhausted'
      : code === 'remote-config/internal-error' ? 'upstream_internal'
        : code.startsWith('app/network-') || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'].includes(code)
          ? 'transport' : 'unknown',
  };
  try {
    const message = (error as { message?: unknown } | null)?.message;
    if (typeof message !== 'string') return details;
    // Match the SDK's non-JSON error envelope, never copy any part of its response body.
    const response = code === 'remote-config/unknown-error'
      ? /^Unexpected response with status: ([45]\d{2}) and body:/.exec(message.slice(0, 80)) : null;
    if (response) {
      details.configurationFailureKind = 'non_json_response';
      details.upstreamHttpStatus = Number(response[1]);
    }
    if (code === 'remote-config/resource-exhausted') {
      details.explicitQuotaExceeded = message.startsWith('Quota exceeded for quota metric ');
    }
  } catch { /* Diagnostics must never replace the original failure. */ }
  return details;
}
