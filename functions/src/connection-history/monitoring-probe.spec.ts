import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
vi.mock('./adapters', () => ({ historyAdmissionQueue: vi.fn(), historyCooldownUntil: vi.fn(), historySleepProvider: vi.fn(), getHistoryAdapter: vi.fn() }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHistoryRun } from './model';
import { historyProbeCandidate, historyProbeDue, observeConnectionHistory, HISTORY_PROBE_TIMEOUT_MS } from './monitoring-probe';
const run = () => createHistoryRun('qa', ServiceNames.WahooAPI, { requested: true, rangePreset: '30_days',
  runId: '11111111-1111-4111-8111-111111111111', tokenPath: 'wahooAPIAccessTokens/qa/tokens/account', rootPath: 'wahooAPIAccessTokens/qa', providerUserId: 'account', credentialGeneration: 'generation' }, 'connection', 1000);
describe('bounded history observation selection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());
  it('uses scheduler time, only at each UTC quarter hour', () => {
    for (const minute of [0, 15, 30, 45]) expect(historyProbeDue(`2026-10-09T12:${String(minute).padStart(2, '0')}:00Z`)).toBe(true);
    for (const time of [undefined, 'private', '2026-10-09T12:14:00Z']) expect(historyProbeDue(time)).toBe(false);
  });
  it('excludes processed, future retries and active leases, but observes overdue finalization', () => {
    const row = run(); expect(historyProbeCandidate(row, 2000)).toBe('eligible');
    row.nextAttemptAt = 3000; expect(historyProbeCandidate(row, 2000)).toBe('excluded');
    row.nextAttemptAt = 1000; row.leaseExpiresAt = 3000; expect(historyProbeCandidate(row, 2000)).toBe('excluded');
    delete row.leaseExpiresAt; row.steps[0].status = 'retrying'; expect(historyProbeCandidate(row, 2000)).toBe('eligible');
    row.nextAttemptAt = 3000; expect(historyProbeCandidate(row, 2000)).toBe('excluded'); row.nextAttemptAt = 1000;
    row.steps[0].done = true; expect(historyProbeCandidate(row, 2000)).toBe('eligible');
    row.processed = true; expect(historyProbeCandidate(row, 2000)).toBe('excluded');
  });
  it('reports malformed scheduling and oversized recipes as unknown', () => {
    const row = run(); row.nextAttemptAt = NaN; expect(historyProbeCandidate(row, 2000)).toBe('unknown');
    row.nextAttemptAt = 1000; row.steps = Array(11).fill(row.steps[0]); expect(historyProbeCandidate(row, 2000)).toBe('unknown');
  });
  it('times out with four unavailable heartbeats and suppresses late healthy observations', async () => {
    vi.useFakeTimers();
    let resolveQuery!: (value: unknown) => void;
    const query: any = { where: () => query, orderBy: () => query, select: () => query, limit: () => query,
      get: () => new Promise(resolve => { resolveQuery = resolve; }) };
    const db: any = { collection: () => query, runTransaction: vi.fn() };
    const observation = observeConnectionHistory(db, vi.fn(), vi.fn(), 2000);
    await vi.advanceTimersByTimeAsync(HISTORY_PROBE_TIMEOUT_MS);
    await observation;
    expect(logger.warn).toHaveBeenCalledTimes(4);
    resolveQuery({ size: 0, docs: [] }); await vi.advanceTimersByTimeAsync(0);
    expect(logger.info).not.toHaveBeenCalled(); expect(db.runTransaction).not.toHaveBeenCalled();
  });
});
