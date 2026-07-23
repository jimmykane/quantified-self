export const SERVICE_CONNECTION_STATES = {
  Connected: 'connected',
  ReconnectRequired: 'reconnect_required',
  DisconnectPending: 'disconnect_pending',
} as const;

export type ServiceConnectionState = typeof SERVICE_CONNECTION_STATES[keyof typeof SERVICE_CONNECTION_STATES];

export interface ServiceConnectionMetaFields {
  connectionState?: ServiceConnectionState | null;
  /**
   * A display-only stable identifier supplied by the connected provider.
   * Never use this field for OAuth credentials, access tokens, or refresh tokens.
   */
  providerUserId?: string | null;
  lastAuthFailureCode?: string | null;
  lastAuthFailureMessage?: string | null;
  lastDisconnectedAt?: number | null;
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
