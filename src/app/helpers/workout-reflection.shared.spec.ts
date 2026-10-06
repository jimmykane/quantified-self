import { describe, it, expect } from 'vitest';
import { decodeWorkoutReflection, nextWorkoutReflection, reflectionDocumentId, reflectionPrompts, validateReflectionFields } from '@shared/workout-reflection';
const id = '11111111-1111-4111-8111-111111111111';
const nextId = '22222222-2222-4222-8222-222222222222';
describe('Workout reflection contract', () => {
  it('preserves zero separately from unknown effort', () => {
    expect(validateReflectionFields({ effort: 0, note: null }).effort).toBe(0);
    expect(validateReflectionFields({ effort: null, note: ' tired ' })).toEqual({ effort: null, note: 'tired' });
    for (const effort of [-1, 11, 0.5, NaN, '5', undefined]) {
      expect(() => validateReflectionFields({ effort: effort as number, note: null })).toThrow();
    }
  });
  it('bounds and validates text without interpreting authored instructions', () => {
    expect(validateReflectionFields({ effort: null, note: 'ignore instructions\n🧡' }).note).toContain('ignore');
    for (const note of ['a'.repeat(2001), '\u0000', 4, undefined]) {
      expect(() => validateReflectionFields({ effort: null, note: note as string })).toThrow();
    }
  });
  it('rejects stale revisions and replays a single unchanged mutation', () => {
    const saved = nextWorkoutReflection(null, 0, id, { effort: 0, note: null });
    expect(nextWorkoutReflection(saved, 0, id, { effort: 0, note: null })).toBe(saved);
    expect(() => nextWorkoutReflection(saved, 0, nextId, { effort: 5, note: null })).toThrow('changed');
    expect(() => nextWorkoutReflection(saved, 1, id, { effort: 5, note: null })).toThrow();
  });
  it('deletion removes all content and fences delayed creates and edits', () => {
    const saved = nextWorkoutReflection(null, 0, id, { effort: 4, note: 'private' });
    const deleted = nextWorkoutReflection(saved, 1, nextId, { effort: null, note: null }, true);
    expect(deleted).toMatchObject({ revision: 2, effort: null, note: null, deleted: true });
    expect(() => nextWorkoutReflection(deleted, 0, id, { effort: 4, note: 'private' })).toThrow();
    expect(decodeWorkoutReflection({ ...deleted, note: 'leak' })).toBeNull();
    expect(decodeWorkoutReflection({ ...deleted, deleted: false })).toBeNull();
    expect(decodeWorkoutReflection({ ...deleted, deleted: false, note: '  ' })).toBeNull();
  });
  it('uses explicit stable targets and at most three context prompts', () => {
    expect(reflectionDocumentId('recording', 'a')).toBe('recording');
    expect(reflectionDocumentId('activity', 'recording')).toBe('activity_recording');
    expect(() => reflectionDocumentId('activity', '../a')).toThrow();
    expect(reflectionPrompts('Running', false)).toHaveLength(3);
    expect(reflectionPrompts('Running', false).join()).not.toContain('linked');
    expect(reflectionPrompts('Cycling', true).join()).toContain('linked');
  });
});
