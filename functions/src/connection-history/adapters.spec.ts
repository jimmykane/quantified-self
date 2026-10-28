import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ activity: vi.fn(), garminActivity: vi.fn(), wahoo: vi.fn(), suunto: vi.fn(), coros: vi.fn(), garmin: vi.fn(),
  routes: vi.fn(), healthEnabled: vi.fn(), sleepEnabled: vi.fn(), before: vi.fn(), meta: {} as Record<string, unknown> }));
vi.mock('../suunto/route-history', () => ({ queueSuuntoRouteHistory: mocks.routes }));
vi.mock('../history', () => ({ addHistoryToQueue: mocks.activity }));
vi.mock('../garmin/backfill', () => ({ processGarminBackfill: mocks.garminActivity, GarminHistoryRangeUnavailableError: class GarminHistoryRangeUnavailableError extends Error { constructor(public readonly minimumDate?: Date) { super('Unavailable range'); } } }));
vi.mock('../wahoo/history-to-queue', () => ({ importWahooHistory: mocks.wahoo }));
vi.mock('../sleep/backfill', () => ({ queueSuuntoSleepHealthHistory: mocks.suunto, queueCorosSleepHealthHistory: mocks.coros, queueGarminSleepHealthHistory: mocks.garmin }));
vi.mock('../garmin/health-flags', () => ({ isGarminHealthSyncEnabled: mocks.healthEnabled }));
vi.mock('../suunto/health-flags', () => ({ isSuuntoHealthSyncEnabled: mocks.healthEnabled }));
vi.mock('../sleep/provider-flags', () => ({ isSleepProviderEnabled: mocks.sleepEnabled, isSleepSyncUserAllowed: () => true }));
vi.mock('./execution', () => ({ assertHistoryConnectionCurrent: vi.fn(), HistoryWindowTooLargeError: class HistoryWindowTooLargeError extends Error {}, HistoryUnavailableError: class HistoryUnavailableError extends Error { constructor(message: string, public readonly earliestStartMs?: number) { super(message); } } }));
vi.mock('firebase-admin', () => ({ firestore: () => ({ doc: () => ({ get: async () => ({ data: () => mocks.meta }) }),
  runTransaction: async (work: any) => work({ get: async () => ({ data: () => mocks.meta }), set: vi.fn() }) }) }));
import { GarminHistoryRangeUnavailableError } from '../garmin/backfill';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { CONNECTION_HISTORY_CAPABILITIES, historyCapabilities, type HistoryCapability } from '../../../shared/connection-history';
import { createHistoryRun } from './model';
import { executeHistoryOperation, HISTORY_ADAPTERS, historyAdmissionQueue } from './adapters';
import { HistoryUnavailableError, type HistoryExecution } from './execution';
import { advanceHistoryRun, type HistoryChildObservation } from './advance';
const now = Date.parse('2026-03-01T13:00:00+02:00');
function run(service: ServiceNames) { return createHistoryRun('owner', service, { requested: true, importRouteHistory: true, rangePreset: '30_days', runId: '11111111-1111-4111-8111-111111111111', providerUserId: 'selected-account', tokenPath: 'private/exact/token', rootPath: 'private/root', credentialGeneration: 'credential' }, 'connection', now); }
const execution = { runId: 'run', tokenPath: 'private/exact/token', providerUserId: 'selected-account', beforeRequest: mocks.before } as unknown as HistoryExecution;
beforeEach(() => { vi.clearAllMocks(); mocks.meta = {}; mocks.healthEnabled.mockReturnValue(true); mocks.sleepEnabled.mockReturnValue(true);
  mocks.routes.mockResolvedValue({ count: 2, hasMore: false, afterRouteId: 'last-route' });
  mocks.activity.mockResolvedValue({ successCount: 2, failureCount: 0 }); mocks.garminActivity.mockResolvedValue(undefined); mocks.wahoo.mockResolvedValue({ successCount: 2 });
  for (const fn of [mocks.suunto, mocks.coros, mocks.garmin]) fn.mockResolvedValue({ queued: 1, sleepQueued: 1, healthQueued: 1 }); });
