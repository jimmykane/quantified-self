import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ activity: vi.fn(), garminActivity: vi.fn(), wahoo: vi.fn(), suunto: vi.fn(), coros: vi.fn(), garmin: vi.fn(),
  healthEnabled: vi.fn(), sleepEnabled: vi.fn(), before: vi.fn(), meta: {} as Record<string, unknown> }));
vi.mock('../history', () => ({ addHistoryToQueue: mocks.activity }));
vi.mock('../garmin/backfill', () => ({ processGarminBackfill: mocks.garminActivity, GarminHistoryRangeUnavailableError: class GarminHistoryRangeUnavailableError extends Error {} }));
vi.mock('../wahoo/history-to-queue', () => ({ importWahooHistory: mocks.wahoo }));
vi.mock('../sleep/backfill', () => ({ queueSuuntoSleepHealthHistory: mocks.suunto, queueCorosSleepHealthHistory: mocks.coros, queueGarminSleepHealthHistory: mocks.garmin }));
vi.mock('../garmin/health-flags', () => ({ isGarminHealthSyncEnabled: mocks.healthEnabled }));
vi.mock('../suunto/health-flags', () => ({ isSuuntoHealthSyncEnabled: mocks.healthEnabled }));
vi.mock('../sleep/provider-flags', () => ({ isSleepProviderEnabled: mocks.sleepEnabled, isSleepSyncUserAllowed: () => true }));
vi.mock('./execution', () => ({ assertHistoryConnectionCurrent: vi.fn(), HistoryWindowTooLargeError: class HistoryWindowTooLargeError extends Error {} }));
vi.mock('firebase-admin', () => ({ firestore: () => ({ doc: () => ({ get: async () => ({ data: () => mocks.meta }) }),
  runTransaction: async (work: any) => work({ get: async () => ({ data: () => mocks.meta }), set: vi.fn() }) }) }));
import { GarminHistoryRangeUnavailableError } from '../garmin/backfill';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { CONNECTION_HISTORY_CAPABILITIES, historyCapabilities, type HistoryCapability } from '../../../shared/connection-history';
import { createHistoryRun } from './model';
import { executeHistoryOperation, HISTORY_ADAPTERS, historyAdmissionQueue } from './adapters';
import type { HistoryExecution } from './execution';
const now = Date.parse('2026-03-01T13:00:00+02:00');
function run(service: ServiceNames) { return createHistoryRun('owner', service, { requested: true, flowGeneration: 'flow', providerUserId: 'selected-account', tokenPath: 'private/exact/token', rootPath: 'private/root', credentialGeneration: 'credential' }, 'connection', now); }
const execution = { runId: 'run', tokenPath: 'private/exact/token', providerUserId: 'selected-account', beforeRequest: mocks.before } as unknown as HistoryExecution;
beforeEach(() => { vi.clearAllMocks(); mocks.meta = {}; mocks.healthEnabled.mockReturnValue(true); mocks.sleepEnabled.mockReturnValue(true);
  mocks.activity.mockResolvedValue({ successCount: 2, failureCount: 0 }); mocks.garminActivity.mockResolvedValue(undefined); mocks.wahoo.mockResolvedValue({ successCount: 2 });
  for (const fn of [mocks.suunto, mocks.coros, mocks.garmin]) fn.mockResolvedValue({ queued: 1, sleepQueued: 1, healthQueued: 1 }); });
describe('shared history adapter contracts', () => {
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
  it('reuses Garmin submission without claiming webhook delivery', async () => {
    const job = run(ServiceNames.GarminAPI); await executeHistoryOperation(job, job.steps[0], execution);
    expect(mocks.garminActivity).toHaveBeenCalledWith('owner', new Date(job.startMs), new Date(job.endMs), execution); expect(job.steps[0].capability.completion).toBe('requested');
  });
  it('skips a provider-declared unavailable Garmin range without retrying it', async () => {
    const job = run(ServiceNames.GarminAPI);
    mocks.garminActivity.mockRejectedValue(new GarminHistoryRangeUnavailableError());
    await expect(executeHistoryOperation(job, job.steps[0], execution)).rejects.toMatchObject({ name: 'HistorySkippedError' });
  });
  it('resumes Wahoo one page at a time with cumulative counts and a fixed range', async () => {
    const job = run(ServiceNames.WahooAPI); job.steps[0].page = 3; job.steps[0].count = 100; mocks.wahoo.mockResolvedValue({ successCount: 50, nextPage: 4 });
    expect(await executeHistoryOperation(job, job.steps[0], execution)).toEqual({ count: 50, nextStartMs: job.startMs, nextPage: 4 });
    expect(mocks.wahoo).toHaveBeenCalledWith('owner', new Date(job.startMs), new Date(job.endMs), { execution, singlePage: true, page: 3, processedCountOffset: 100 });
  });
  it.each([ServiceNames.SuuntoApp, ServiceNames.GarminAPI, ServiceNames.COROSAPI])('reuses Sleep/Health operations with explicit ranges and capability scope for %s', async service => {
    const job = run(service); const fn = service === ServiceNames.SuuntoApp ? mocks.suunto : service === ServiceNames.GarminAPI ? mocks.garmin : mocks.coros;
    for (const step of job.steps.slice(1)) {
      await executeHistoryOperation(job, step, execution);
      expect(fn).toHaveBeenLastCalledWith('owner', { execution, startMs: job.startMs, endMs: job.endMs, resources: step.resources });
    }
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
});
