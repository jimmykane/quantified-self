import { describe, expect, it } from 'vitest';
import type { TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import type { TrainingVerificationV1 } from '@shared/training-provider-verification';
import { TRAINING_DELIVERY_STATUS_LABELS } from './training-delivery-display.helper';
import { trainingVerificationCommandError, trainingVerificationLabel } from './training-verification-display.helper';

describe('Training remote check labels', () => {
  it('offers another check, not a nonexistent Cancel/Save review, after a revision conflict', () => {
    expect(trainingVerificationCommandError({ code: 'functions/aborted' })).toContain('Check again');
    expect(trainingVerificationCommandError({ code: 'aborted' })).not.toContain('Cancel');
    expect(trainingVerificationCommandError(new Error('failure'))).toContain('Unable to check sync');
  });
  it.each(['failed', 'needs_attention', 'unsupported', 'outside_horizon'] as const)(
    'does not hide %s behind an earlier check or restoration state', status => {
      for (const state of ['present', 'unknown', 'restoring', 'deferred'] as const) {
        expect(trainingVerificationLabel({ status } as TrainingDeliveryStatusV1, { state } as TrainingVerificationV1))
          .toBe(TRAINING_DELIVERY_STATUS_LABELS[status]);
      }
    });
  it.each([
    [false, null, null, 'Not sent · Needs review'],
    [true, 1000, 1000, 'Update needs review'],
    [true, null, 1000, 'Update needs review'],
    [false, 1000, 1000, 'Update needs review'],
    [false, null, 1000, 'Needs review'],
  ])('distinguishes initial review from updates and uncertain acceptance (%s, %s, %s)', (hasRemoteCopy, lastAcceptedAtMs, lastAttemptAtMs, label) => {
    for (const state of ['present', 'restoring', 'unknown'] as const) {
      expect(trainingVerificationLabel({ status: 'approval_required', hasRemoteCopy, lastAcceptedAtMs, lastAttemptAtMs } as TrainingDeliveryStatusV1,
        { state } as TrainingVerificationV1)).toBe(label);
    }
  });
  it('distinguishes the linked activity source, another sent copy and an unrelated past copy', () => {
    const base = { workoutId: 'workout', status: 'past', hasRemoteCopy: true, differsFromQS: false,
      lastAcceptedAtMs: 1000 } as TrainingDeliveryStatusV1;
    expect(trainingVerificationLabel({ ...base, provider: 'suunto' }, undefined,
      { workoutId: 'workout', provider: 'suunto' })).toBe('Completed · activity linked');
    expect(trainingVerificationLabel({ ...base, provider: 'garmin' }, undefined,
      { workoutId: 'workout', provider: 'suunto' })).toBe('Sent · workout completed');
    expect(trainingVerificationLabel({ ...base, provider: 'garmin' })).toBe('Past workout · previously sent');
    expect(trainingVerificationLabel({ ...base, provider: 'garmin', status: 'failed' }, undefined,
      { workoutId: 'workout', provider: 'suunto' })).toBe(TRAINING_DELIVERY_STATUS_LABELS.failed);
    expect(trainingVerificationLabel({ ...base, provider: 'garmin', status: 'delivered' },
      { state: 'confirmed_missing' } as TrainingVerificationV1,
      { workoutId: 'workout', provider: 'suunto' })).toBe('Missing from connected app');
  });
});
