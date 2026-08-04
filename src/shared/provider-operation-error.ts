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

function normalizeOptionalString(value: unknown, maxLength = SAFE_TEXT_MAX_LENGTH): string | undefined {
  const normalized = `${value || ''}`
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(access_token|refresh_token|id_token|client_secret|authorization|token|api[_-]?key|x-sig|signature|sig)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\b(access_token|refresh_token|id_token|client_secret|authorization|token|api[_-]?key|x-sig|signature|sig)["']?\s*:\s*["'][^"']+["']/gi, '$1: "[redacted]"')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized || undefined;
}

function normalizeFiniteNonNegativeNumber(value: unknown): number | undefined {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : undefined;
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
    this.retryMode = options.retryMode || (options.disposition === 'retryable' ? 'restart' : 'none');
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
