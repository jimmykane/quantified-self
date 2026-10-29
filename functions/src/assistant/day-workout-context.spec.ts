import { describe, expect, it, vi } from 'vitest';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { collectDayWorkoutContext, type DayWorkoutTrainingContext } from './day-workout-context';
import type { AssistantMcpToolName } from './mcp-session';

const now = new Date('2026-10-28T12:00:00Z');
const controls = defaultDayWorkoutControls('2026-11-02', 'Europe/Helsinki');
const training: DayWorkoutTrainingContext = { scheduleRevision: 7, nearby: [], phase: null, previousStrength: [], references: [], missing: [] };
function session(fail?: string) {
  return { callTool: vi.fn(async (name: AssistantMcpToolName) => {
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
