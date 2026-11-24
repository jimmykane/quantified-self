import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { collectDailyWorkoutSuggestionContext } from './daily-workout-suggestion-context';
import { DayWorkoutTrainingNotReadyError, readDayWorkoutTrainingContext } from './day-workout-context';
import { withWorkoutTargetContext } from './day-workout-target-context';
import { selectDailyWorkoutSuggestionSport } from './daily-workout-suggestion-routine';
import { createAssistantMcpSession, type AssistantMcpSession } from './mcp-session';

vi.mock('./mcp-session', () => ({ createAssistantMcpSession: vi.fn() }));
vi.mock('./daily-workout-suggestion-routine', async original => {
  const actual = await original<typeof import('./daily-workout-suggestion-routine')>();
  return { ...actual, selectDailyWorkoutSuggestionSport: vi.fn(actual.selectDailyWorkoutSuggestionSport) };
});
vi.mock('./day-workout-target-context', () => ({ withWorkoutTargetContext: vi.fn(async (_uid, _controls, _now, context) => context) }));
vi.mock('./day-workout-context', async original => ({
  ...await original<typeof import('./day-workout-context')>(), readDayWorkoutTrainingContext: vi.fn(),
}));

describe('daily Training preparation before weekday sport selection', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const preferences = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-11-15', 'UTC') };
  const selected = { ...preferences.controls, sport: ActivityTypes.Cycling };
  let status: string, preparationFails: boolean, snapshotFails: boolean, routineFails: boolean;
  let routineRequests: Record<string, unknown>[], routinePages: Record<string, unknown>[];
  let calls: string[], readyKinds: Set<string>;
  let session: Pick<AssistantMcpSession, 'callTool' | 'close'>;
  beforeEach(() => {
    vi.clearAllMocks(); status = 'ready'; preparationFails = false; snapshotFails = false;
    calls = []; readyKinds = new Set(); routineFails = false; routineRequests = [];
    routinePages = [{ scanComplete: true, activities: ['2026-11-01', '2026-11-08'].map(date => ({
      activityRef: date, startTimeMs: Date.parse(date + 'T09:00:00Z'), activityType: ActivityTypes.Cycling,
      stats: { durationSeconds: 3600 },
    })) }];
    session = {
      close: vi.fn(async () => undefined),
      callTool: vi.fn(async (name, input = {}) => {
        calls.push(name);
        if (name === 'prepare_training_metrics') {
          if (preparationFails) throw Error('Unavailable');
          readyKinds = new Set(status === 'ready' ? input.metricKinds as string[] : []);
          return { structuredContent: { status, readyMetricKinds: [...readyKinds] } };
        }
        if (name === 'query_activities' && input.start === '2026-10-17T00:00:00Z' && !input.activityTypes) {
          routineRequests.push(input);
          if (routineFails) throw Error('History unavailable');
          return { structuredContent: routinePages[routineRequests.length - 1] };
        }
        // Mirror the session's admission rule: snapshot reads require preparation on this session.
        if (name === 'get_training_metric' && (snapshotFails || !readyKinds.has(String(input.metricKind)))) throw Error('Not ready');
        if (name === 'get_daily_report') return { structuredContent: { sleep: { status: 'no_completed_session', latestSession: null } } };
        return { structuredContent: { ...input, scanComplete: true, scheduleRevision: 1,
          restDays: [], workouts: [], plans: [], activities: [], notes: [] } };
      }),
    };
    vi.mocked(createAssistantMcpSession).mockResolvedValue(session as AssistantMcpSession);
    vi.mocked(readDayWorkoutTrainingContext).mockResolvedValue({
      scheduleRevision: 1, nearby: [], phase: null, previousStrength: [], references: [], missing: [],
    });
  });
  it.each(['preparing', 'unavailable', 'error'])('defers %s before sport or other context reads and closes its session', async pending => {
    status = pending; preparationFails = pending === 'error';
    await expect(collectDailyWorkoutSuggestionContext('owner', preferences, now, false))
      .rejects.toBeInstanceOf(DayWorkoutTrainingNotReadyError);
    expect(calls).toEqual(['prepare_training_metrics']);
    expect(selectDailyWorkoutSuggestionSport).not.toHaveBeenCalled();
    expect(readDayWorkoutTrainingContext).not.toHaveBeenCalled();
    expect(withWorkoutTargetContext).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  });
  it('prepares once on the same session, then uses the chosen sport throughout context', async () => {
    const result = await collectDailyWorkoutSuggestionContext('owner', preferences, now, false);
    expect(calls.slice(0, 2)).toEqual(['prepare_training_metrics', 'query_activities']);
    expect(calls.filter(name => name === 'prepare_training_metrics')).toHaveLength(1);
    expect(calls).toContain('get_training_metric');
    expect(selectDailyWorkoutSuggestionSport).toHaveBeenCalledWith(preferences, now, session);
    expect(result.controls).toEqual(selected); expect(result.evidence.trainingMetricsReady).toBe(true);
    expect(readDayWorkoutTrainingContext).toHaveBeenCalledWith('owner', selected, now);
    expect(withWorkoutTargetContext).toHaveBeenCalledWith('owner', selected, now, expect.any(Object));
    expect(createAssistantMcpSession).toHaveBeenCalledExactlyOnceWith('owner', 'https://quantified-self.io', undefined,
      'coordinate_free', preferences.controls.timelineContext, preferences.controls.trainingContext);
    expect(session.close).toHaveBeenCalledOnce();
  });
  it.each([true, false])('keeps weekday history bounded and falls back unless the scan completes (complete: %s)', async complete => {
    const history = routinePages[0].activities as unknown[];
    routinePages = [
      { scanComplete: false, nextCursor: 'page-2', activities: [history[0]] },
      { scanComplete: complete, ...(complete ? {} : { nextCursor: 'page-3' }), activities: [history[1]] },
    ];
    const result = await collectDailyWorkoutSuggestionContext('owner', preferences, now, false);
    expect(result.controls.sport).toBe(complete ? selected.sport : preferences.controls.sport);
    expect(routineRequests).toEqual([
      { start: '2026-10-17T00:00:00Z', end: now.toISOString(), limit: 100 },
      { start: '2026-10-17T00:00:00Z', end: now.toISOString(), limit: 100, cursor: 'page-2' },
    ]);
    expect(createAssistantMcpSession).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce();
  });
  it.each(['followRoutine', 'routineContext', 'activityContext'] as const)('skips weekday history when %s is disabled', async disabled => {
    const prefs = disabled === 'followRoutine' ? { ...preferences, followRoutine: false }
      : { ...preferences, controls: { ...preferences.controls, [disabled]: false } };
    const result = await collectDailyWorkoutSuggestionContext('owner', prefs, now, false);
    expect(routineRequests).toEqual([]); expect(result.controls).toEqual(prefs.controls);
    expect(createAssistantMcpSession).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce();
  });
  it.each([false, true])('only prepares selected metrics (all disabled: %s)', async disabled => {
    const prefs = { ...preferences, controls: { ...preferences.controls, freshnessContext: false, activityContext: !disabled } };
    const result = await collectDailyWorkoutSuggestionContext('owner', prefs, now, false);
    expect(result.evidence.trainingMetricsReady).toBe(true);
    if (disabled) expect(calls).not.toContain('prepare_training_metrics');
    else expect(session.callTool).toHaveBeenCalledWith('prepare_training_metrics', { metricKinds: ['training_summary'] });
    expect(session.close).toHaveBeenCalledOnce();
  });
  it('preserves best-effort context when the user explicitly chooses available data', async () => {
    status = 'preparing';
    const result = await collectDailyWorkoutSuggestionContext('owner', preferences, now, true);
    expect(calls.slice(0, 2)).toEqual(['query_activities', 'prepare_training_metrics']);
    expect(calls.filter(name => name === 'prepare_training_metrics')).toHaveLength(1);
    expect(result.evidence.trainingMetricsReady).toBe(false);
    expect(withWorkoutTargetContext).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce();
  });
  it('keeps the shared session open for recovery context after a failed routine read', async () => {
    routineFails = true;
    const result = await collectDailyWorkoutSuggestionContext('owner', preferences, now, false);
    expect(result.controls).toEqual(preferences.controls);
    expect(result.evidence.trainingMetricsReady).toBe(true);
    expect(withWorkoutTargetContext).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce();
  });
  it('closes the shared session if later context collection fails', async () => {
    vi.mocked(readDayWorkoutTrainingContext).mockRejectedValueOnce(Error('Schedule changed'));
    await expect(collectDailyWorkoutSuggestionContext('owner', preferences, now, false)).rejects.toThrow('Schedule changed');
    expect(session.close).toHaveBeenCalledOnce(); expect(withWorkoutTargetContext).not.toHaveBeenCalled();
  });
  it('still defers if a prepared snapshot fails later, without repeating preparation', async () => {
    snapshotFails = true;
    await expect(collectDailyWorkoutSuggestionContext('owner', preferences, now, false))
      .rejects.toBeInstanceOf(DayWorkoutTrainingNotReadyError);
    expect(calls).toEqual(['prepare_training_metrics', 'query_activities', 'get_training_metric']);
    expect(session.close).toHaveBeenCalledOnce();
  });
});