describe('shared history adapter contracts', () => {
  it.each([ServiceNames.SuuntoApp, ServiceNames.COROSAPI])('keeps adjacent manual %s windows contiguous through the entire selected end day', async service => {
    const job = run(service);
    job.rangePreset = 'custom'; job.startMs = Date.parse('2026-01-01T00:00:00Z'); job.endMs = Date.parse('2026-02-02T23:59:59.999Z');
    const step = job.steps[0]; step.nextStartMs = job.startMs;
    const first = await executeHistoryOperation(job, step, execution);
    expect(mocks.activity).toHaveBeenLastCalledWith('owner', service, new Date(job.startMs), new Date('2026-01-30T23:59:59.999Z'), expect.objectContaining({ maxItems: 100 }));
    expect(first.nextStartMs).toBe(Date.parse('2026-01-31T00:00:00Z'));
    step.nextStartMs = first.nextStartMs;
    const last = await executeHistoryOperation(job, step, execution);
    expect(mocks.activity).toHaveBeenLastCalledWith('owner', service, new Date(first.nextStartMs), new Date(job.endMs), expect.objectContaining({ maxItems: 100 }));
    expect(last.nextStartMs).toBe(job.endMs + 1);
  });
  it('requires explicit support (or an empty unsupported declaration) for every service and version', () => {
    for (const service of Object.values(ServiceNames)) {
      expect(HISTORY_ADAPTERS[service]).toBeDefined();
      for (const capability of historyCapabilities(service)) expect(HISTORY_ADAPTERS[service][capability.id][capability.version].execute).toBeTypeOf('function');
    }
  });
  it('executes a newly registered capability and its queue without changing coordinator or OAuth routing', async () => {
    const service = ServiceNames.WahooAPI;
    const previousRun = run(service);
    const capabilities = CONNECTION_HISTORY_CAPABILITIES[service] as unknown as HistoryCapability[];
    const execute = vi.fn().mockResolvedValue({ count: 3, nextStartMs: now + 1000, nextPage: 1 });
    capabilities.push({ id: 'fixture', version: 1, resources: ['activities'], cooldownGroup: 'activities', completion: 'queued' });
    HISTORY_ADAPTERS[service].fixture = { 1: { execute, downstream: 'activities' } };
    try {
      const futureRun = run(service); const step = futureRun.steps[1];
      expect(previousRun.steps).toHaveLength(1);
      expect(historyAdmissionQueue(futureRun, step)).toEqual(historyAdmissionQueue(futureRun, futureRun.steps[0]));
      expect(await executeHistoryOperation(futureRun, step, execution)).toMatchObject({ count: 3 });
      expect(execute).toHaveBeenCalledWith(futureRun, step, execution);
      expect(mocks.wahoo).not.toHaveBeenCalled();
    } finally { capabilities.pop(); delete HISTORY_ADAPTERS[service].fixture; }
  });
  it.each([ServiceNames.SuuntoApp, ServiceNames.COROSAPI])('reuses the canonical activity operation with the exact account and original UTC range for %s', async service => {
    const job = run(service); await executeHistoryOperation(job, job.steps[0], execution);
    expect(mocks.activity).toHaveBeenCalledWith('owner', service, new Date(job.startMs), new Date(job.endMs), expect.objectContaining({ execution, maxItems: 100, expectedProviderUserId: 'selected-account' }));
    expect(new Date(job.startMs).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
  it('uses the independent route queue and a library cursor instead of the history date range', async () => {
    const job = run(ServiceNames.SuuntoApp); const step = job.steps.find(step => step.id === 'routes')!;
    expect(historyAdmissionQueue(job, step)).toEqual({ taskQueue: 'processRouteSyncTask', collection: 'routeSyncQueue' });
    mocks.routes.mockResolvedValueOnce({ count: 100, hasMore: true, afterRouteId: 'route-100' });
    expect(await executeHistoryOperation(job, step, execution)).toEqual({ count: 100, nextStartMs: job.startMs, nextPage: 2, routeAfterId: 'route-100' });
    expect(mocks.routes).toHaveBeenCalledWith('owner', execution, undefined, 0);
    step.routeAfterId = 'route-100'; step.count = 100; step.page = 2;
    expect(await executeHistoryOperation(job, step, execution)).toEqual({ count: 2, nextStartMs: job.endMs + 1000, nextPage: 1, routeAfterId: 'last-route' });
    expect(mocks.routes).toHaveBeenLastCalledWith('owner', execution, 'route-100', 100);
    expect(mocks.activity).not.toHaveBeenCalled(); expect(mocks.suunto).not.toHaveBeenCalled();
  });
  it('reuses Garmin submission without claiming webhook delivery', async () => {
    const job = run(ServiceNames.GarminAPI); await executeHistoryOperation(job, job.steps[0], execution);
    expect(mocks.garminActivity).toHaveBeenCalledWith('owner', new Date(job.startMs), new Date(job.endMs), execution); expect(job.steps[0].capability.completion).toBe('requested');
  });
  it('resumes bounded manual Garmin requests at the failed window and finishes as requested', async () => {
    const job = run(ServiceNames.GarminAPI);
    job.rangePreset = 'custom'; job.startMs = Date.parse('2026-01-01T21:00:00.000Z'); job.endMs = Date.parse('2026-02-02T20:59:59.999Z');
    job.steps = [job.steps[0]]; const step = job.steps[0]; step.nextStartMs = job.startMs;
    const deps = {
      execute: async () => ({ ...await executeHistoryOperation(job, step, execution), childPaths: [] }),
      observe: vi.fn(async () => 'processed' as const),
      classify: () => ({ kind: 'retry' as const, message: 'Temporary provider failure' }),
    };
    await advanceHistoryRun(job, deps, now);
    const resumeMs = Date.parse('2026-01-31T21:00:00.000Z');
    expect(step).toMatchObject({ count: 1, nextStartMs: resumeMs, status: 'queued', done: false });
    expect(mocks.garminActivity).toHaveBeenLastCalledWith('owner', new Date(job.startMs), new Date(resumeMs - 1), execution);
    mocks.garminActivity.mockRejectedValueOnce(new Error('Temporary provider failure'));
    await advanceHistoryRun(job, deps, now + 2000);
    expect(step).toMatchObject({ count: 1, nextStartMs: resumeMs, status: 'retrying', done: false });
    await advanceHistoryRun(job, deps, job.nextAttemptAt);
    expect(mocks.garminActivity.mock.calls.slice(1)).toEqual([
      ['owner', new Date(resumeMs), new Date(job.endMs), execution],
      ['owner', new Date(resumeMs), new Date(job.endMs), execution],
    ]);
    expect(step).toMatchObject({ count: 2, nextStartMs: job.endMs + 1, status: 'requested', done: true, childPaths: [] });
    expect(job.processed).toBe(true);
    expect(deps.observe).not.toHaveBeenCalled();
    expect(mocks.garmin).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it('skips a provider-declared unavailable Garmin range without retrying it', async () => {
    const job = run(ServiceNames.GarminAPI);
    mocks.garminActivity.mockRejectedValue(new GarminHistoryRangeUnavailableError());
    await expect(executeHistoryOperation(job, job.steps[0], execution)).rejects.toMatchObject({ name: 'HistorySkippedError' });
  });
  it('continues a longer Garmin activity import at the provider minimum instead of dropping later history', async () => {
    const job = run(ServiceNames.GarminAPI); job.startMs -= 180 * 86400000; job.steps[0].nextStartMs = job.startMs;
    const minimum = now - 10 * 86400000;
    mocks.garminActivity.mockRejectedValueOnce(new GarminHistoryRangeUnavailableError(new Date(minimum)));
    const skippedWindow = await executeHistoryOperation(job, job.steps[0], execution);
    expect(skippedWindow).toEqual({ count: 0, nextStartMs: minimum, nextPage: 1 });
    job.steps[0].nextStartMs = skippedWindow.nextStartMs;
    expect(await executeHistoryOperation(job, job.steps[0], execution)).toMatchObject({ count: 1, nextStartMs: job.endMs + 1000 });
    expect(mocks.garminActivity).toHaveBeenLastCalledWith('owner', new Date(minimum), new Date(job.endMs), execution);
  });
  it('continues later Garmin Sleep windows after an unavailable early window without expanding the selected range', async () => {
    const job = run(ServiceNames.GarminAPI); job.startMs -= 180 * 86400000; const step = job.steps[1]; step.nextStartMs = job.startMs;
    const minimum = now - 10 * 86400000;
    mocks.garmin.mockRejectedValueOnce(new HistoryUnavailableError('Unavailable Sleep range', minimum));
    const skippedWindow = await executeHistoryOperation(job, step, execution);
    expect(skippedWindow).toEqual({ count: 0, nextStartMs: minimum, nextPage: 1 });
    step.nextStartMs = skippedWindow.nextStartMs;
    expect(await executeHistoryOperation(job, step, execution)).toMatchObject({ count: 1, nextStartMs: job.endMs + 1000 });
    expect(mocks.garmin).toHaveBeenLastCalledWith('owner', { execution, startMs: minimum, endMs: job.endMs, resources: ['sleep'] });
    mocks.garmin.mockRejectedValueOnce(new HistoryUnavailableError('Unavailable Sleep range', job.endMs + 1000));
    await expect(executeHistoryOperation(job, step, execution)).rejects.toThrow('Unavailable Sleep range');
  });
  it.each(['30_days', 'custom'] as const)('resumes Wahoo %s history one page at a time with cumulative counts and a fixed range', async rangePreset => {
    const job = run(ServiceNames.WahooAPI); job.steps[0].page = 3; job.steps[0].count = 100; mocks.wahoo.mockResolvedValue({ successCount: 50, nextPage: 4 });
    job.rangePreset = rangePreset;
    if (rangePreset === 'custom') {
      job.startMs = Date.parse('2026-10-01T21:00:00.000Z'); job.endMs = Date.parse('2026-10-02T20:59:59.999Z');
    }
    expect(await executeHistoryOperation(job, job.steps[0], execution)).toEqual({ count: 50, nextStartMs: job.startMs, nextPage: 4 });
    expect(mocks.wahoo).toHaveBeenCalledWith('owner', new Date(job.startMs), new Date(job.endMs), { execution, singlePage: true, page: 3, processedCountOffset: 100 });
    mocks.wahoo.mockResolvedValueOnce({ successCount: 1 });
    const completed = await executeHistoryOperation(job, job.steps[0], execution);
    expect(completed.nextStartMs).toBeGreaterThan(job.endMs);
  });
  it.each([ServiceNames.SuuntoApp, ServiceNames.GarminAPI, ServiceNames.COROSAPI])('reuses Sleep/Health operations with explicit ranges and capability scope for %s', async service => {
    const job = run(service); const fn = service === ServiceNames.SuuntoApp ? mocks.suunto : service === ServiceNames.GarminAPI ? mocks.garmin : mocks.coros;
    for (const step of job.steps.slice(1).filter(step => step.id !== 'routes')) {
      await executeHistoryOperation(job, step, execution);
      expect(fn).toHaveBeenLastCalledWith('owner', { execution, startMs: job.startMs,
        endMs: job.endMs + (service === ServiceNames.SuuntoApp ? 1 : 0), resources: step.resources,
        ...(service === ServiceNames.SuuntoApp ? { suuntoWindowBatchVersion: 1 } : {}) });
    }
  });
  it.each(['sleep', 'health'] as const)('batches %s without an extra coordinator wait and replays the exact range after an interrupted admission', async resource => {
    const job = run(ServiceNames.SuuntoApp);
    job.startMs = Date.parse('2000-01-01T00:00:00.123Z'); job.endMs = job.startMs + 365 * 86400000 - 1;
    job.steps = [job.steps.find(step => step.id === resource)!];
    const step = job.steps[0]; step.nextStartMs = job.startMs;
    const width = (resource === 'health' ? 26 : 28) * 86400000;
    const deps = { execute: async () => ({ ...await executeHistoryOperation(job, step, execution), childPaths: ['child'] }),
      observe: vi.fn(async (): Promise<HistoryChildObservation> => 'processed'), classify: () => ({ kind: 'retry' as const, message: 'Interrupted admission' }) };
    mocks.suunto.mockRejectedValueOnce(new Error('Interrupted admission'));
    await advanceHistoryRun(job, deps, now);
    expect(step.nextStartMs).toBe(job.startMs);
    await advanceHistoryRun(job, deps, job.nextAttemptAt);
    expect(mocks.suunto.mock.calls[0]).toEqual(mocks.suunto.mock.calls[1]);
    expect(step.nextStartMs).toBe(job.startMs + 4 * width);
    deps.observe.mockResolvedValueOnce('pending');
    await advanceHistoryRun(job, deps, job.nextAttemptAt);
    expect(mocks.suunto).toHaveBeenCalledTimes(2);
    while (!job.processed) await advanceHistoryRun(job, deps, job.nextAttemptAt);
    const calls = mocks.suunto.mock.calls.slice(1).map(([, options]) => options);
    expect(calls).toHaveLength(Math.ceil(365 * 86400000 / (4 * width)));
    let cursor = job.startMs;
    for (const options of calls) {
      expect(options).toMatchObject({ startMs: cursor, resources: [resource], suuntoWindowBatchVersion: 1 });
      expect(options.endMs - options.startMs).toBeLessThanOrEqual(4 * width); cursor = options.endMs;
    }
    expect(cursor).toBe(job.endMs + 1);
    expect(step.status).toBe('processed');
  });
  it.each(['sleep', 'health'] as const)('leaves an existing %s run on its exact legacy plan', async resource => {
    const job = run(ServiceNames.SuuntoApp); job.endMs = job.startMs + 90 * 86400000;
    const step = job.steps.find(step => step.id === resource)!;
    delete step.suuntoWindowBatchVersion; delete step.windowDays;
    const result = await executeHistoryOperation(job, step, execution);
    expect(mocks.suunto).toHaveBeenCalledWith('owner', { execution, startMs: job.startMs,
      endMs: job.startMs + 30 * 86400000 - 1000, resources: [resource] });
    expect(result.nextStartMs).toBe(job.startMs + 30 * 86400000);
  });
  it('skips cooldown scopes without calling the provider', async () => {
    const job = run(ServiceNames.GarminAPI); mocks.meta = { didLastHistoryImport: Date.now() };
    await expect(executeHistoryOperation(job, job.steps[0], execution)).rejects.toMatchObject({ name: 'HistorySkippedError', nextAllowedAtMs: expect.any(Number) }); expect(mocks.garminActivity).not.toHaveBeenCalled();
  });
  it('honors capability availability and rejects unregistered versions', async () => {
    const job = run(ServiceNames.GarminAPI); mocks.healthEnabled.mockReturnValue(false);
    await expect(executeHistoryOperation(job, job.steps[2], execution)).rejects.toThrow('temporarily unavailable'); expect(mocks.garmin).not.toHaveBeenCalled();
    job.steps[0].capability.version = 999; await expect(executeHistoryOperation(job, job.steps[0], execution)).rejects.toThrow('capability changed');
  });
  it.each(['version', 'resource', 'provider'] as const)('rejects an incompatible batch %s instead of reinterpreting it as legacy history', async change => {
    const job = run(change === 'provider' ? ServiceNames.GarminAPI : ServiceNames.SuuntoApp);
    const step = job.steps.find(step => step.id === 'health')!;
    step.suuntoWindowBatchVersion = 1;
    if (change === 'version') Reflect.set(step, 'suuntoWindowBatchVersion', 2);
    if (change === 'resource') step.resources = ['sleep'];
    await expect(executeHistoryOperation(job, step, execution)).rejects.toMatchObject({ name: 'HistorySkippedError' });
    expect(mocks.suunto).not.toHaveBeenCalled(); expect(mocks.garmin).not.toHaveBeenCalled();
  });
});
