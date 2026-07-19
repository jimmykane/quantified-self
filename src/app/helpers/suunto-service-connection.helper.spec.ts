import { describe, expect, it } from 'vitest';
import { buildSuuntoServiceConnectionViewModel } from './suunto-service-connection.helper';

describe('suunto-service-connection.helper', () => {
  it('builds the default connected-state copy when reconnect is not required', () => {
    const result = buildSuuntoServiceConnectionViewModel({
      hasToken: true,
      serviceMeta: null,
    });

    expect(result).toMatchObject({
      connected: true,
      reconnectRequired: false,
      showDetails: true,
      description: 'Required for activity history imports, route imports, and Suunto uploads.',
      failureMessage: null,
      statusTone: 'default',
      connectButtonLabel: 'Connect',
      reconnectPromptSource: 'suunto-reconnect-required:unknown',
    });
  });

  it('builds reconnect-required state from service meta', () => {
    const result = buildSuuntoServiceConnectionViewModel({
      hasToken: false,
      serviceMeta: {
        connectionState: 'reconnect_required',
        lastAuthFailureMessage: 'invalid_grant',
        lastDisconnectedAt: 123,
      } as any,
    });

    expect(result).toMatchObject({
      connected: false,
      reconnectRequired: true,
      showDetails: true,
      description: 'Reconnect Suunto to resume sleep sync, activity history imports, route imports, and uploads. Automatic activity sync from Garmin and COROS stays off until you turn it on again.',
      failureMessage: 'invalid_grant',
      statusLabelOverride: 'Reconnect required',
      statusIconOverride: 'sync_problem',
      statusTone: 'attention',
      connectButtonLabel: 'Reconnect',
      reconnectPromptSource: 'suunto-reconnect-required:123',
    });
  });

  it('treats disconnect-pending state as not connected even when a token exists', () => {
    const result = buildSuuntoServiceConnectionViewModel({
      hasToken: true,
      serviceMeta: {
        connectionState: 'disconnect_pending',
      } as any,
    });

    expect(result).toMatchObject({
      connected: false,
      reconnectRequired: false,
      disconnectPending: true,
      showDetails: true,
      statusLabelOverride: 'Disconnect pending',
      statusIconOverride: 'sync_problem',
      statusTone: 'attention',
    });
  });

  it('builds manual-review disconnect state with reconnect copy', () => {
    const result = buildSuuntoServiceConnectionViewModel({
      hasToken: true,
      serviceMeta: {
        connectionState: 'disconnect_pending',
        disconnectManualReviewRequired: true,
      } as any,
    });

    expect(result).toMatchObject({
      connected: false,
      disconnectPending: true,
      disconnectManualReviewRequired: true,
      description: 'Suunto disconnect retries have stopped. Reconnect Suunto to refresh this connection, or contact support if the old connection still appears in Suunto.',
      statusLabelOverride: 'Reconnect needed',
      connectButtonLabel: 'Reconnect',
    });
  });
});
