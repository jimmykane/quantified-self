import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('firebase-functions/logger', () => ({ error: mocks.log }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('./delivery-service', () => ({ admitDeliveryNotification: vi.fn() }));
vi.mock('./history-consent', () => ({ automaticPushConfiguration: vi.fn() }));
import { admitDeliveryNotification } from './delivery-service';
import { queueActivitySendNotification, queueAutomaticDeliveryNotification } from './delivery-admission';
const manual = { state: 'complete', finished: 20, total: 20, notificationRequested: true, createdAt: 1, updatedAt: 2 };
const automatic = { originalCollection: 'activitySyncQueue', manual: false, userID: 'owner', dateCreated: 1, failedAt: 2 };
function event(after: unknown, before?: unknown) { return { data: { after: { data: () => after }, before: { data: () => before } }, params: { uid: 'owner', batchId: 'batch', jobId: 'job' } } as never; }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(admitDeliveryNotification).mockResolvedValue(); });
describe('delivery result admission triggers', () => {
  it.each([undefined, { ...manual, notificationRequested: false }, { ...manual, state: 'confirmed' }, { ...manual, stopped: true }])('skips non-consented or non-complete sends', async after => {
    await queueActivitySendNotification.run(event(after)); expect(admitDeliveryNotification).not.toHaveBeenCalled();
  });
  it('admits one batch result and ignores later completion metadata writes', async () => {
    await queueActivitySendNotification.run(event(manual));
    expect(admitDeliveryNotification).toHaveBeenCalledWith('owner', { kind: 'manual', id: 'batch', createdAt: 1, completedAt: 2 }, expect.anything());
    vi.mocked(admitDeliveryNotification).mockClear(); await queueActivitySendNotification.run(event(manual, manual)); expect(admitDeliveryNotification).not.toHaveBeenCalled();
  });
  it.each([undefined, { ...automatic, manual: true }, { ...automatic, originalCollection: 'workoutQueue' }, { ...automatic, deliveryMode: 'historical' }, { ...automatic, sendBatchID: 'batch' }])('skips unrelated dead letters', async after => {
    await queueAutomaticDeliveryNotification.run(event(after)); expect(admitDeliveryNotification).not.toHaveBeenCalled();
  });
  it('admits automatic failure but ignores unrelated updates to the same failure', async () => {
    await queueAutomaticDeliveryNotification.run(event(automatic));
    expect(admitDeliveryNotification).toHaveBeenCalledWith('owner', { kind: 'automatic', id: 'job', createdAt: 1, completedAt: 2 }, expect.anything());
    vi.mocked(admitDeliveryNotification).mockClear(); await queueAutomaticDeliveryNotification.run(event(automatic, automatic)); expect(admitDeliveryNotification).not.toHaveBeenCalled();
  });
  it('reports only fixed failure fields and retries notification preparation independently', async () => {
    vi.mocked(admitDeliveryNotification).mockRejectedValue(new Error('private-canary'));
    await expect(queueActivitySendNotification.run(event(manual))).rejects.toThrow('notification admission failed');
    expect(mocks.log).toHaveBeenCalledWith('[ActivityDeliveryPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private-canary');
  });
});
