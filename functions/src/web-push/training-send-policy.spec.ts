import { afterEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { trainingSendConfiguration } from './training-send-admission';
import { trainingSendPayload, trainingSendTerminal } from './training-send-policy';
import { observeTrainingSend } from './training-send-service';
const mocks = vi.hoisted(() => ({ template: vi.fn(), log: vi.fn() }));
vi.mock('firebase-admin/remote-config', () => ({ getRemoteConfig: () => ({ getTemplate: mocks.template }) }));
vi.mock('firebase-functions/logger', () => ({ error: mocks.log }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe('Training send policy', () => {
  it.each(['missing', 'off', 'conditional', 'enabled'])('requires an unconditional foundation and sender flag: %s', async kind => {
    const parameters: Record<string, unknown> = { web_push_enabled: { defaultValue: { value: 'true' } },
      web_push_vapid_public_key: { defaultValue: { value: 'public-key' } } };
    if (kind !== 'missing') parameters.web_push_training_sync_enabled = { defaultValue: { value: kind === 'off' ? 'false' : 'true' },
      ...(kind === 'conditional' ? { conditionalValues: { beta: { value: 'true' } } } : {}) };
    mocks.template.mockResolvedValue({ parameters });
    await expect(trainingSendConfiguration()).resolves.toEqual({ enabled: kind === 'enabled', publicKey: 'public-key' });
  });
  it('bounds only the optional configuration read so a stalled service does not block Training sends', async () => {
    vi.useFakeTimers(); mocks.template.mockReturnValue(new Promise(() => {})); const result = trainingSendConfiguration();
    await vi.advanceTimersByTimeAsync(5000); await expect(result).resolves.toEqual({ enabled: false, publicKey: '' });
    expect(mocks.log).toHaveBeenCalledWith('[TrainingSendPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses per-request tags, provider acceptance wording and both navigation formats', () => {
    const state = { scope: 'plan' as const, scopeId: 'p', provider: 'garmin' as const, requestId: 'request' };
    const payload = trainingSendPayload('https://beta.quantified-self.io', state, 1, 0);
    expect(payload.notification.body).toBe('Your 1 workout was sent to Garmin.'); expect(payload.notification.tag).not.toContain('request');
    expect(trainingSendPayload('https://beta.quantified-self.io', { ...state, provider: 'coros' }, 1, 0).notification.tag).not.toBe(payload.notification.tag);
    expect(trainingSendPayload('https://beta.quantified-self.io', { ...state, requestId: 'another' }, 1, 0).notification.tag).not.toBe(payload.notification.tag);
    expect(payload.notification.navigate).toBe('https://beta.quantified-self.io/training/plans/plan/p?sync=attention');
    expect(payload.notification.data.onActionClick.default.url).toBe('/training/plans/plan/p?sync=attention');
    expect(trainingSendPayload('https://quantified-self.io', { ...state, scope: 'workout' }, 0, 2).notification.body).toContain('could not be sent');
    expect(() => trainingSendPayload('https://example.com', state, 1, 0)).toThrow();
  });
  it('keeps intermediate retries pending and closes attention states as one failed member', () => {
    expect(trainingSendTerminal('retrying')).toBe('waiting'); expect(trainingSendTerminal('delivered')).toBe('sent');
    for (const status of ['failed', 'needs_attention', 'unsupported', 'reconnect_required', 'approval_required']) expect(trainingSendTerminal(status)).toBe('failed');
    expect(trainingSendTerminal('completed')).toBe('cancelled');
  });
  it.each(['pending', 'retrying'])('adds no Firestore reads for an intermediate %s status', async status => {
    const raw = { schemaVersion: 1, id: 'a'.repeat(64), workoutId: 'w', planId: null, provider: 'garmin', status,
      differsFromQS: true, hasRemoteCopy: false, timeZone: 'UTC', approvalDigest: null, issues: [],
      lastAttemptAtMs: null, lastAcceptedAtMs: null, retryCount: 0, nextRetryAtMs: null, updatedAtMs: 1 };
    await expect(observeTrainingSend('owner', raw, { db: {} as never, now: () => 1, sendReady: vi.fn() })).resolves.toBe(false);
  });
});
