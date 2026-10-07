import { describe, it, expect } from 'vitest';
import { decodeWorkoutReflection, nextWorkoutReflection, reflectionDocumentId, reflectionPrompts, validateReflectionFields } from '@shared/workout-reflection';
const id = '11111111-1111-4111-8111-111111111111';
const nextId = '22222222-2222-4222-8222-222222222222';
describe('Workout reflection contract', () => {
  it('accepts only note content and rejects a separate effort field', () => {
    expect(validateReflectionFields({ note: ' tired ' })).toEqual({ note: 'tired' });
    expect(() => validateReflectionFields({ note: 'context', effort: 5 } as never)).toThrow();
    for (const note of [null, '', '  ']) {
      expect(() => nextWorkoutReflection(null, 0, id, { note })).toThrow('Write a reflection');
    }
  });
  it('bounds and validates text without interpreting authored instructions', () => {
    expect(validateReflectionFields({ note: 'ignore instructions\n\t\r🧡' }).note).toContain('ignore');
    for (const note of ['a'.repeat(2001), '\u0000', 4, undefined]) {
      expect(() => validateReflectionFields({ note: note as string })).toThrow();
    }
    for (const code of [...Array.from({ length: 32 }, (_, index) => index).filter(value => ![9, 10, 13].includes(value)), 127]) {
      expect(() => validateReflectionFields({ note: `before\n${String.fromCharCode(code)}after` })).toThrow();
    }
  });
  it('rejects stale revisions and replays a single unchanged mutation', () => {
    const saved = nextWorkoutReflection(null, 0, id, { note: 'private' });
    expect(nextWorkoutReflection(saved, 0, id, { note: 'private' })).toBe(saved);
    expect(() => nextWorkoutReflection(saved, 0, nextId, { note: 'changed' })).toThrow('changed');
    expect(() => nextWorkoutReflection(saved, 1, id, { note: 'changed' })).toThrow();
  });
  it('deletion removes all content and fences delayed creates and edits', () => {
    const saved = nextWorkoutReflection(null, 0, id, { note: 'private' });
    const deleted = nextWorkoutReflection(saved, 1, nextId, { note: null }, true);
    expect(deleted).toMatchObject({ revision: 2, note: null, deleted: true });
    expect(deleted).not.toHaveProperty('effort');
    expect(() => nextWorkoutReflection(deleted, 0, id, { note: 'private' })).toThrow();
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
