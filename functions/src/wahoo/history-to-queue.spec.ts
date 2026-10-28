import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { withHistoryExecution } from '../connection-history/context';
import type { HistoryExecution } from '../connection-history/execution';
import { startManualActivityHistory } from '../connection-history/manual-activity';
import { enforceAppCheck, hasProAccess } from '../utils';
import { getNextAllowedHistoryImportDate } from '../history';
import { SERVICE_NAME } from './constants';

vi.mock('../connection-history/manual-activity', () => ({ startManualActivityHistory: vi.fn() }));
vi.mock('firebase-functions/v2/https', async importOriginal => ({
  ...await importOriginal<typeof import('firebase-functions/v2/https')>(),
  onCall: (_options: unknown, handler: unknown) => handler,
}));

const firestoreMocks = vi.hoisted(() => {
  const metaRef = { path: 'users/user-1/meta/Wahoo API' };
  const transactionGet = vi.fn();
  const transactionSet = vi.fn();
  const transaction = { get: transactionGet, set: transactionSet };
  const runTransaction = vi.fn(async (runner: (value: typeof transaction) => unknown) => runner(transaction));
  const firestore = {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({ doc: vi.fn(() => metaRef) })),
      })),
    })),
    runTransaction,
  };
  return { metaRef, transactionGet, transactionSet, runTransaction, firestore };
});

const deletionGuardMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  getStateInTransaction: vi.fn(),
}));

const historyMocks = vi.hoisted(() => ({
  isDisconnectPendingForUser: vi.fn(),
  assertWahooConnectionAvailable: vi.fn(),
  getTokenData: vi.fn(),
  generateIDFromParts: vi.fn(),
  requestWahooAPI: vi.fn(),
  upsertWahooWorkoutQueueItem: vi.fn(),
  getActiveWahooTokenSnapshot: vi.fn(),
  captureWahooActiveAccountGuard: vi.fn(),
  assertWahooActiveAccountGuardCurrent: vi.fn(),
  assertWahooActiveAccountGuardCurrentInTransaction: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => firestoreMocks.firestore,
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => 'delete-field' },
}));
vi.mock('../history', () => ({ getNextAllowedHistoryImportDate: vi.fn() }));
vi.mock('../service-disconnect-pending', () => ({
  isServiceDisconnectPendingForUser: historyMocks.isDisconnectPendingForUser,
}));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: deletionGuardMocks.getState,
  getUserDeletionGuardStateInTransaction: deletionGuardMocks.getStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));
vi.mock('./refresh-recovery', () => ({
  assertWahooConnectionAvailable: historyMocks.assertWahooConnectionAvailable,
  isWahooReconnectRequiredError: (error: unknown) => (
    error instanceof Error && error.name === 'WahooReconnectRequiredError'
  ),
  isWahooRefreshBackoffError: (error: unknown) => (
    error instanceof Error && error.name === 'WahooRefreshBackoffError'
  ),
  isWahooRefreshContentionError: (error: unknown) => (
    error instanceof Error && (
      error.name === 'TokenRefreshInProgressError'
      || error.name === 'TokenRefreshSupersededError'
      || error.name === 'WahooCredentialSupersededError'
    )
  ),
}));
vi.mock('../tokens', () => ({ getTokenData: historyMocks.getTokenData }));
vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  enforceAppCheck: vi.fn(),
  generateIDFromParts: historyMocks.generateIDFromParts,
  hasProAccess: vi.fn(),
  PRO_REQUIRED_MESSAGE: 'Pro required',
}));
vi.mock('./auth/api', () => ({
  requestWahooAPI: historyMocks.requestWahooAPI,
  WahooAPIRequestError: class WahooAPIRequestError extends Error {},
}));
vi.mock('./queue-store', () => ({
  upsertWahooWorkoutQueueItem: historyMocks.upsertWahooWorkoutQueueItem,
}));
vi.mock('./account', () => ({
  getActiveWahooTokenSnapshot: historyMocks.getActiveWahooTokenSnapshot,
  captureWahooActiveAccountGuard: historyMocks.captureWahooActiveAccountGuard,
  assertWahooActiveAccountGuardCurrent: historyMocks.assertWahooActiveAccountGuardCurrent,
  assertWahooActiveAccountGuardCurrentInTransaction: historyMocks.assertWahooActiveAccountGuardCurrentInTransaction,
  normalizeWahooUserID: (value: unknown) => `${value || ''}`.trim() || null,
}));

