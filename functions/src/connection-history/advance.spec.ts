import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHistoryRun } from './model';
import { advanceHistoryRun, type HistoryAdvanceDependencies } from './advance';
const now = Date.parse('2026-09-14T12:00:00Z');
function run() { return createHistoryRun('owner', ServiceNames.WahooAPI, { requested: true, rangePreset: '30_days', providerUserId: 'account', tokenPath: 'tokens/account', rootPath: 'tokens', credentialGeneration: 'credential', runId: '11111111-1111-4111-8111-111111111111' }, 'connection', now); }
function dependencies(): HistoryAdvanceDependencies { return { execute: vi.fn(async () => ({ count: 1, nextStartMs: now + 1000, nextPage: 1, childPaths: [] })), observe: vi.fn(async () => 'processed'), classify: () => ({ kind: 'retry', message: 'Please retry.' }) }; }
describe('history continuation', () => {
  it('finishes an empty or fully persisted window and never runs it again', async () => {
    const job = run(); const deps = dependencies(); await advanceHistoryRun(job, deps, now);
    expect(job.processed).toBe(true); expect(job.steps[0].status).toBe('processed');
    await advanceHistoryRun(job, deps, now); expect(deps.execute).toHaveBeenCalledTimes(1);
  });
  it('persists a route-library cursor and waits for imported children before admitting another batch', async () => {
    const job = run(); const deps = dependencies();
    deps.execute = vi.fn().mockResolvedValueOnce({ count: 100, nextStartMs: job.startMs, nextPage: 2,
      routeAfterId: 'route-100', childPaths: ['routeSyncQueue/item'] });
    await advanceHistoryRun(job, deps, now);
    expect(job.steps[0]).toMatchObject({ count: 100, page: 2, routeAfterId: 'route-100', done: false });
    deps.observe = vi.fn(async () => 'pending');
    await advanceHistoryRun(job, deps, now + 60000); expect(deps.execute).toHaveBeenCalledTimes(1);
    deps.observe = vi.fn(async () => 'processed');
    deps.execute = vi.fn().mockResolvedValue({ count: 1, nextStartMs: job.endMs + 1000, nextPage: 1, routeAfterId: 'route-101', childPaths: [] });
    await advanceHistoryRun(job, deps, now + 120000);
    expect(job.steps[0]).toMatchObject({ count: 101, routeAfterId: 'route-101', status: 'processed', done: true });
  });
  it('waits for workers without replaying the provider request', async () => {
    const job = run(); job.steps[0].childPaths = ['queue/item']; const deps = dependencies();
    deps.observe = vi.fn(async () => 'pending'); await advanceHistoryRun(job, deps, now);
    expect(deps.execute).not.toHaveBeenCalled(); expect(job.nextAttemptAt).toBe(now + 60000);
  });
  it('continues later route batches after a route disappears and retains the explanation through completion', async () => {
    const job = createHistoryRun('owner', ServiceNames.SuuntoApp, { requested: true, importRouteHistory: true, rangePreset: '30_days',
      providerUserId: 'account', tokenPath: 'tokens/account', rootPath: 'tokens', credentialGeneration: 'credential',
      runId: '11111111-1111-4111-8111-111111111111' }, 'connection', now);
    for (const step of job.steps.slice(0, 3)) step.done = true;
    const routes = job.steps[3]; routes.count = 100; routes.routeAfterId = 'route-099'; routes.page = 2;
    routes.childPaths = ['routeSyncQueue/deleted'];
    const deps = dependencies(); deps.observe = vi.fn(async () => 'unavailable');
    deps.execute = vi.fn(async () => ({ count: 5, nextStartMs: job.endMs + 1000, nextPage: 1,
      routeAfterId: 'route-104', childPaths: ['routeSyncQueue/final'] }));
    await advanceHistoryRun(job, deps, now);
    expect(routes).toMatchObject({ count: 105, routeAfterId: 'route-104', status: 'queued', done: false });
    expect(deps.execute).toHaveBeenCalledTimes(1);
    deps.observe = vi.fn(async () => 'processed');
    await advanceHistoryRun(job, deps, now + 60000);
    expect(job.processed).toBe(true); expect(routes.status).toBe('processed');
    expect(routes.message).toContain('no longer available');
  });
  it.each(['failed', 'authorization'] as const)('finishes a %s child with actionable status and no redundant provider work', async observed => {
    const job = run(); job.steps[0].childPaths = ['queue/item']; const deps = dependencies(); deps.observe = vi.fn(async () => observed);
    await advanceHistoryRun(job, deps, now);
    expect(job.processed).toBe(true); expect(deps.execute).not.toHaveBeenCalled();
    expect(job.steps[0].status).toBe(observed === 'failed' ? 'failed' : 'skipped');
    expect(job.steps[0].message).toContain(observed === 'failed' ? 'Retry failed imports' : 'Reconnect');
    if (observed === 'failed') expect(job.steps[0].childPaths).toEqual(['queue/item']);
  });
  it('keeps retry and reconnect guidance for mixed downstream failures', async () => {
    const job = run(); job.steps[0].childPaths = ['queue/auth', 'queue/retry']; const deps = dependencies();
    deps.observe = vi.fn(async () => 'mixed'); await advanceHistoryRun(job, deps, now);
    expect(job.steps[0]).toMatchObject({ status: 'failed', done: true, retryCount: 0 });
    expect(job.steps[0].message).toContain('reconnect');
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
  it('keeps the current capacity wait reason after earlier routes became unavailable', async () => {
    const job = run(); job.steps[0].resources = ['routes']; job.steps[0].hadUnavailableRoutes = true;
    const deps = dependencies(); deps.execute = vi.fn().mockRejectedValue(new Error('capacity'));
    deps.classify = () => ({ kind: 'wait', message: 'Waiting for capacity. Your history will continue automatically.' });
    await advanceHistoryRun(job, deps, now);
    expect(job.steps[0]).toMatchObject({ status: 'queued', done: false, hadUnavailableRoutes: true,
      message: 'Waiting for capacity. Your history will continue automatically.' });
    deps.execute = vi.fn().mockResolvedValue({ count: 1, nextStartMs: job.endMs + 1000, nextPage: 1, childPaths: [] });
    await advanceHistoryRun(job, deps, now + 60000);
    expect(job.processed).toBe(true); expect(job.steps[0].message).toContain('no longer available');
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
