import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { afterReparseScan, observeReparseQueue, reparseCandidate, REPARSE_PROBE_TIMEOUT_MS, type ReparseProbeProfile } from './monitoring-probe';
import { emitReparseMonitoring, monitorReparseAttempt, monitorReparseEnqueue } from './monitoring';

const now = 100_000_000;
const ts = (n: number) => ({ toMillis: () => n });
const profile: ReparseProbeProfile = { collection: 'sportsLibReparseJobs', target: '10.0.0', terminal: m => m === 'terminal', hasSource: () => true };
const job = (patch = {}) => ({ status: 'pending', updatedAt: ts(now - 4_000_000), enqueuedAt: ts(now - 4_000_000),
  attemptCount: 0, targetSportsLibVersion: profile.target, ...patch });

describe('reparse observability boundary', () => {
  beforeEach(() => vi.clearAllMocks());
  it('preserves successes and the exact thrown error; distinguishes deployment waits from failures', async () => {
    expect(await monitorReparseAttempt('normal', 'worker_attempt', async () => 42)).toBe(42);
    const error = new Error('private uid payload');
    await expect(monitorReparseAttempt('route', 'worker_attempt', async () => { throw error; })).rejects.toBe(error);
    const wait = new Error('[sports-lib-reparse-worker] Runtime sports-lib version "1" is behind job target "2". Retrying after rollout.');
    await expect(monitorReparseAttempt('heavy', 'worker_attempt', async () => { throw wait; })).rejects.toBe(wait);
    const logs = vi.mocked(logger.info).mock.calls;
    expect(logs.map(call => call[1]?.outcome)).toEqual(['acknowledged', 'failed', 'rollout_wait']);
    expect(JSON.stringify(logs)).not.toMatch(/private|payload|Runtime sports/);
  });
  it('never propagates a logging failure or forwards arbitrary fields', async () => {
    emitReparseMonitoring({ event: 'job_commit', tier: 'normal', outcome: 'completed', uid: 'secret' } as never);
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('secret');
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('logger unavailable'); });
    expect(await monitorReparseAttempt('route', 'worker_attempt', async () => 'ok')).toBe('ok');
  });
  it('preserves actual enqueue, deduplication and exception behavior', async () => {
    expect(await monitorReparseEnqueue('heavy', async () => true)).toBe(true);
    expect(await monitorReparseEnqueue('route', async () => false)).toBe(false);
    const error = new Error('PRIVATE');
    await expect(monitorReparseEnqueue('normal', async () => { throw error; })).rejects.toBe(error);
    expect(vi.mocked(logger.info).mock.calls.map(call => call[1]?.outcome)).toEqual(['queued', 'deduplicated', 'failed']);
  });
  it('keeps scanner results even when observation fails and avoids probing near the deadline', async () => {
    const error = new Error('original'); const observe = vi.fn().mockRejectedValue(new Error('probe'));
    await expect(afterReparseScan(async () => { throw error; }, observe, ['normal', 'heavy'])).rejects.toBe(error);
    expect(observe).toHaveBeenCalledOnce(); observe.mockClear();
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(290_000);
    await afterReparseScan(async () => undefined, observe, ['route'], clock);
    expect(observe).not.toHaveBeenCalled();
  });
  it('excludes rollout, terminal, manual-heavy, exhausted and future work', () => {
    expect(reparseCandidate(job(), profile, now)).toBe('eligible');
    for (const patch of [{ targetSportsLibVersion: '9.0.0' }, { targetSportsLibVersion: '11.0.0' }, { terminalFailure: true },
      { failureReason: 'TOO_HEAVY_FOR_AUTO_REPARSE' }, { lastError: 'terminal' }, { status: 'superseded' },
      { status: 'failed', attemptCount: 10 }, { enqueuedAt: ts(now + 1) }, { updatedAt: ts(now) }]) {
      expect(reparseCandidate(job(patch), profile, now)).toBe('excluded');
    }
    expect(reparseCandidate(job({ updatedAt: {} }), profile, now)).toBe('unknown');
    expect(reparseCandidate(job({ attemptCount: NaN }), profile, now)).toBe('unknown');
    expect(reparseCandidate(job({ targetSportsLibVersion: undefined }), profile, now)).toBe('unknown');
    expect(reparseCandidate(job({ enqueuedAt: undefined }), profile, now)).toBe('unknown');
  });
  it('waits out the maximum native retry and active processing budgets, not just the minimum backoff', () => {
    expect(reparseCandidate(job({ status: 'failed' }), profile, now)).toBe('excluded');
    expect(reparseCandidate(job({ status: 'processing', updatedAt: ts(now - 15_000_000), enqueuedAt: ts(1) }), profile, now)).toBe('excluded');
    expect(reparseCandidate(job({ status: 'failed', updatedAt: ts(now - 15_000_000), enqueuedAt: ts(1) }), profile, now)).toBe('eligible');
    expect(reparseCandidate(job({ status: 'processing', updatedAt: ts(now - 17_000_000), enqueuedAt: ts(1) }), profile, now)).toBe('eligible');
  });
  it('reports query errors as unknown, not zero, and prevents late timeout reads emitting healthy samples', async () => {
    const chain = { where: vi.fn(), orderBy: vi.fn(), select: vi.fn(), limitToLast: vi.fn(), get: vi.fn() };
    for (const key of ['where', 'orderBy', 'select', 'limitToLast'] as const) chain[key].mockReturnValue(chain);
    const db = { collection: vi.fn(() => chain) } as never;
    chain.get.mockRejectedValueOnce(new Error('PRIVATE_INDEX_FAILURE'));
    await observeReparseQueue(db, profile, now);
    expect(vi.mocked(logger.info).mock.calls.map(call => call[1]?.event)).toEqual(['queue_sample_unavailable', 'queue_sample_unavailable']);
    vi.clearAllMocks(); vi.useFakeTimers();
    try {
      let resolve!: (value: unknown) => void;
      chain.get.mockReturnValueOnce(new Promise(r => { resolve = r; }));
      const observation = observeReparseQueue(db, profile, now);
      await vi.advanceTimersByTimeAsync(REPARSE_PROBE_TIMEOUT_MS);
      await observation;
      resolve({ docs: [], size: 0 }); await Promise.resolve();
      expect(vi.mocked(logger.info).mock.calls.map(call => call[1]?.event)).toEqual(['queue_sample_unavailable', 'queue_sample_unavailable']);
      expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
      expect(chain.get).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
