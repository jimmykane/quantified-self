import { describe, expect, it } from 'vitest';
import { notificationSweepErrorCode, notificationConfigurationFailureDetails } from './sweep-diagnostics';

describe('notification sweep error-code privacy', () => {
  it.each([
    ['remote-config/resource-exhausted', 'Quota exceeded for quota metric private-quota-canary', { configurationFailureKind: 'resource_exhausted', explicitQuotaExceeded: true }],
    ['remote-config/resource-exhausted', 'private-message-canary', { configurationFailureKind: 'resource_exhausted', explicitQuotaExceeded: false }],
    ['remote-config/unknown-error', 'Unexpected response with status: 502 and body: private-body-canary', { configurationFailureKind: 'non_json_response', upstreamHttpStatus: 502 }],
    ['remote-config/unknown-error', 'Unexpected response with status: 200 and body: private-body-canary', { configurationFailureKind: 'unknown' }],
    ['remote-config/internal-error', 'private-message-canary', { configurationFailureKind: 'upstream_internal' }],
    ['app/network-timeout', 'private-message-canary', { configurationFailureKind: 'transport' }],
  ])('classifies configuration failure %s without emitting its message', (code, message, expected) => {
    const error = { code, message, headers: { authorization: 'private-token-canary' }, toJSON: () => { throw new Error('private-json-canary'); } };
    const details = notificationConfigurationFailureDetails(error, 1234.4);
    expect(details).toEqual({ configurationOperation: 'get_client_template', configurationElapsedMs: 1234, ...expected });
    expect(JSON.stringify(details)).not.toContain('private-');
  });

  it('bounds elapsed time and tolerates hostile errors', () => {
    expect(notificationConfigurationFailureDetails(null, Infinity).configurationElapsedMs).toBe(0);
    expect(notificationConfigurationFailureDetails(null, -1).configurationElapsedMs).toBe(0);
    expect(notificationConfigurationFailureDetails(null, 1_000_000).configurationElapsedMs).toBe(120_000);
    expect(notificationConfigurationFailureDetails({ get code() { throw new Error('private-code'); } }, 1).configurationFailureKind).toBe('unknown');
    expect(notificationConfigurationFailureDetails({ code: 'remote-config/unknown-error', get message() { throw new Error('private-message'); } }, 1).configurationFailureKind).toBe('unknown');
  });
  it.each([
    [{ code: 14 }, 'unavailable'], [{ code: '14' }, 'unavailable'],
    [{ code: 'DEADLINE_EXCEEDED' }, 'deadline-exceeded'], [{ code: 'firestore/permission-denied' }, 'permission-denied'],
    [{ code: 'remote-config/internal-error' }, 'remote-config/internal-error'],
    [{ code: 'remote-config/resource-exhausted' }, 'remote-config/resource-exhausted'],
    [{ code: 'app/network-error' }, 'app/network-error'], [{ code: 'ETIMEDOUT' }, 'ETIMEDOUT'],
    [{ code: 503 }, 'http-503'], [{ statusCode: 429 }, 'http-429'], [{ status: 403 }, 'http-403'],
    [{ code: 'private-code-canary', statusCode: 500 }, 'http-500'],
    [{ code: 'private-code-canary' }, 'unknown'], [{ code: -1 }, 'unknown'], [{ code: 14.5 }, 'unknown'],
    [{ code: 'private/deadline-exceeded' }, 'unknown'], [{ statusCode: 'private-status-canary' }, 'unknown'],
    [{ statusCode: 200 }, 'unknown'], [{}, 'unknown'], [null, 'unknown'], ['private-error-canary', 'unknown'],
  ])('projects only an allowlisted code from %j', (error, expected) => {
    expect(notificationSweepErrorCode(error)).toBe(expected);
  });

  it('does not serialize error payloads or allow diagnostics to replace a failure', () => {
    const error = { code: 14, message: 'private-message-canary', stack: 'private-stack-canary',
      endpoint: 'https://web.push.apple.com/private-endpoint-canary', payload: 'private-payload-canary',
      toJSON: () => { throw new Error('private-json-canary'); } };
    expect(notificationSweepErrorCode(error)).toBe('unavailable');
    expect(notificationSweepErrorCode({ get code() { throw new Error('private-getter-canary'); } })).toBe('unknown');
  });
});
