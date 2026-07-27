import { DataDistance, DataDuration } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  ActivityIdentityLike,
  resolveActivityIdentityAssignments,
} from './activity-identity-matcher';

function identity(
  sourceActivityKey: string | undefined,
  startDate: number,
  duration = 3_600,
  distance = 10_000,
): ActivityIdentityLike {
  return {
    sourceActivityKey,
    startDate,
    endDate: startDate + (duration * 1_000),
    type: 'Running',
    getStat: type => ({
      getValue: () => type === DataDuration.type
        ? duration
        : type === DataDistance.type
          ? distance
          : null,
    }),
  };
}

describe('activity identity matcher', () => {
  it('prefers unique source keys before otherwise ambiguous signatures', () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const result = resolveActivityIdentityAssignments([
      identity('source-a', startDate),
      identity('source-b', startDate),
    ], [
      identity('source-b', startDate),
      identity('source-a', startDate),
    ]);

    expect([...result.assignments.entries()]).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(result.unmatchedParsedIndexes).toEqual([]);
    expect(result.unmatchedExistingIndexes).toEqual([]);
  });

  it('uses a unique strict identity signature when source keys are unavailable', () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const result = resolveActivityIdentityAssignments([
      identity(undefined, startDate, 3_600, 10_000),
      identity(undefined, startDate + 7_200_000, 1_800, 5_000),
    ], [
      identity(undefined, startDate + 7_200_000, 1_800, 5_000),
      identity(undefined, startDate, 3_600, 10_000),
    ]);

    expect([...result.assignments.entries()]).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it('leaves duplicate source keys and signatures unmatched', () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const result = resolveActivityIdentityAssignments([
      identity('duplicate', startDate),
      identity('duplicate', startDate),
    ], [
      identity('duplicate', startDate),
      identity('duplicate', startDate),
    ]);

    expect(result.assignments.size).toBe(0);
    expect(result.unmatchedParsedIndexes).toEqual([0, 1]);
    expect(result.unmatchedExistingIndexes).toEqual([0, 1]);
  });
});
