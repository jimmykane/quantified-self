import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { notifyConnectionAfterTransition } from './connection-admission';
import { admitConnectionNotification } from './connection-service';
import { automaticPushConfiguration } from './history-consent';
const mocks = vi.hoisted(() => ({ template: vi.fn(), error: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase-admin/remote-config', () => ({ getRemoteConfig: () => ({ getTemplate: mocks.template }) }));
vi.mock('firebase-functions/logger', () => ({ error: mocks.error }));
vi.mock('./connection-service', () => ({ admitConnectionNotification: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(admitConnectionNotification).mockResolvedValue(); });
afterEach(() => vi.useRealTimers());
describe('post-transition connection notification boundary', () => {
  it('bounds stalled configuration reads and never resumes admission after a late response', async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    mocks.template.mockReturnValue(new Promise(value => { resolve = value; }));
    const prepared = vi.fn(), finished = vi.fn();
    vi.mocked(admitConnectionNotification).mockImplementation(async (_uid, _incident, deps) => {
      await deps.configuration(); prepared();
    });
    const pending = notifyConnectionAfterTransition('owner', { service: ServiceNames.GarminAPI,
      id: '00000000-0000-4000-8000-000000000001', observedAt: Date.now(), providerUserId: 'account' }).then(finished);
    await vi.advanceTimersByTimeAsync(5001);
    expect(finished).toHaveBeenCalledOnce(); expect(prepared).not.toHaveBeenCalled();
    resolve({ parameters: {} }); await vi.advanceTimersByTimeAsync(1); await pending;
    expect(prepared).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('[ConnectionAttentionPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
  });
  it('never changes auth recovery outcomes or logs raw provider errors', async () => {
    vi.mocked(admitConnectionNotification).mockRejectedValue(new Error('private-canary'));
    await expect(notifyConnectionAfterTransition('owner', { service: ServiceNames.GarminAPI,
      id: '00000000-0000-4000-8000-000000000001', observedAt: Date.now(), providerUserId: 'account' })).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledWith('[ConnectionAttentionPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('private-canary');
  });
  it.each(['missing', 'off', 'foundation off', 'conditional', 'enabled'])('requires both unconditional flags: %s', async kind => {
    const parameters: Record<string, any> = { web_push_enabled: { defaultValue: { value: kind === 'foundation off' ? 'false' : 'true' } },
      web_push_connection_attention_enabled: { defaultValue: { value: kind === 'off' ? 'false' : 'true' } },
      web_push_vapid_public_key: { defaultValue: { value: 'public-key' } } };
    if (kind === 'missing') delete parameters.web_push_connection_attention_enabled;
    if (kind === 'conditional') parameters.web_push_connection_attention_enabled.conditionalValues = { beta: { value: 'true' } };
    mocks.template.mockResolvedValue({ parameters });
    await expect(automaticPushConfiguration('web_push_connection_attention_enabled')).resolves.toEqual({ enabled: kind === 'enabled', publicKey: 'public-key' });
  });
});
