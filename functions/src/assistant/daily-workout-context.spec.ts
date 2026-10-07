import { describe, expect, it, vi } from 'vitest';
import { DataDuration } from '@sports-alliance/sports-lib';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { ASSISTANT_CREATE_TODAYS_WORKOUT_PROMPT } from '../../../shared/assistant.prompts';
import {
  collectDailyWorkoutContext,
  dailyWorkoutFacts,
  requestsDailyWorkoutChange,
  requestsDailyWorkoutContext,
  resolveDailyWorkoutRequest,
} from './daily-workout-context';

const NOW = new Date('2026-09-25T12:00:00.000Z');

function fixtureRead() {
  return vi.fn(async (name: string) => {
    switch (name) {
      case 'list_training_plans': return { scheduleRevision: 7, scanComplete: true, plans: [] };
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
  const history = [
    { role: 'user' as const, text: 'Suggest a workout for today using readiness and my plan.',
      createdAt: '2026-10-03T09:00:00Z' },
    { role: 'assistant' as const, text: 'Consider an easy ride.', createdAt: '2026-10-03T09:01:00Z' },
    { role: 'user' as const, text: 'What about tomorrow?', createdAt: '2026-10-03T09:02:00Z' },
  ];

  it('retains the recommendation thread for tomorrow and the no-plan hypothetical without inheriting writes', () => {
    for (const prompt of ['What about tomorrow?', 'For tomorrow please.',
      "Today was done so no other session. If I didn't have that plan what would you propose taking into account all the above?"]) {
      expect(requestsDailyWorkoutContext(prompt, history)).toBe(true);
      expect(requestsDailyWorkoutChange(prompt)).toBe(false);
      expect(resolveDailyWorkoutRequest(prompt, history, new Date('2026-10-03T10:00:00Z'), 'Europe/Helsinki').targetDate)
        .toBe('2026-10-04');
    }
    expect(resolveDailyWorkoutRequest("Today was done so no other session. If I didn't have that plan, for tomorrow please.",
      history, new Date('2026-10-03T10:00:00Z'), 'Europe/Helsinki')).toEqual({
      targetDate: '2026-10-04', hypotheticalWithoutPlan: true, noAdditionalWorkoutToday: true,
    });
    expect(requestsDailyWorkoutContext('What about tomorrow?', [...history,
      { role: 'user', text: 'Show my weight trend.' }])).toBe(false);
  });

  it('anchors inherited relative dates to the original message while a new today request uses the new day', () => {
    const nextMorning = new Date('2026-10-04T08:00:00Z');
    expect(resolveDailyWorkoutRequest('Please reassess the session.', history, nextMorning, 'Europe/Helsinki').targetDate)
      .toBe('2026-10-04');
    expect(resolveDailyWorkoutRequest('Create a workout for today.', history, nextMorning, 'Europe/Helsinki').targetDate)
      .toBe('2026-10-04');
    expect(resolveDailyWorkoutRequest('What about tomorrow?', history, nextMorning, 'Europe/Helsinki').targetDate)
      .toBe('2026-10-05');
  });

  it('retains hypothetical and same-day constraints for short follow-ups but not a new request or new day', () => {
    const constrained = [...history, { role: 'user' as const, createdAt: '2026-10-03T09:03:00Z',
      text: "Today was done so no other session. If I didn't have that plan what would you propose taking into account all the above?" }];
    expect(resolveDailyWorkoutRequest('For tomorrow please.', constrained, new Date('2026-10-03T12:00:00Z'), 'Europe/Helsinki'))
      .toEqual({ targetDate: '2026-10-04', hypotheticalWithoutPlan: true, noAdditionalWorkoutToday: true });
    expect(resolveDailyWorkoutRequest('Please reassess the session.', constrained, new Date('2026-10-04T12:00:00Z'), 'Europe/Helsinki'))
      .toEqual({ targetDate: '2026-10-04', hypotheticalWithoutPlan: true, noAdditionalWorkoutToday: false });
    expect(resolveDailyWorkoutRequest('Create a workout for today.', constrained, new Date('2026-10-04T12:00:00Z'), 'Europe/Helsinki'))
      .toEqual({ targetDate: '2026-10-04', hypotheticalWithoutPlan: false, noAdditionalWorkoutToday: false });
  });

  it.each([
    ['2026-12-31T23:30:00Z', 'Europe/Helsinki', '2027-01-02'],
    ['2028-02-28T12:00:00Z', 'Europe/Helsinki', '2028-02-29'],
    ['2026-03-28T12:00:00Z', 'Europe/Helsinki', '2026-03-29'],
    ['2026-10-24T12:00:00Z', 'Europe/Helsinki', '2026-10-25'],
    ['2026-10-04T00:30:00Z', 'America/Los_Angeles', '2026-10-04'],
  ])('resolves tomorrow as a calendar date across DST/leap/year/zone boundaries %s', (time, zone, target) => {
    expect(resolveDailyWorkoutRequest('Suggest a workout for tomorrow.', [], new Date(time), zone).targetDate).toBe(target);
  });

  it('keeps ambiguous or impossible target dates unresolved instead of choosing today', () => {
    for (const prompt of ['Suggest a workout for today and tomorrow.', 'Suggest a workout on 2026-02-30.']) {
      expect(resolveDailyWorkoutRequest(prompt, history, NOW, 'Europe/Helsinki').targetDate).toBeNull();
    }
  });

  it('keeps explicit plan creation on the multi-workout workflow and ends the previous daily recommendation thread', () => {
    for (const prompt of ['Create a training plan for tomorrow.', 'Create me a new plan for Tuesday and Wednesday.',
      'Build a new training plan with one workout today and one tomorrow.']) {
      expect(requestsDailyWorkoutContext(prompt, history)).toBe(false);
      expect(requestsDailyWorkoutContext('What about tomorrow?', [...history, { role: 'user', text: prompt }])).toBe(false);
    }
    expect(requestsDailyWorkoutContext('Create a workout for tomorrow using my plan.', history)).toBe(true);
  });

  it('checks the requested day calendar and weekday while keeping current readiness and completed activity dated today', async () => {
    const base = fixtureRead();
    const read = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'get_training_metric') return { metricKind: args.metricKind, payload: {} };
      if (name === 'query_planned_workouts_by_date') return { scheduleRevision: 7, scanComplete: true, workouts: [] };
      if (name === 'query_timeline_notes') return { scanComplete: true, notes: [{
        category: 'travel', title: 'Trip', startDate: '2026-09-26', endDate: '2026-09-27',
        effectiveEndDate: '2026-09-27', timeZone: 'Europe/Helsinki',
      }] };
      return base(name);
    });
    const result = await collectDailyWorkoutContext({ now: NOW, timeZone: 'Europe/Helsinki',
      timelineNotesEnabled: true, trainingPlansEnabled: true, read: read as never,
      request: { targetDate: '2026-09-26', hypotheticalWithoutPlan: true, noAdditionalWorkoutToday: true } });
    expect(result.localDate).toBe('2026-09-25');
    expect(result.weekday).toBe('Saturday');
    expect(result.weekdayConsistency.matchingWeekdayCount).toBe(0);
    expect(result.timelineNotes.notes[0].status).toBe('upcoming');
    expect(read).toHaveBeenCalledWith('query_planned_workouts_by_date', {
      startDate: '2026-09-26', endDate: '2026-09-26', limit: 25,
    });
    expect(read).toHaveBeenCalledWith('query_timeline_notes', expect.objectContaining({ endDate: '2026-09-26' }));
    expect(read).toHaveBeenCalledWith('query_activities', expect.objectContaining({ relativePeriod: 'today' }));
    const facts = dailyWorkoutFacts(result);
    expect(facts).toContain('**Planned 2026-09-26:** No workouts listed for 2026-09-26');
    expect(facts).toContain('as of 2026-09-25, not forecast');
    expect(facts).toContain('No additional workout today');
    expect(facts).toContain('hypothetical suggestion');
    expect(facts).not.toContain('**Planned today:**');
  });


  it.each(['known', 'gap', 'stale', 'missing', 'disabled'])('keeps target-day phase context %s and separate from measured readiness', async state => {
    const base = fixtureRead();
    const read = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'get_training_metric') return { metricKind: args.metricKind, payload: {} };
      if (name === 'list_training_plans') return { scheduleRevision: 7, scanComplete: true,
        plans: [{ planRef: 'plan-ref', revision: 3, name: 'Autumn' }] };
      if (name === 'get_training_plan_phases') {
        if (state === 'missing') throw new Error('Not in this catalog');
        return { scheduleRevision: state === 'stale' ? 8 : 7, planRevision: 3, phases: { version: 1, items: [{
          id: 'base', name: 'Base', startLocalDate: '2026-10-24', endLocalDate: '2026-10-25',
          description: 'private-description-canary',
        }] } };
      }
      return base(name);
    });
    const result = await collectDailyWorkoutContext({ now: new Date('2026-10-24T12:00:00Z'), timeZone: 'Europe/Helsinki',
      timelineNotesEnabled: false, trainingPlansEnabled: state !== 'disabled', read: read as never,
      request: { targetDate: state === 'gap' ? '2026-10-26' : '2026-10-25', hypotheticalWithoutPlan: false, noAdditionalWorkoutToday: false } });
    expect(result.plannedWorkouts.phaseContext?.status).toBe(state === 'known' ? 'known' : state === 'gap' ? 'none' : state === 'disabled' ? undefined : 'unavailable');
    expect(dailyWorkoutFacts(result)).not.toContain('private-description-canary');
    if (state === 'known') expect(dailyWorkoutFacts(result)).toContain('Base');
    if (state === 'disabled') expect(read.mock.calls.map(call => call[0])).not.toContain('get_training_plan_phases');
  });
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

  it('keeps distant-date notes inside the existing query contract without claiming a complete scan', async () => {
    const base = fixtureRead();
    const read = vi.fn(async (name: string, args: Record<string, unknown>) => name === 'get_training_metric'
      ? { metricKind: args.metricKind, payload: {} } : base(name));
    const result = await collectDailyWorkoutContext({ now: NOW, timeZone: 'UTC',
      timelineNotesEnabled: true, trainingPlansEnabled: false, read: read as never,
      request: { targetDate: '2027-12-31', hypotheticalWithoutPlan: false, noAdditionalWorkoutToday: false } });
    expect(read).toHaveBeenCalledWith('query_timeline_notes', expect.objectContaining({
      startDate: '2026-08-29', endDate: '2027-08-29',
    }));
    expect(result.timelineNotes.scanComplete).toBe(false);
    expect(dailyWorkoutFacts(result)).toContain('Some notes could not be checked');
  });

  it('previews only an expressly requested workout change', () => {
    expect(requestsDailyWorkoutChange('Suggest a workout for today using my current schedule.')).toBe(false);
    expect(requestsDailyWorkoutChange('Suggest a workout for today, but do not send it.')).toBe(false);
    expect(requestsDailyWorkoutChange('Suggest a workout for today and sync it to Garmin.')).toBe(true);
    expect(requestsDailyWorkoutChange('Create one workout for today and send it to Suunto.')).toBe(true);
    expect(requestsDailyWorkoutContext(ASSISTANT_CREATE_TODAYS_WORKOUT_PROMPT, [])).toBe(true);
    expect(requestsDailyWorkoutChange(ASSISTANT_CREATE_TODAYS_WORKOUT_PROMPT)).toBe(true);
    expect(resolveDailyWorkoutRequest(ASSISTANT_CREATE_TODAYS_WORKOUT_PROMPT, [], NOW, 'Europe/Helsinki'))
      .toEqual({ targetDate: '2026-09-25', hypotheticalWithoutPlan: false, noAdditionalWorkoutToday: false });
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
    expect(result.plannedWorkouts.scheduleRevision).toBe(7);
    expect(result.trainingSnapshots.form?.metricKind).toBe(DERIVED_METRIC_KINDS.Form);
    expect(result.trainingSnapshots.rampRate?.metricKind).toBe(DERIVED_METRIC_KINDS.RampRate);
    expect(result.trainingSnapshots.trainingSummary?.metricKind).toBe(DERIVED_METRIC_KINDS.TrainingSummary);
    expect(read.mock.calls.map(([name]) => name)).toEqual([
      'prepare_training_metrics', 'get_training_metric', 'get_training_metric',
      'get_training_metric',
      'get_daily_report', 'query_metric', 'query_activities', 'query_timeline_notes',
      'query_planned_workouts_by_date', 'get_planned_workout_completions', 'list_training_plans',
    ]);
    expect(read.mock.calls.find(([name]) => name === 'query_metric')?.[1])
      .toMatchObject({ metric: DataDuration.type, aggregation: 'total', interval: 'daily',
        timeZone: 'Europe/Helsinki' });
    expect(read.mock.calls.find(([name]) => name === 'get_planned_workout_completions')?.[1])
      .toEqual({ workoutRefs: ['swim-ref', 'bike-ref', 'wahoo-ref'] });
    const facts = dailyWorkoutFacts(result);
    expect(facts).toContain('2 of the last 4 Fridays');
    expect(facts).toContain('Belly Pain”');
    expect(facts).toContain('2026-09-04 – 2026-09-10 (ended)');
    expect(facts).toContain('1 has a linked recorded activity');
    expect(facts).toContain('Linked to a recorded activity: “Wahoo test”');
    expect(facts).toContain('Freshness, Ramp rate, Training summary checked');
    expect(facts.split('\n').every(line => line.startsWith('- '))).toBe(true);
    expect(facts).not.toContain('snapshot');
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
    expect(dailyWorkoutFacts(result)).toContain('linked activities were not checked because Training plans access is off');
  });

  it('keeps missing records distinct from incomplete reads in the readable summary', async () => {
    const base = fixtureRead();
    const read = vi.fn(async (name: string, args: Record<string, unknown>) =>
      name === 'get_training_metric' ? { metricKind: args.metricKind, payload: {} } : base(name));
    const result = await collectDailyWorkoutContext({ now: NOW, timeZone: 'Europe/Helsinki',
      timelineNotesEnabled: true, trainingPlansEnabled: true, read: read as never });
    result.activitiesToday.scanComplete = false;
    result.timelineNotes.scanComplete = false;
    result.plannedWorkouts.scanComplete = false;
    result.plannedWorkouts.workouts = [];
    const incomplete = dailyWorkoutFacts(result);
    expect(incomplete).toContain('Some activities could not be checked, so the total is unknown');
    expect(incomplete).toContain('Some notes could not be checked; more may exist');
    expect(incomplete).toContain('No workouts found so far');
    expect(incomplete).toContain('Some planned workouts could not be checked; more may exist');
    expect(incomplete).not.toContain('No workouts listed for today');
    result.plannedWorkouts.scanComplete = true;
    expect(dailyWorkoutFacts(result)).toContain('No workouts listed for today');
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
    expect(dailyWorkoutFacts(result)).toContain('**Timeline notes (last 28 days):** Found 1 ongoing, 1 ended');
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
    expect(dailyWorkoutFacts(result)).toContain('Freshness, Ramp rate, Training summary unavailable');
  });
});
