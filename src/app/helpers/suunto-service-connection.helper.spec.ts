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
      description: 'Required for activity history imports, route sync, and Suunto uploads.',
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
      description: 'Reconnect Suunto to resume sleep sync, activity history imports, route sync, and uploads. If you use Garmin or COROS auto-sync into Suunto, re-enable those routes after reconnecting.',
      failureMessage: 'invalid_grant',
      statusLabelOverride: 'Reconnect required',
      statusIconOverride: 'sync_problem',
      statusTone: 'attention',
      connectButtonLabel: 'Reconnect',
      reconnectPromptSource: 'suunto-reconnect-required:123',
    });
  });
});
