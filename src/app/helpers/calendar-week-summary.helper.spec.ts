import { ActivityTypes, DataDistance, DataDuration, DistanceUnits, type EventInterface } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { buildCalendarWeekSummary, resolveCalendarCompletionCoverage } from './calendar-week-summary.helper';
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

describe('Calendar weekly summaries', () => {
  it('partitions current active/standalone workouts with exact links taking precedence over skipped', () => {
    const value = input();
    value.schedule.data.workouts = [workout('remaining'), workout('done', { planId: 'active' }), workout('skipped', { lifecycle: 'skipped' }),
      workout('skipped-linked', { lifecycle: 'skipped' }), workout('inactive', { planId: 'paused' }), workout('deleted', { lifecycle: 'deleted' }),
      workout('outside', { localDate: '2026-10-12' })];
    value.completions.data = [link('done', { planId: 'active' }), link('skipped-linked')];
    const summary = buildCalendarWeekSummary(value);
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
    const summary = buildCalendarWeekSummary(value);
    expect(summary.recordedCount).toBe(3);
    expect(summary.recordedMetrics[0].coverage).toContain('1 of 3');
    expect(summary.recordedMetrics[2].text).toContain('30');
    expect(summary.recordedMetrics[2].coverage).toContain('2 of 3');
    expect(buildCalendarWeekSummary({ ...value, unitSettings: { distanceUnits: DistanceUnits.Miles } }).recordedMetrics[1].text).toContain('mi');
    expect(summary.recordedMetrics[1].text).toContain('Km');
  });
  it('reuses shared range/unknown/repeat/early-Lap analysis without a midpoint or planned load model', () => {
    const value = input();
    value.schedule.data.workouts = [workout('mixed', { structure: { version: 1, sport: ActivityTypes.Cycling, nodes: [
      { kind: 'repeat', id: 'repeat', count: 3, steps: [{ kind: 'step', id: 'distance', purpose: 'work',
        ending: { kind: 'distance', meters: 1000, allowEarlyLap: true }, targets: [{ kind: 'speed', mode: 'absolute', presentation: 'speed', minimumMetersPerSecond: 2, maximumMetersPerSecond: 4 }] }] },
      { kind: 'step', id: 'lap', purpose: 'recovery', ending: { kind: 'manual' }, targets: [] },
    ] } })];
    const summary = buildCalendarWeekSummary(value);
    expect(summary.remaining?.summary.duration).toMatchObject({ estimatedSubtotalRange: { minimumSeconds: 750, maximumSeconds: 1500 }, unknownSteps: 1, completeRange: null });
    expect(summary.remaining?.summary.distance.exactSubtotalMeters).toBe(3000);
    expect(summary.remainingText).toContain('estimated');
    expect(summary.remainingText).toContain('unknown duration');
    expect(summary.remainingText).toContain('early Lap');
  });
  it('withholds remaining/completion counts for loading, failed, or invalid completion evidence', () => {
    const value = input();
    value.schedule.data.workouts = [workout('a')];
    for (const status of ['loading', 'error'] as const) {
      const summary = buildCalendarWeekSummary({ ...value, completions: { ...value.completions, status } });
      expect(summary.remainingCount).toBeNull(); expect(summary.completedCount).toBeNull(); expect(summary.remaining).toBeNull();
      expect(summary.planned?.workoutCount).toBe(1);
    }
    value.completions.data = [link('a', { workoutRevisionAtLink: 3 })];
    expect(buildCalendarWeekSummary(value).remaining).toBeNull();
  });
  it('withholds complete prescription totals when a bounded schedule read is partial', () => {
    const value = input(); value.schedule.complete = false; value.schedule.data.workouts = [workout('a')]; value.events.complete = false;
    const summary = buildCalendarWeekSummary(value);
    expect(summary.planned?.summary.duration.completeExactSeconds).toBeNull();
    expect(summary.plannedText).toContain('partial source');
    expect(summary.warnings.join(' ')).toContain('incomplete');
  });
  it('does not claim there are no prescriptions when an incomplete scan found no eligible workouts', () => {
    const value = input(); value.schedule.complete = false;
    value.schedule.data.workouts = [workout('inactive', { planId: 'paused' })];
    const summary = buildCalendarWeekSummary(value);
    expect(summary.plannedText).toContain('complete total unknown');
    expect(summary.remainingText).toContain('complete total unknown');
  });
  it('uses one validity boundary for completion counts and calendar markers', () => {
    const workouts = [workout('valid'), workout('future'), workout('conflicting'), workout('ambiguous')];
    const data = [link('valid'), link('future', { workoutRevisionAtLink: 3 }),
      link('conflicting', { workoutRevisionAtLink: 2, planId: 'other' }), link('ambiguous'), link('ambiguous')];
    expect(resolveCalendarCompletionCoverage(workouts, { status: 'ready', complete: true, data }))
      .toEqual({ complete: false, linkedWorkoutIds: ['valid'], changedSinceCompletionCount: 1 });
    expect(resolveCalendarCompletionCoverage(workouts, { status: 'error', complete: false, data }).linkedWorkoutIds).toEqual([]);
  });
  it('distinguishes ready empty from failed reads and never treats missing metrics as zero', () => {
    const empty = buildCalendarWeekSummary(input());
    expect(empty.scheduledCount).toBe(0); expect(empty.remainingCount).toBe(0); expect(empty.remainingText).toBe('No prescriptions');
    expect(empty.recordedMetrics.every(metric => metric.text === 'Unavailable')).toBe(true);
    const failed = buildCalendarWeekSummary({ ...input(), events: { status: 'error', complete: false, data: [] }, schedule: { status: 'error', complete: false, data: null } });
    expect(failed.recordedCount).toBeNull(); expect(failed.scheduledCount).toBeNull(); expect(failed.planned).toBeNull();
  });
});
