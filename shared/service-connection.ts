export const SERVICE_CONNECTION_STATES = {
  Connected: 'connected',
  ReconnectRequired: 'reconnect_required',
} as const;

export type ServiceConnectionState = typeof SERVICE_CONNECTION_STATES[keyof typeof SERVICE_CONNECTION_STATES];

export interface ServiceConnectionMetaFields {
  connectionState?: ServiceConnectionState | null;
  lastAuthFailureCode?: string | null;
  lastAuthFailureMessage?: string | null;
  lastDisconnectedAt?: number | null;
}

export function isReconnectRequiredServiceConnection(value: Pick<ServiceConnectionMetaFields, 'connectionState'> | null | undefined): boolean {
  return value?.connectionState === SERVICE_CONNECTION_STATES.ReconnectRequired;
}