import {
  addWahooAPIHistoryToQueue,
  finishWahooHistoryLease,
  importWahooHistory,
  selectWahooHistoryPage,
  toWahooHistoryCallableError,
} from './history-to-queue';

function workout(id: number, starts: string, options: { file?: boolean; fitnessAppID?: number } = {}) {
  return {
    id,
    starts,
    workout_summary: {
      id: id + 100,
      updated_at: starts,
      fitness_app_id: options.fitnessAppID ?? 5,
      file: options.file === false ? null : { url: `https://cdn.wahooligan.com/${id}.fit` },
    },
  };
}

describe('selectWahooHistoryPage', () => {
  const start = new Date('2026-07-10T00:00:00.000Z');
  const end = new Date('2026-07-18T23:59:59.999Z');

  it('keeps the inclusive range and stops at the first older descending workout', () => {
    const result = selectWahooHistoryPage('user-1', [
      workout(1, '2026-07-20T10:00:00.000Z'),
      workout(2, '2026-07-18T10:00:00.000Z'),
      workout(3, '2026-07-10T00:00:00.000Z'),
      workout(4, '2026-07-09T23:59:59.999Z'),
      workout(5, '2026-07-08T10:00:00.000Z'),
    ], start, end);

    expect(result.items.map(item => item.workoutID)).toEqual(['2', '3']);
    expect(result.reachedStart).toBe(true);
  });

  it('skips no-FIT and third-party-origin records without stopping pagination', () => {
    const result = selectWahooHistoryPage('user-1', [
      workout(1, '2026-07-18T10:00:00.000Z', { file: false }),
      workout(2, '2026-07-17T10:00:00.000Z', { fitnessAppID: 1001 }),
      workout(3, '2026-07-16T10:00:00.000Z'),
    ], start, end);

    expect(result.items.map(item => item.workoutID)).toEqual(['3']);
    expect(result.skippedCount).toBe(2);
    expect(result.reachedStart).toBe(false);
  });
});

describe('toWahooHistoryCallableError', () => {
  it('preserves the Wahoo refresh retry time for callable clients', () => {
    const refreshError = Object.assign(new Error('backoff'), {
      name: 'WahooRefreshBackoffError',
      retryAt: 1_800_000_000_000,
    });

    expect(toWahooHistoryCallableError(refreshError)).toMatchObject({
      code: 'unavailable',
      details: { retryAt: 1_800_000_000_000 },
    });
  });

  it('tells callable clients to reconnect for terminal Wahoo recovery state', () => {
    const reconnectError = Object.assign(new Error('reconnect'), {
      name: 'WahooReconnectRequiredError',
    });

    expect(toWahooHistoryCallableError(reconnectError)).toMatchObject({
      code: 'unauthenticated',
      message: 'Reconnect Wahoo before importing history.',
    });
  });

  it('translates a named terminal refresh failure after lifecycle cleanup', () => {
    const terminalError = Object.assign(new Error('invalid_grant'), {
      name: 'TerminalServiceAuthError',
      providerErrorCode: 'invalid_grant',
    });

    expect(toWahooHistoryCallableError(terminalError)).toMatchObject({
      code: 'unauthenticated',
      message: 'Reconnect Wahoo before importing history.',
    });
  });

  it.each([
    'TokenRefreshInProgressError',
    'TokenRefreshSupersededError',
    'WahooCredentialSupersededError',
  ])('maps %s to an unavailable history callable error', (name) => {
    const error = Object.assign(new Error('refresh contention'), { name });

    expect(toWahooHistoryCallableError(error)).toMatchObject({
      code: 'unavailable',
      message: 'Wahoo credentials are being refreshed. Please retry shortly.',
    });
  });
});

