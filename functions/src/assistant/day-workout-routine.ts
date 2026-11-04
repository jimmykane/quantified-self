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
  let sessionCount = 0;
  for (const value of activities) {
    const activity = record(value);
    if (typeof activity.activityRef !== 'string' || !activity.activityRef || seen.has(activity.activityRef)
      || typeof activity.startTimeMs !== 'number' || !Number.isFinite(activity.startTimeMs)
      || !activityTypes.includes(String(activity.activityType))) continue;
    const instant = new Date(activity.startTimeMs);
    if (!Number.isFinite(instant.getTime())) continue;
    const date = dayWorkoutLocalDate(instant, controls.timeZone);
    if (date < windowStartDate || date > windowEndDate || weekday(date) !== targetWeekday) continue;
    seen.add(activity.activityRef); dates.add(date); sessionCount += 1;
    const duration = record(activity.stats).durationSeconds;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) { durations.push(duration); durationDates.add(date); }
  }
  durations.sort((a, b) => a - b);
  // A single recorded day cannot establish a usual duration; missing persisted duration stays unknown.
  const middle = Math.floor(durations.length / 2);
  const typicalDurationSeconds = durationDates.size >= 2 && durations.length >= 2
    ? durations.length % 2 ? durations[middle] : durations[middle - 1] + (durations[middle] - durations[middle - 1]) / 2
    : null;
  let weekdayOpportunities = 0;
  for (let day = 0; day < 28; day += 1) if (weekday(dayWorkoutDateOffset(windowStartDate, day)) === targetWeekday) weekdayOpportunities += 1;
  return { status: dates.size >= 2 ? 'available' : 'insufficient', sport: controls.sport,
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(controls.localDate + 'T12:00:00Z')),
    windowStartDate, windowEndDate, weekdayOpportunities, recordedDayCount: dates.size, sessionCount,
    typicalDurationSeconds, missingDatesAreUnknown: true };
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
