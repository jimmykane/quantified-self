import { describe, expect, it, vi } from 'vitest';
import { DataDuration } from '@sports-alliance/sports-lib';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import {
  collectDailyWorkoutContext,
  dailyWorkoutFacts,
  requestsDailyWorkoutChange,
  requestsDailyWorkoutContext,
} from './daily-workout-context';

const NOW = new Date('2026-09-25T12:00:00.000Z');

function fixtureRead() {
  return vi.fn(async (name: string) => {
    switch (name) {
      case 'get_daily_report': return { sleep: { durationSeconds: 29_520 }, readiness: { score: 61 } };
      case 'query_metric': return { metric: { type: DataDuration.type }, aggregation: {
        buckets: [
          { localDate: '2026-09-11', weekday: 'Friday', aggregateValue: 2_000 },
          { localDate: '2026-09-24', weekday: 'Thursday', aggregateValue: 3_000 },
          { localDate: '2026-09-25', weekday: 'Friday', aggregateValue: 7_086 },
          { localDate: '2026-08-28', weekday: 'Friday', aggregateValue: 1_000 },
        ],
      } };
      case 'query_activities': return { scanComplete: true,
        activities: [{ title: 'Morning ride' }, { title: 'Evening ride' }] };
      case 'query_timeline_notes': return { scanComplete: true, nextCursor: null,
        notes: [{ category: 'sickness', title: 'Belly Pain', details: 'Felt unwell.',
          startDate: '2026-09-04', endDate: '2026-09-10', effectiveEndDate: '2026-09-10',
          timeZone: 'Europe/Helsinki' }] };
      case 'query_planned_workouts_by_date': return { scheduleRevision: 7, scanComplete: true, workouts: [
        { workoutRef: 'swim-ref', title: 'Swim', localDate: '2026-09-25', lifecycle: 'planned', planRef: null },
        { workoutRef: 'bike-ref', title: 'Mountain bike', localDate: '2026-09-25', lifecycle: 'planned', planRef: null },
        { workoutRef: 'wahoo-ref', title: 'Wahoo test', localDate: '2026-09-25', lifecycle: 'planned', planRef: null },
      ] };
      case 'get_planned_workout_completions': return { scheduleRevision: 7, completions: [
        { workoutRef: 'swim-ref', state: 'unlinked' },
        { workoutRef: 'bike-ref', state: 'unlinked' },
        { workoutRef: 'wahoo-ref', state: 'linked', provider: 'wahoo' },
      ] };
      case 'prepare_training_metrics': return { status: 'ready', readyMetricKinds: [
        DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.FormNow,
        DERIVED_METRIC_KINDS.RampRate,
        DERIVED_METRIC_KINDS.TrainingSummary,
      ] };
      case 'get_training_metric': throw new Error('Specify metricKind in the fixture.');
      default: throw new Error(`Unexpected tool ${name}`);
    }
  });
}

