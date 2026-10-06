/** Private athlete-authored context. Never an imported stat, prescription, or completion signal. */
export const WORKOUT_REFLECTION_COLLECTION = 'workoutReflections';
export const WORKOUT_REFLECTION_NOTE_LIMIT = 2000;
export type WorkoutReflectionTarget = 'recording' | 'activity';
export interface WorkoutReflectionFields { effort: number | null; note: string | null }
export interface WorkoutReflection extends WorkoutReflectionFields {
  schemaVersion: 1;
  revision: number;
  deleted: boolean;
  mutationId: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function reflectionDocumentId(target: WorkoutReflectionTarget, activityId: string): string {
  if (!activityId || activityId.length > 1400 || activityId.includes('/') || /^\.+$/.test(activityId)) {
    throw new Error('The recording target is invalid.');
  }
  return target === 'recording' ? 'recording' : `activity_${activityId}`;
}
export function validateReflectionFields(value: WorkoutReflectionFields): WorkoutReflectionFields {
  if (!value || Object.keys(value).some(key => !['effort', 'note'].includes(key))
    || !(value.effort === null || (Number.isInteger(value.effort) && value.effort >= 0 && value.effort <= 10))
    || !(value.note === null || (typeof value.note === 'string' && value.note.length <= WORKOUT_REFLECTION_NOTE_LIMIT
      && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.note)))) {
    throw new Error('Choose a whole-number effort from 0 to 10 and a note of at most 2000 characters.');
  }
  return { effort: value.effort, note: value.note?.trim() || null };
}
export function decodeWorkoutReflection(value: unknown): WorkoutReflection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || Number(record.revision) < 1
    || Number(record.revision) >= Number.MAX_SAFE_INTEGER || typeof record.deleted !== 'boolean'
    || typeof record.mutationId !== 'string' || !uuid.test(record.mutationId)) return null;
  try {
    const fields = validateReflectionFields({ effort: record.effort as number | null, note: record.note as string | null });
    if (record.deleted ? (fields.effort !== null || fields.note !== null) : (fields.effort === null && fields.note === null)) return null;
    return { schemaVersion: 1, revision: Number(record.revision), deleted: record.deleted,
      mutationId: record.mutationId, ...fields };
  } catch { return null; }
}
/** Shared optimistic/retry semantics for browser transactions and reviewed MCP writes. */
export function nextWorkoutReflection(current: WorkoutReflection | null, expectedRevision: number,
  mutationId: string, fields: WorkoutReflectionFields, deleted = false): WorkoutReflection {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER - 1
    || !uuid.test(mutationId)) throw new Error('The reflection change is invalid.');
  const validated = deleted ? { effort: null, note: null } : validateReflectionFields(fields);
  if (!deleted && validated.effort === null && validated.note === null) {
    throw new Error('Add effort or a note, or skip this reflection.');
  }
  if (current?.mutationId === mutationId && current.revision === expectedRevision + 1
    && current.deleted === deleted && current.effort === validated.effort && current.note === validated.note) return current;
  if ((current?.revision ?? 0) !== expectedRevision || current?.mutationId === mutationId) {
    throw new Error('Reflection changed elsewhere. Reload it before editing.');
  }
  return { schemaVersion: 1, revision: expectedRevision + 1, mutationId, deleted, ...validated };
}
export function reflectionPrompts(sport: string, exactlyLinked: boolean): readonly string[] {
  return [
    'How did this session feel overall?',
    /run|walk|hike/i.test(sport) ? 'Did terrain or conditions affect how it felt?'
      : /cycl|bik/i.test(sport) ? 'Did wind, terrain, or fueling affect how it felt?'
      : /swim/i.test(sport) ? 'How did your breathing and technique feel?'
      : 'Was anything different from your usual session?',
    exactlyLinked ? 'What felt different from the linked planned workout?'
      : 'Anything about fatigue or recovery you want to remember?',
  ];
}
