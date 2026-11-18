import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import type { SleepSession } from '../../../shared/sleep';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { notifyNewSleepAfterPersistence } from './sleep-admission';
import { admitSleepNotification, sendSleepNotification } from './sleep-service';
import { automaticPushConfiguration } from './history-consent';
const mocks = vi.hoisted(() => ({ template: vi.fn(), error: vi.fn(), history: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase-admin/remote-config', () => ({ getRemoteConfig: () => ({ getTemplate: mocks.template }) }));
vi.mock('firebase-functions/logger', () => ({ error: mocks.error }));
vi.mock('../connection-history/context', () => ({ currentHistoryExecution: mocks.history }));
vi.mock('./sleep-service', () => ({ admitSleepNotification: vi.fn(), sendSleepNotification: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); mocks.history.mockReturnValue(undefined); vi.mocked(admitSleepNotification).mockResolvedValue(); vi.mocked(sendSleepNotification).mockResolvedValue(); });
function input() {
  const now = Date.now();
  const queue = { id: 'queue', type: 'garmin_push', sleepNotificationOrigin: 'live', dateCreated: now } as SleepSyncQueueItemInterface;
  const session = { id: 'canonical', source: { provider: 'GarminAPI', providerUserId: 'account' },
    sleepDate: new Date(now).toISOString().slice(0, 10), startTimeMs: now - 8 * 3600000, endTimeMs: now - 60000,
    createdAtMs: now, isNap: false, durationSeconds: 28000 } as SleepSession;
  return { queue, session };
}
describe('post-persistence sleep admission', () => {
  it.each(['update', 'history', 'execution history', 'backfill', 'legacy', 'old sleep', 'nap'])('skips %s before configuration or database access', async kind => {
    const { queue, session } = input();
    if (kind === 'history') queue.connectionHistoryRunId = 'history';
    if (kind === 'execution history') mocks.history.mockReturnValue({});
    if (kind === 'backfill') queue.type = 'garmin_health_backfill';
    if (kind === 'legacy') delete queue.sleepNotificationOrigin;
    if (kind === 'old sleep') { session.endTimeMs -= 2 * 86400000; session.startTimeMs -= 2 * 86400000; }
    if (kind === 'nap') session.isNap = true;
    await notifyNewSleepAfterPersistence('owner', queue, kind === 'update' ? undefined : [session]);
    expect(admitSleepNotification).not.toHaveBeenCalled(); expect(mocks.template).not.toHaveBeenCalled();
  });
  it('admits only the newest eligible sleep in a multi-night poll', async () => {
    const { queue, session } = input();
    await notifyNewSleepAfterPersistence('owner', queue, [{ ...session, id: 'older', endTimeMs: session.endTimeMs - 3600000 }, session]);
    expect(admitSleepNotification).toHaveBeenCalledOnce();
    expect(sendSleepNotification).toHaveBeenCalledOnce();
    expect(admitSleepNotification).toHaveBeenCalledWith('owner', expect.objectContaining({ sessionId: 'canonical' }), queue, expect.anything());
  });
  it('keeps the successful import successful if notification preparation fails', async () => {
    const { queue, session } = input(); vi.mocked(admitSleepNotification).mockRejectedValue(new Error('private-canary'));
    await expect(notifyNewSleepAfterPersistence('owner', queue, [session])).resolves.toBeUndefined();
    expect(sendSleepNotification).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('[SleepSyncPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('private-canary');
  });
  it('keeps a committed import successful even if immediate sending fails', async () => {
    const { queue, session } = input(); vi.mocked(sendSleepNotification).mockRejectedValueOnce(new Error('private-canary'));
    await expect(notifyNewSleepAfterPersistence('owner', queue, [session])).resolves.toBeUndefined();
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('private-canary');
  });
  it.each(['missing', 'off', 'foundation off', 'conditional', 'enabled'])('requires both unconditional flags: %s', async kind => {
    const parameters: Record<string, any> = { web_push_enabled: { defaultValue: { value: kind === 'foundation off' ? 'false' : 'true' } },
      web_push_sleep_sync_enabled: { defaultValue: { value: kind === 'off' ? 'false' : 'true' } },
      web_push_vapid_public_key: { defaultValue: { value: 'public-key' } } };
    if (kind === 'missing') delete parameters.web_push_sleep_sync_enabled;
    if (kind === 'conditional') parameters.web_push_sleep_sync_enabled.conditionalValues = { beta: { value: 'true' } };
    mocks.template.mockResolvedValue({ parameters });
    await expect(automaticPushConfiguration('web_push_sleep_sync_enabled')).resolves.toEqual({ enabled: kind === 'enabled', publicKey: 'public-key' });
  });
});
