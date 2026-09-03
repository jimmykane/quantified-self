export const SERVICE_CONNECTION_STATES = {
  Connected: 'connected',
  ReconnectRequired: 'reconnect_required',
  DisconnectPending: 'disconnect_pending',
} as const;

export type ServiceConnectionState = typeof SERVICE_CONNECTION_STATES[keyof typeof SERVICE_CONNECTION_STATES];
export type ProviderBindingState = 'bound' | 'unbound';

/**
 * Browser-safe account information derived by the backend from an OAuth token
 * document. This projection must never contain credentials or lifecycle
 * generations. Provider identifiers are included only where the connection UX
 * needs to distinguish retained accounts.
 */
export interface ServiceConnectionAccountProjection {
  providerUserId?: string;
  connectedAtMs?: number;
  permissions?: string[];
  permissionsUpdatedAtMs?: number;
}

export const SERVICE_DISCONNECT_RETRY_REASON = 'service_disconnect_in_progress' as const;

export const SERVICE_DISCONNECT_RETRY_BLOCKERS = {
  TokenRefresh: 'token_refresh',
  DisconnectOperation: 'disconnect_operation',
} as const;

export type ServiceDisconnectRetryBlocker = typeof SERVICE_DISCONNECT_RETRY_BLOCKERS[keyof typeof SERVICE_DISCONNECT_RETRY_BLOCKERS];

export interface ServiceDisconnectRetryDetails {
  reason: typeof SERVICE_DISCONNECT_RETRY_REASON;
  blocker: ServiceDisconnectRetryBlocker;
  retryAt: number;
  retryDeadlineAt: number;
}

export interface ServiceConnectionMetaFields {
  connectionState?: ServiceConnectionState | null;
  /**
   * A display-only stable identifier supplied by the connected provider.
   * Never use this field for OAuth credentials, access tokens, or refresh tokens.
   */
  providerUserId?: string | null;
  /** Browser-safe account summaries; OAuth documents remain server-only. */
  connectionAccounts?: ServiceConnectionAccountProjection[];
  /** Monotonic nanosecond-precision event key used to reject out-of-order projection triggers. */
  connectionAccountsRevisionKey?: string | null;
  providerBindingState?: ProviderBindingState | null;
  providerBindingCheckedAt?: number | null;
  providerBindingCheckLeaseId?: string | null;
  providerBindingCheckLeaseExpiresAt?: number | null;
  providerBindingCheckNextRetryAt?: number | null;
  lastAuthFailureCode?: string | null;
  lastAuthFailureMessage?: string | null;
  lastDisconnectedAt?: number | null;
  /** Server-owned generation for the latest connection-state transition. */
  connectionStateGeneration?: string | null;
  /** Server-owned generation for the active pending-disconnect episode. */
  disconnectGeneration?: string | null;
  /** Durable provider-neutral repair marker for route restoration. */
  routeRestorePending?: boolean | null;
  /** True after new route-restore deferrals have been transactionally fenced. */
  routeRestoreParkingClosed?: boolean | null;
  routeRestoreConnectionGeneration?: string | null;
  routeRestoreLastAttemptAt?: number | null;
  routeRestoreAttemptCount?: number | null;
  /** Durable provider Health repair marker for the derived lifecycle state. */
  healthLifecycleProjectionPending?: boolean | null;
  healthLifecycleProjectionConnectionGeneration?: string | null;
  healthLifecycleProjectionTransitionAtMs?: number | null;
  /** Server-owned Wahoo refresh recovery state. Never stores OAuth values. */
  wahooRefreshFailureCount?: number | null;
  wahooRefreshFailureLastAt?: number | null;
  wahooRefreshRetryAt?: number | null;
  /** Server-owned repair marker for a partially completed reconnect queue release. */
  wahooReconnectReleasePending?: boolean | null;
  wahooReconnectReleaseLastAttemptAt?: number | null;
  wahooReconnectReleaseAttemptCount?: number | null;
  wahooReconnectReleaseConnectionGeneration?: string | null;
  /** Server-owned repair marker for a bounded pending-disconnect queue release. */
  pendingDisconnectQueueReleasePending?: boolean | null;
  pendingDisconnectQueueReleaseLastAttemptAt?: number | null;
  pendingDisconnectQueueReleaseAttemptCount?: number | null;
  pendingDisconnectQueueReleaseGeneration?: string | null;
  disconnectReason?: string | null;
  disconnectAttemptCount?: number | null;
  disconnectNextAttemptAt?: unknown | null;
  disconnectLastAttemptAt?: unknown | null;
  disconnectRetryExpiresAt?: unknown | null;
  disconnectLastStatusCode?: number | null;
  disconnectLastErrorMessage?: string | null;
  disconnectManualReviewRequired?: boolean | null;
}

export function isReconnectRequiredServiceConnection(value: Pick<ServiceConnectionMetaFields, 'connectionState'> | null | undefined): boolean {
  return value?.connectionState === SERVICE_CONNECTION_STATES.ReconnectRequired;
}

export function isDisconnectPendingServiceConnection(value: Pick<ServiceConnectionMetaFields, 'connectionState'> | null | undefined): boolean {
  return value?.connectionState === SERVICE_CONNECTION_STATES.DisconnectPending;
}

export function isServiceUnavailableForSyncConnection(value: Pick<ServiceConnectionMetaFields, 'connectionState'> | null | undefined): boolean {
  return isReconnectRequiredServiceConnection(value) || isDisconnectPendingServiceConnection(value);
}
