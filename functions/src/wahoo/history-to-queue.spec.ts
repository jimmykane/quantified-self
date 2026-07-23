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
  getStateInTransaction: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => firestoreMocks.firestore, {
    FieldValue: { delete: () => 'delete-field' },
  }),
}));
vi.mock('../history', () => ({ getNextAllowedHistoryImportDate: vi.fn() }));
vi.mock('../service-disconnect-pending', () => ({ isServiceDisconnectPendingForUser: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: deletionGuardMocks.getStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));
vi.mock('../tokens', () => ({ getTokenData: vi.fn() }));
vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  enforceAppCheck: vi.fn(),
  generateIDFromParts: vi.fn(),
  hasProAccess: vi.fn(),
  PRO_REQUIRED_MESSAGE: 'Pro required',
}));
vi.mock('./auth/api', () => ({
  requestWahooAPI: vi.fn(),
  WahooAPIRequestError: class WahooAPIRequestError extends Error {},
}));
vi.mock('./queue-store', () => ({ upsertWahooWorkoutQueueItem: vi.fn() }));

import { finishWahooHistoryLease, selectWahooHistoryPage } from './history-to-queue';

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

describe('finishWahooHistoryLease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
