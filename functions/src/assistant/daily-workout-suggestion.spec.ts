import { readFileSync } from 'node:fs';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { parseDailyWorkoutSuggestionPreferences } from '../../../shared/daily-workout-suggestion';

describe('daily workout preferences', () => {
  const now = new Date('2026-10-30T07:00:00Z');
  const controls = defaultDayWorkoutControls('2020-01-01', 'Europe/Helsinki');
  it('keeps private cached prescriptions and TTL on existing exempt fields', () => {
    const indexes = JSON.parse(readFileSync(new URL('../../../firestore.indexes.json', import.meta.url), 'utf8'));
    for (const fieldPath of ['messages', 'version', 'expireAt']) {
      expect(indexes.fieldOverrides).toContainEqual({ collectionGroup: 'assistantConversations', fieldPath, indexes: [], ttl: fieldPath === 'expireAt' });
    }
  });
  it('refreshes only the saved date, preserves opt-outs, and defaults all sources on', () => {
    const value = parseDailyWorkoutSuggestionPreferences({ enabled: true, followRoutine: true,
      controls: { ...controls, timelineContext: false } }, now);
    expect(value.controls.localDate).toBe('2026-10-30');
    expect(value.controls.timelineContext).toBe(false);
    expect(value.controls.hrvContext).toBe(true);
  });
  it.each([{ trainingContext: false }, { activityContext: false }, { destinationPlanId: 'plan' }, { injected: true }])(
    'rejects controls that cannot safely prepare an additional session: %j', patch => {
      expect(() => parseDailyWorkoutSuggestionPreferences({ enabled: true, followRoutine: true, controls: { ...controls, ...patch } }, now)).toThrow();
    });
  it.each([
    ['2026-10-30T21:59Z', '2026-10-30'], ['2026-10-30T22:00Z', '2026-10-31'],
    ['2026-10-24T22:30Z', '2026-10-25'], ['2026-10-25T22:30Z', '2026-10-26'],
  ])('uses the saved-zone date at %s, including midnight and DST', (instant, expected) => {
    expect(parseDailyWorkoutSuggestionPreferences({ enabled: true, followRoutine: true, controls }, new Date(instant))
      .controls.localDate).toBe(expected);
  });
});

import { collectDailyWorkoutSuggestionCoverage, dailyWorkoutSuggestionAwaitsSleep, dailyWorkoutSuggestionSkip, runDailyWorkoutSuggestion, type DailyWorkoutSuggestionDependencies } from './daily-workout-suggestion';
import { dailyWorkoutSuggestionRoutineSport } from './daily-workout-suggestion-routine';
import type { DayWorkoutContext } from './day-workout-context';
import { ActivityTypes } from '@sports-alliance/sports-lib';

