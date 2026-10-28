import { describe, expect, it } from 'vitest';
import { carryActivitySourceIdentity, readActivitySourceIdentity } from '../../../shared/activity-source-identity';

describe('activity source provenance', () => {
  const source = { version: 1, activityId: 'existing-id', startMs: 0, endMs: 1000, importedType: 'Stretching' };
  it('accepts a bounded snapshot for its own stable document ID without mutating it', () => {
    expect(readActivitySourceIdentity(source, 'existing-id')).toEqual(source);
    expect(readActivitySourceIdentity(source, 'different-id')).toBeNull();
    expect(readActivitySourceIdentity(source)).not.toBe(source);
  });
  it('hydrates provenance for the matched saved ID while keeping the file sport', () => {
    const existing = { getID: () => 'existing-id', type: 'Pilates', sourceIdentity: source };
    const parsed = { getID: () => 'existing-id', type: 'Yoga' };
    carryActivitySourceIdentity(existing, parsed);
    expect(parsed).toEqual({ getID: parsed.getID, type: 'Yoga', sourceIdentity: { ...source, importedType: 'Yoga' } });
    const unmatched = { getID: () => 'other', type: 'Yoga' };
    carryActivitySourceIdentity(existing, unmatched);
    expect(unmatched).not.toHaveProperty('sourceIdentity');
    expect(unmatched.type).toBe('Yoga');
  });

  it.each([null, [], {}, { ...source, version: 2 }, { ...source, activityId: 'other/id' },
    { ...source, startMs: NaN }, { ...source, endMs: -1 }, { ...source, importedType: '' },
    { ...source, importedType: 'x'.repeat(121) }])('rejects malformed or unbound provenance: %j', input => {
    expect(readActivitySourceIdentity(input)).toBeNull();
  });
});
