import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { buildDayWorkoutRoutine, readDayWorkoutRoutine, routineActivityTypes } from './day-workout-routine';
const now = new Date('2026-10-29T12:00Z');
const controls = defaultDayWorkoutControls('2026-11-05', 'Europe/Helsinki', ActivityTypes.StrengthTraining);
const activity = (date: string, duration: unknown = 3600, type = ActivityTypes.StrengthTraining, ref = date) => ({
  activityRef: ref, startTimeMs: Date.parse(date + 'T10:00Z'), activityType: type, stats: { durationSeconds: duration },
});
describe('Recorded sport and weekday routine', () => {
  it('uses only the selected weekday/sport in the prior complete 28 local days and counts dates once', () => {
    const routine = buildDayWorkoutRoutine(controls, now, [activity('2026-10-01', 3000), activity('2026-10-08'),
      activity('2026-10-22', 4200, ActivityTypes.WeightTraining), activity('2026-10-22', 4200, ActivityTypes.WeightTraining),
      activity('2026-10-15', 5000, ActivityTypes.Running), activity('2026-10-21'), activity('2026-10-29'), activity('2026-09-24')]);
    expect(routine).toEqual({ status: 'available', sport: ActivityTypes.StrengthTraining, weekday: 'Thursday',
      windowStartDate: '2026-10-01', windowEndDate: '2026-10-28', weekdayOpportunities: 4,
      recordedDayCount: 3, sessionCount: 3, typicalDurationSeconds: 3600, missingDatesAreUnknown: true });
  });
  it('does not mix distinct strength disciplines or running variants into the requested sport', () => {
    expect(routineActivityTypes(ActivityTypes.Calisthenics)).toEqual([ActivityTypes.Calisthenics]);
    expect(routineActivityTypes(ActivityTypes.Running)).toEqual([ActivityTypes.Running]);
    expect(buildDayWorkoutRoutine(controls, now, [activity('2026-10-08', 3600, ActivityTypes.Calisthenics)])
      .recordedDayCount).toBe(0);
  });
  it('uses a median for matching sessions and does not count multiple sessions as multiple weekday opportunities', () => {
    const result = buildDayWorkoutRoutine(controls, now, [activity('2026-10-01', 3000), activity('2026-10-08', 3600),
      activity('2026-10-08', 1800, ActivityTypes.StrengthTraining, 'second-session'), activity('2026-10-22', 7200)]);
    expect(result).toMatchObject({ recordedDayCount: 3, sessionCount: 4, typicalDurationSeconds: 3300 });
  });
  it('keeps missing/invalid durations unknown and requires usable duration on two distinct days', () => {
    const result = buildDayWorkoutRoutine(controls, now, [activity('2026-10-08', 3000),
      activity('2026-10-08', 3600, ActivityTypes.StrengthTraining, 'second'), activity('2026-10-22', null), activity('2026-10-15', -1)]);
    expect(result).toMatchObject({ recordedDayCount: 3, typicalDurationSeconds: null });
    expect(buildDayWorkoutRoutine(controls, now, [activity('2026-10-08', Number.NaN)]))
      .toMatchObject({ status: 'insufficient', recordedDayCount: 1, typicalDurationSeconds: null });
  });
  it('treats an empty complete history as insufficient evidence rather than missed training', () => {
    expect(buildDayWorkoutRoutine(controls, now, [])).toMatchObject({ status: 'insufficient', recordedDayCount: 0,
      sessionCount: 0, typicalDurationSeconds: null, missingDatesAreUnknown: true });
  });
  it.each(['Europe/Helsinki', 'America/Los_Angeles'])('buckets the actual local weekday across DST in %s', timeZone => {
    const input = { ...controls, timeZone };
    const stamp = timeZone === 'Europe/Helsinki' ? '2026-10-21T22:30Z' : '2026-10-23T06:30Z';
    expect(buildDayWorkoutRoutine(input, now, [{ ...activity('2026-10-22'), startTimeMs: Date.parse(stamp) }]))
      .toMatchObject({ weekday: 'Thursday', recordedDayCount: 1, weekdayOpportunities: 4 });
  });
  it('rejects invalid dates, missing identity and foreign sports without forwarding private fields', () => {
    const result = buildDayWorkoutRoutine(controls, now, [activity('2026-10-01'), { ...activity('2026-10-08'),
      note: 'PRIVATE-NOTE', startPosition: { latitudeDegrees: 67 }, title: 'PRIVATE-TITLE' },
      { ...activity('2026-10-22'), activityRef: null }, { ...activity('2026-10-22'), startTimeMs: Infinity }, null]);
    expect(result.recordedDayCount).toBe(2); expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|activityRef|startTimeMs|latitude/);
  });
  it('reads at most two bounded, filtered pages with stable bounds and projects only the resulting routine', async () => {
    const read = vi.fn().mockResolvedValueOnce({ activities: [activity('2026-10-08')], scanComplete: false, nextCursor: 'page-two' })
      .mockResolvedValueOnce({ activities: [activity('2026-10-22')], scanComplete: true, nextCursor: null });
    expect(await readDayWorkoutRoutine(controls, now, read)).toMatchObject({ recordedDayCount: 2 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[0][0]).toEqual({ start: '2026-09-30T00:00:00.000Z', end: now.toISOString(),
      activityTypes: [ActivityTypes.StrengthTraining, ActivityTypes.WeightTraining], limit: 100 });
    expect(read.mock.calls[1][0]).toEqual({ ...read.mock.calls[0][0], cursor: 'page-two' });
  });
  it('withholds the pattern on partial scans, missing/looping cursors, oversized pages and read failures', async () => {
    for (const page of [{ activities: [activity('2026-10-08')], scanComplete: false, nextCursor: 'more' },
      { activities: [], scanComplete: false }, { activities: [], scanComplete: true, nextCursor: 'more' },
      { activities: Array.from({ length: 101 }, () => activity('2026-10-08')), scanComplete: true }]) {
      const read = vi.fn().mockResolvedValue(page);
      expect(await readDayWorkoutRoutine(controls, now, read)).toBeNull(); expect(read.mock.calls.length).toBeLessThanOrEqual(2);
    }
    expect(await readDayWorkoutRoutine(controls, now, vi.fn().mockRejectedValue(new Error('offline')))).toBeNull();
  });
});