describe('finishWahooHistoryLease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deletionGuardMocks.getState.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    deletionGuardMocks.getStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    firestoreMocks.transactionGet.mockResolvedValue({
      data: () => ({ historyImportLeaseOwner: 'lease-1' }),
    });
  });

  it('records completion only while the owning user remains active', async () => {
    await finishWahooHistoryLease(
      'user-1',
      'lease-1',
      new Date('2026-07-10T00:00:00.000Z'),
      new Date('2026-07-18T00:00:00.000Z'),
      4,
      true,
    );

    expect(deletionGuardMocks.getStateInTransaction).toHaveBeenCalledWith(
      firestoreMocks.firestore,
      expect.anything(),
      'user-1',
    );
    expect(firestoreMocks.transactionSet).toHaveBeenCalledWith(
      firestoreMocks.metaRef,
      expect.objectContaining({
        historyImportLeaseOwner: 'delete-field',
        processedActivitiesFromLastHistoryImportCount: 4,
      }),
      { merge: true },
    );
  });

  it('keeps the original automatic cooldown anchor across pages and retries', async () => {
    const connectedAt = Date.parse('2026-07-18T00:00:00Z');
    const execution = { cooldownStartedAtMs: connectedAt, inTransaction: vi.fn() } as unknown as HistoryExecution;
    for (const count of [4, 8]) {
      await withHistoryExecution(execution, () => finishWahooHistoryLease('user-1', 'lease-1', new Date('2026-06-19'), new Date(connectedAt), count, true));
      expect(firestoreMocks.transactionSet).toHaveBeenLastCalledWith(firestoreMocks.metaRef,
        expect.objectContaining({ didLastHistoryImport: connectedAt, processedActivitiesFromLastHistoryImportCount: count }), { merge: true });
    }
  });

  it('does not recreate Wahoo metadata after account deletion begins', async () => {
    deletionGuardMocks.getStateInTransaction.mockResolvedValue({
      userExists: false,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await finishWahooHistoryLease(
      'user-1',
      'lease-1',
      new Date('2026-07-10T00:00:00.000Z'),
      new Date('2026-07-18T00:00:00.000Z'),
      4,
      true,
    );

    expect(firestoreMocks.transactionGet).not.toHaveBeenCalled();
    expect(firestoreMocks.transactionSet).not.toHaveBeenCalled();
  });
});

