import { DataDistance, DataDuration } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  ActivityIdentityLike,
  HISTORICAL_IMPORT_TYPE_REFINEMENTS,
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
  it('allows mutable sport/stat fields only inside a verified recording with unique source windows', () => {
    const old = { ...identity('old-file', 1000), type: 'Stretching' };
    const next = { ...identity('new-file', 1000, 3600, 0), type: 'Yoga' };
    expect(resolveActivityIdentityAssignments([old], [next]).assignments.size).toBe(0);
    expect([...resolveActivityIdentityAssignments([old], [next], { allowSourceWindowMatch: true }).assignments]).toEqual([[0, 0]]);
    for (const candidate of [{ ...next, startDate: 2000 }, { ...next, endDate: null }])
      expect(resolveActivityIdentityAssignments([old], [candidate], { allowSourceWindowMatch: true }).assignments.size).toBe(0);
    for (const [before, after] of [[[old, old], [next]], [[old], [next, next]]])
      expect(resolveActivityIdentityAssignments(before, after, { allowSourceWindowMatch: true }).assignments.size).toBe(0);
  });

  it('uses the bound source snapshot for reads without mutating the saved document', () => {
    const old = { ...identity(undefined, 1000), type: 'Yoga', getID: () => 'stable-id',
      sourceIdentity: { version: 1, activityId: 'stable-id', startMs: 1000, endMs: 3601000, importedType: 'Stretching' } };
    const incoming = { ...identity(undefined, 1000), type: 'Stretching' };
    expect([...resolveActivityIdentityAssignments([old], [incoming]).assignments]).toEqual([[0, 0]]);
    expect(old.type).toBe('Yoga');
    expect(resolveActivityIdentityAssignments([{ ...old, getID: () => 'different-id' }], [incoming]).assignments.size).toBe(0);
  });

  it('carries only explicitly certified stable IDs across Training sport changes', () => {
    const old = { ...identity(undefined, 1000), getID: () => 'stable', type: 'Stretching' };
    const incoming = { ...identity(undefined, 1000), getID: () => 'stable', type: 'Yoga' };
    expect(resolveActivityIdentityAssignments([old], [incoming]).assignments.size).toBe(0);
    expect([...resolveActivityIdentityAssignments([old], [incoming], { verifiedActivityIds: new Set(['stable']) }).assignments]).toEqual([[0, 0]]);
    expect(resolveActivityIdentityAssignments([old], [{ ...incoming, getID: () => 'foreign' }],
      { verifiedActivityIds: new Set(['stable']) }).assignments.size).toBe(0);
    expect(resolveActivityIdentityAssignments([old, old], [incoming],
      { verifiedActivityIds: new Set(['stable']) }).assignments.size).toBe(0);
  });

  it.each(HISTORICAL_IMPORT_TYPE_REFINEMENTS)('matches a documented %s -> %s refinement with identical source evidence', (oldType, newType) => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const oldActivity = { ...identity('persisted-source-key', startDate), type: oldType };
    const parsedActivity = { ...identity(undefined, startDate), type: newType };
    expect([...resolveActivityIdentityAssignments([oldActivity], [parsedActivity]).assignments])
      .toEqual([[0, 0]]);
    expect([...resolveActivityIdentityAssignments([oldActivity], [parsedActivity], { requireStrictMatch: true }).assignments]).toEqual([[0, 0]]);
    expect(oldActivity.type).toBe(oldType);
    expect(parsedActivity.type).toBe(newType);

    const sourceHash = 'a'.repeat(64);
    const keyedOld = { ...oldActivity, sourceActivityKey: `${sourceHash}:${'b'.repeat(64)}:0` };
    const keyedParsed = { ...parsedActivity, sourceActivityKey: `${sourceHash}:${'c'.repeat(64)}:0` };
    for (const [existing, parsed] of [[keyedOld, keyedParsed], [keyedParsed, keyedOld]]) {
      expect([...resolveActivityIdentityAssignments([existing], [parsed]).assignments]).toEqual([[0, 0]]);
    }
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

  it('matches several corpus-verified renames without relying on the one-leg fallback', () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const result = resolveActivityIdentityAssignments([
      { ...identity(undefined, startDate), type: 'Hiking' },
      { ...identity(undefined, startDate + 3_600_000), type: 'Backcountry Skiing' },
      { ...identity(undefined, startDate + 7_200_000), type: 'Running' },
    ], [
      { ...identity(undefined, startDate + 7_200_000), type: 'Track Running' },
      { ...identity(undefined, startDate), type: 'Trekking' },
      { ...identity(undefined, startDate + 3_600_000), type: 'Ski Touring' },
    ]);
    expect([...result.assignments].sort()).toEqual([[0, 2], [1, 0], [2, 1]]);
    expect(result.unmatchedParsedIndexes).toEqual([]);
    expect(result.unmatchedExistingIndexes).toEqual([]);
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
      { ...refined, type: 'Swimming' },
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

  it('rejects different source hashes, malformed generated keys and unapproved type pairs', () => {
    const sourceHash = 'a'.repeat(64);
    const oldKey = `${sourceHash}:${'b'.repeat(64)}:0`;
    const newKey = `${sourceHash}:${'c'.repeat(64)}:0`;
    const original = { ...identity(oldKey, 1_000), type: 'Hiking' };
    const refined = { ...identity(newKey, 1_000), type: 'Trekking' };
    for (const sourceActivityKey of [
      `${'d'.repeat(64)}:${'c'.repeat(64)}:0`,
      `${sourceHash}:${'c'.repeat(64)}`,
      `${newKey}:extra`,
      `${sourceHash}:${'g'.repeat(64)}:0`,
      'arbitrary-source-key',
    ]) {
      expect(resolveActivityIdentityAssignments([original], [{ ...refined, sourceActivityKey }]).assignments.size).toBe(0);
    }
    expect(resolveActivityIdentityAssignments(
      [{ ...original, type: 'Road Cycling' }], [{ ...refined, type: 'Gravel Cycling' }],
    ).assignments.size).toBe(0);
  });

  it('retains time, duration, distance and ambiguity guards for matching generated source hashes', () => {
    const sourceHash = 'a'.repeat(64);
    const original = { ...identity(`${sourceHash}:${'b'.repeat(64)}:0`, 1_000), type: 'Hiking' };
    const refined = { ...identity(`${sourceHash}:${'c'.repeat(64)}:0`, 1_000), type: 'Trekking' };
    for (const candidate of [
      { ...refined, startDate: 2_000 },
      { ...refined, endDate: 4_000_000 },
      { ...identity(refined.sourceActivityKey, 1_000, 1_800), type: 'Trekking', endDate: original.endDate },
      { ...identity(refined.sourceActivityKey, 1_000, 3_600, 12_000), type: 'Trekking' },
    ]) {
      expect(resolveActivityIdentityAssignments([original], [candidate]).assignments.size).toBe(0);
    }
    expect(resolveActivityIdentityAssignments([original, original], [refined]).assignments.size).toBe(0);
    expect(resolveActivityIdentityAssignments([original], [refined, refined]).assignments.size).toBe(0);
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

  it('requires complete strict evidence for report links even when keys agree', () => {
    const old = identity('shared-key', Date.parse('2026-07-01T08:00:00Z'));
    const mismatches = [
      { ...old, endDate: Number(old.endDate) + 1000 },
      { ...old, getStat: () => ({ getValue: () => 999 }) },
      { ...old, getStat: () => null },
      { ...old, type: 'Cycling' },
    ];
    for (const parsed of mismatches) {
      expect(resolveActivityIdentityAssignments([old], [parsed], {
        requireStrictMatch: true,
      }).assignments.size).toBe(0);
    }
    expect([...resolveActivityIdentityAssignments([old], [old], { requireStrictMatch: true }).assignments]).toEqual([[0, 0]]);
  });

  it('uses source-file hashes to disambiguate otherwise identical strict report participants', () => {
    const start = Date.parse('2026-07-01T08:00:00Z');
    const a = identity(`${'a'.repeat(64)}:${'c'.repeat(64)}:0`, start);
    const b = identity(`${'b'.repeat(64)}:${'c'.repeat(64)}:0`, start);
    expect([...resolveActivityIdentityAssignments([a, b], [b, a], { requireStrictMatch: true }).assignments]).toEqual([[0, 1], [1, 0]]);
    const wrongFile = { ...a, sourceActivityKey: `${'f'.repeat(64)}:${'c'.repeat(64)}:0` };
    expect(resolveActivityIdentityAssignments([a], [wrongFile], { requireStrictMatch: true }).assignments.size).toBe(0);
  });

  it('leaves unrelated last remaining legs unmatched', () => {
    const result = resolveActivityIdentityAssignments([
      identity('persisted-source', Date.parse('2026-07-01T08:00:00.000Z')),
    ], [identity('different-source', Date.parse('2026-07-02T08:00:00.000Z'))]);
    expect(result.assignments.size).toBe(0);
    expect(result.unmatchedParsedIndexes).toEqual([0]);
    expect(result.unmatchedExistingIndexes).toEqual([0]);
  });
});
