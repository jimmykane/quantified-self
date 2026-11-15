import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { collectDailyWorkoutSuggestionContext } from './daily-workout-suggestion-context';
import { DayWorkoutTrainingNotReadyError, readDayWorkoutTrainingContext } from './day-workout-context';
import { withWorkoutPowerContext } from './day-workout-power';
import { selectDailyWorkoutSuggestionSport } from './daily-workout-suggestion-routine';
import { createAssistantMcpSession, type AssistantMcpSession } from './mcp-session';

vi.mock('./mcp-session', () => ({ createAssistantMcpSession: vi.fn() }));
vi.mock('./daily-workout-suggestion-routine', () => ({ selectDailyWorkoutSuggestionSport: vi.fn() }));
vi.mock('./day-workout-power', () => ({ withWorkoutPowerContext: vi.fn(async (_uid, _controls, _now, context) => context) }));
vi.mock('./day-workout-context', async original => ({
  ...await original<typeof import('./day-workout-context')>(), readDayWorkoutTrainingContext: vi.fn(),
}));

describe('daily Training preparation before weekday sport selection', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const preferences = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-11-15', 'UTC') };
  const selected = { ...preferences.controls, sport: ActivityTypes.Cycling };
  let status: string, preparationFails: boolean, snapshotFails: boolean;
  let calls: string[], readyKinds: Set<string>;
  let session: Pick<AssistantMcpSession, 'callTool' | 'close'>;
  beforeEach(() => {
    vi.clearAllMocks(); status = 'ready'; preparationFails = false; snapshotFails = false;
    calls = []; readyKinds = new Set();
    session = {
      close: vi.fn(async () => undefined),
      callTool: vi.fn(async (name, input = {}) => {
        calls.push(name);
        if (name === 'prepare_training_metrics') {
          if (preparationFails) throw Error('Unavailable');
          readyKinds = new Set(status === 'ready' ? input.metricKinds as string[] : []);
          return { structuredContent: { status, readyMetricKinds: [...readyKinds] } };
        }
        // Mirror the session's admission rule: snapshot reads require preparation on this session.
        if (name === 'get_training_metric' && (snapshotFails || !readyKinds.has(String(input.metricKind)))) throw Error('Not ready');
        if (name === 'get_daily_report') return { structuredContent: { sleep: { status: 'no_completed_session', latestSession: null } } };
        return { structuredContent: { ...input, scanComplete: true, scheduleRevision: 1,
          restDays: [], workouts: [], plans: [], activities: [], notes: [] } };
      }),
    };
    vi.mocked(createAssistantMcpSession).mockResolvedValue(session as AssistantMcpSession);
    vi.mocked(selectDailyWorkoutSuggestionSport).mockImplementation(async (_uid, prefs) => {
      calls.push('selectSport'); return { ...prefs.controls, sport: selected.sport };
    });
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
    expect(withWorkoutPowerContext).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  });
  it('prepares once on the same session, then uses the chosen sport throughout context', async () => {
    const result = await collectDailyWorkoutSuggestionContext('owner', preferences, now, false);
    expect(calls.slice(0, 2)).toEqual(['prepare_training_metrics', 'selectSport']);
    expect(calls.filter(name => name === 'prepare_training_metrics')).toHaveLength(1);
    expect(calls).toContain('get_training_metric');
    expect(result.controls).toEqual(selected); expect(result.evidence.trainingMetricsReady).toBe(true);
    expect(readDayWorkoutTrainingContext).toHaveBeenCalledWith('owner', selected, now);
    expect(withWorkoutPowerContext).toHaveBeenCalledWith('owner', selected, now, expect.any(Object));
    expect(createAssistantMcpSession).toHaveBeenCalledExactlyOnceWith('owner', 'https://quantified-self.io', undefined,
      'coordinate_free', preferences.controls.timelineContext, preferences.controls.trainingContext);
    expect(session.close).toHaveBeenCalledOnce();
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
    expect(calls.slice(0, 2)).toEqual(['selectSport', 'prepare_training_metrics']);
    expect(calls.filter(name => name === 'prepare_training_metrics')).toHaveLength(1);
    expect(result.evidence.trainingMetricsReady).toBe(false);
    expect(withWorkoutPowerContext).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce();
  });
  it('closes the session if sport selection fails', async () => {
    vi.mocked(selectDailyWorkoutSuggestionSport).mockRejectedValueOnce(Error('Sport read failed'));
    await expect(collectDailyWorkoutSuggestionContext('owner', preferences, now, false)).rejects.toThrow('Sport read failed');
    expect(readDayWorkoutTrainingContext).not.toHaveBeenCalled(); expect(session.close).toHaveBeenCalledOnce();
  });
  it('still defers if a prepared snapshot fails later, without repeating preparation', async () => {
    snapshotFails = true;
    await expect(collectDailyWorkoutSuggestionContext('owner', preferences, now, false))
      .rejects.toBeInstanceOf(DayWorkoutTrainingNotReadyError);
    expect(calls).toEqual(['prepare_training_metrics', 'selectSport', 'get_training_metric']);
    expect(session.close).toHaveBeenCalledOnce();
  });
});