describe('importWahooHistory account fencing', () => {
  const accountGuard = {
    providerUserId: 'wahoo-user-1',
    connectionStateGeneration: 'connection-1',
    activeCredentialGeneration: 'credential-1',
    credential: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deletionGuardMocks.getState.mockResolvedValue({ shouldSkip: false });
    deletionGuardMocks.getStateInTransaction.mockResolvedValue({ shouldSkip: false });
    firestoreMocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({}),
    });
    historyMocks.isDisconnectPendingForUser.mockResolvedValue(false);
    historyMocks.assertWahooConnectionAvailable.mockResolvedValue(undefined);
    historyMocks.getActiveWahooTokenSnapshot.mockResolvedValue({
      id: 'wahoo-user-1',
      data: () => ({ wahooUserID: 'wahoo-user-1' }),
    });
    historyMocks.getTokenData.mockResolvedValue({
      accessToken: 'access-token',
      wahooUserID: 'wahoo-user-1',
    });
    historyMocks.captureWahooActiveAccountGuard.mockResolvedValue(accountGuard);
    historyMocks.assertWahooActiveAccountGuardCurrent.mockResolvedValue(undefined);
    historyMocks.assertWahooActiveAccountGuardCurrentInTransaction.mockResolvedValue(undefined);
    historyMocks.generateIDFromParts.mockResolvedValue('queue-1');
    historyMocks.requestWahooAPI.mockResolvedValue({
      data: {
        workouts: [workout(1, '2026-07-18T10:00:00.000Z')],
        total: 1,
      },
    });
    historyMocks.upsertWahooWorkoutQueueItem.mockResolvedValue({ queued: true });
    vi.mocked(startManualActivityHistory).mockReset();
    vi.mocked(enforceAppCheck).mockReset();
    vi.mocked(hasProAccess).mockResolvedValue(true);
    vi.mocked(getNextAllowedHistoryImportDate).mockResolvedValue(null);
  });

  describe('manual history callable', () => {
    const data = { startDate: '2026-07-10T21:00:00.000Z', endDate: '2026-07-18T20:59:59.999Z', background: true };
    type TestRequest = { auth: { uid: string } | null; app: { appId: string }; data: unknown };
    const request = (): TestRequest => ({ auth: { uid: 'user-1' }, app: { appId: 'test-app' }, data: { ...data } });
    const invoke = addWahooAPIHistoryToQueue as unknown as (request: TestRequest) => Promise<unknown>;

    it('accepts exact selected dates without fetching credentials, scanning Wahoo or queuing workouts', async () => {
      const projection = { runId: 'run', active: true } as Awaited<ReturnType<typeof startManualActivityHistory>>;
      vi.mocked(startManualActivityHistory).mockResolvedValue(projection);
      await expect(invoke(request())).resolves.toEqual({ result: 'History import accepted', historyImport: projection });
      expect(startManualActivityHistory).toHaveBeenCalledWith('user-1', SERVICE_NAME, new Date(data.startDate), new Date(data.endDate));
      expect(enforceAppCheck).toHaveBeenCalledOnce();
      expect(hasProAccess).toHaveBeenCalledWith('user-1');
      expect(historyMocks.getActiveWahooTokenSnapshot).not.toHaveBeenCalled();
      expect(historyMocks.requestWahooAPI).not.toHaveBeenCalled();
      expect(historyMocks.upsertWahooWorkoutQueueItem).not.toHaveBeenCalled();
    });

    it.each([undefined, false])('preserves legacy stats for older clients with background=%s', async background => {
      const input = { ...request(), data: { ...data, background } };
      await expect(invoke(input)).resolves.toMatchObject({
        result: 'Wahoo history items added to queue', stats: { successCount: 1, pagesFetched: 1 },
      });
      expect(startManualActivityHistory).not.toHaveBeenCalled();
      expect(getNextAllowedHistoryImportDate).toHaveBeenCalledWith('user-1', SERVICE_NAME);
      expect(historyMocks.requestWahooAPI).toHaveBeenCalledOnce();
    });

    it.each(['already-exists', 'permission-denied', 'failed-precondition'] as const)('does not fall back after an admission %s error', async code => {
      const error = new HttpsError(code, 'Admission rejected');
      vi.mocked(startManualActivityHistory).mockRejectedValue(error);
      await expect(invoke(request())).rejects.toBe(error);
      expect(historyMocks.requestWahooAPI).not.toHaveBeenCalled();
    });

    it.each(['app-check', 'auth', 'pro'])('requires %s before background admission', async guard => {
      const input = request();
      if (guard === 'app-check') vi.mocked(enforceAppCheck).mockImplementation(() => { throw new HttpsError('unauthenticated', 'App Check required'); });
      if (guard === 'auth') input.auth = null;
      if (guard === 'pro') vi.mocked(hasProAccess).mockResolvedValue(false);
      await expect(invoke(input)).rejects.toMatchObject({ code: guard === 'pro' ? 'permission-denied' : 'unauthenticated' });
      expect(startManualActivityHistory).not.toHaveBeenCalled();
      expect(historyMocks.requestWahooAPI).not.toHaveBeenCalled();
    });

    it.each([
      { ...data, background: 'true' }, { ...data, startDate: 'invalid' },
      { ...data, endDate: '2026-07-01' }, {},
    ])('rejects invalid input before admission', async invalidData => {
      await expect(invoke({ ...request(), data: invalidData })).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(startManualActivityHistory).not.toHaveBeenCalled();
      expect(historyMocks.requestWahooAPI).not.toHaveBeenCalled();
    });
  });

  it('queues one bounded page per coordinator step and resumes with the same exact range', async () => {
    const start = new Date('2026-07-10T21:00:00.000Z'), end = new Date('2026-07-18T20:59:59.999Z');
    const execution = { runId: 'manual-run', beforeRequest: vi.fn(), inTransaction: vi.fn(), onQueued: vi.fn() } as unknown as HistoryExecution;
    historyMocks.generateIDFromParts.mockImplementation(async parts => parts.join('-'));
    historyMocks.requestWahooAPI.mockResolvedValueOnce({ data: {
      workouts: Array.from({ length: 100 }, (_, index) => workout(index + 1, end.toISOString())), total: 104,
    } });
    const first = await importWahooHistory('user-1', start, end, { execution, singlePage: true });
    expect(first).toMatchObject({ successCount: 100, pagesFetched: 1, nextPage: 2 });
    expect(historyMocks.requestWahooAPI).toHaveBeenCalledOnce();
    expect(execution.onQueued).toHaveBeenCalledTimes(100);
    historyMocks.requestWahooAPI.mockResolvedValueOnce({ data: { workouts: [
      workout(101, start.toISOString()), workout(102, start.toISOString(), { file: false }),
      workout(103, start.toISOString(), { fitnessAppID: 1001 }), workout(104, new Date(start.getTime() - 1).toISOString()),
    ], total: 104 } });
    const second = await importWahooHistory('user-1', start, end, { execution, singlePage: true, page: first.nextPage, processedCountOffset: first.successCount });
    expect(second).toMatchObject({ successCount: 1, skippedCount: 2, pagesFetched: 1 });
    expect(second.nextPage).toBeUndefined();
    expect(historyMocks.requestWahooAPI).toHaveBeenLastCalledWith('access-token', '/v1/workouts?page=2&per_page=100');
    expect(historyMocks.upsertWahooWorkoutQueueItem).toHaveBeenCalledTimes(101);
    expect(historyMocks.upsertWahooWorkoutQueueItem).toHaveBeenLastCalledWith(expect.objectContaining({
      workoutID: '101', firebaseUserID: 'user-1', fromHistory: true, connectionHistoryRunId: 'manual-run',
    }), 'deferred', expect.any(Function));
    expect(execution.beforeRequest).toHaveBeenCalledTimes(2);
    expect(execution.onQueued).toHaveBeenLastCalledWith('wahooAPIWorkoutQueue/wahoo-user-1-101');
  });

  it('stops before queue insertion when the Wahoo account changes after a page fetch', async () => {
    historyMocks.assertWahooActiveAccountGuardCurrent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('account changed'), { code: 'unauthenticated' }));

    await expect(importWahooHistory(
      'user-1',
      new Date('2026-07-10T00:00:00.000Z'),
      new Date('2026-07-18T23:59:59.999Z'),
    )).rejects.toThrow('account changed');

    expect(historyMocks.upsertWahooWorkoutQueueItem).not.toHaveBeenCalled();
  });

  it('rejects an automatic-history reservation before provider work without remapping the busy response', async () => {
    firestoreMocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ connectionHistoryReservation: 'automatic-run', connectionHistoryReservationExpiresAt: Date.now() + 60_000 }),
    });
    const error = await importWahooHistory('user-1', new Date('2026-07-10'), new Date('2026-07-18')).catch(error => error);

    expect(error).toBeInstanceOf(HttpsError);
    expect(error).toMatchObject({ code: 'already-exists', httpErrorCode: { status: 409 } });
    expect(toWahooHistoryCallableError(error)).toBeNull();
    expect(historyMocks.requestWahooAPI).not.toHaveBeenCalled();
    expect(historyMocks.upsertWahooWorkoutQueueItem).not.toHaveBeenCalled();
    expect(firestoreMocks.transactionSet).not.toHaveBeenCalled();
  });

  it('binds every history queue write to the captured Wahoo account transactionally', async () => {
    const queueTransaction = { get: vi.fn() };
    historyMocks.upsertWahooWorkoutQueueItem.mockImplementationOnce(async (_item, _dispatch, authorize) => {
      await authorize(queueTransaction);
      return { queued: true };
    });

    await expect(importWahooHistory(
      'user-1',
      new Date('2026-07-10T00:00:00.000Z'),
      new Date('2026-07-18T23:59:59.999Z'),
    )).resolves.toMatchObject({ successCount: 1 });

    expect(historyMocks.assertWahooActiveAccountGuardCurrentInTransaction).toHaveBeenCalledWith(
      queueTransaction,
      'user-1',
      accountGuard,
    );
  });

  it('aborts the history import when the account fence fails inside queue insertion', async () => {
    const accountChanged = Object.assign(new Error('account changed during queue write'), {
      code: 'unauthenticated',
    });
    historyMocks.upsertWahooWorkoutQueueItem.mockImplementationOnce(async (_item, _dispatch, authorize) => {
      historyMocks.assertWahooActiveAccountGuardCurrentInTransaction.mockRejectedValueOnce(accountChanged);
      await authorize({});
      return { queued: true };
    });
    historyMocks.assertWahooActiveAccountGuardCurrent
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(accountChanged);

    await expect(importWahooHistory(
      'user-1',
      new Date('2026-07-10T00:00:00.000Z'),
      new Date('2026-07-18T23:59:59.999Z'),
    )).rejects.toThrow('account changed during queue write');
  });
});
