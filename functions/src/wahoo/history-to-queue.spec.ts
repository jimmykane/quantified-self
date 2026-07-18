import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin', () => ({ firestore: vi.fn() }));
vi.mock('../history', () => ({ getNextAllowedHistoryImportDate: vi.fn() }));
vi.mock('../service-disconnect-pending', () => ({ isServiceDisconnectPendingForUser: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: vi.fn(),
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

import { selectWahooHistoryPage } from './history-to-queue';

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
