import {
  isDisconnectPendingServiceConnection,
  SERVICE_CONNECTION_STATES,
} from '@shared/service-connection';
import { AppUserServiceMetaInterface } from '../models/app-user.interface';
import { buildReconnectSuuntoServicePromptSource } from './dashboard-action-prompt.helper';

export interface SuuntoServiceConnectionViewModel {
  connected: boolean;
  reconnectRequired: boolean;
  disconnectPending: boolean;
  showDetails: boolean;
  description: string;
  failureMessage: string | null;
  statusLabelOverride: string | null;
  statusIconOverride: string | null;
  statusTone: 'default' | 'attention';
  connectButtonLabel: string;
  reconnectPromptSource: string;
}

export function buildSuuntoServiceConnectionViewModel(options: {
  hasToken: boolean;
  forceConnected?: boolean;
  serviceMeta?: AppUserServiceMetaInterface | null | undefined;
}): SuuntoServiceConnectionViewModel {
  const disconnectPending = isDisconnectPendingServiceConnection(options.serviceMeta);
  const connected = !disconnectPending && (options.hasToken || options.forceConnected === true);
  const reconnectRequired = options.serviceMeta?.connectionState === SERVICE_CONNECTION_STATES.ReconnectRequired;

  return {
    connected,
    reconnectRequired,
    disconnectPending,
    showDetails: connected || reconnectRequired || disconnectPending,
    description: disconnectPending
      ? 'Disconnect is pending while the partner service finishes deauthorization. Sync and imports are paused for this connection.'
      : reconnectRequired
      ? 'Reconnect Suunto to resume sleep sync, activity history imports, route sync, and uploads. If you use Garmin or COROS auto-sync into Suunto, re-enable those routes after reconnecting.'
      : 'Required for activity history imports, route sync, and Suunto uploads.',
    failureMessage: options.serviceMeta?.lastAuthFailureMessage || null,
    statusLabelOverride: disconnectPending ? 'Disconnect pending' : reconnectRequired ? 'Reconnect required' : null,
    statusIconOverride: disconnectPending ? 'sync_problem' : reconnectRequired ? 'sync_problem' : null,
    statusTone: disconnectPending || reconnectRequired ? 'attention' : 'default',
    connectButtonLabel: reconnectRequired ? 'Reconnect' : 'Connect',
    reconnectPromptSource: buildReconnectSuuntoServicePromptSource(options.serviceMeta?.lastDisconnectedAt),
  };
}
