import { ActivityTypes, DataAscent, DataDistance, DataDuration, DistanceUnits, type EventInterface } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildCalendarPeriodSummary, resolveCalendarCompletionCoverage } from './calendar-period-summary.helper';
import { DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE, DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from './dashboard-form.helper';

const start = new Date(2026, 9, 5);
const end = new Date(2026, 9, 12);
const workout = (id: string, overrides: Partial<ScheduledWorkoutV1> = {}): ScheduledWorkoutV1 => ({ schemaVersion: 1, id,
  planId: null, localDate: '2026-10-06', lifecycle: 'planned', title: id, revision: 2, createdAtMs: 1, updatedAtMs: 2,
  structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'step', id: 'work', purpose: 'work',
    ending: { kind: 'time', seconds: 1800.25 }, targets: [] }] }, ...overrides });
const link = (id: string, overrides: Partial<TrainingWorkoutCompletionV1> = {}): TrainingWorkoutCompletionV1 => ({ schemaVersion: 1,
  workoutId: id, planId: null, provider: 'garmin', matchMethod: 'provider_marker', eventId: 'outside-week', activityId: null,
  sourceSessionIndex: null, activityStartAtMs: new Date(2026, 9, 13).getTime(), scheduledLocalDate: '2026-10-01',
  workoutRevisionAtLink: 1, timing: 'late', linkedAtMs: 1, updatedAtMs: 1, ...overrides });
const event = (id: string, stats: Record<string, number>, startDate = new Date(2026, 9, 6)): EventInterface => ({ startDate,
  getID: () => id, getStat: (type: string) => stats[type] === undefined ? null : { getValue: () => stats[type] },
} as EventInterface);
const input = () => ({ window: { startMs: start.getTime(), endExclusiveMs: end.getTime() }, startLocalDate: '2026-10-05', endLocalDate: '2026-10-11',
  events: { status: 'ready' as const, complete: true, data: [] as EventInterface[] },
  schedule: { status: 'ready' as const, complete: true, data: { state: { activePlanId: 'active' }, workouts: [] as ScheduledWorkoutV1[] } },
  completions: { status: 'ready' as const, complete: true, data: [] as TrainingWorkoutCompletionV1[] } });

