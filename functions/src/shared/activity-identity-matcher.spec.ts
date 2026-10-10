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
  it.each([
    ['Cycling', 'Road Cycling'],
    ['Running', 'Road Running'],
    ['Indoor Running', 'Indoor Track Running'],
    ['Elliptical Trainer', 'Crosstrainer'],
    ['Flexibility Training', 'Stretching'],
    ['Rock Climbing', 'Climbing'],
    ['Generic', 'Chores'],
    ['Generic', 'Meditation'],
  ])('matches a documented %s -> %s refinement with identical source evidence', (oldType, newType) => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const oldActivity = { ...identity('persisted-source-key', startDate), type: oldType };
    const parsedActivity = { ...identity(undefined, startDate), type: newType };
    expect([...resolveActivityIdentityAssignments([oldActivity], [parsedActivity]).assignments])
      .toEqual([[0, 0]]);
    expect(oldActivity.type).toBe(oldType);
    expect(parsedActivity.type).toBe(newType);
  });

  it('matches renamed legs in a reordered multisport event', () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const result = resolveActivityIdentityAssignments([
      { ...identity(undefined, startDate), type: 'Cycling' },
      { ...identity(undefined, startDate + 3_600_000), type: 'Indoor Running' },
    ], [
      { ...identity(undefined, startDate + 3_600_000), type: 'Indoor Track Running' },
      { ...identity(undefined, startDate), type: 'Road Cycling' },
    ]);
    expect([...result.assignments].sort()).toEqual([[0, 1], [1, 0]]);
  });

  it('rejects type refinements with differing or missing source evidence', () => {
    const original = { ...identity(undefined, 1_000), type: 'Cycling' };
    const refined = { ...identity(undefined, 1_000), type: 'Road Cycling' };
    [
      { ...refined, startDate: 2_000 },
      { ...refined, endDate: 4_000_000 },
      { ...refined, endDate: null },
      { ...refined, getStat: () => null },
      { ...refined, getStat: () => ({ getValue: () => null }) },
      { ...identity(undefined, 1_000, 3_600, 12_000), type: 'Road Cycling' },
      { ...refined, type: 'Mountain Biking' },
    ].forEach(candidate => expect(resolveActivityIdentityAssignments([original], [candidate]).assignments.size).toBe(0));
    expect(resolveActivityIdentityAssignments(
      [{ ...original, sourceActivityKey: 'source-a' }],
      [{ ...refined, sourceActivityKey: 'source-b' }],
    ).assignments.size).toBe(0);
  });

  it('fails closed on ambiguous refinements in either direction without transitive type equivalence', () => {
    const generic = { ...identity(undefined, 1_000), type: 'Generic' };
    const chores = { ...identity(undefined, 1_000), type: 'Chores' };
    const meditation = { ...identity(undefined, 1_000), type: 'Meditation' };
    expect(resolveActivityIdentityAssignments([generic], [chores, meditation]).assignments.size).toBe(0);
    expect(resolveActivityIdentityAssignments([generic, generic], [chores]).assignments.size).toBe(0);
    expect(resolveActivityIdentityAssignments([chores], [meditation]).assignments.size).toBe(0);
  });

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

  it('fails closed when the only remaining parsed and persisted identities disagree', () => {
    const result = resolveActivityIdentityAssignments([
      identity('persisted-source', Date.parse('2026-07-01T08:00:00.000Z')),
    ], [
      identity('different-source', Date.parse('2026-07-02T08:00:00.000Z')),
    ]);

    expect(result.assignments.size).toBe(0);
    expect(result.unmatchedParsedIndexes).toEqual([0]);
    expect(result.unmatchedExistingIndexes).toEqual([0]);
  });

  it('retains the one-remaining-item fallback only when a legacy caller requests it', () => {
    const result = resolveActivityIdentityAssignments([
      identity('persisted-source', Date.parse('2026-07-01T08:00:00.000Z')),
    ], [
      identity('different-source', Date.parse('2026-07-02T08:00:00.000Z')),
    ], {
      allowSingleRemainingFallback: true,
    });

    expect([...result.assignments.entries()]).toEqual([[0, 0]]);
    expect(result.unmatchedParsedIndexes).toEqual([]);
    expect(result.unmatchedExistingIndexes).toEqual([]);
  });
});
