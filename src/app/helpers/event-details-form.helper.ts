import { DataFeeling, DataRPE, Feelings, RPEBorgCR10SCale, type EventInterface, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';

export interface EventDetailsValues { name: string; description: string; feeling: number | null; rpe: number | null }
export type EventDetailsChanges = { [K in keyof EventDetailsValues]?: { before: EventDetailsValues[K]; after: EventDetailsValues[K] } };
export function eventDetailsValues(event: EventInterface): EventDetailsValues {
  const feeling = event.getStat?.(DataFeeling.type);
  const rpe = event.getStat?.(DataRPE.type);
  return { name: event.name || '', description: event.description || '',
    feeling: validFeedbackValue(feeling ? feeling.getValue() : undefined, 'feeling'),
    rpe: validFeedbackValue(rpe ? rpe.getValue() : undefined, 'rpe') };
}
function validFeedbackValue(value: unknown, kind: 'feeling' | 'rpe'): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    && (kind === 'rpe' ? value >= 0 && value <= 10 : Number.isInteger(value) && value >= 1 && value <= 5) ? value : null;
}
export function eventDetailsChanges(before: EventDetailsValues, after: EventDetailsValues): EventDetailsChanges {
  const changes: EventDetailsChanges = {};
  if (before.name !== after.name) changes.name = { before: before.name, after: after.name };
  if (before.description !== after.description) changes.description = { before: before.description, after: after.description };
  if (before.feeling !== after.feeling) changes.feeling = { before: before.feeling, after: after.feeling };
  if (before.rpe !== after.rpe) changes.rpe = { before: before.rpe, after: after.rpe };
  return changes;
}
/** Only edited fields are patched; unrelated or concurrently updated stats are preserved. */
export function eventDetailsWritePatch(current: Record<string, unknown>, changes: EventDetailsChanges): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const stats = current.stats && typeof current.stats === 'object' ? current.stats as Record<string, unknown> : {};
  for (const key of Object.keys(changes)) {
    if (!['name', 'description', 'feeling', 'rpe'].includes(key)) throw new Error('Invalid event detail change.');
    const change = changes[key as keyof EventDetailsChanges];
    if (!change) throw new Error('Invalid event detail change.');
    const metric = key === 'rpe' ? DataRPE.type : DataFeeling.type;
    const isText = key === 'name' || key === 'description';
    const value = isText ? current[key] || '' : validFeedbackValue(stats[metric], key as 'feeling' | 'rpe');
    if (isText ? typeof change.after !== 'string' : validFeedbackValue(change.after, key as 'feeling' | 'rpe') === null) {
      throw new Error('Invalid event detail value.');
    }
    if (value === change.after) continue; // An unchanged uncertain retry already succeeded.
    if (value !== change.before) throw new Error('Event details changed elsewhere. Reopen the editor before saving.');
    patch[isText ? key : `stats.${metric}`] = change.after;
  }
  return patch;
}
export function feedbackOptions(kind: 'feeling' | 'rpe', saved: number | null, settings?: UserUnitSettingsInterface) {
  const type = kind === 'rpe' ? DataRPE.type : DataFeeling.type;
  const values = Object.values(kind === 'rpe' ? RPEBorgCR10SCale : Feelings).filter((value): value is number => typeof value === 'number');
  if (saved !== null && !values.includes(saved)) values.push(saved);
  return values.sort((a, b) => a - b).map(value => ({ value, label: resolveUnitAwareDisplayFromValue(type, value, settings)?.text || '' }));
}
