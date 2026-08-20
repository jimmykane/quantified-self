export const SERVICE_CONNECTION_STATES = {
  Connected: 'connected',
  ReconnectRequired: 'reconnect_required',
  DisconnectPending: 'disconnect_pending',
} as const;

export type ServiceConnectionState = typeof SERVICE_CONNECTION_STATES[keyof typeof SERVICE_CONNECTION_STATES];
export type ProviderBindingState = 'bound' | 'unbound';

export interface ServiceConnectionMetaFields {
  connectionState?: ServiceConnectionState | null;
  /**
   * A display-only stable identifier supplied by the connected provider.
   * Never use this field for OAuth credentials, access tokens, or refresh tokens.
   */
  providerUserId?: string | null;
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
  routeRestoreConnectionGeneration?: string | null;
  routeRestoreLastAttemptAt?: number | null;
  routeRestoreAttemptCount?: number | null;
  /** Server-owned Wahoo refresh recovery state. Never stores OAuth values. */
  wahooRefreshFailureCount?: number | null;
  wahooRefreshFailureLastAt?: number | null;
  wahooRefreshRetryAt?: number | null;
  /** Server-owned repair marker for a partially completed reconnect queue release. */
  wahooReconnectReleasePending?: boolean | null;
  wahooReconnectReleaseLastAttemptAt?: number | null;
  wahooReconnectReleaseAttemptCount?: number | null;
  wahooReconnectReleaseConnectionGeneration?: string | null;
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
