import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { SECRET_PARAMS } from '../secrets';
import { automaticPushConfiguration } from './history-consent';
import { sendActivitySyncNotifications } from './activity';
import { sendActivityNotification } from './activity-service';
import { sendActivityDeliveryNotifications } from './delivery';
import { sendDeliveryNotification } from './delivery-service';
import { sendTrainingSyncNotifications } from './training';
import { sendTrainingNotification } from './training-service';
import { notificationConfigurationFailureDetails, notificationSweepErrorCode } from './sweep-diagnostics';

const mocks = vi.hoisted(() => ({ get: vi.fn(), log: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collectionGroup: () => ({
  where: () => ({ orderBy: () => ({ limit: () => ({ select: () => ({ get: mocks.get }) }) }) }),
}) }) }));
vi.mock('firebase-functions/logger', () => ({ info: mocks.log, error: mocks.log }));
vi.mock('./history-consent', () => ({ automaticPushConfiguration: vi.fn() }));
vi.mock('./activity-service', () => ({ sendActivityNotification: vi.fn() }));
vi.mock('./delivery-service', () => ({ sendDeliveryNotification: vi.fn() }));
vi.mock('./training-service', () => ({ sendTrainingNotification: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ empty: true, docs: [] });
  vi.mocked(automaticPushConfiguration).mockResolvedValue({ enabled: false, publicKey: '' });
  vi.mocked(sendActivityNotification).mockResolvedValue();
  vi.mocked(sendDeliveryNotification).mockResolvedValue();
  vi.mocked(sendTrainingNotification).mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

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

describe.each([
  { name: 'activity', scheduler: sendActivitySyncNotifications, prepare: sendActivityNotification,
    state: 'activitySync', tag: '[ActivitySyncPush]', failure: 'Activity sync notification sweep failed.' },
  { name: 'delivery', scheduler: sendActivityDeliveryNotifications, prepare: sendDeliveryNotification,
    state: 'activityDelivery', tag: '[ActivityDeliveryPush]', failure: 'Activity delivery notification sweep failed.' },
  { name: 'training', scheduler: sendTrainingSyncNotifications, prepare: sendTrainingNotification,
    state: 'trainingSync', tag: '[TrainingSyncPush]', failure: 'Training sync notification sweep failed.' },
])('$name scheduler diagnostics', ({ scheduler, prepare, state, tag, failure }) => {
  const run = () => scheduler.run({} as never);
  const privateError = () => Object.assign(new Error('private-message-canary https://example.test/private-endpoint-canary'),
    { code: 14, payload: 'private-payload-canary', uid: 'private-user-canary' });
  const assertFailure = (failureStage: string, errorCode = 'unavailable') => {
    expect(mocks.log).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith(tag, { telemetryVersion: 1, phase: 'sweep', outcome: 'failed', failureStage, errorCode,
      ...(failureStage === 'configuration' ? { configurationOperation: 'get_client_template', configurationElapsedMs: expect.any(Number),
        configurationFailureKind: errorCode === 'remote-config/internal-error' ? 'upstream_internal' : 'unknown' } : {}) });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/private-|Sweep/);
  };

  it.each([
    [14, 'unavailable'],
    ['remote-config/internal-error', 'remote-config/internal-error'],
  ])('identifies configuration failure %s without logging private error contents', async (code, expected) => {
    vi.mocked(automaticPushConfiguration).mockRejectedValueOnce(Object.assign(privateError(), { code }));
    await expect(run()).rejects.toThrow(failure);
    assertFailure('configuration', expected); expect(mocks.get).not.toHaveBeenCalled();
  });
  it('includes quota classification for configuration failures and preserves the failed invocation', async () => {
    vi.mocked(automaticPushConfiguration).mockRejectedValueOnce(Object.assign(privateError(), {
      code: 'remote-config/resource-exhausted', message: 'Quota exceeded for quota metric private-quota-canary',
    }));
    await expect(run()).rejects.toThrow(failure);
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith(tag, { telemetryVersion: 1, phase: 'sweep', outcome: 'failed',
      failureStage: 'configuration', errorCode: 'remote-config/resource-exhausted', configurationOperation: 'get_client_template',
      configurationElapsedMs: expect.any(Number), configurationFailureKind: 'resource_exhausted', explicitQuotaExceeded: true });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private-');
  });
  it('identifies invalid signing configuration without logging keys', async () => {
    vi.mocked(automaticPushConfiguration).mockResolvedValueOnce({ enabled: true, publicKey: 'private-public-key-canary' });
    vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value').mockReturnValue('private-secret-canary');
    await expect(run()).rejects.toThrow(failure);
    assertFailure('signing_key', 'failed-precondition'); expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each(['due_query', 'backlog_probe'])('identifies a failed %s without logging query or account data', async stage => {
    if (stage === 'backlog_probe') mocks.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mocks.get.mockRejectedValueOnce(privateError());
    await expect(run()).rejects.toThrow(failure);
    assertFailure(stage);
  });
  it.each([['private-user-canary', 'other'], ['other', 'private-user-canary']])('awaits both accounts when %s appears first', async (first, second) => {
    mocks.get.mockResolvedValueOnce({ docs: [first, second].map(uid => ({ ref: { path: `users/${uid}/pushState/${state}` } })) });
    let otherFinished = false;
    vi.mocked(prepare).mockImplementation(async uid => {
      if (uid === 'private-user-canary') throw privateError();
      await Promise.resolve(); otherFinished = true;
    });
    await expect(run()).rejects.toThrow(failure);
    expect(otherFinished).toBe(true); expect(prepare).toHaveBeenCalledTimes(2);
    assertFailure('account_processing'); expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('keeps the first rejection code when several accounts fail', async () => {
    mocks.get.mockResolvedValueOnce({ docs: ['first', 'second'].map(uid => ({ ref: { path: `users/${uid}/pushState/${state}` } })) });
    vi.mocked(prepare).mockImplementation(async uid => { throw Object.assign(privateError(), { code: uid === 'first' ? 4 : 14 }); });
    await expect(run()).rejects.toThrow(failure);
    assertFailure('account_processing', 'deadline-exceeded'); expect(prepare).toHaveBeenCalledTimes(2);
  });
});