vi.mock('../utils', async original => ({ ...await original<typeof import('../utils')>(), enforceAppCheck: (context: { app?: unknown }) => {
  if (!context.app) throw Error('App Check required');
}, getUserRoleAndGracePeriod: vi.fn() }));
const dailyNow = new Date('2026-10-30T07:00:00Z');
const dailyControls = defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki');
function evidence(): DayWorkoutContext {
  return { evidence: { daily: { dailyReport: { sleep: { status: 'no_completed_session', latestSession: null } }, activitiesToday: { scanComplete: true, activities: [] },
    plannedWorkouts: { scanComplete: true, completionChecked: true, workouts: [], restDayContext: { status: 'none' } } } },
  usedContext: [], missingContext: [], previousStrength: [], references: [] };
}
function dependencies() {
  const preferences = { enabled: true, followRoutine: true, controls: dailyControls };
  let status: any = { localDate: '2026-10-30', state: 'waiting' };
  const store = { read: vi.fn(async () => ({ preferences, status })), begin: vi.fn(async () => 'lease'),
    assertActive: vi.fn(), charge: vi.fn(), finish: vi.fn(async (_uid, _date, _token, state, controls, result) => { status = { localDate: '2026-10-30', state, ...(controls ? { controls } : {}), ...(result ? { result } : {}) }; }),
    dismiss: vi.fn(async () => ({ localDate: '2026-10-30', state: 'dismissed' as const })) };
  return { store, now: () => dailyNow, legal: vi.fn(), pro: vi.fn(async () => true), selectSport: vi.fn(async () => dailyControls),
    coverage: vi.fn(async () => null as 'planned' | 'completed' | 'rest-day' | null), context: vi.fn(async () => evidence()), generate: vi.fn(async (_request, _evidence, _correction, usage) => {
      usage?.({ available: true, inputTokens: 100, outputTokens: 20, thoughtsTokens: 40 }); return { kind: 'rest', rationale: 'Keep today easy.' };
    }), log: vi.fn() } satisfies DailyWorkoutSuggestionDependencies;
}
describe('daily workout preparation', () => {
  const identity = { auth: { uid: 'owner' }, app: {} };
  it('requires authentication, App Check, Pro and legal access before accessing private state', async () => {
    const deps = dependencies();
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, {}, deps)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, { auth: identity.auth }, deps)).rejects.toThrow('App Check');
    deps.pro.mockResolvedValue(false);
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(deps.store.read).not.toHaveBeenCalled();
  });
  it('rejects controls, dates and other injected parameters on the private mode', async () => {
    const deps = dependencies();
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare', date: 'tomorrow' }, identity, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(deps.store.read).not.toHaveBeenCalled();
  });
  it.each([{ action: ['status'] }, { action: ['prepare'] }, { action: {} }, { action: null }])('rejects non-string actions before data access %j', async value => {
    const deps = dependencies();
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', ...value }, identity, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(deps.legal).not.toHaveBeenCalled(); expect(deps.store.read).not.toHaveBeenCalled();
  });
  it('requires an explicit dismiss date and rejects date injection on read/generate actions', async () => {
    const deps = dependencies();
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'dismiss' }, identity, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'status', localDate: '2026-10-30' }, identity, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'dismiss', localDate: '2026-10-30' }, identity, deps);
    expect(deps.store.dismiss).toHaveBeenCalledWith('owner', '2026-10-30');
  });
  it('prepares one included result and replays without Assistant quota dependencies or another model call', async () => {
    const deps = dependencies(); const input = { mode: 'daily-suggestion', action: 'prepare' };
    const result = await runDailyWorkoutSuggestion(input, identity, deps);
    expect(result.state).toBe('ready'); expect(result.result?.kind).toBe('rest');
    expect(await runDailyWorkoutSuggestion(input, identity, deps)).toEqual(result);
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, meteredAttempts: 1,
      inputTokens: 100, outputTokens: 20, thoughtsTokens: 40 }));
    expect(JSON.stringify(deps.log.mock.calls)).not.toMatch(/owner|2026-|Keep today/);
  });
  it.each(['planned', 'completed', 'rest-day'] as const)('keeps the allowance unused while today is %s and resumes when coverage is removed', async state => {
    const deps = dependencies(), context = evidence();
    const daily = context.evidence.daily as any;
    if (state === 'planned') daily.plannedWorkouts.workouts.push({ lifecycle: 'planned' });
    if (state === 'completed') daily.activitiesToday.activities.push({});
    if (state === 'rest-day') context.plannedRestDay = { localDate: '2026-10-30', planName: 'Plan' };
    deps.context.mockResolvedValue(context);
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).state).toBe(state);
    expect(deps.generate).not.toHaveBeenCalled(); expect(deps.store.charge).not.toHaveBeenCalled();
    // This path persisted an uncharged covered receipt after the full context read.
    deps.context.mockResolvedValue(evidence());
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'status' }, identity, deps)).state).toBe('waiting');
    expect(deps.generate).not.toHaveBeenCalled(); expect(deps.store.charge).not.toHaveBeenCalled();
    const ready = await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    expect(ready.state).toBe('ready');
    expect(await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).toEqual(ready);
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it('fails closed on partial schedule, activities or unknown rest-day evidence', () => {
    for (const key of ['activitiesToday', 'plannedWorkouts']) {
      const context = evidence(); (context.evidence.daily as any)[key].scanComplete = false;
      expect(() => dailyWorkoutSuggestionSkip(context)).toThrow();
    }
    const context = evidence(); (context.evidence.daily as any).plannedWorkouts.restDayContext.status = 'unavailable';
    expect(() => dailyWorkoutSuggestionSkip(context)).toThrow();
  });
  it.each(['2026-10-30T00:30Z', '2026-10-30T10:00Z', '2026-10-30T13:00Z', '2026-10-30T20:30Z'])(
    'prepares once on the first visit at %s without an hour cutoff', async instant => {
      const deps = dependencies(); deps.now = () => new Date(instant);
      const input = { mode: 'daily-suggestion', action: 'prepare' };
      const ready = await runDailyWorkoutSuggestion(input, identity, deps);
      expect(ready.state).toBe('ready');
      expect(await runDailyWorkoutSuggestion(input, identity, deps)).toEqual(ready);
      expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
    });
  it('does not start while preparing or for disabled preferences', async () => {
    const deps = dependencies(), { preferences } = await deps.store.read('owner');
    deps.store.read.mockResolvedValueOnce({ preferences, status: { localDate: '2026-10-30', state: 'preparing' } });
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).state).toBe('preparing');
    deps.store.read.mockResolvedValueOnce({ preferences: null as any, status: { localDate: '', state: 'off' } });
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).state).toBe('off');
    expect(deps.store.begin).not.toHaveBeenCalled();
  });
  it('rechecks cached suggestions after Add, completed activity sync or an authored rest day', async () => {
    const deps = dependencies(), input = { mode: 'daily-suggestion', action: 'prepare' };
    await runDailyWorkoutSuggestion(input, identity, deps);
    for (const state of ['planned', 'completed', 'rest-day'] as const) {
      deps.coverage.mockResolvedValue(state);
      expect(await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'status' }, identity, deps)).toEqual({ localDate: '2026-10-30', state });
    }
    deps.coverage.mockResolvedValue(null);
    expect((await runDailyWorkoutSuggestion(input, identity, deps)).state).toBe('ready');
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it('checks coverage before loading routine or recovery context for an already covered day', async () => {
    const deps = dependencies(); deps.coverage.mockResolvedValue('planned');
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).state).toBe('planned');
    expect(deps.selectSport).not.toHaveBeenCalled(); expect(deps.context).not.toHaveBeenCalled(); expect(deps.store.begin).not.toHaveBeenCalled();
  });
  it('prepares once after deleting a workout that blocked the initial coverage check', async () => {
    const deps = dependencies(), prepare = { mode: 'daily-suggestion', action: 'prepare' };
    deps.coverage.mockResolvedValue('planned');
    expect((await runDailyWorkoutSuggestion(prepare, identity, deps)).state).toBe('planned');
    expect(deps.store.begin).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.store.charge).not.toHaveBeenCalled();
    deps.coverage.mockResolvedValue(null);
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'status' }, identity, deps)).state).toBe('waiting');
    const ready = await runDailyWorkoutSuggestion(prepare, identity, deps);
    expect(ready.state).toBe('ready');
    // Adding and deleting the suggested workout exposes the existing result without another admission.
    deps.coverage.mockResolvedValue('planned');
    expect((await runDailyWorkoutSuggestion(prepare, identity, deps)).state).toBe('planned');
    deps.coverage.mockResolvedValue(null);
    expect(await runDailyWorkoutSuggestion(prepare, identity, deps)).toEqual(ready);
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it('starts the unused daily generation after noon when an initially blocking workout is removed', async () => {
    const deps = dependencies(), prepare = { mode: 'daily-suggestion', action: 'prepare' };
    deps.coverage.mockResolvedValue('planned');
    expect((await runDailyWorkoutSuggestion(prepare, identity, deps)).state).toBe('planned');
    deps.now = () => new Date('2026-10-30T13:00Z'); deps.coverage.mockResolvedValue(null);
    expect((await runDailyWorkoutSuggestion(prepare, identity, deps)).state).toBe('ready');
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it('honors a dismissal or disablement that arrives while cached coverage is being checked', async () => {
    const deps = dependencies(); await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    const ready = await deps.store.read('owner');
    deps.store.read.mockResolvedValueOnce(ready).mockResolvedValueOnce({ ...ready, status: { localDate: '2026-10-30', state: 'dismissed' } });
    deps.coverage.mockResolvedValue('planned');
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'status' }, identity, deps)).state).toBe('dismissed');
    deps.store.read.mockResolvedValueOnce(ready).mockResolvedValueOnce({ preferences: null as any, status: { localDate: '', state: 'off' } });
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'status' }, identity, deps)).state).toBe('off');
  });
  it('records both model attempts when the first prescription fails validation', async () => {
    const deps = dependencies();
    deps.generate.mockImplementationOnce(async (_request, _context, _correction, usage) => {
      usage?.({ available: true, inputTokens: 500, outputTokens: 100, thoughtsTokens: 200 }); return { bad: 'json' } as any;
    });
    await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    expect(deps.store.charge).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ attempts: 2, meteredAttempts: 2,
      inputTokens: 600, outputTokens: 120, thoughtsTokens: 240 }));
  });
  it('never regenerates a failed charged attempt or logs provider error contents', async () => {
    const deps = dependencies(); deps.generate.mockRejectedValue(new Error('PRIVATE provider text'));
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).rejects.toMatchObject({ code: 'unavailable' });
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).state).toBe('failed');
    expect(deps.generate).toHaveBeenCalledOnce(); expect(JSON.stringify(deps.log.mock.calls)).not.toContain('PRIVATE');
  });
  it('waits without spending allowance, then uses the synced night once without requiring an HRV baseline', async () => {
    const deps = dependencies(), context = evidence(), input = { mode: 'daily-suggestion', action: 'prepare' };
    const daily = context.evidence.daily as Record<string, unknown>;
    daily.dailyReport = { sleep: { status: 'available', latestSession: { endTimeMs: Date.parse('2026-10-29T05:00Z') } } };
    deps.context.mockResolvedValue(context);
    expect(await runDailyWorkoutSuggestion(input, identity, deps)).toEqual({ localDate: '2026-10-30', state: 'waiting-sleep' });
    expect(deps.store.charge).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled();
    daily.dailyReport = { sleep: { status: 'available', latestSession: { endTimeMs: Date.parse('2026-10-30T05:00Z') } },
      readiness: { drivers: { sleep: { status: 'available', latestSleepAtMs: Date.parse('2026-10-30T05:00Z') }, hrv: { personalRange: { reason: 'building_baseline' } } } } };
    deps.now = () => new Date('2026-10-30T13:00Z');
    expect((await runDailyWorkoutSuggestion(input, identity, deps)).state).toBe('ready');
    expect((await runDailyWorkoutSuggestion(input, identity, deps)).state).toBe('ready');
    expect(deps.store.charge).toHaveBeenCalledOnce(); expect(deps.generate).toHaveBeenCalledOnce();
  });
  it('requires a dated, previously deferred suggestion for the included explicit fallback and allows it after noon', async () => {
    const deps = dependencies(), context = evidence(); context.evidence.daily = { ...(context.evidence.daily as object), dailyReport: {} };
    deps.context.mockResolvedValue(context);
    const fallback = { mode: 'daily-suggestion', action: 'use-available-data', localDate: '2026-10-30' };
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'use-available-data' }, identity, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await runDailyWorkoutSuggestion(fallback, identity, deps)).state).toBe('waiting');
    expect(deps.store.begin).not.toHaveBeenCalled();
    await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    deps.now = () => new Date('2026-10-30T13:00Z');
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).state).toBe('waiting-sleep');
    await expect(runDailyWorkoutSuggestion({ ...fallback, localDate: '2026-10-29' }, identity, deps)).rejects.toMatchObject({ code: 'aborted' });
    const result = await runDailyWorkoutSuggestion(fallback, identity, deps);
    expect(result.state).toBe('ready'); expect(result.result?.missingContext.join(' ')).toContain('explicitly chose');
    await runDailyWorkoutSuggestion(fallback, identity, deps);
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it('accepts sleep completed during the context read and records its actual observation time', async () => {
    const deps = dependencies(), context = evidence(); let now = dailyNow;
    const endedAt = dailyNow.getTime() + 30_000;
    (context.evidence.daily as Record<string, unknown>).dailyReport = {
      sleep: { status: 'available', latestSession: { endTimeMs: endedAt } },
      readiness: { drivers: { sleep: { status: 'available', latestSleepAtMs: endedAt } } },
    };
    deps.now = () => now;
    deps.context.mockImplementation(async () => { now = new Date(dailyNow.getTime() + 60_000); return context; });
    const result = await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    expect(result.state).toBe('ready'); expect(result.result?.observedAt).toBe(now.toISOString());
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it.each(['planned', 'completed', 'rest-day'] as const)('keeps %s coverage ahead of a deferred fallback, then resumes the unused suggestion', async state => {
    const deps = dependencies(), context = evidence(); context.evidence.daily = { ...(context.evidence.daily as object), dailyReport: {} };
    deps.context.mockResolvedValue(context);
    await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    deps.now = () => new Date('2026-10-30T13:00Z'); deps.coverage.mockResolvedValue(state);
    const fallback = { mode: 'daily-suggestion', action: 'use-available-data', localDate: '2026-10-30' };
    expect((await runDailyWorkoutSuggestion(fallback, identity, deps)).state).toBe(state);
    expect(deps.generate).not.toHaveBeenCalled(); expect(deps.store.charge).not.toHaveBeenCalled();
    deps.coverage.mockResolvedValue(null);
    expect((await runDailyWorkoutSuggestion(fallback, identity, deps)).state).toBe('ready');
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
});
describe('current-night sleep admission', () => {
  function context(end?: string, processed = true): DayWorkoutContext {
    const value = evidence(); (value.evidence.daily as Record<string, unknown>).dailyReport = end ? {
      sleep: { status: 'available', latestSession: { endTimeMs: Date.parse(end) } },
      readiness: { drivers: { sleep: { status: 'available', latestSleepAtMs: processed ? Date.parse(end) : null } } },
    } : { sleep: { status: 'no_completed_session', latestSession: null } }; return value;
  }
  it('does not block no-history, inactive tracking or opted-out sleep, but does not mistake a failed read for no history', () => {
    expect(dailyWorkoutSuggestionAwaitsSleep(dailyControls, context(), dailyNow)).toBe(false);
    expect(dailyWorkoutSuggestionAwaitsSleep(dailyControls, context('2026-10-01T05:00Z'), dailyNow)).toBe(false);
    const missing = evidence(); missing.evidence.daily = {};
    expect(dailyWorkoutSuggestionAwaitsSleep(dailyControls, missing, dailyNow)).toBe(true);
    expect(dailyWorkoutSuggestionAwaitsSleep({ ...dailyControls, sleepContext: false }, missing, dailyNow)).toBe(false);
  });
  it('waits for a completed current local night and its matching recovery projection, including the seven-day boundary', () => {
    expect(dailyWorkoutSuggestionAwaitsSleep(dailyControls, context('2026-10-23T05:00Z'), dailyNow)).toBe(true);
    expect(dailyWorkoutSuggestionAwaitsSleep(dailyControls, context('2026-10-30T08:00Z'), dailyNow)).toBe(true);
    expect(dailyWorkoutSuggestionAwaitsSleep(dailyControls, context('2026-10-30T05:00Z', false), dailyNow)).toBe(true);
    expect(dailyWorkoutSuggestionAwaitsSleep(dailyControls, context('2026-10-29T22:30Z'), dailyNow)).toBe(false);
    expect(dailyWorkoutSuggestionAwaitsSleep(dailyControls, context('2026-10-29T05:00Z'), dailyNow)).toBe(true);
  });
});
describe('daily sport preference from recorded weekday history', () => {
  const preferences = { enabled: true, followRoutine: true, controls: dailyControls };
  const activities = (sport: ActivityTypes, dates: string[]) => dates.map((date, i) => ({ activityRef: `${sport}-${i}`,
    activityType: sport, startTimeMs: Date.parse(`${date}T10:00Z`), stats: { durationSeconds: 1800 } }));
  it('chooses repeated strength Fridays, excludes today and falls back for sparse or tied evidence', () => {
    const strength = activities(ActivityTypes.StrengthTraining, ['2026-10-09', '2026-10-16', '2026-10-30']);
    expect(dailyWorkoutSuggestionRoutineSport(preferences, dailyNow, strength)).toBe(ActivityTypes.StrengthTraining);
    expect(dailyWorkoutSuggestionRoutineSport({ ...preferences, controls: { ...dailyControls, timing: 'strict' } }, dailyNow, strength)).toBe(ActivityTypes.Running);
    expect(dailyWorkoutSuggestionRoutineSport(preferences, dailyNow, strength.slice(0, 1))).toBe(ActivityTypes.Running);
    expect(dailyWorkoutSuggestionRoutineSport(preferences, dailyNow, [...strength,
      ...activities(ActivityTypes.Cycling, ['2026-10-09', '2026-10-16'])])).toBe(ActivityTypes.Running);
  });
});

describe('bounded current-day coverage for cached suggestions', () => {
  it('uses only current-day activity summaries and existing schedule/rest reads', async () => {
    const callTool = vi.fn(async (name: string) => ({ structuredContent: name === 'query_activities'
      ? { activities: [], scanComplete: true } : name === 'query_planned_workouts_by_date'
      ? { workouts: [], scanComplete: true, scheduleRevision: 1 }
      : { plans: [], scanComplete: true, scheduleRevision: 1 } }));
    expect(await collectDailyWorkoutSuggestionCoverage(dailyControls, { callTool })).toBeNull();
    expect(callTool.mock.calls.map(call => call[0])).toEqual(['query_activities', 'query_planned_workouts_by_date', 'list_training_plans']);
    expect(callTool).toHaveBeenCalledWith('query_activities', { relativePeriod: 'today', timeZone: 'Europe/Helsinki', limit: 1 });
  });
  it('uses positive existence without scanning more activities, and rejects partial empty reads', async () => {
    const callTool = vi.fn().mockResolvedValueOnce({ structuredContent: { activities: [{}], scanComplete: false } });
    expect(await collectDailyWorkoutSuggestionCoverage(dailyControls, { callTool })).toBe('completed'); expect(callTool).toHaveBeenCalledOnce();
    callTool.mockResolvedValueOnce({ structuredContent: { activities: [], scanComplete: false } });
    await expect(collectDailyWorkoutSuggestionCoverage(dailyControls, { callTool })).rejects.toThrow('incomplete');
  });
});
