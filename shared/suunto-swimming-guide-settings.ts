/** Owner display preferences, not workout prescriptions or provider consent. */
export const SUUNTO_SWIM_WORK_FIELDS = ['distance', 'duration', 'pace', 'interval', 'heartRate', 'strokes', 'strokeRate', 'swolf', 'workoutDistance'] as const;
export const SUUNTO_SWIM_REST_FIELDS = ['interval', 'previousPlannedDistance', 'nextPlannedDistance', 'heartRate', 'workoutDistance', 'workoutStrokes'] as const;
export type SuuntoSwimWorkField = typeof SUUNTO_SWIM_WORK_FIELDS[number];
export type SuuntoSwimRestField = typeof SUUNTO_SWIM_REST_FIELDS[number];
export interface SuuntoSwimmingGuideSettings {
  version: 1;
  workFields: SuuntoSwimWorkField[];
  restFields: SuuntoSwimRestField[];
}
export const SUUNTO_SWIM_FIELD_LABELS: Readonly<Record<SuuntoSwimWorkField | SuuntoSwimRestField, string>> = {
  distance: 'Interval distance / distance remaining', duration: 'Interval elapsed time', pace: 'Current lap average pace',
  interval: 'Planned interval number', heartRate: 'Current heart rate', strokes: 'Current lap stroke count',
  strokeRate: 'Current lap average stroke rate', swolf: 'Current lap average SWOLF (pool only)',
  workoutDistance: 'Total workout distance', workoutStrokes: 'Total workout stroke count',
  previousPlannedDistance: 'Previous planned interval distance', nextPlannedDistance: 'Next planned interval distance',
};
export function defaultSuuntoSwimmingGuideSettings(): SuuntoSwimmingGuideSettings {
  return { version: 1, workFields: ['distance', 'duration', 'pace', 'interval'],
    restFields: ['interval', 'previousPlannedDistance', 'nextPlannedDistance', 'heartRate'] };
}
function fields<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return Array.isArray(value) && value.length <= 5 && Array.from(value).every(field => typeof field === 'string' && allowed.includes(field as T))
    && new Set(value).size === value.length;
}
export function parseSuuntoSwimmingGuideSettings(value: unknown): SuuntoSwimmingGuideSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid swimming Guide settings.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['version', 'workFields', 'restFields'].includes(key)) || data.version !== 1
    || !fields(data.workFields, SUUNTO_SWIM_WORK_FIELDS) || !fields(data.restFields, SUUNTO_SWIM_REST_FIELDS)) {
    throw new Error('Invalid swimming Guide settings.');
  }
  return { version: 1, workFields: [...data.workFields], restFields: [...data.restFields] };
}
/** Untrusted owner settings can choose only bounded, documented fields. */
export function normalizeSuuntoSwimmingGuideSettings(value: unknown): SuuntoSwimmingGuideSettings {
  try { return parseSuuntoSwimmingGuideSettings(value); } catch { return defaultSuuntoSwimmingGuideSettings(); }
}
