import { ActivityTypeGroups, ActivityTypesHelper, DataAscent, DataDescent, DataDistance, DataDuration, type ActivityInterface, type EventInterface } from '@sports-alliance/sports-lib';
import { trainingLoadTimeMs } from './training-load-source';

export interface ActivityAscentCorrection {
  value: number;
  sourceValue: number | null;
}

export const ACTIVITY_ELEVATION_METRICS = ['ascent', 'descent'] as const;
export type ActivityElevationMetric = typeof ACTIVITY_ELEVATION_METRICS[number];
export function activityElevationMetric(metric: ActivityElevationMetric) {
  return metric === 'descent'
    ? { type: DataDescent.type, field: 'descentCorrection' as const, DataClass: DataDescent }
    : { type: DataAscent.type, field: 'ascentCorrection' as const, DataClass: DataAscent };
}
export type AscentCorrectedActivity = ActivityInterface & {
  ascentCorrection?: ActivityAscentCorrection;
  descentCorrection?: ActivityAscentCorrection;
};
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

export interface ActivityElevationEdit {
  activityId: string;
  metric: ActivityElevationMetric;
  value: number | null;
  expectedSourceFingerprint: string;
  expectedCorrection: ActivityAscentCorrection | null;
}
export interface ActivityElevationUpdate {
  activityId: string;
  metric: ActivityElevationMetric;
  value: number | null;
  eventValue: number | null;
  correction: ActivityAscentCorrection | null;
}

/** Patch summaries in place so an open chart retains its hydrated activities and streams. */
export function applySavedActivityElevation(event: EventInterface, saved: ActivityElevationUpdate): void {
  const { type, field, DataClass } = activityElevationMetric(saved.metric);
  const activity = event.getActivities().find(item => item.getID() === saved.activityId) as AscentCorrectedActivity | undefined;
  if (activity) {
    if (saved.value === null) activity.removeStat(type);
    else activity.addStat(new DataClass(saved.value));
    if (saved.correction) activity[field] = { ...saved.correction };
    else delete activity[field];
  }
  if (saved.eventValue === null) event.removeStat(type);
  else event.addStat(new DataClass(saved.eventValue));
}

export function applySavedActivityAscent(event: EventInterface, saved: ActivityAscentUpdate): void {
  applySavedActivityElevation(event, { ...saved, metric: 'ascent', value: saved.ascent, eventValue: saved.eventAscent });
}

export function validActivityAscent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ACTIVITY_ASCENT_METERS;
}

export function readActivityAscent(stats: unknown, metric: ActivityElevationMetric = 'ascent'): number | null {
  if (!stats || typeof stats !== 'object') return null;
  const raw = (stats as Record<string, unknown>)[activityElevationMetric(metric).type];
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
export function applyActivityAscentCorrection(activity: AscentCorrectedActivity, value: unknown, freshSource = false, metric: ActivityElevationMetric = 'ascent'): void {
  const correction = readAscentCorrection(value);
  if (!correction) return;
  if (!isTerrainAscentActivity(activity.type)) throw new Error('An elevation correction cannot be applied to a diving activity.');
  const { field, DataClass } = activityElevationMetric(metric);
  activity[field] = { ...correction, sourceValue: freshSource
    ? readActivityAscent(activity.toJSON().stats, metric) : correction.sourceValue };
  activity.addStat(new DataClass(correction.value));
}

/** Hydration's last-unmatched/device-name fallback must not transfer a correction to a different recording. */
export function carryActivityAscentCorrection(existing: AscentCorrectedActivity, parsed: AscentCorrectedActivity): void {
  if (!ACTIVITY_ELEVATION_METRICS.some(metric => readAscentCorrection(existing[activityElevationMetric(metric).field]))) return;
  if (existing.type !== parsed.type || trainingLoadTimeMs(existing.startDate) !== trainingLoadTimeMs(parsed.startDate)
    || trainingLoadTimeMs(existing.endDate) !== trainingLoadTimeMs(parsed.endDate)) return;
  for (const type of [DataDuration.type, DataDistance.type]) {
    const oldStat = existing.getStat(type), parsedStat = parsed.getStat(type);
    if ((oldStat ? oldStat.getValue() : null) !== (parsedStat ? parsedStat.getValue() : null)) return;
  }
  for (const metric of ACTIVITY_ELEVATION_METRICS) {
    applyActivityAscentCorrection(parsed, existing[activityElevationMetric(metric).field], false, metric);
  }
}

/** Only corrected elevation totals are replaced; source samples and other summaries stay intact. */
export function applyCorrectedEventAscent(event: EventInterface): void {
  const activities = event.getActivities() as AscentCorrectedActivity[];
  for (const metric of ACTIVITY_ELEVATION_METRICS) {
    const { field, type, DataClass } = activityElevationMetric(metric);
    if (!activities.some(activity => readAscentCorrection(activity[field]))) continue;
    const values = activities.filter(activity => isTerrainAscentActivity(activity.type))
      .map(activity => { const stat = activity.getStat(type); return stat ? stat.getValue() : null; })
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    if (values.length) event.addStat(new DataClass(values.reduce((total, value) => total + value, 0)));
  }
}
