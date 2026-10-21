import { ActivityTypeGroups, ActivityTypesHelper, DataAscent, DataDistance, DataDuration, type ActivityInterface, type EventInterface } from '@sports-alliance/sports-lib';
import { trainingLoadTimeMs } from './training-load-source';

export interface ActivityAscentCorrection {
  value: number;
  sourceValue: number | null;
}

export type AscentCorrectedActivity = ActivityInterface & { ascentCorrection?: ActivityAscentCorrection };
export const MAX_ACTIVITY_ASCENT_METERS = 1_000_000;

export interface ActivityAscentEdit {
  activityId: string;
  ascent: number | null;
  expectedSourceFingerprint: string;
  expectedCorrection: ActivityAscentCorrection | null;
}

/** Canonical values committed by the owner-only processing transaction. */
export interface ActivityAscentUpdate {
  activityId: string;
  ascent: number | null;
  eventAscent: number | null;
  correction: ActivityAscentCorrection | null;
}

/** Patch summaries in place so an open chart retains its hydrated activities and streams. */
export function applySavedActivityAscent(event: EventInterface, saved: ActivityAscentUpdate): void {
  const activity = event.getActivities().find(item => item.getID() === saved.activityId) as AscentCorrectedActivity | undefined;
  if (activity) {
    if (saved.ascent === null) activity.removeStat(DataAscent.type);
    else activity.addStat(new DataAscent(saved.ascent));
    if (saved.correction) activity.ascentCorrection = { ...saved.correction };
    else delete activity.ascentCorrection;
  }
  if (saved.eventAscent === null) event.removeStat(DataAscent.type);
  else event.addStat(new DataAscent(saved.eventAscent));
}

export function validActivityAscent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ACTIVITY_ASCENT_METERS;
}

export function readActivityAscent(stats: unknown): number | null {
  if (!stats || typeof stats !== 'object') return null;
  const raw = (stats as Record<string, unknown>)[DataAscent.type];
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).value
    ?? (raw as Record<string, unknown>).rawValue ?? (raw as Record<string, unknown>)._value : raw;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function readAscentCorrection(value: unknown): ActivityAscentCorrection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const correction = value as Record<string, unknown>;
  if (Object.keys(correction).some(key => key !== 'value' && key !== 'sourceValue')
    || !validActivityAscent(correction.value)
    || !(correction.sourceValue === null || (typeof correction.sourceValue === 'number'
      && Number.isFinite(correction.sourceValue) && correction.sourceValue >= 0))) return null;
  return { value: correction.value, sourceValue: correction.sourceValue as number | null };
}

export function isTerrainAscentActivity(type: unknown): boolean {
  return typeof type === 'string'
    && ActivityTypesHelper.getActivityGroupForActivityType(type as ActivityInterface['type']) !== ActivityTypeGroups.DivingGroup;
}

/** Source parses update the reset value; browser hydration keeps the persisted source value. */
export function applyActivityAscentCorrection(activity: AscentCorrectedActivity, value: unknown, freshSource = false): void {
  const correction = readAscentCorrection(value);
  if (!correction) return;
  if (!isTerrainAscentActivity(activity.type)) throw new Error('An ascent correction cannot be applied to a diving activity.');
  activity.ascentCorrection = { ...correction, sourceValue: freshSource
    ? readActivityAscent(activity.toJSON().stats) : correction.sourceValue };
  activity.addStat(new DataAscent(correction.value));
}

/** Hydration's last-unmatched/device-name fallback must not transfer a correction to a different recording. */
export function carryActivityAscentCorrection(existing: AscentCorrectedActivity, parsed: AscentCorrectedActivity): void {
  if (!readAscentCorrection(existing.ascentCorrection)) return;
  if (existing.type !== parsed.type || trainingLoadTimeMs(existing.startDate) !== trainingLoadTimeMs(parsed.startDate)
    || trainingLoadTimeMs(existing.endDate) !== trainingLoadTimeMs(parsed.endDate)) return;
  for (const type of [DataDuration.type, DataDistance.type]) {
    const oldStat = existing.getStat(type), parsedStat = parsed.getStat(type);
    if ((oldStat ? oldStat.getValue() : null) !== (parsedStat ? parsedStat.getValue() : null)) return;
  }
  applyActivityAscentCorrection(parsed, existing.ascentCorrection);
}

/** Only ascent is replaced; source samples, other summaries and load evaluations are untouched. */
export function applyCorrectedEventAscent(event: EventInterface): void {
  const activities = event.getActivities() as AscentCorrectedActivity[];
  if (!activities.some(activity => readAscentCorrection(activity.ascentCorrection))) return;
  const values = activities.filter(activity => isTerrainAscentActivity(activity.type))
    .map(activity => { const stat = activity.getStat(DataAscent.type); return stat ? stat.getValue() : null; })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  if (values.length) event.addStat(new DataAscent(values.reduce((total, value) => total + value, 0)));
}
