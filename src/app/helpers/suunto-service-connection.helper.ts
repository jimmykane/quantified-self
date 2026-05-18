import { SERVICE_CONNECTION_STATES } from '@shared/service-connection';
import { AppUserServiceMetaInterface } from '../models/app-user.interface';
import { buildReconnectSuuntoServicePromptSource } from './dashboard-action-prompt.helper';

export interface SuuntoServiceConnectionViewModel {
  connected: boolean;
  reconnectRequired: boolean;
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
  const connected = options.hasToken || options.forceConnected === true;
  const reconnectRequired = options.serviceMeta?.connectionState === SERVICE_CONNECTION_STATES.ReconnectRequired;

  return {
    connected,
    reconnectRequired,
    showDetails: connected || reconnectRequired,
    description: reconnectRequired
      ? 'Reconnect Suunto to resume sleep sync, history imports, and FIT uploads. If you use Garmin or COROS auto-sync into Suunto, re-enable those routes after reconnecting.'
      : 'Required for history imports and FIT activity uploads.',
    failureMessage: options.serviceMeta?.lastAuthFailureMessage || null,
    statusLabelOverride: reconnectRequired ? 'Reconnect required' : null,
    statusIconOverride: reconnectRequired ? 'sync_problem' : null,
    statusTone: reconnectRequired ? 'attention' : 'default',
    connectButtonLabel: reconnectRequired ? 'Reconnect' : 'Connect',
    reconnectPromptSource: buildReconnectSuuntoServicePromptSource(options.serviceMeta?.lastDisconnectedAt),
  };
}
