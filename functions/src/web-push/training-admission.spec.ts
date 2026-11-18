import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { queueTrainingSyncNotification } from './training-admission';
import { observeTrainingNotification } from './training-service';
import { observeTrainingSend, sendTrainingSendResult } from './training-send-service';
const log = vi.hoisted(() => vi.fn());
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase-functions/logger', () => ({ error: log }));
vi.mock('./training-service', () => ({ observeTrainingNotification: vi.fn() }));
vi.mock('./training-send-service', () => ({ observeTrainingSend: vi.fn(), sendTrainingSendResult: vi.fn() }));
const event = (status = 'failed', before = 'retrying') => ({ params: { uid: 'owner', deliveryId: 'a'.repeat(64) },
  data: { before: { data: () => ({ status: before }) }, after: { data: () => ({ status, updatedAtMs: 123 }) } } });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(observeTrainingNotification).mockResolvedValue(); vi.mocked(observeTrainingSend).mockResolvedValue(false); vi.mocked(sendTrainingSendResult).mockResolvedValue(); });
describe('training notification status observer', () => {
  it('collapses failures covered by an explicit send but still processes recovery', async () => {
    vi.mocked(observeTrainingSend).mockResolvedValue(true);
    await queueTrainingSyncNotification.run(event() as never); expect(observeTrainingNotification).not.toHaveBeenCalled();
    await queueTrainingSyncNotification.run(event('delivered') as never); expect(observeTrainingNotification).toHaveBeenCalledOnce();
  });
  it('sends a ready explicit result in the existing status handler', async () => {
    vi.mocked(observeTrainingSend).mockImplementation(async (_uid, _status, deps) => { await deps.sendReady!('request'); return true; });
    await queueTrainingSyncNotification.run(event() as never);
    expect(sendTrainingSendResult).toHaveBeenCalledWith('owner', 'request', expect.any(Object));
  });
  it('observes newer evidence even when the public status is unchanged', async () => {
    await queueTrainingSyncNotification.run(event('delivered', 'delivered') as never);
    expect(observeTrainingSend).toHaveBeenCalledOnce(); expect(observeTrainingNotification).not.toHaveBeenCalled();
  });
  it('retries send-result admission errors without logging raw data or falling back to a second alert', async () => {
    vi.mocked(observeTrainingSend).mockRejectedValue(new Error('private-canary'));
    await expect(queueTrainingSyncNotification.run(event() as never)).rejects.toThrow('Training send notification admission failed.');
    expect(observeTrainingNotification).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[TrainingSendPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-canary');
  });
  it.each(['pending', 'retrying', 'paused_plan', 'paused_pro', 'unsupported', 'outside_horizon'])('ignores %s before reading configuration', async status => {
    await queueTrainingSyncNotification.run(event(status) as never); expect(observeTrainingNotification).not.toHaveBeenCalled();
  });
  it('ignores routine rewrites and deleted projections', async () => {
    await queueTrainingSyncNotification.run(event('failed', 'failed') as never);
    await queueTrainingSyncNotification.run({ ...event(), data: { after: { data: () => undefined } } } as never);
    expect(observeTrainingNotification).not.toHaveBeenCalled();
  });
  it.each(['failed', 'needs_attention', 'connection_repair', 'reconnect_required', 'delivered'])('observes committed %s transitions', async status => {
    await queueTrainingSyncNotification.run(event(status) as never);
    expect(observeTrainingNotification).toHaveBeenCalledWith('owner', { id: 'a'.repeat(64), status, observedAt: 123 }, expect.any(Object));
  });
  it('reports preparation failure with fixed labels and no raw error', async () => {
    vi.mocked(observeTrainingNotification).mockRejectedValue(new Error('private-canary'));
    await expect(queueTrainingSyncNotification.run(event() as never)).rejects.toThrow('Training sync notification admission failed.');
    expect(log).toHaveBeenCalledWith('[TrainingSyncPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-canary');
  });
});
