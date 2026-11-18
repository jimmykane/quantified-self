import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import webpush from 'web-push';
import { SECRET_PARAMS } from '../secrets';
import { sendActivitySyncNotifications } from './activity';
import { sendActivityNotification } from './activity-service';
import { sendSleepNotification } from './sleep-service';
import { sendConnectionNotification } from './connection-service';
import { sendTrainingSendResult } from './training-send-service';
import { sendDeliveryNotification } from './delivery-service';
import { sendTrainingNotification } from './training-service';
import { automaticPushConfiguration } from './history-consent';
const mocks = vi.hoisted(() => ({ get: vi.fn(), log: vi.fn(), warn: vi.fn(), limit: vi.fn(), select: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collectionGroup: () => ({ where: () => ({ orderBy: () => ({
  limit: (limit: number) => { mocks.limit(limit); return { select: (...fields: string[]) => { mocks.select(fields); return { get: mocks.get }; } }; },
}) }) }) }) }));
vi.mock('firebase-functions/logger', () => ({ info: mocks.log, error: mocks.log, warn: mocks.warn }));
vi.mock('./history-consent', () => ({ automaticPushConfiguration: vi.fn() }));
vi.mock('./delivery-service', () => ({ sendDeliveryNotification: vi.fn() }));
vi.mock('./training-service', () => ({ sendTrainingNotification: vi.fn() }));
vi.mock('./activity-service', () => ({ sendActivityNotification: vi.fn() }));
vi.mock('./sleep-service', () => ({ sendSleepNotification: vi.fn() }));
vi.mock('./connection-service', () => ({ sendConnectionNotification: vi.fn() }));
vi.mock('./training-send-service', () => ({ sendTrainingSendResult: vi.fn() }));
vi.mock('web-push', async original => ({ default: { ...(await original<{ default: typeof webpush }>()).default, sendNotification: vi.fn().mockResolvedValue({}) } }));
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(sendDeliveryNotification).mockResolvedValue(); vi.mocked(sendTrainingNotification).mockResolvedValue(); vi.mocked(sendActivityNotification).mockResolvedValue();
  vi.mocked(sendSleepNotification).mockResolvedValue();
  vi.mocked(sendConnectionNotification).mockResolvedValue();
  vi.mocked(sendTrainingSendResult).mockResolvedValue();
  mocks.get.mockResolvedValue({ empty: true, docs: [] }); vi.mocked(automaticPushConfiguration).mockResolvedValue({ enabled: false, publicKey: '' });
});
afterEach(() => vi.restoreAllMocks());
const run = () => sendActivitySyncNotifications.run({} as never);
describe('one shared notification worker', () => {
  it('uses one masked queue query when idle, without configuration or signing-key reads', async () => {
    const secret = vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value');
    await run();
    expect(automaticPushConfiguration).not.toHaveBeenCalled(); expect(secret).not.toHaveBeenCalled();
    expect(mocks.limit.mock.calls).toEqual([[25]]); expect(mocks.select.mock.calls).toEqual([[['dueAt']]]);
    expect(mocks.log).toHaveBeenCalledWith('[ActivitySyncPushSweep]', { telemetryVersion: 1, oldestDueAgeSeconds: 0 });
  });
  it.each([
    ['activitySync', sendActivityNotification, 'web_push_activity_sync_enabled', 'qs-activity-sync'],
    ['activityDelivery', sendDeliveryNotification, 'web_push_activity_delivery_enabled', 'qs-activity-delivery'],
    ['trainingSync', sendTrainingNotification, 'web_push_training_sync_enabled', 'qs-training-sync'],
    ['sleepReady', sendSleepNotification, 'web_push_sleep_sync_enabled', 'qs-sleep-sync'],
    ['connectionAttention', sendConnectionNotification, 'web_push_connection_attention_enabled', 'qs-connection-attention'],
    ['trainingSend_plan_p_garmin', sendTrainingSendResult, 'web_push_training_sync_enabled', undefined],
  ] as const)('dispatches %s with only its own configuration and caches it across accounts', async (name, sender, flag, topic) => {
    const pair = webpush.generateVAPIDKeys(); const secret = vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value').mockReturnValue(JSON.stringify(pair));
    vi.mocked(automaticPushConfiguration).mockResolvedValue({ enabled: true, publicKey: pair.publicKey });
    mocks.get.mockResolvedValueOnce({ docs: ['one', 'two'].map(uid => ({ ref: { path: `users/${uid}/pushState/${name}` } })) });
    (sender as ReturnType<typeof vi.fn>).mockImplementation(async (...args: unknown[]) => {
      const deps = args.at(-1) as Parameters<typeof sendActivityNotification>[1];
      expect((await deps.configuration()).enabled).toBe(true);
      await deps.send({ endpoint: 'https://web.push.apple.com/synthetic' } as never, 'payload');
    });
    await run(); expect(sender).toHaveBeenCalledTimes(2); expect(automaticPushConfiguration).toHaveBeenCalledExactlyOnceWith(flag);
    expect(secret).toHaveBeenCalledOnce();
    expect(webpush.sendNotification).toHaveBeenCalledWith(expect.anything(), 'payload', {
      vapidDetails: { subject: 'mailto:support@quantified-self.io', ...pair }, TTL: 600, timeout: 5000, urgency: 'low', ...(topic ? { topic } : {}),
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it('retains safe Remote Config diagnostics once per affected category', async () => {
    mocks.get.mockResolvedValueOnce({ docs: ['one', 'two'].map(uid => ({ ref: { path: `users/${uid}/pushState/activityDelivery` } })) });
    vi.mocked(automaticPushConfiguration).mockRejectedValueOnce(Object.assign(
      new Error('Unexpected response with status: 502 and body: private-canary'), { code: 'remote-config/unknown-error' }));
    vi.mocked(sendDeliveryNotification).mockImplementation(async (_uid, deps) => { await deps.configuration(); });
    await expect(run()).rejects.toThrow('Notification sweep failed.');
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith('[WebPushConfiguration]', expect.objectContaining({
      category: 'delivery', errorCode: 'remote-config/unknown-error', configurationFailureKind: 'non_json_response', upstreamHttpStatus: 502,
    }));
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('private-canary');
  });
  it('does not read the signing key for disabled work', async () => {
    const secret = vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value');
    mocks.get.mockResolvedValueOnce({ docs: [{ ref: { path: 'users/owner/pushState/activitySync' } }] });
    vi.mocked(sendActivityNotification).mockImplementation(async (_uid, deps) => { expect((await deps.configuration()).enabled).toBe(false); });
    await run(); expect(secret).not.toHaveBeenCalled(); expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
  it('continues other categories after a failure and preserves its safe error code', async () => {
    mocks.get.mockResolvedValueOnce({ docs: ['activitySync', 'activityDelivery', 'trainingSync'].map(name => ({ ref: { path: `users/owner/pushState/${name}` } })) });
    vi.mocked(sendDeliveryNotification).mockRejectedValue(Object.assign(new Error('private-canary'), { code: 14 }));
    await expect(run()).rejects.toThrow('Notification sweep failed.');
    expect(sendActivityNotification).toHaveBeenCalledOnce(); expect(sendTrainingNotification).toHaveBeenCalledOnce();
    expect(mocks.log).toHaveBeenCalledWith('[ActivitySyncPush]', { telemetryVersion: 1, phase: 'sweep', outcome: 'failed', failureStage: 'account_processing', errorCode: 'unavailable' });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private-canary');
  });
  it.each(['due_query', 'backlog_probe'])('classifies a failed %s without exposing raw errors', async stage => {
    if (stage === 'backlog_probe') mocks.get.mockResolvedValueOnce({ docs: [{ ref: { path: 'users/owner/pushState/activitySync' } }] });
    mocks.get.mockRejectedValueOnce(Object.assign(new Error('private-canary'), { code: 4 }));
    await expect(run()).rejects.toThrow('Notification sweep failed.');
    expect(mocks.log).toHaveBeenCalledWith('[ActivitySyncPush]', { telemetryVersion: 1, phase: 'sweep', outcome: 'failed', failureStage: stage, errorCode: 'deadline-exceeded' });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private-canary');
  });
});
