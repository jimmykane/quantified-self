import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import webpush from 'web-push';
import { SECRET_PARAMS } from '../secrets';
import { sendTrainingSyncNotifications } from './training';
import { sendTrainingNotification } from './training-service';
import { automaticPushConfiguration } from './history-consent';
const mocks = vi.hoisted(() => ({ get: vi.fn(), log: vi.fn(), limit: vi.fn(), select: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collectionGroup: () => ({ where: () => ({ orderBy: () => ({
  limit: (limit: number) => { mocks.limit(limit); return { select: (...fields: string[]) => { mocks.select(fields); return { get: mocks.get }; } }; },
}) }) }) }) }));
vi.mock('firebase-functions/logger', () => ({ info: mocks.log, error: mocks.log }));
vi.mock('./history-consent', () => ({ automaticPushConfiguration: vi.fn() }));
vi.mock('./training-service', () => ({ sendTrainingNotification: vi.fn() }));
vi.mock('web-push', async original => ({ default: { ...(await original<{ default: typeof webpush }>()).default, sendNotification: vi.fn().mockResolvedValue({}) } }));
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(sendTrainingNotification).mockResolvedValue();
  mocks.get.mockResolvedValue({ empty: true, docs: [] }); vi.mocked(automaticPushConfiguration).mockResolvedValue({ enabled: false, publicKey: '' });
});
afterEach(() => vi.restoreAllMocks());
const run = () => sendTrainingSyncNotifications.run({} as never);
describe('bounded training sync notification scheduler', () => {
  it('emits an idle heartbeat, uses masked indexed bounded queries and does not read the secret while disabled', async () => {
    const secret = vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value'); await run();
    expect(secret).not.toHaveBeenCalled(); expect(mocks.limit.mock.calls).toEqual([[25], [1]]);
    expect(mocks.select.mock.calls).toEqual([[['trainingDueAt']], [['trainingDueAt']]]);
    expect(mocks.log).toHaveBeenCalledWith('[TrainingSyncPushSweep]', { telemetryVersion: 1, enabled: false, oldestDueAgeSeconds: 0 });
    expect(sendTrainingNotification).not.toHaveBeenCalled();
  });
  it.each(['https://web.push.apple.com/synthetic', 'https://test.notify.windows.com/synthetic'])('sends with bounded declarative transport to %s', async endpoint => {
    const pair = webpush.generateVAPIDKeys(); vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value').mockReturnValue(JSON.stringify(pair));
    vi.mocked(automaticPushConfiguration).mockResolvedValue({ enabled: true, publicKey: pair.publicKey });
    mocks.get.mockResolvedValueOnce({ docs: [{ ref: { path: 'users/owner/pushState/trainingSync' } }, { ref: { path: 'unrelated/owner/pushState/trainingSync' } }] });
    await run(); expect(sendTrainingNotification).toHaveBeenCalledOnce(); const [uid, deps] = vi.mocked(sendTrainingNotification).mock.calls[0];
    expect(uid).toBe('owner'); await deps.send({ endpoint } as never, 'payload');
    expect(webpush.sendNotification).toHaveBeenCalledWith({ endpoint }, 'payload', {
      vapidDetails: { subject: 'mailto:support@quantified-self.io', ...pair }, TTL: 600, timeout: 5000, urgency: 'low', topic: 'qs-training-sync',
      ...(endpoint.includes('windows') ? { headers: { 'X-WNS-Type': 'wns/raw', 'X-WNS-TTL': '600' } } : {}),
    });
  });
  it('rejects mismatched keys before claiming work', async () => {
    vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value').mockReturnValue(JSON.stringify(webpush.generateVAPIDKeys()));
    vi.mocked(automaticPushConfiguration).mockResolvedValue({ enabled: true, publicKey: 'different' });
    await expect(run()).rejects.toThrow('Training sync notification sweep failed.'); expect(sendTrainingNotification).not.toHaveBeenCalled();
  });
  it('isolates per-account preparation failure and reports unknown health rather than a healthy heartbeat', async () => {
    mocks.get.mockResolvedValueOnce({ docs: ['one', 'two'].map(uid => ({ ref: { path: `users/${uid}/pushState/trainingSync` } })) });
    vi.mocked(sendTrainingNotification).mockImplementation(async uid => { if (uid === 'one') throw new Error('private-canary'); });
    await expect(run()).rejects.toThrow('Training sync notification sweep failed.'); expect(sendTrainingNotification).toHaveBeenCalledTimes(2);
    expect(mocks.log).toHaveBeenCalledWith('[TrainingSyncPush]', { telemetryVersion: 1, phase: 'sweep', outcome: 'failed',
      failureStage: 'account_processing', errorCode: 'unknown' });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/private-canary|TrainingSyncPushSweep/);
  });
});
