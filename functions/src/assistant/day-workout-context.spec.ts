import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DAY_WORKOUT_SIGNAL_OPTIONS, defaultDayWorkoutControls } from '../../../shared/day-workout';
import { collectDayWorkoutContext, type DayWorkoutTrainingContext } from './day-workout-context';
import type { AssistantMcpToolName } from './mcp-session';

const now = new Date('2026-10-28T12:00:00Z');
const controls = { ...defaultDayWorkoutControls('2026-11-02', 'Europe/Helsinki'), trainingContext: false, timelineContext: false };
const training: DayWorkoutTrainingContext = { scheduleRevision: 7, nearby: [], phase: null, previousStrength: [], references: [], missing: [] };
function session(fail?: string) {
  return { callTool: vi.fn<(name: AssistantMcpToolName, input?: Record<string, unknown>) => Promise<{ structuredContent: Record<string, unknown> }>>(async name => {
    if (name === fail) throw new Error('Synthetic read failure');
    const values: Record<string, Record<string, unknown>> = {
      prepare_training_metrics: { status: 'preparing', readyMetricKinds: [] },
      get_daily_report: { readiness: { score: null } },
      query_metric: { aggregation: { buckets: [] } }, query_metrics: { results: [] },
      query_activities: { activities: [], scanComplete: true },
      query_timeline_notes: { notes: [], scanComplete: true },
      query_planned_workouts_by_date: { workouts: [], scanComplete: true, scheduleRevision: 7 },
      list_training_plans: { plans: [], scanComplete: true, scheduleRevision: 7 },
    };
    return { structuredContent: values[name] ?? {} };
  }) };
}
describe('Calendar generation context boundaries', () => {
  const recoveryReport = {
    sleep: { status: 'available', latestSession: { durationSeconds: 28800 } },
    readiness: { status: 'available', score: 61, confidence: 'medium', drivers: {
      load: { status: 'available', form: 0, rampRate: -2 },
      hrv: { personalRange: { latestMs: 45, reason: 'outside_range', currentAverage: 42,
        normalRange: { min: 50, max: 65 }, observationDayCount: 30 } },
      overnightHeartRate: { status: 'available', combinedRatio: 1.1 },
    } },
    trainingSummary: { status: 'available', current28d: { sessionCount: 10 } },
  };
  function withReport(report: Record<string, unknown>) {
    const source = session(); const original = source.callTool.getMockImplementation()!;
    source.callTool.mockImplementation(async name => name === 'get_daily_report'
      ? { structuredContent: report } : original(name));
    return source;
  }
  const reportWithVitals = () => ({ ...recoveryReport, sleep: { ...recoveryReport.sleep, latestSession: {
    durationSeconds: 28800, vitals: { averageHrvMs: 8787.01, overnightHrvMs: 8787.02,
      averageHeartRateBpm: 8989.01, minimumHeartRateBpm: 8989.02 },
  } } });
  it.each(['hrvContext', 'sleepContext', 'overnightHeartRateContext', 'freshnessContext'] as const)('omits unchecked %s evidence and the combined readiness score', async key => {
      const source = withReport(reportWithVitals());
      const original = source.callTool.getMockImplementation()!;
      source.callTool.mockImplementation(async name => name === 'prepare_training_metrics'
        ? { structuredContent: { status: 'ready', readyMetricKinds: ['form', 'ramp_rate', 'training_summary'] } }
        : name === 'get_training_metric' ? { structuredContent: { payload: { dailyLoads: [{ load: 5757.01 }] } } }
          : original(name));
      const result = await collectDayWorkoutContext({ ...controls, [key]: false }, now, source, vi.fn());
      const daily = result.evidence.daily as { dailyReport: {
        sleep?: { latestSession: { vitals: Record<string, unknown> } };
        readiness: { score?: number; drivers: Record<string, unknown> };
      }; trainingSnapshots: { form: unknown; rampRate: unknown } };
      const report = daily.dailyReport;
      expect(report.readiness.score).toBeUndefined();
      const driver = { hrvContext: 'hrv', sleepContext: 'sleep', overnightHeartRateContext: 'overnightHeartRate', freshnessContext: 'load' }[key];
      expect(report.readiness.drivers[driver]).toBeUndefined();
      if (key === 'sleepContext') expect(report.sleep).toBeUndefined();
      else {
        expect(report.sleep?.latestSession).toBeDefined();
        if (key === 'hrvContext') expect(JSON.stringify(result.evidence)).not.toContain('8787.');
        if (key === 'overnightHeartRateContext') expect(JSON.stringify(result.evidence)).not.toContain('8989.');
      }
      if (key === 'freshnessContext') {
        expect(daily.trainingSnapshots.form).toBeNull(); expect(daily.trainingSnapshots.rampRate).toBeNull();
        expect(source.callTool).toHaveBeenCalledWith('prepare_training_metrics', { metricKinds: ['training_summary'] });
        expect(source.callTool).not.toHaveBeenCalledWith('get_training_metric', { metricKind: 'form' });
        expect(source.callTool).not.toHaveBeenCalledWith('get_training_metric', { metricKind: 'ramp_rate' });
      }
      expect(result.missingContext.some(message => message.includes('turned off'))).toBe(true);
    });
  it('omits an unchecked combined readiness score while keeping independently selected drivers', async () => {
    const result = await collectDayWorkoutContext({ ...controls, readinessContext: false }, now, withReport(reportWithVitals()), vi.fn());
    expect(result.evidence.daily).toMatchObject({ dailyReport: { readiness: { status: 'disabled', drivers: {
      hrv: recoveryReport.readiness.drivers.hrv, load: recoveryReport.readiness.drivers.load,
    } } } });
    expect((result.evidence.daily as { dailyReport: { readiness: unknown } }).dailyReport.readiness).not.toHaveProperty('score');
  });
  it('skips unchecked activity and feedback queries and omits their evidence instead of reporting zero', async () => {
    const source = withReport(reportWithVitals());
    const result = await collectDayWorkoutContext({ ...controls, activityContext: false, feedbackContext: false }, now, source, vi.fn());
    const names = source.callTool.mock.calls.map(call => call[0]);
    for (const name of ['query_activities', 'query_metric', 'query_metrics']) expect(names).not.toContain(name);
    expect(result.evidence.daily).not.toHaveProperty('activitiesToday');
    expect(result.evidence.daily).not.toHaveProperty('weekdayConsistency');
    expect(result.evidence.daily).not.toHaveProperty('dailyReport.trainingSummary');
    expect(result.evidence).not.toHaveProperty('feedback');
    expect(result.usedContext).not.toContain('Today’s recorded activities');
  });
  it('does not read recovery or activity tools when every data option is off', async () => {
    const source = session();
    const off = { ...controls, ...Object.fromEntries(DAY_WORKOUT_SIGNAL_OPTIONS.map(({ key }) => [key, false])) };
    const result = await collectDayWorkoutContext(off, now, source, vi.fn());
    expect(source.callTool).not.toHaveBeenCalled();
    expect(result.usedContext).toEqual([]);
  });
  it('supplies selected-sport weekday habits without sending activity identities or redundant all-sport buckets', async () => {
    const source = session(); const original = source.callTool.getMockImplementation()!;
    source.callTool.mockImplementation(async (name, input) => name === 'query_activities' && input?.start
      ? { structuredContent: { scanComplete: true, activities: ['2026-10-12', '2026-10-19', '2026-10-26'].map(date => ({
        activityRef: 'PRIVATE-REF-' + date, activityType: ActivityTypes.StrengthTraining,
        startTimeMs: Date.parse(date + 'T10:00Z'), stats: { durationSeconds: 3600 }, title: 'PRIVATE-TITLE',
      })) } } : original(name));
    const result = await collectDayWorkoutContext({ ...controls, sport: ActivityTypes.StrengthTraining }, now, source, vi.fn());
    expect(result.evidence.daily).toMatchObject({ trainingRoutine: { sport: ActivityTypes.StrengthTraining, weekday: 'Monday',
      recordedDayCount: 3, weekdayOpportunities: 4, typicalDurationSeconds: 3600 } });
    expect(result.evidence.daily).not.toHaveProperty('weekdayConsistency');
    expect(JSON.stringify(result.evidence)).not.toMatch(/PRIVATE-REF|PRIVATE-TITLE/);
    expect(result.usedContext).toContain('Recorded Strength Training on 3 of the previous 4 Mondays');
    expect(source.callTool.mock.calls.map(([name]) => name)).not.toContain('query_metric');
  });
  it('makes the routine opt-out independent of recovery and stops its historical reads when activities are off', async () => {
    for (const overrides of [{ routineContext: false }, { activityContext: false }]) {
      const source = withReport(recoveryReport);
      const result = await collectDayWorkoutContext({ ...controls, ...overrides }, now, source, vi.fn());
      expect(source.callTool.mock.calls.filter(([name, input]) => name === 'query_activities' && input?.start)).toEqual([]);
      expect(result.evidence.daily).not.toHaveProperty('trainingRoutine');
      expect(result.evidence.daily).not.toHaveProperty('weekdayConsistency');
      expect(result.usedContext).toContain('Current freshness (Form)');
    }
  });
  it('discloses incomplete routine history without claiming an empty weekday pattern', async () => {
    const source = session(); const original = source.callTool.getMockImplementation()!;
    source.callTool.mockImplementation(async (name, input) => name === 'query_activities' && input?.start
      ? { structuredContent: { scanComplete: false, nextCursor: 'more', activities: [] } } : original(name));
    const result = await collectDayWorkoutContext(controls, now, source, vi.fn());
    expect(result.evidence.daily).not.toHaveProperty('trainingRoutine');
    expect(result.missingContext).toContain('Training routine could not be checked completely; no weekday habit was inferred.');
    expect(result.usedContext.some(text => text.includes('previous 4'))).toBe(false);
  });
  it('always supplies current freshness, HRV, sleep, heart rate and readiness with optional access off', async () => {
    const source = withReport(recoveryReport);
    const result = await collectDayWorkoutContext(controls, now, source, vi.fn());
    expect(source.callTool).toHaveBeenCalledWith('get_daily_report', { timeZone: 'Europe/Helsinki' });
    expect(result.evidence.daily).toMatchObject({ dailyReport: recoveryReport,
      localDate: '2026-10-28', recommendation: { targetDate: '2026-11-02' } });
    // Another snapshot can still be preparing without hiding usable current signals, including zero Form.
    expect(result.usedContext).toEqual(expect.arrayContaining(['Current freshness (Form)',
      'Current training load ramp rate', 'Recent sleep', 'Recorded HRV', 'HRV compared with your personal range',
      'Recorded overnight heart rate', 'Overnight heart rate compared with your personal baseline',
      'Readiness observed on 2026-10-28', 'Training summary: recent 28 days and usual volume']));
    expect(result.missingContext).not.toContain('Current freshness (Form) is unavailable.');
    expect(source.callTool.mock.calls.map(call => call[0])).not.toContain('query_planned_workouts_by_date');
  });
  it('retains available historical loads without calling them current freshness when the daily report fails', async () => {
    const source = session('get_daily_report'); const original = source.callTool.getMockImplementation()!;
    source.callTool.mockImplementation(async name => {
      if (name === 'prepare_training_metrics') return { structuredContent: { status: 'ready', readyMetricKinds: ['form'] } };
      if (name === 'get_training_metric') return { structuredContent: { metricKind: 'form', payload: {
        dailyLoads: [{ dayMs: Date.parse('2026-10-27T00:00Z'), load: 75 }],
      } } };
      return original(name);
    });
    const result = await collectDayWorkoutContext(controls, now, source, async () => training);
    expect(result.usedContext).toContain('Training load history');
    expect(result.usedContext).not.toContain('Current freshness (Form)');
    expect(result.missingContext).toContain('Current freshness (Form) is unavailable.');
    expect(result.missingContext).toContain('Current readiness is unavailable.');
  });
  it('does not claim recovery evidence from nonempty wrappers with missing values', async () => {
    const result = await collectDayWorkoutContext(controls, now, withReport({
      sleep: { status: 'no_completed_session', latestSession: null },
      readiness: { status: 'no_signal', score: null, drivers: { load: { status: 'not_ready', form: null, rampRate: null },
        hrv: { personalRange: null }, overnightHeartRate: { status: 'not_recorded' } } },
      trainingSummary: { status: 'stale' },
    }), async () => training);
    expect(result.usedContext).toEqual(['Today’s recorded activities']);
    expect(result.missingContext).toEqual(expect.arrayContaining(['Current freshness (Form) is unavailable.',
      'Current readiness is unavailable.', 'Recent sleep is unavailable.', 'Recent HRV is unavailable.',
      'Recent overnight heart rate is unavailable.', 'The current 28-day Training summary is unavailable.']));
  });
  it.each([
    ['building_baseline', 'HRV personal baseline is still building.'],
    ['insufficient_current', 'HRV has too few recent observations for a personal-range comparison.'],
  ])('keeps recorded values but discloses unavailable HRV comparison: %s', async (reason, message) => {
    const report = { ...recoveryReport, readiness: { ...recoveryReport.readiness,
      drivers: { ...recoveryReport.readiness.drivers,
        hrv: { personalRange: { latestMs: 45, reason } },
        overnightHeartRate: { status: 'insufficient_baseline' },
      } } };
    const result = await collectDayWorkoutContext(controls, now, withReport(report), async () => training);
    expect(result.usedContext).toContain('Recorded HRV');
    expect(result.usedContext).not.toContain('HRV compared with your personal range');
    expect(result.usedContext).toContain('Recorded overnight heart rate');
    expect(result.usedContext).not.toContain('Overnight heart rate compared with your personal baseline');
    expect(result.missingContext).toContain(message);
    expect(result.missingContext).toContain('Overnight heart rate has too little baseline history for comparison.');
  });

  it('uses Training and Timeline context by default, while keeping each opt-out independent', async () => {
    const defaults = defaultDayWorkoutControls('2026-11-02', 'Europe/Helsinki');
    for (const choices of [defaults, { ...defaults, trainingContext: false }, { ...defaults, timelineContext: false }]) {
      const source = session(); const readTraining = vi.fn().mockResolvedValue(training);
      await collectDayWorkoutContext(choices, now, source, readTraining);
      expect(readTraining).toHaveBeenCalledTimes(choices.trainingContext ? 1 : 0);
      const called = source.callTool.mock.calls.map(call => call[0]);
      expect(called.includes('query_planned_workouts_by_date')).toBe(choices.trainingContext);
      expect(called.includes('query_timeline_notes')).toBe(choices.timelineContext);
    }
  });
  it('propagates verified selected-plan rest intent only with Training context enabled', async () => {
    const plannedRestDay = { localDate: controls.localDate, planName: 'Autumn' };
    const readTraining = vi.fn().mockResolvedValue({ ...training, plannedRestDay });
    const enabled = await collectDayWorkoutContext({ ...controls, trainingContext: true }, now, session(), readTraining);
    expect(enabled.plannedRestDay).toEqual(plannedRestDay);
    expect(enabled.usedContext).toContain('Authored rest day in the selected plan');
    readTraining.mockClear();
    const disabled = await collectDayWorkoutContext(controls, now, session(), readTraining);
    expect(disabled).not.toHaveProperty('plannedRestDay'); expect(readTraining).not.toHaveBeenCalled();
  });
  it('never reads plans or notes without their independent opt-ins', async () => {
    const source = session(); const readTraining = vi.fn().mockResolvedValue(training);
    const result = await collectDayWorkoutContext(controls, now, source, readTraining);
    expect(readTraining).not.toHaveBeenCalled();
    expect(source.callTool.mock.calls.map(call => call[0])).not.toContain('query_timeline_notes');
    expect(source.callTool.mock.calls.map(call => call[0])).not.toContain('query_planned_workouts_by_date');
    expect(result.missingContext).toContain('Training plan context and previous weights: access is off.');
    expect(result.evidence.daily).toMatchObject({ localDate: '2026-10-28', recommendation: { targetDate: '2026-11-02' } });
  });
  it('uses only existing event metric aggregation for Feeling/RPE and labels missing feedback', async () => {
    const source = session();
    const result = await collectDayWorkoutContext(controls, now, source, async () => training);
    expect(source.callTool).toHaveBeenCalledWith('query_metrics', expect.objectContaining({ metrics: [
      { metric: 'Feeling', aggregation: 'minimum' }, { metric: 'Feeling', aggregation: 'maximum' },
      { metric: 'Rated Perceived Exertion', aggregation: 'minimum' }, { metric: 'Rated Perceived Exertion', aggregation: 'maximum' },
    ] }));
    expect(result.missingContext).toContain('No usable existing Feeling/RPE feedback was found.');
  });
  it('blocks incomplete or changed required schedule checks and tolerates optional recovery failure', async () => {
    await expect(collectDayWorkoutContext({ ...controls, trainingContext: true }, now,
      session('query_planned_workouts_by_date'), async () => training)).rejects.toThrow();
    await expect(collectDayWorkoutContext({ ...controls, trainingContext: true }, now,
      session(), async () => ({ ...training, scheduleRevision: 8 }))).rejects.toThrow(/changed/);
    const result = await collectDayWorkoutContext({ ...controls, timelineContext: true }, now,
      session('get_daily_report'), async () => training);
    expect(result.missingContext).toContain('Some recorded Training or recovery evidence is unavailable.');
    expect(result.usedContext).toContain('Existing Timeline notes, with their actual dates');
  });
  it('counts actual feedback values, including zero/fractions, and normalizes local-day metric buckets', async () => {
    const source = session(); const original = source.callTool.getMockImplementation()!;
    source.callTool.mockImplementation(async name => {
      if (name === 'query_metric') return { structuredContent: { aggregation: { buckets: [
        { time: Date.parse('2026-10-27T22:00Z'), totalCount: 1, aggregateValue: 1800 },
      ] } } };
      if (name === 'query_metrics') return { structuredContent: { results: [
        { metric: { type: 'Feeling' }, matchedEventCount: 12, aggregation: { buckets: [
          { time: Date.parse('2026-09-30T21:00Z'), totalCount: 1, aggregateValue: 0 },
          { time: Date.parse('2026-10-26T22:00Z'), totalCount: 2, aggregateValue: 2.5 },
          { time: Date.parse('2026-09-29T21:00Z'), totalCount: 1, aggregateValue: 5 },
        ] } },
        { metric: { type: 'Rated Perceived Exertion' }, matchedEventCount: 12, aggregation: { buckets: [] } },
      ] } };
      return original(name);
    });
    const result = await collectDayWorkoutContext(controls, now, source, async () => training);
    expect(result.evidence.feedback).toMatchObject({ results: [
      { aggregation: { buckets: [{ localDate: '2026-10-01', aggregateValue: 0 }, { localDate: '2026-10-27', aggregateValue: 2.5 }] } },
      { aggregation: { buckets: [] } },
    ] });
    expect(JSON.stringify(result.evidence.daily)).toContain('2026-10-28');
    source.callTool.mockImplementation(async name => name === 'query_metrics'
      ? { structuredContent: { results: [{ matchedEventCount: 12, aggregation: { buckets: [] } }] } } : original(name));
    expect((await collectDayWorkoutContext(controls, now, source, async () => training)).missingContext)
      .toContain('No usable existing Feeling/RPE feedback was found.');
  });
});
