import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHistoryRun } from './model';
import { advanceHistoryRun, type HistoryAdvanceDependencies } from './advance';
const now = Date.parse('2026-09-14T12:00:00Z');
function run() { return createHistoryRun('owner', ServiceNames.WahooAPI, { requested: true, rangePreset: '30_days', providerUserId: 'account', tokenPath: 'tokens/account', rootPath: 'tokens', credentialGeneration: 'credential', flowGeneration: 'flow' }, 'connection', now); }
function dependencies(): HistoryAdvanceDependencies { return { execute: vi.fn(async () => ({ count: 1, nextStartMs: now + 1000, nextPage: 1, childPaths: [] })), observe: vi.fn(async () => 'processed'), classify: () => ({ kind: 'retry', message: 'Please retry.' }) }; }
describe('history continuation', () => {
  it('finishes an empty or fully persisted window and never runs it again', async () => {
    const job = run(); const deps = dependencies(); await advanceHistoryRun(job, deps, now);
    expect(job.processed).toBe(true); expect(job.steps[0].status).toBe('processed');
    await advanceHistoryRun(job, deps, now); expect(deps.execute).toHaveBeenCalledTimes(1);
  });
  it('waits for workers without replaying the provider request', async () => {
    const job = run(); job.steps[0].childPaths = ['queue/item']; const deps = dependencies();
    deps.observe = vi.fn(async () => 'pending'); await advanceHistoryRun(job, deps, now);
    expect(deps.execute).not.toHaveBeenCalled(); expect(job.nextAttemptAt).toBe(now + 60000);
  });
  it.each(['failed', 'authorization'] as const)('finishes a %s child with actionable status and no redundant provider work', async observed => {
    const job = run(); job.steps[0].childPaths = ['queue/item']; const deps = dependencies(); deps.observe = vi.fn(async () => observed);
    await advanceHistoryRun(job, deps, now);
    expect(job.processed).toBe(true); expect(deps.execute).not.toHaveBeenCalled();
    expect(job.steps[0].status).toBe(observed === 'failed' ? 'failed' : 'skipped');
    expect(job.steps[0].message).toContain(observed === 'failed' ? 'Retry failed imports' : 'Reconnect');
    if (observed === 'failed') expect(job.steps[0].childPaths).toEqual(['queue/item']);
  });
  it('records submission separately from ingestion for Garmin', async () => {
    const job = run(); job.steps[0].capability.completion = 'requested';
    await advanceHistoryRun(job, dependencies(), now); expect(job.steps[0].status).toBe('requested');
  });
  it('backs off failures, preserving the original range and cursor', async () => {
    const job = run(); const start = job.startMs; const deps = dependencies(); deps.execute = vi.fn().mockRejectedValue(new Error());
    await advanceHistoryRun(job, deps, now); expect(job.steps[0].status).toBe('retrying');
    expect(job.nextAttemptAt).toBe(now + 900000); expect(job.steps[0].nextStartMs).toBe(start);
  });
  it('skips a cooldown and preserves its availability date', async () => {
    const job = run(); const deps = dependencies(); deps.execute = vi.fn().mockRejectedValue(new Error());
    deps.classify = () => ({ kind: 'skip', message: 'Cooldown', nextAllowedAtMs: now + 86400000 });
    await advanceHistoryRun(job, deps, now); expect(job.processed).toBe(true); expect(job.steps[0].nextAllowedAtMs).toBe(now + 86400000);
  });
  it('subdivides oversized responses without spending retries or dropping data', async () => {
    const job = run(); const deps = dependencies(); deps.execute = vi.fn().mockRejectedValue(new Error()); deps.classify = () => ({ kind: 'split', message: 'Too large' });
    await advanceHistoryRun(job, deps, now); expect(job.steps[0].windowDays).toBe(15); expect(job.steps[0].retryCount).toBe(0); expect(job.steps[0].nextStartMs).toBe(job.startMs);
  });
});
