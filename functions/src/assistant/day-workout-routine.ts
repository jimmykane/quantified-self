import { ActivityTypes } from '@sports-alliance/sports-lib';
import { dayWorkoutDateOffset, dayWorkoutLocalDate, type DayWorkoutControls } from '../../../shared/day-workout';

type RecordValue = Record<string, unknown>;
export interface DayWorkoutRoutine {
  status: 'available' | 'insufficient';
  sport: string;
  weekday: string;
  windowStartDate: string;
  windowEndDate: string;
  weekdayOpportunities: number;
  recordedDayCount: number;
  sessionCount: number;
  typicalDurationSeconds: number | null;
  durationBaseline?: { source: 'weekday' | 'sport'; typicalDurationSeconds: number; recordedDayCount: number } | null;
  missingDatesAreUnknown: true;
}
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as RecordValue : {};
export function routineActivityTypes(sport: DayWorkoutControls['sport']): string[] {
  return sport === ActivityTypes.StrengthTraining || sport === ActivityTypes.WeightTraining
    ? [ActivityTypes.StrengthTraining, ActivityTypes.WeightTraining] : [sport];
}
const weekday = (date: string): number => new Date(date + 'T12:00:00Z').getUTCDay();

/** Private, identity-free synthesis of existing safe activity summaries. No punctuality or adherence inference. */
export function buildDayWorkoutRoutine(controls: DayWorkoutControls, now: Date, activities: readonly unknown[]): DayWorkoutRoutine {
  const today = dayWorkoutLocalDate(now, controls.timeZone);
  const windowStartDate = dayWorkoutDateOffset(today, -28);
  const windowEndDate = dayWorkoutDateOffset(today, -1);
  const targetWeekday = weekday(controls.localDate);
  const activityTypes = routineActivityTypes(controls.sport);
  const dates = new Set<string>();
  const seen = new Set<string>();
  const durations: number[] = [];
  const durationDates = new Set<string>();
  const sportDurations: number[] = [];
  const sportDurationDates = new Set<string>();
  let sessionCount = 0;
  for (const value of activities) {
    const activity = record(value);
    if (typeof activity.activityRef !== 'string' || !activity.activityRef || seen.has(activity.activityRef)
      || typeof activity.startTimeMs !== 'number' || !Number.isFinite(activity.startTimeMs)
      || !activityTypes.includes(String(activity.activityType))) continue;
    const instant = new Date(activity.startTimeMs);
    if (!Number.isFinite(instant.getTime())) continue;
    const date = dayWorkoutLocalDate(instant, controls.timeZone);
    if (date < windowStartDate || date > windowEndDate) continue;
    seen.add(activity.activityRef);
    const duration = record(activity.stats).durationSeconds;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) { sportDurations.push(duration); sportDurationDates.add(date); }
    if (weekday(date) !== targetWeekday) continue;
    dates.add(date); sessionCount += 1;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) { durations.push(duration); durationDates.add(date); }
  }
  // A single recorded day cannot establish a usual duration; missing persisted duration stays unknown.
  const median = (values: number[], dates: Set<string>): number | null => {
    if (dates.size < 2 || values.length < 2) return null;
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : values[middle - 1] + (values[middle] - values[middle - 1]) / 2;
  };
  const typicalDurationSeconds = median(durations, durationDates);
  const sportDurationSeconds = median(sportDurations, sportDurationDates);
  const durationBaseline = typicalDurationSeconds !== null
    ? { source: 'weekday' as const, typicalDurationSeconds, recordedDayCount: durationDates.size }
    : sportDurationSeconds !== null
      ? { source: 'sport' as const, typicalDurationSeconds: sportDurationSeconds, recordedDayCount: sportDurationDates.size } : null;
  let weekdayOpportunities = 0;
  for (let day = 0; day < 28; day += 1) if (weekday(dayWorkoutDateOffset(windowStartDate, day)) === targetWeekday) weekdayOpportunities += 1;
  return { status: dates.size >= 2 ? 'available' : 'insufficient', sport: controls.sport,
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(controls.localDate + 'T12:00:00Z')),
    windowStartDate, windowEndDate, weekdayOpportunities, recordedDayCount: dates.size, sessionCount,
    typicalDurationSeconds, ...(controls.durationMode === 'auto' ? { durationBaseline } : {}), missingDatesAreUnknown: true };
}

/** At most two existing MCP pages; never turn a partial scan or a failed read into an apparent habit. */
export async function readDayWorkoutRoutine(controls: DayWorkoutControls, now: Date,
  read: (input: RecordValue) => Promise<RecordValue>): Promise<DayWorkoutRoutine | null> {
  const today = dayWorkoutLocalDate(now, controls.timeZone);
  const input = { start: dayWorkoutDateOffset(today, -29) + 'T00:00:00.000Z', end: now.toISOString(),
    activityTypes: routineActivityTypes(controls.sport), limit: 100 };
  const activities: unknown[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < 2; page += 1) {
      const result = await read({ ...input, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.activities) || result.activities.length > 100) return null;
      activities.push(...result.activities);
      if (result.scanComplete === true && !result.nextCursor) return buildDayWorkoutRoutine(controls, now, activities);
      if (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor === cursor) return null;
      cursor = result.nextCursor;
    }
  } catch { /* Read failure is missing context, never an empty activity history. */ }
  return null;
}
