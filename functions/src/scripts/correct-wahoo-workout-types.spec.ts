import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => ({
  getUserDeletionGuardState: vi.fn(),
  isServiceDisconnectPendingForUser: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: vi.fn(() => ({ name: 'firestore' })),
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: mocks.getUserDeletionGuardState,
}));

vi.mock('../service-disconnect-pending', () => ({
  isServiceDisconnectPendingForUser: mocks.isServiceDisconnectPendingForUser,
}));

import {
  assertWahooCorrectionApplied,
  assertWahooCorrectionMutationAllowed,
  buildWahooWorkoutTypeUpdateForm,
} from './correct-wahoo-workout-types';

describe('Wahoo workout type correction script safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: false });
    mocks.isServiceDisconnectPendingForUser.mockResolvedValue(false);
  });

  it('allows a mutation only while the user and Wahoo connection remain active', async () => {
    await expect(assertWahooCorrectionMutationAllowed('user-1')).resolves.toBeUndefined();
    expect(mocks.isServiceDisconnectPendingForUser).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.WahooAPI,
    );
  });

  it('blocks a mutation if account deletion starts after the initial inspection', async () => {
    mocks.getUserDeletionGuardState.mockResolvedValueOnce({ shouldSkip: true });

    await expect(assertWahooCorrectionMutationAllowed('user-1'))
      .rejects.toThrow('deleted or deleting user');
    expect(mocks.isServiceDisconnectPendingForUser).not.toHaveBeenCalled();
  });

  it('blocks a mutation while Wahoo disconnect is pending', async () => {
    mocks.isServiceDisconnectPendingForUser.mockResolvedValueOnce(true);

    await expect(assertWahooCorrectionMutationAllowed('user-1'))
      .rejects.toThrow('disconnect is pending');
  });

  it('fails verification when Wahoo does not retain the requested type', () => {
    expect(() => assertWahooCorrectionApplied(
      '485861650',
      { id: '485861650', name: 'Cycling', workoutTypeId: 0, workoutTypeName: 'BIKING' },
      { id: 9, name: 'HIKING' },
    )).toThrow('did not retain the requested type');
  });

  it('accepts a matching type while preserving Wahoo\'s existing title', () => {
    expect(() => assertWahooCorrectionApplied(
      '485861650',
      { id: '485861650', name: 'Sunday in the hills', workoutTypeId: 9, workoutTypeName: 'HIKING' },
      { id: 9, name: 'HIKING' },
    )).not.toThrow();
  });

  it('builds a type-only update so the existing Wahoo title is preserved', () => {
    const form = buildWahooWorkoutTypeUpdateForm(9);

    expect(form.get('workout[workout_type_id]')).toBe('9');
    expect(form.has('workout[name]')).toBe(false);
  });
});
