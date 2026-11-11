import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { SECRET_PARAMS } from '../secrets';
import { automaticPushConfiguration } from './history-consent';
import { sendActivityDeliveryNotifications } from './delivery';
import { sendDeliveryNotification } from './delivery-service';
import { sendTrainingSyncNotifications } from './training';
import { sendTrainingNotification } from './training-service';
import { notificationSweepErrorCode } from './sweep-diagnostics';

const mocks = vi.hoisted(() => ({ get: vi.fn(), log: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collectionGroup: () => ({
  where: () => ({ orderBy: () => ({ limit: () => ({ select: () => ({ get: mocks.get }) }) }) }),
}) }) }));
vi.mock('firebase-functions/logger', () => ({ info: mocks.log, error: mocks.log }));
vi.mock('./history-consent', () => ({ automaticPushConfiguration: vi.fn() }));
vi.mock('./delivery-service', () => ({ sendDeliveryNotification: vi.fn() }));
vi.mock('./training-service', () => ({ sendTrainingNotification: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ empty: true, docs: [] });
  vi.mocked(automaticPushConfiguration).mockResolvedValue({ enabled: false, publicKey: '' });
  vi.mocked(sendDeliveryNotification).mockResolvedValue();
  vi.mocked(sendTrainingNotification).mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

describe('notification sweep error-code privacy', () => {
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
    expect(mocks.log).toHaveBeenCalledWith(tag, { telemetryVersion: 1, phase: 'sweep', outcome: 'failed', failureStage, errorCode });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/private-|Sweep/);
  };

  it('identifies configuration failures without logging private error contents', async () => {
    vi.mocked(automaticPushConfiguration).mockRejectedValueOnce(privateError());
    await expect(run()).rejects.toThrow(failure);
    assertFailure('configuration'); expect(mocks.get).not.toHaveBeenCalled();
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
