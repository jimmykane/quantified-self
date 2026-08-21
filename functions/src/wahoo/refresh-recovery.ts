import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  isReconnectRequiredServiceConnection,
  type ServiceConnectionMetaFields,
} from '../../../shared/service-connection';
import {
  getServiceConnectionMeta,
  recordWahooOpaqueRefreshFailure,
  type WahooOpaqueRefreshFailureClaim,
} from '../service-connection-meta';
import type { RefreshFailureDetails } from '../service-auth-lifecycle';

export class WahooRefreshBackoffError extends Error {
  readonly name = 'WahooRefreshBackoffError';
  readonly code = 'unavailable';
  readonly statusCode = 503;

  constructor(
    readonly retryAt: number,
  ) {
    super('Wahoo token refresh is temporarily paused.');
  }
}

export interface WahooRefreshLifecycleGuard {
  connectionStateGeneration: string | null;
}

export function isWahooRefreshBackoffError(error: unknown): error is WahooRefreshBackoffError {
  return error instanceof WahooRefreshBackoffError
    || (error instanceof Error && error.name === 'WahooRefreshBackoffError');
}

export class WahooReconnectRequiredError extends Error {
  readonly name = 'WahooReconnectRequiredError';
  readonly code = 'unauthenticated';
  readonly statusCode = 401;

  constructor() {
    super('Reconnect Wahoo to resume sync.');
  }
}

export function isWahooReconnectRequiredError(error: unknown): error is WahooReconnectRequiredError {
  return error instanceof WahooReconnectRequiredError
    || (error instanceof Error && error.name === 'WahooReconnectRequiredError');
}

export function isOpaqueWahooRefreshFailure(
  failure: Pick<RefreshFailureDetails, 'statusCode' | 'isInvalidGrant' | 'providerErrorCode'>,
): boolean {
  // Wahoo supplied only a generic 400 in production. A named provider code or
  // invalid_grant follows the ordinary terminal-auth path instead.
  return failure.statusCode === 400
    && !failure.isInvalidGrant
    && !`${failure.providerErrorCode || ''}`.trim();
}

function getRetryAt(meta: ServiceConnectionMetaFields | null): number | null {
  const retryAt = Number(meta?.wahooRefreshRetryAt || 0);
  return Number.isFinite(retryAt) && retryAt > 0 ? retryAt : null;
}

/** Stops a retry before it can issue another Wahoo refresh request. */
export async function assertWahooRefreshAllowed(
  userID: string,
  nowMs = Date.now(),
): Promise<WahooRefreshLifecycleGuard> {
  const meta = await getServiceConnectionMeta(userID, ServiceNames.WahooAPI);
  if (isReconnectRequiredServiceConnection(meta)) {
    throw new WahooReconnectRequiredError();
  }

  const retryAt = getRetryAt(meta);
  if (retryAt !== null && retryAt > nowMs) {
    throw new WahooRefreshBackoffError(retryAt);
  }
  const connectionStateGeneration = typeof meta?.connectionStateGeneration === 'string'
    && meta.connectionStateGeneration.trim()
    ? meta.connectionStateGeneration
    : null;
  return { connectionStateGeneration };
}

/** Prevents use of a connection after its opaque refresh failures became terminal. */
export async function assertWahooConnectionAvailable(userID: string): Promise<void> {
  const meta = await getServiceConnectionMeta(userID, ServiceNames.WahooAPI);
  if (isReconnectRequiredServiceConnection(meta)) {
    throw new WahooReconnectRequiredError();
  }
}

export async function toWahooRefreshFailureError(
  userID: string,
  claim: WahooOpaqueRefreshFailureClaim,
): Promise<WahooRefreshBackoffError | WahooReconnectRequiredError> {
  const outcome = await recordWahooOpaqueRefreshFailure(userID, claim);
  if (outcome.stale) {
    // OAuth, disconnect, or a winning refresh replaced the claimed token while
    // Wahoo was responding. Do not overwrite its recovery state; the caller
    // retries against the current credential shortly.
    return new WahooRefreshBackoffError(Date.now() + 5_000);
  }
  if (outcome.reconnectRequired) {
    return new WahooReconnectRequiredError();
  }
  // A user deletion guard can decline the write. In that case leave a short
  // retryable pause rather than exposing a raw provider failure.
  return new WahooRefreshBackoffError(outcome.retryAt || Date.now() + 60_000);
}
