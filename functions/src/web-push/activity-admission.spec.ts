import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { notifyNewActivityAfterPersistence } from './activity-admission';
import { admitActivityNotification } from './activity-service';
import { automaticPushConfiguration } from './history-consent';
import type { QueueItemInterface } from '../queue/queue-item.interface';
const mocks = vi.hoisted(() => ({ template: vi.fn(), error: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase-admin/remote-config', () => ({ getRemoteConfig: () => ({ getTemplate: mocks.template }) }));
vi.mock('firebase-functions/logger', () => ({ error: mocks.error }));
vi.mock('./activity-service', () => ({ admitActivityNotification: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(admitActivityNotification).mockResolvedValue(); });
function input() { return { id: 'queue', activityNotificationOrigin: 'live', dateCreated: Date.now(), queueRevision: 'revision' } as QueueItemInterface; }
describe('post-persistence activity admission boundary', () => {
  it.each(['updated', 'unconfirmed', 'history', 'initial history', 'legacy queue', 'old event'])('skips %s without configuration or database access', async kind => {
    const queue = input(), result = { eventID: 'canonical', savedOriginalFiles: [], created: true };
    if (kind === 'updated') result.created = false;
    if (kind === 'history') queue.fromHistory = true;
    if (kind === 'initial history') queue.connectionHistoryRunId = 'run';
    if (kind === 'legacy queue') delete queue.activityNotificationOrigin;
    await notifyNewActivityAfterPersistence('owner', ServiceNames.SuuntoApp, queue, kind === 'unconfirmed' ? undefined : result,
      new Date(Date.now() - 60000), new Date(Date.now() - (kind === 'old event' ? 49 * 3600000 : 1000)), Date.now() - 86400000);
    expect(admitActivityNotification).not.toHaveBeenCalled(); expect(mocks.template).not.toHaveBeenCalled();
  });
  it('passes the canonical result, original queue revision, and connection time after a successful first save', async () => {
    const queue = input(), start = new Date(Date.now() - 60000), end = new Date(Date.now() - 1000), connected = new Date(Date.now() - 86400000);
    await notifyNewActivityAfterPersistence('owner', ServiceNames.COROSAPI, queue, { eventID: 'canonical', savedOriginalFiles: [], created: true }, start, end, connected);
    expect(admitActivityNotification).toHaveBeenCalledWith('owner', { eventID: 'canonical', service: ServiceNames.COROSAPI,
      queueId: 'queue', queueCreatedAt: queue.dateCreated, queueRevision: 'revision', startMs: +start, endMs: +end, connectedAtMs: +connected }, expect.anything());
  });
  it('keeps successful provider persistence successful and emits only fixed telemetry when admission fails', async () => {
    vi.mocked(admitActivityNotification).mockRejectedValue(new Error('private-canary'));
    await expect(notifyNewActivityAfterPersistence('owner', ServiceNames.WahooAPI, input(), { created: true, eventID: 'canonical', savedOriginalFiles: [] },
      new Date(Date.now() - 60000), new Date(Date.now() - 1000), Date.now() - 86400000)).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledWith('[ActivitySyncPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('private-canary');
  });
  it.each(['missing', 'off', 'main off', 'conditional', 'enabled'])('requires unconditional explicit activity and foundation flags: %s', async kind => {
    const parameters: Record<string, any> = { web_push_enabled: { defaultValue: { value: kind === 'main off' ? 'false' : 'true' } },
      web_push_activity_sync_enabled: { defaultValue: { value: kind === 'off' ? 'false' : 'true' } }, web_push_vapid_public_key: { defaultValue: { value: 'public-key' } } };
    if (kind === 'missing') delete parameters.web_push_activity_sync_enabled;
    if (kind === 'conditional') parameters.web_push_activity_sync_enabled.conditionalValues = { beta: { value: 'true' } };
    mocks.template.mockResolvedValue({ parameters });
    await expect(automaticPushConfiguration('web_push_activity_sync_enabled')).resolves.toEqual({ enabled: kind === 'enabled', publicKey: 'public-key' });
  });
});
