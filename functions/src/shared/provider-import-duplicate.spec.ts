import { describe, expect, it } from 'vitest';
import type { ActivityIdentityLike } from './activity-identity-matcher';
import { isGarminIndoorActivityCopy } from './provider-import-duplicate';

function pair(type = 'Treadmill', generic = 'Running', distance = 5000) {
  const startMs = 1_700_000_000_000;
  const stats: Record<string, number> = { Duration: 1800.4, Distance: distance };
  const saved: ActivityIdentityLike = { getID: () => 'saved', type,
    sourceIdentity: { version: 1, activityId: 'saved', startMs, endMs: startMs + 1_850_000, importedType: type },
    getStat: key => ({ getValue: () => stats[key] }) };
  const incoming: ActivityIdentityLike = { type: generic, startDate: new Date(startMs), endDate: new Date(startMs + 1_800_000),
    getStat: key => ({ getValue: () => stats[key] }) };
  return { saved, incoming, startMs };
}

describe('Garmin indoor activity copies', () => {
  it.each([
    ['Treadmill', 'Running', 5000], ['Indoor Rowing', 'Rowing', 0],
  ] as const)('recognizes %s exported as %s without modifying saved data', (type, generic, distance) => {
    const { saved, incoming } = pair(type, generic, distance);
    const before = JSON.stringify(saved);
    expect(isGarminIndoorActivityCopy(saved, incoming)).toBe(true);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it.each([
    'start', 'duration', 'distance', 'missing-stat', 'nonfinite-stat', 'negative-distance', 'zero-duration',
    'end-not-active-time', 'end-after-saved', 'source-id', 'missing-source', 'source-window', 'sport',
  ])('rejects insufficient or contradictory evidence: %s', scenario => {
    const { saved, incoming, startMs } = pair();
    if (scenario === 'start') incoming.startDate = new Date(startMs + 1);
    if (scenario === 'duration') incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1801 : 5000 });
    if (scenario === 'distance') incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1800.4 : 5001 });
    if (scenario === 'missing-stat') saved.getStat = () => null;
    if (scenario === 'nonfinite-stat') saved.getStat = () => ({ getValue: () => NaN });
    if (scenario === 'negative-distance') saved.getStat = key => ({ getValue: () => key === 'Duration' ? 1800.4 : -1 });
    if (scenario === 'zero-duration') saved.getStat = key => ({ getValue: () => key === 'Duration' ? 0 : 5000 });
    if (scenario === 'end-not-active-time') incoming.endDate = new Date(startMs + 1_802_000);
    if (scenario === 'end-after-saved') (saved.sourceIdentity as Record<string, unknown>).endMs = startMs + 1_799_000;
    if (scenario === 'source-id') saved.getID = () => 'another-activity';
    if (scenario === 'missing-source') delete saved.sourceIdentity;
    if (scenario === 'source-window') (saved.sourceIdentity as Record<string, unknown>).endMs = startMs - 1;
    if (scenario === 'sport') incoming.type = 'Trail Running';
    expect(isGarminIndoorActivityCopy(saved, incoming)).toBe(false);
  });

  it('compares original sport provenance while preserving a live owner sport edit', () => {
    const { saved, incoming } = pair();
    saved.type = 'Walking';
    expect(isGarminIndoorActivityCopy(saved, incoming)).toBe(true);
    expect(saved.type).toBe('Walking');
  });
});