describe('daily workout context', () => {
  it('recognizes a today recommendation and its reassessment, but not an unrelated plan question', () => {
    const prompt = 'For today, suggest a cautious workout using sleep and my plan.';
    expect(requestsDailyWorkoutContext(prompt, [])).toBe(true);
    expect(requestsDailyWorkoutContext('Please reassess Form, ramp and completion links.', [
      { role: 'user', text: prompt },
    ])).toBe(true);
    expect(requestsDailyWorkoutContext('Show my planned workouts next week.', [])).toBe(false);
    expect(requestsDailyWorkoutContext('Create a workout for today and send it to Garmin.', [])).toBe(true);
    expect(requestsDailyWorkoutContext('What about my weight?', [
      { role: 'user', text: prompt },
    ])).toBe(false);
    expect(requestsDailyWorkoutContext('Please reassess Form and completion links.', [
      { role: 'user', text: prompt }, { role: 'assistant', text: 'Here is the suggestion.' },
      { role: 'user', text: 'Show my weight trend.' },
    ])).toBe(false);
  });

  it('previews only an expressly requested workout change', () => {
    expect(requestsDailyWorkoutChange('Suggest a workout for today using my current schedule.')).toBe(false);
    expect(requestsDailyWorkoutChange('Suggest a workout for today, but do not send it.')).toBe(false);
    expect(requestsDailyWorkoutChange('Suggest a workout for today and sync it to Garmin.')).toBe(true);
    expect(requestsDailyWorkoutChange('Create one workout for today and send it to Suunto.')).toBe(true);
  });

  it('reads exact completion and prepared snapshots, counts today, and dates an ended note', async () => {
    const base = fixtureRead();
    const read = vi.fn(async (name: Parameters<typeof base>[0], args: Record<string, unknown>) =>
      name === 'get_training_metric'
        ? { metricKind: args.metricKind, payload: { measured: true } }
        : base(name));
    const result = await collectDailyWorkoutContext({ now: NOW, timeZone: 'Europe/Helsinki',
      timelineNotesEnabled: true, trainingPlansEnabled: true, read });
    expect(result.localDate).toBe('2026-09-25');
    expect(result.windowStartDate).toBe('2026-08-29');
    expect(result.weekdayConsistency.matchingWeekdayDates).toEqual(['2026-09-11', '2026-09-25']);
    expect(result.activitiesToday.activities).toHaveLength(2);
    expect(result.timelineNotes.notes[0]).toMatchObject({ title: 'Belly Pain', status: 'ended',
      endDate: '2026-09-10' });
    expect(result.plannedWorkouts.workouts[2]).toMatchObject({ title: 'Wahoo test',
      completion: { state: 'linked', provider: 'wahoo' } });
    expect(result.trainingSnapshots.form?.metricKind).toBe(DERIVED_METRIC_KINDS.Form);
    expect(result.trainingSnapshots.rampRate?.metricKind).toBe(DERIVED_METRIC_KINDS.RampRate);
    expect(result.trainingSnapshots.trainingSummary?.metricKind).toBe(DERIVED_METRIC_KINDS.TrainingSummary);
    expect(read.mock.calls.map(([name]) => name)).toEqual([
      'prepare_training_metrics', 'get_training_metric', 'get_training_metric',
      'get_training_metric',
      'get_daily_report', 'query_metric', 'query_activities', 'query_timeline_notes',
      'query_planned_workouts_by_date', 'get_planned_workout_completions',
    ]);
    expect(read.mock.calls.find(([name]) => name === 'query_metric')?.[1])
      .toMatchObject({ metric: DataDuration.type, aggregation: 'total', interval: 'daily',
        timeZone: 'Europe/Helsinki' });
    expect(read.mock.calls.find(([name]) => name === 'get_planned_workout_completions')?.[1])
      .toEqual({ workoutRefs: ['swim-ref', 'bike-ref', 'wahoo-ref'] });
    const facts = dailyWorkoutFacts(result);
    expect(facts).toContain('2 of the last 4 Fridays');
    expect(facts).toContain('Belly Pain”');
    expect(facts).toContain('2026-09-04–2026-09-10 (ended)');
    expect(facts).toContain('1 has an exact stored completion link');
    expect(facts).toContain('Exact completion linked: “Wahoo test”');
    expect(facts).toContain('Form snapshot read; ramp-rate snapshot read; Training Summary snapshot read');
  });

  it('keeps disabled access and incomplete scans explicit', async () => {
    const base = fixtureRead();
    const read = vi.fn(async (name: string, args: Record<string, unknown>) =>
      name === 'get_training_metric'
        ? { metricKind: args.metricKind, payload: {} }
        : base(name));
    const result = await collectDailyWorkoutContext({ now: NOW, timeZone: 'Europe/Helsinki',
      timelineNotesEnabled: false, trainingPlansEnabled: false, read: read as never });
    expect(read.mock.calls.map(([name]) => name)).not.toContain('query_timeline_notes');
    expect(read.mock.calls.map(([name]) => name)).not.toContain('query_planned_workouts_by_date');
    expect(dailyWorkoutFacts(result)).toContain('Timeline notes were not checked because access is off');
    expect(dailyWorkoutFacts(result)).toContain('completion links were not checked because Training plans access is off');
  });

  it('fails closed when batch completion results do not match the listed workouts', async () => {
    const base = fixtureRead();
    const read = vi.fn(async (name: string, args: Record<string, unknown>) =>
      name === 'get_planned_workout_completions'
        ? { scheduleRevision: 7, completions: [{ workoutRef: 'wrong-ref', state: 'unlinked' }] }
        : name === 'get_training_metric'
          ? { metricKind: args.metricKind, payload: {} }
          : base(name));
    await expect(collectDailyWorkoutContext({ now: NOW, timeZone: 'Europe/Helsinki',
      timelineNotesEnabled: false, trainingPlansEnabled: true, read: read as never }))
      .rejects.toThrow('incomplete planned workout completion evidence');
  });

  it('follows a note continuation so closed notes cannot hide an ongoing note', async () => {
    const base = fixtureRead();
    const read = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'query_timeline_notes') return args.cursor
        ? { scanComplete: true, nextCursor: null, notes: [{ category: 'injury',
          title: 'Knee discomfort', details: null, startDate: '2026-09-20', endDate: null,
          effectiveEndDate: '2026-09-25', timeZone: 'Europe/Helsinki' }] }
        : { scanComplete: false, nextCursor: 'next-note-page', notes: [{ category: 'sickness',
          title: 'Past illness', details: null, startDate: '2026-09-04', endDate: '2026-09-10',
          effectiveEndDate: '2026-09-10', timeZone: 'Europe/Helsinki' }] };
      if (name === 'get_training_metric') return { metricKind: args.metricKind, payload: {} };
      return base(name);
    });
    const result = await collectDailyWorkoutContext({ now: NOW, timeZone: 'Europe/Helsinki',
      timelineNotesEnabled: true, trainingPlansEnabled: false, read: read as never });
    expect(result.timelineNotes.scanComplete).toBe(true);
    expect(result.timelineNotes.notes.map(note => note.status)).toEqual(['ended', 'ongoing']);
    expect(dailyWorkoutFacts(result)).toContain('1 ongoing and 1 ended Timeline notes');
    expect(read.mock.calls.filter(([name]) => name === 'query_timeline_notes')).toHaveLength(2);
  });

  it('does not label a prepared but unavailable Training snapshot as read', async () => {
    const base = fixtureRead();
    const read = vi.fn(async (name: string) => name === 'prepare_training_metrics'
      ? { status: 'unavailable', readyMetricKinds: [] }
      : base(name));
    const result = await collectDailyWorkoutContext({ now: NOW, timeZone: 'Europe/Helsinki',
      timelineNotesEnabled: false, trainingPlansEnabled: false, read: read as never });
    expect(result.trainingSnapshots).toMatchObject({ form: null, rampRate: null,
      trainingSummary: null });
    expect(read.mock.calls.map(([name]) => name)).not.toContain('get_training_metric');
    expect(dailyWorkoutFacts(result)).toContain('Form snapshot unavailable');
  });
});
