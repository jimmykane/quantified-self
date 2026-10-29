import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { MAX_ISOLATED_HISTORY_FAILURES, createHistoryRun } from './model';
import { advanceHistoryRun, type HistoryAdvanceDependencies } from './advance';
const now = Date.parse('2026-09-14T12:00:00Z');
function run() { return createHistoryRun('owner', ServiceNames.WahooAPI, { requested: true, rangePreset: '30_days', providerUserId: 'account', tokenPath: 'tokens/account', rootPath: 'tokens', credentialGeneration: 'credential', runId: '11111111-1111-4111-8111-111111111111' }, 'connection', now); }
function dependencies(): HistoryAdvanceDependencies { return { execute: vi.fn(async () => ({ count: 1, nextStartMs: now + 1000, nextPage: 1, childPaths: [] })), observe: vi.fn(async () => 'processed'), classify: () => ({ kind: 'retry', message: 'Please retry.' }) }; }
describe('history continuation', () => {
  it.each([9, 18, 19])('uses the extended provider retry budget at %i failures', async retryCount => {
    const job = run();
    job.steps[0].retryCount = retryCount;
    const deps = dependencies();
    deps.execute = vi.fn().mockRejectedValue(new Error('Temporary provider failure'));

    await advanceHistoryRun(job, deps, now);

    expect(job.steps[0]).toMatchObject({
      retryCount: retryCount + 1,
      done: retryCount === 19,
      status: retryCount === 19 ? 'failed' : 'retrying',
    });
    expect(job.nextAttemptAt).toBe(now + (retryCount === 19 ? 2_000 : 14_400_000));
  });

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
    expect(job.steps[0].childPaths).toEqual(observed === 'failed' ? ['queue/item'] : []);
  });
  it('isolates failed records while scanning later pages, then reports a completed scan with failures', async () => {
    const job = run(); const step = job.steps[0]; const deps = dependencies();
    step.childPaths = ['queue/good', 'queue/bad']; step.page = 2; step.count = 2;
    deps.observe = vi.fn().mockResolvedValueOnce({ failedPaths: ['queue/bad', 'queue/bad'] }).mockResolvedValue('processed');
    deps.execute = vi.fn(async () => ({ count: 1, nextStartMs: job.endMs + 1000, nextPage: 3, childPaths: ['queue/last'] }));
    await advanceHistoryRun(job, deps, now);
    expect(step).toMatchObject({ done: false, status: 'queued', count: 3, page: 3,
      childPaths: ['queue/last'], failedChildPaths: ['queue/bad'] });
    expect(step.message).toContain('Continuing');
    expect(job.processed).toBe(false);
    await advanceHistoryRun(job, deps, now + 60000);
    expect(job.processed).toBe(true);
    expect(step).toMatchObject({ done: true, status: 'failed', childPaths: [], failedChildPaths: ['queue/bad'], retryCount: 0 });
    expect(step.message).toContain('History scan finished. 1 record failed');
    expect(deps.observe).toHaveBeenNthCalledWith(2, ['queue/last']);
    await advanceHistoryRun(job, deps, now + 120000);
    expect(deps.execute).toHaveBeenCalledTimes(1);
  });
  it.each([ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI])('isolates record failures for %s and continues the next resource independently', async serviceName => {
    const job = createHistoryRun('owner', serviceName, { requested: true, rangePreset: '30_days', providerUserId: 'account',
      tokenPath: 'tokens/account', rootPath: 'tokens', credentialGeneration: 'credential',
      runId: '11111111-1111-4111-8111-111111111111' }, 'connection', now);
    const step = job.steps[0]; step.childPaths = ['queue/bad']; step.nextStartMs = job.endMs + 1000;
    const deps = dependencies(); deps.observe = vi.fn(async () => ({ failedPaths: ['queue/bad'] }));
    await advanceHistoryRun(job, deps, now);
    expect(step).toMatchObject({ status: 'failed', done: true, failedChildPaths: ['queue/bad'] });
    expect(deps.execute).not.toHaveBeenCalled();
    if (job.steps.length > 1) {
      expect(job.processed).toBe(false);
      await advanceHistoryRun(job, deps, now + 2000);
      expect(deps.execute).toHaveBeenCalledWith(job.steps[1]);
      expect(job.steps[1].done).toBe(true);
    } else expect(job.processed).toBe(true);
  });
  it.each(['authorization', 'skipped'] as const)('keeps all recovery references after a later %s stop', async observed => {
    const job = run(); const step = job.steps[0]; const deps = dependencies();
    step.failedChildPaths = ['queue/earlier']; step.childPaths = ['queue/auth'];
    deps.observe = vi.fn(async () => observed);
    await advanceHistoryRun(job, deps, now);
    expect(deps.execute).not.toHaveBeenCalled();
    expect(step).toMatchObject({ done: true, status: 'failed', failedChildPaths: ['queue/earlier'], childPaths: ['queue/auth'] });
    expect(step.message).toContain(observed === 'authorization' ? 'Reconnect' : 'connection changed');
    expect(step.message).toContain('earlier records also failed');
  });
  it('keeps retained failures when the next provider page needs authorization', async () => {
    const job = run(); const deps = dependencies(); job.steps[0].failedChildPaths = ['queue/earlier'];
    deps.execute = vi.fn().mockRejectedValue(new Error('authorization'));
    deps.classify = () => ({ kind: 'skip', message: 'Reconnect before continuing.' });
    await advanceHistoryRun(job, deps, now);
    expect(job.steps[0]).toMatchObject({ status: 'failed', done: true, failedChildPaths: ['queue/earlier'] });
    expect(job.steps[0].message).toContain('Reconnect');
  });
  it('bounds isolated failures and keeps the overflow batch reachable without requesting another page', async () => {
    const job = run(); const deps = dependencies(); const step = job.steps[0];
    step.failedChildPaths = Array.from({ length: MAX_ISOLATED_HISTORY_FAILURES - 1 }, (_, i) => `queue/old-${i}`);
    step.childPaths = ['queue/new-1', 'queue/new-2'];
    deps.observe = vi.fn(async () => ({ failedPaths: [...step.childPaths] }));
    await advanceHistoryRun(job, deps, now);
    expect(deps.execute).not.toHaveBeenCalled();
    expect(step).toMatchObject({ status: 'failed', done: true, childPaths: ['queue/new-1', 'queue/new-2'] });
    expect(step.failedChildPaths).toHaveLength(MAX_ISOLATED_HISTORY_FAILURES - 1);
  });
  it('does not admit more batches in another resource after the shared failure bound is reached', async () => {
    const job = run(); const deps = dependencies(); const first = job.steps[0];
    first.done = true; first.status = 'failed';
    first.failedChildPaths = Array.from({ length: MAX_ISOLATED_HISTORY_FAILURES }, (_, i) => `queue/bad-${i}`);
    job.steps.push({ ...first, id: 'another', done: false, status: 'queued', failedChildPaths: [], childPaths: [] });
    await advanceHistoryRun(job, deps, now);
    expect(deps.execute).not.toHaveBeenCalled();
    expect(job.steps[1]).toMatchObject({ done: true, status: 'failed' });
    expect(job.steps[1].message).toContain('paused');
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
