import { ServiceNames } from '@sports-alliance/sports-lib';

export type ProviderFailureDisposition =
  | 'retryable'
  | 'permanent'
  | 'auth_required'
  | 'permission_required';

export type ProviderRetryMode = 'resume' | 'restart' | 'none';

export type ProviderOperation =
  | 'activity_upload_init'
  | 'activity_upload_blob'
  | 'activity_upload_status'
  | 'route_create'
  | 'route_update'
  | 'route_upload';

export interface ProviderOperationErrorOptions {
  serviceName: ServiceNames;
  operation: ProviderOperation;
  disposition: ProviderFailureDisposition;
  retryMode?: ProviderRetryMode;
  code: string;
  message: string;
  statusCode?: number;
  providerCode?: string;
  providerUserId?: string;
  providerOperationId?: string;
  retryAfterSeconds?: number;
  dlqContext?: string;
}

const SAFE_TEXT_MAX_LENGTH = 500;
const TRANSIENT_PROVIDER_TRANSPORT_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ESOCKETTIMEDOUT',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const TRANSIENT_PROVIDER_TRANSPORT_ERROR_NAMES = new Set([
  'AbortError',
  'FetchError',
  'RequestError',
  'TimeoutError',
  'WahooAPITransportError',
]);

function normalizeOptionalString(value: unknown, maxLength = SAFE_TEXT_MAX_LENGTH): string | undefined {
  const normalized = `${value || ''}`
    .replace(
      /["']?\b(access_token|refresh_token|id_token|client_secret|authorization|token|api[_-]?key|x-sig|signature|sig)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|(?:Bearer|Basic)\s+[^&,\s}\]]+|[^&,\s}\]]+)/gi,
      '$1=[redacted]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized || undefined;
}

function normalizeFiniteNonNegativeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return undefined;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : undefined;
}

export interface TerminalServiceAuthErrorLike {
  name: 'TerminalServiceAuthError';
  message?: string;
  statusCode?: number | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  providerUserId?: string;
  dlqContext?: string;
}

/**
 * Uses the canonical lifecycle error name so adapters remain reliable across
 * test doubles and separately loaded bundles.
 */
export function isTerminalServiceAuthError(error: unknown): error is TerminalServiceAuthErrorLike {
  return !!error
    && typeof error === 'object'
    && (error as { name?: unknown }).name === 'TerminalServiceAuthError';
}

/**
 * A destination-provider failure whose queue behavior was decided at the
 * provider boundary. Queue workers must not infer this policy from messages.
 */
export class ProviderOperationError extends Error {
  readonly name = 'ProviderOperationError';
  readonly serviceName: ServiceNames;
  readonly operation: ProviderOperation;
  readonly disposition: ProviderFailureDisposition;
  readonly retryMode: ProviderRetryMode;
  readonly code: string;
  readonly statusCode?: number;
  readonly providerCode?: string;
  readonly providerUserId?: string;
  readonly providerOperationId?: string;
  readonly retryAfterSeconds?: number;
  readonly dlqContext?: string;

  constructor(options: ProviderOperationErrorOptions) {
    super(normalizeOptionalString(options.message) || 'Provider operation failed.');
    this.serviceName = options.serviceName;
    this.operation = options.operation;
    this.disposition = options.disposition;
    this.retryMode = options.disposition === 'retryable'
      ? options.retryMode === 'resume' ? 'resume' : 'restart'
      : 'none';
    this.code = normalizeOptionalString(options.code, 100) || 'provider_operation_failed';
    this.statusCode = normalizeFiniteNonNegativeNumber(options.statusCode);
    this.providerCode = normalizeOptionalString(options.providerCode, 100);
    this.providerUserId = normalizeOptionalString(options.providerUserId, 200);
    this.providerOperationId = normalizeOptionalString(options.providerOperationId, 200);
    this.retryAfterSeconds = normalizeFiniteNonNegativeNumber(options.retryAfterSeconds);
    this.dlqContext = normalizeOptionalString(options.dlqContext, 100);
  }
}

export function isProviderOperationError(error: unknown): error is ProviderOperationError {
  return error instanceof ProviderOperationError;
}

/**
 * Recognizes transport failures that have no HTTP response. Keep this list
 * explicit so validation and programming errors are never retried by accident.
 */
export function isTransientProviderTransportError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errorLike = error as {
    code?: unknown;
    errno?: unknown;
    name?: unknown;
    cause?: { code?: unknown; errno?: unknown; name?: unknown } | null;
  };
  const candidates = [
    errorLike.code,
    errorLike.errno,
    errorLike.cause?.code,
    errorLike.cause?.errno,
  ].map(value => `${value || ''}`.trim().toUpperCase()).filter(Boolean);
  if (candidates.some(code => TRANSIENT_PROVIDER_TRANSPORT_CODES.has(code))) {
    return true;
  }

  const names = [errorLike.name, errorLike.cause?.name]
    .map(value => `${value || ''}`.trim())
    .filter(Boolean);
  return names.some(name => TRANSIENT_PROVIDER_TRANSPORT_ERROR_NAMES.has(name));
}
