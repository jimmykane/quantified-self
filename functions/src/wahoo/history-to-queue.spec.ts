import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => {
  const metaRef = { path: 'users/user-1/meta/Wahoo API' };
  const transactionGet = vi.fn();
  const transactionSet = vi.fn();
  const transaction = { get: transactionGet, set: transactionSet };
  const runTransaction = vi.fn(async (runner: any) => runner(transaction));
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
