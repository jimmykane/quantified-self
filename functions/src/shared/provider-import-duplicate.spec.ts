import { describe, expect, it } from 'vitest';
import type { ActivityIdentityLike } from './activity-identity-matcher';
import { isCrossProviderRunCopy, isGarminActivityCopy } from './provider-import-duplicate';

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

describe('cross-provider outdoor run recordings', () => {
  function runPair(type = 'Trail Running', generic = 'Running', duration = 1800.4, distance = 4950) {
    const result = pair(type, generic);
    result.incoming.endDate = new Date(result.startMs + 1_850_000);
    result.incoming.getStat = key => ({ getValue: () => key === 'Duration' ? duration : distance });
    return result;
  }

  it.each([['Trail Running', 'Running'], ['Running', 'Trail Running'], ['Road Running', 'Running']])(
    'recognizes %s and %s with a matching window and bounded watch differences', (type, generic) => {
      const { saved, incoming } = runPair(type, generic, 1800.7);
      const before = JSON.stringify([saved, incoming]);
      expect(isCrossProviderRunCopy(saved, incoming)).toBe(true);
      expect(JSON.stringify([saved, incoming])).toBe(before);
    });

  it('allows the duration and distance bounds, but rejects values just outside them', () => {
    const { saved, incoming } = runPair('Trail Running', 'Running', 1801.4, 4900);
    expect(isCrossProviderRunCopy(saved, incoming)).toBe(true);
    incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1801.401 : 4900 });
    expect(isCrossProviderRunCopy(saved, incoming)).toBe(false);
    incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1800.4 : 4899.99 });
    expect(isCrossProviderRunCopy(saved, incoming)).toBe(false);
  });

  it.each(['start', 'end', 'missing-source', 'wrong-source-id', 'missing-stat', 'nonfinite-stat',
    'zero-duration', 'zero-distance', 'negative-distance', 'duration-exceeds-window'])(
    'rejects insufficient evidence: %s', scenario => {
      const { saved, incoming, startMs } = runPair();
      if (scenario === 'start') incoming.startDate = new Date(startMs + 1);
      if (scenario === 'end') incoming.endDate = new Date(startMs + 1_850_001);
      if (scenario === 'missing-source') delete saved.sourceIdentity;
      if (scenario === 'wrong-source-id') saved.getID = () => 'other';
      if (scenario === 'missing-stat') incoming.getStat = () => null;
      if (scenario === 'nonfinite-stat') incoming.getStat = () => ({ getValue: () => NaN });
      if (scenario === 'zero-duration') incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 0 : 5000 });
      if (scenario === 'zero-distance') incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1800.4 : 0 });
      if (scenario === 'negative-distance') incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1800.4 : -1 });
      if (scenario === 'duration-exceeds-window') {
        saved.getStat = incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1851.01 : 5000 });
      }
      expect(isCrossProviderRunCopy(saved, incoming)).toBe(false);
    });

  it.each(['Treadmill', 'Indoor Running', 'Virtual Running', 'Walking', 'Hiking', 'Cycling', 'Unknown Sport'])(
    'does not extend the outdoor-running rule to %s', type => {
      const { saved, incoming } = runPair(type);
      expect(isCrossProviderRunCopy(saved, incoming)).toBe(false);
      expect(isCrossProviderRunCopy(runPair().saved, { ...incoming, type })).toBe(false);
    });
});

describe('Garmin activity copies from Suunto', () => {
  it.each([
    ['Treadmill', 'Running', 5000], ['Indoor Rowing', 'Rowing', 0],
  ] as const)('recognizes %s exported as %s without modifying saved data', (type, generic, distance) => {
    const { saved, incoming } = pair(type, generic, distance);
    const before = JSON.stringify(saved);
    expect(isGarminActivityCopy(saved, incoming)).toBe(true);
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
    expect(isGarminActivityCopy(saved, incoming)).toBe(false);
  });

  it('compares original sport provenance while preserving a live owner sport edit', () => {
    const { saved, incoming } = pair();
    saved.type = 'Walking';
    expect(isGarminActivityCopy(saved, incoming)).toBe(true);
    expect(saved.type).toBe('Walking');
  });

  it.each([0, 0.25, -0.75, 1, -1])('recognizes a Running/Trail Running copy with timer drift %s and retained pauses', drift => {
    const { saved, incoming, startMs } = pair('Running', 'Trail Running');
    incoming.endDate = new Date(startMs + 1_850_000);
    incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1800.4 + drift : 5000 });
    expect(isGarminActivityCopy(saved, incoming)).toBe(true);
  });

  function virtualPair() {
    const result = pair('Virtual Running', 'Running');
    (result.saved.sourceIdentity as Record<string, unknown>).endMs = result.startMs + 1_801_000;
    return result;
  }

  it('recognizes a Virtual Running copy ending one second earlier', () => {
    const { saved, incoming } = virtualPair();
    expect(isGarminActivityCopy(saved, incoming)).toBe(true);
  });

  it.each(['start', 'end', 'duration', 'distance', 'source', 'sport', 'zero-duration'])(
    'rejects contradictory new-pair evidence: %s', scenario => {
      for (const kind of ['trail', 'virtual']) {
        const { saved, incoming, startMs } = kind === 'trail' ? pair('Running', 'Trail Running') : virtualPair();
        if (kind === 'trail') incoming.endDate = new Date(startMs + 1_850_000);
        if (scenario === 'start') incoming.startDate = new Date(startMs + 1);
        if (scenario === 'end') incoming.endDate = new Date(Number(incoming.endDate) - 1);
        if (scenario === 'duration') incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1801.401 : 5000 });
        if (scenario === 'distance') incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1800.4 : 5000.01 });
        if (scenario === 'source') delete saved.sourceIdentity;
        if (scenario === 'sport') incoming.type = 'Hiking';
        if (scenario === 'zero-duration') incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 0 : 5000 });
        expect(isGarminActivityCopy(saved, incoming)).toBe(false);
      }
    });

  it('retains exact active-time matching for existing indoor pairs', () => {
    const { saved, incoming } = pair();
    incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 1800.5 : 5000 });
    expect(isGarminActivityCopy(saved, incoming)).toBe(false);
  });

  it('rejects a zero-length Virtual Running copy even with a subsecond active duration', () => {
    const { saved, incoming, startMs } = virtualPair();
    (saved.sourceIdentity as Record<string, unknown>).endMs = startMs + 500;
    saved.getStat = incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 0.4 : 5000 });
    incoming.endDate = new Date(startMs);
    expect(isGarminActivityCopy(saved, incoming)).toBe(false);
  });
});