describe('Calendar period summaries', () => {
  it('partitions current active/standalone workouts with exact links taking precedence over skipped', () => {
    const value = input();
    value.schedule.data.workouts = [workout('remaining'), workout('done', { planId: 'active' }), workout('skipped', { lifecycle: 'skipped' }),
      workout('skipped-linked', { lifecycle: 'skipped' }), workout('inactive', { planId: 'paused' }), workout('deleted', { lifecycle: 'deleted' }),
      workout('outside', { localDate: '2026-10-12' })];
    value.completions.data = [link('done', { planId: 'active' }), link('skipped-linked')];
    const summary = buildCalendarPeriodSummary(value);
    expect([summary.scheduledCount, summary.completedCount, summary.skippedCount, summary.remainingCount]).toEqual([4, 2, 1, 1]);
    expect(summary.planned?.summary.duration.completeExactSeconds).toBe(3600.5);
    expect(summary.remaining?.summary.duration.completeExactSeconds).toBe(1800.25);
    expect(summary.recordedCount).toBe(0); // A late out-of-week link is no recording in this week.
    expect(summary.changedSinceCompletionCount).toBe(2);
  });
  it('sums unique recorded parents in the closed-open window and keeps missing/zero/legacy load distinct', () => {
    const value = input();
    const parent = event('multisport', { [DataDuration.type]: 1200, [DataDistance.type]: 1609.344, [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 0,
      [DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE]: 99 });
    value.events.data = [parent, parent, event('legacy', { [DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE]: 30 }),
      event('missing', {}), event('end', { [DataDuration.type]: 999 }, end), event('before', {}, new Date(start.getTime() - 1))];
    const summary = buildCalendarPeriodSummary(value);
    expect(summary.recordedCount).toBe(3);
    expect(summary.recordedMetrics[0].coverage).toContain('1 of 3');
    expect(summary.recordedMetrics[2].text).toContain('30');
    expect(summary.recordedMetrics[2].coverage).toContain('2 of 3');
    expect(buildCalendarPeriodSummary({ ...value, unitSettings: normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }) }).recordedMetrics[1].text).toContain('mi');
    expect(summary.recordedMetrics[1].text).toContain('Km');
  });
  it('reuses shared range/unknown/repeat/early-Lap analysis without a midpoint or planned load model', () => {
    const value = input();
    value.schedule.data.workouts = [workout('mixed', { structure: { version: 1, sport: ActivityTypes.Cycling, nodes: [
      { kind: 'repeat', id: 'repeat', count: 3, steps: [{ kind: 'step', id: 'distance', purpose: 'work',
        ending: { kind: 'distance', meters: 1000, allowEarlyLap: true }, targets: [{ kind: 'speed', mode: 'absolute', presentation: 'speed', minimumMetersPerSecond: 2, maximumMetersPerSecond: 4 }] }] },
      { kind: 'step', id: 'lap', purpose: 'recovery', ending: { kind: 'manual' }, targets: [] },
    ] } })];
    const summary = buildCalendarPeriodSummary(value);
    expect(summary.remaining?.summary.duration).toMatchObject({ estimatedSubtotalRange: { minimumSeconds: 750, maximumSeconds: 1500 }, unknownSteps: 1, completeRange: null });
    expect(summary.remaining?.summary.distance.exactSubtotalMeters).toBe(3000);
    expect(summary.remainingText).toContain('About ');
    expect(summary.remainingText).toContain('Plus steps with no set time');
    expect(summary.remainingText).toContain('finish earlier with Lap');
  });
  it('withholds remaining/completion counts for loading, failed, or invalid completion evidence', () => {
    const value = input();
    value.schedule.data.workouts = [workout('a')];
    for (const status of ['loading', 'error'] as const) {
      const summary = buildCalendarPeriodSummary({ ...value, completions: { ...value.completions, status } });
      expect(summary.remainingCount).toBeNull(); expect(summary.completedCount).toBeNull(); expect(summary.remaining).toBeNull();
      expect(summary.planned?.workoutCount).toBe(1);
    }
    value.completions.data = [link('a', { workoutRevisionAtLink: 3 })];
    expect(buildCalendarPeriodSummary(value).remaining).toBeNull();
  });
  it('withholds complete prescription totals when a bounded schedule read is partial', () => {
    const value = input(); value.schedule.complete = false; value.schedule.data.workouts = [workout('a')]; value.events.complete = false;
    const summary = buildCalendarPeriodSummary(value);
    expect(summary.planned?.summary.duration.completeExactSeconds).toBeNull();
    expect(summary.plannedText).toContain('from workouts loaded');
    expect(summary.warnings.join(' ')).toContain('may be missing');
  });
  it('does not claim there are no prescriptions when an incomplete scan found no eligible workouts', () => {
    const value = input(); value.schedule.complete = false;
    value.schedule.data.workouts = [workout('inactive', { planId: 'paused' })];
    const summary = buildCalendarPeriodSummary(value);
    expect(summary.plannedText).toBe('Workouts may be missing');
    expect(summary.remainingText).toBe('Workouts may be missing');
  });
  it('uses one validity boundary for completion counts and calendar markers', () => {
    const workouts = [workout('valid'), workout('future'), workout('conflicting'), workout('ambiguous')];
    const data = [link('valid'), link('future', { workoutRevisionAtLink: 3 }),
      link('conflicting', { workoutRevisionAtLink: 2, planId: 'other' }), link('ambiguous'), link('ambiguous')];
    expect(resolveCalendarCompletionCoverage(workouts, { status: 'ready', complete: true, data }))
      .toEqual({ complete: false, linkedWorkoutIds: ['valid'], changedSinceCompletionCount: 1 });
    expect(resolveCalendarCompletionCoverage(workouts, { status: 'error', complete: false, data }).linkedWorkoutIds).toEqual([]);
  });
  it('uses a leap-month window while keeping exact cross-month links and owner distance units', () => {
    const value = input();
    value.window = { startMs: new Date(2028, 1, 1).getTime(), endExclusiveMs: new Date(2028, 2, 1).getTime() };
    value.startLocalDate = '2028-02-01'; value.endLocalDate = '2028-02-29';
    value.events.data = [event('leap', { [DataDuration.type]: 600, [DataDistance.type]: 1609.344 }, new Date(2028, 1, 29)),
      event('before', {}, new Date(2028, 0, 31)), event('after', {}, new Date(2028, 2, 1))];
    value.schedule.data.workouts = [workout('first', { localDate: '2028-02-01' }), workout('leap', { localDate: '2028-02-29' }),
      workout('before', { localDate: '2028-01-31' }), workout('after', { localDate: '2028-03-01' })];
    value.completions.data = [link('first', { scheduledLocalDate: '2028-01-01', activityStartAtMs: new Date(2028, 2, 3).getTime() })];
    const summary = buildCalendarPeriodSummary({ ...value, period: 'month', unitSettings: normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }) });
    expect(summary).toMatchObject({ period: 'month', recordedCount: 1, scheduledCount: 2, completedCount: 1, remainingCount: 1 });
    expect(summary.planned?.summary.duration.completeExactSeconds).toBe(3600.5);
    expect(summary.remaining?.summary.duration.completeExactSeconds).toBe(1800.25);
    expect(summary.recordedMetrics[1].text).toContain('mi');
  });
  it.each([undefined, DistanceUnits.Miles])('preserves monthly ascent exclusions and missing metrics with distance units %s', distanceUnits => {
    const value = input();
    value.events.data = [
      { ...event('run', { [DataAscent.type]: 450 }), getActivityTypesAsArray: () => [ActivityTypes.Running] },
      { ...event('missing', {}), getActivityTypesAsArray: () => [ActivityTypes.Running] },
      { ...event('ski', { [DataAscent.type]: 900 }), getActivityTypesAsArray: () => [ActivityTypes.AlpineSki] },
      { ...event('bike', { [DataAscent.type]: 700 }), getActivityTypesAsArray: () => [ActivityTypes.Cycling] },
    ];
    const summary = buildCalendarPeriodSummary({ ...value, period: 'month', unitSettings: distanceUnits ? normalizeUserUnitSettings({ distanceUnits }) : undefined, summariesSettings: { removeAscentForEventTypes: [ActivityTypes.Cycling] } });
    expect(summary.recordedMetrics.find(metric => metric.label === 'Ascent')).toEqual({ label: 'Ascent', text: '450 m',
      coverage: 'From 1 of 2 activities that count toward ascent' });
    expect(buildCalendarPeriodSummary(value).recordedMetrics.some(metric => metric.label === 'Ascent')).toBe(false);
  });
  it('distinguishes ready empty from failed reads and never treats missing metrics as zero', () => {
    const empty = buildCalendarPeriodSummary(input());
    expect(empty.scheduledCount).toBe(0); expect(empty.remainingCount).toBe(0); expect(empty.remainingText).toBe('No workouts');
    expect(empty.recordedMetrics.every(metric => metric.text === 'Unavailable')).toBe(true);
    const failed = buildCalendarPeriodSummary({ ...input(), events: { status: 'error', complete: false, data: [] }, schedule: { status: 'error', complete: false, data: null } });
    expect(failed.recordedCount).toBeNull(); expect(failed.scheduledCount).toBeNull(); expect(failed.planned).toBeNull();
  });

  it.each(['loading', 'error'] as const)('does not need %s activity matches for a confirmed empty period', status => {
    const summary = buildCalendarPeriodSummary({ ...input(), completions: { status, data: [], complete: false } });
    expect(summary).toMatchObject({ scheduledCount: 0, completedCount: 0, skippedCount: 0, remainingCount: 0, loading: false });
    expect(summary.warnings).toEqual([]);
    expect(summary.remaining?.workoutCount).toBe(0);
  });
});
