import { readFileSync } from 'node:fs';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { isMorningWorkoutWindow, parseMorningWorkoutPreferences } from '../../../shared/morning-workout';

describe('morning workout preferences', () => {
  const now = new Date('2026-10-30T07:00:00Z');
  const controls = defaultDayWorkoutControls('2020-01-01', 'Europe/Helsinki');
  it('keeps private cached prescriptions and TTL on existing exempt fields', () => {
    const indexes = JSON.parse(readFileSync(new URL('../../../firestore.indexes.json', import.meta.url), 'utf8'));
    for (const fieldPath of ['messages', 'version', 'expireAt']) {
      expect(indexes.fieldOverrides).toContainEqual({ collectionGroup: 'assistantConversations', fieldPath, indexes: [], ttl: fieldPath === 'expireAt' });
    }
  });
  it('refreshes only the saved date, preserves opt-outs, and defaults all sources on', () => {
    const value = parseMorningWorkoutPreferences({ enabled: true, followRoutine: true,
      controls: { ...controls, timelineContext: false } }, now);
    expect(value.controls.localDate).toBe('2026-10-30');
    expect(value.controls.timelineContext).toBe(false);
    expect(value.controls.hrvContext).toBe(true);
  });
  it.each([{ trainingContext: false }, { activityContext: false }, { destinationPlanId: 'plan' }, { injected: true }])(
    'rejects controls that cannot safely prepare an additional session: %j', patch => {
      expect(() => parseMorningWorkoutPreferences({ enabled: true, followRoutine: true, controls: { ...controls, ...patch } }, now)).toThrow();
    });
  it('uses local 05:00–12:00 including DST, with an exclusive noon boundary', () => {
    expect(isMorningWorkoutWindow(new Date('2026-10-30T03:00:00Z'), 'Europe/Helsinki')).toBe(true);
    expect(isMorningWorkoutWindow(new Date('2026-10-30T10:00:00Z'), 'Europe/Helsinki')).toBe(false);
    expect(isMorningWorkoutWindow(new Date('2026-06-30T02:00:00Z'), 'Europe/Helsinki')).toBe(true);
  });
});

import { collectMorningWorkoutCoverage, morningWorkoutSkip, runMorningWorkout, type MorningWorkoutDependencies } from './morning-workout';
import { morningRoutineSport } from './morning-workout-routine';
import type { DayWorkoutContext } from './day-workout-context';
import { ActivityTypes } from '@sports-alliance/sports-lib';

vi.mock('../utils', async original => ({ ...await original<typeof import('../utils')>(), enforceAppCheck: (context: { app?: unknown }) => {
  if (!context.app) throw Error('App Check required');
}, getUserRoleAndGracePeriod: vi.fn() }));
const morningNow = new Date('2026-10-30T07:00:00Z');
const morningControls = defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki');
function evidence(): DayWorkoutContext {
  return { evidence: { daily: { activitiesToday: { scanComplete: true, activities: [] },
    plannedWorkouts: { scanComplete: true, completionChecked: true, workouts: [], restDayContext: { status: 'none' } } } },
  usedContext: [], missingContext: [], previousStrength: [], references: [] };
}
function dependencies() {
  const preferences = { enabled: true, followRoutine: true, controls: morningControls };
  let status: any = { localDate: '2026-10-30', state: 'waiting' };
  const store = { read: vi.fn(async () => ({ preferences, status })), begin: vi.fn(async () => 'lease'),
    assertActive: vi.fn(), charge: vi.fn(), finish: vi.fn(async (_uid, _date, _token, state, controls, result) => { status = { localDate: '2026-10-30', state, ...(controls ? { controls } : {}), ...(result ? { result } : {}) }; }),
    dismiss: vi.fn(async () => ({ localDate: '2026-10-30', state: 'dismissed' as const })) };
  return { store, now: () => morningNow, legal: vi.fn(), pro: vi.fn(async () => true), selectSport: vi.fn(async () => morningControls),
    coverage: vi.fn(async () => null as 'planned' | 'completed' | 'rest-day' | null), context: vi.fn(async () => evidence()), generate: vi.fn(async (_request, _evidence, _correction, usage) => {
      usage?.({ available: true, inputTokens: 100, outputTokens: 20, thoughtsTokens: 40 }); return { kind: 'rest', rationale: 'Keep today easy.' };
    }), log: vi.fn() } satisfies MorningWorkoutDependencies;
}
describe('morning workout preparation', () => {
  const identity = { auth: { uid: 'owner' }, app: {} };
  it('requires authentication, App Check, Pro and legal access before accessing private state', async () => {
    const deps = dependencies();
    await expect(runMorningWorkout({ mode: 'morning', action: 'prepare' }, {}, deps)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(runMorningWorkout({ mode: 'morning', action: 'prepare' }, { auth: identity.auth }, deps)).rejects.toThrow('App Check');
    deps.pro.mockResolvedValue(false);
    await expect(runMorningWorkout({ mode: 'morning', action: 'prepare' }, identity, deps)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(deps.store.read).not.toHaveBeenCalled();
  });
  it('rejects controls, dates and other injected parameters on the private mode', async () => {
    const deps = dependencies();
    await expect(runMorningWorkout({ mode: 'morning', action: 'prepare', date: 'tomorrow' }, identity, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(deps.store.read).not.toHaveBeenCalled();
  });
  it.each([{ action: ['status'] }, { action: ['prepare'] }, { action: {} }, { action: null }])('rejects non-string actions before data access %j', async value => {
    const deps = dependencies();
    await expect(runMorningWorkout({ mode: 'morning', ...value }, identity, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(deps.legal).not.toHaveBeenCalled(); expect(deps.store.read).not.toHaveBeenCalled();
  });
  it('requires an explicit dismiss date and rejects date injection on read/generate actions', async () => {
    const deps = dependencies();
    await expect(runMorningWorkout({ mode: 'morning', action: 'dismiss' }, identity, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(runMorningWorkout({ mode: 'morning', action: 'status', localDate: '2026-10-30' }, identity, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    await runMorningWorkout({ mode: 'morning', action: 'dismiss', localDate: '2026-10-30' }, identity, deps);
    expect(deps.store.dismiss).toHaveBeenCalledWith('owner', '2026-10-30');
  });
  it('prepares one included result and replays without Assistant quota dependencies or another model call', async () => {
    const deps = dependencies(); const input = { mode: 'morning', action: 'prepare' };
    const result = await runMorningWorkout(input, identity, deps);
    expect(result.state).toBe('ready'); expect(result.result?.kind).toBe('rest');
    expect(await runMorningWorkout(input, identity, deps)).toEqual(result);
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, meteredAttempts: 1,
      inputTokens: 100, outputTokens: 20, thoughtsTokens: 40 }));
    expect(JSON.stringify(deps.log.mock.calls)).not.toMatch(/owner|2026-|Keep today/);
  });
  it.each(['planned', 'completed', 'rest-day'] as const)('skips the model and allowance when today is %s', async state => {
    const deps = dependencies(), context = evidence();
    const daily = context.evidence.daily as any;
    if (state === 'planned') daily.plannedWorkouts.workouts.push({ lifecycle: 'planned' });
    if (state === 'completed') daily.activitiesToday.activities.push({});
    if (state === 'rest-day') context.plannedRestDay = { localDate: '2026-10-30', planName: 'Plan' };
    deps.context.mockResolvedValue(context);
    expect((await runMorningWorkout({ mode: 'morning', action: 'prepare' }, identity, deps)).state).toBe(state);
    expect(deps.generate).not.toHaveBeenCalled(); expect(deps.store.charge).not.toHaveBeenCalled();
  });
  it('fails closed on partial schedule, activities or unknown rest-day evidence', () => {
    for (const key of ['activitiesToday', 'plannedWorkouts']) {
      const context = evidence(); (context.evidence.daily as any)[key].scanComplete = false;
      expect(() => morningWorkoutSkip(context)).toThrow();
    }
    const context = evidence(); (context.evidence.daily as any).plannedWorkouts.restDayContext.status = 'unavailable';
    expect(() => morningWorkoutSkip(context)).toThrow();
  });
  it('does not start after noon, while preparing, or for disabled preferences', async () => {
    const deps = dependencies(); deps.now = () => new Date('2026-10-30T10:00:00Z');
    await runMorningWorkout({ mode: 'morning', action: 'prepare' }, identity, deps);
    expect(deps.store.begin).not.toHaveBeenCalled();
    deps.store.read.mockResolvedValueOnce({ preferences: null as any, status: { localDate: '', state: 'off' } });
    expect((await runMorningWorkout({ mode: 'morning', action: 'prepare' }, identity, deps)).state).toBe('off');
  });
  it('rechecks cached suggestions after Add, completed activity sync or an authored rest day', async () => {
    const deps = dependencies(), input = { mode: 'morning', action: 'prepare' };
    await runMorningWorkout(input, identity, deps);
    for (const state of ['planned', 'completed', 'rest-day'] as const) {
      deps.coverage.mockResolvedValue(state);
      expect(await runMorningWorkout({ mode: 'morning', action: 'status' }, identity, deps)).toEqual({ localDate: '2026-10-30', state });
    }
    deps.coverage.mockResolvedValue(null);
    expect((await runMorningWorkout(input, identity, deps)).state).toBe('ready');
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it('checks coverage before loading routine or recovery context for an already covered day', async () => {
    const deps = dependencies(); deps.coverage.mockResolvedValue('planned');
    expect((await runMorningWorkout({ mode: 'morning', action: 'prepare' }, identity, deps)).state).toBe('planned');
    expect(deps.selectSport).not.toHaveBeenCalled(); expect(deps.context).not.toHaveBeenCalled(); expect(deps.store.begin).not.toHaveBeenCalled();
  });
  it('honors a dismissal or disablement that arrives while cached coverage is being checked', async () => {
    const deps = dependencies(); await runMorningWorkout({ mode: 'morning', action: 'prepare' }, identity, deps);
    const ready = await deps.store.read('owner');
    deps.store.read.mockResolvedValueOnce(ready).mockResolvedValueOnce({ ...ready, status: { localDate: '2026-10-30', state: 'dismissed' } });
    deps.coverage.mockResolvedValue('planned');
    expect((await runMorningWorkout({ mode: 'morning', action: 'status' }, identity, deps)).state).toBe('dismissed');
    deps.store.read.mockResolvedValueOnce(ready).mockResolvedValueOnce({ preferences: null as any, status: { localDate: '', state: 'off' } });
    expect((await runMorningWorkout({ mode: 'morning', action: 'status' }, identity, deps)).state).toBe('off');
  });
  it('records both model attempts when the first prescription fails validation', async () => {
    const deps = dependencies();
    deps.generate.mockImplementationOnce(async (_request, _context, _correction, usage) => {
      usage?.({ available: true, inputTokens: 500, outputTokens: 100, thoughtsTokens: 200 }); return { bad: 'json' } as any;
    });
    await runMorningWorkout({ mode: 'morning', action: 'prepare' }, identity, deps);
    expect(deps.store.charge).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ attempts: 2, meteredAttempts: 2,
      inputTokens: 600, outputTokens: 120, thoughtsTokens: 240 }));
  });
  it('never regenerates a failed charged attempt or logs provider error contents', async () => {
    const deps = dependencies(); deps.generate.mockRejectedValue(new Error('PRIVATE provider text'));
    await expect(runMorningWorkout({ mode: 'morning', action: 'prepare' }, identity, deps)).rejects.toMatchObject({ code: 'unavailable' });
    expect((await runMorningWorkout({ mode: 'morning', action: 'prepare' }, identity, deps)).state).toBe('failed');
    expect(deps.generate).toHaveBeenCalledOnce(); expect(JSON.stringify(deps.log.mock.calls)).not.toContain('PRIVATE');
  });
});
describe('morning sport preference from recorded weekday history', () => {
  const preferences = { enabled: true, followRoutine: true, controls: morningControls };
  const activities = (sport: ActivityTypes, dates: string[]) => dates.map((date, i) => ({ activityRef: `${sport}-${i}`,
    activityType: sport, startTimeMs: Date.parse(`${date}T10:00Z`), stats: { durationSeconds: 1800 } }));
  it('chooses repeated strength Fridays, excludes today and falls back for sparse or tied evidence', () => {
    const strength = activities(ActivityTypes.StrengthTraining, ['2026-10-09', '2026-10-16', '2026-10-30']);
    expect(morningRoutineSport(preferences, morningNow, strength)).toBe(ActivityTypes.StrengthTraining);
    expect(morningRoutineSport({ ...preferences, controls: { ...morningControls, timing: 'strict' } }, morningNow, strength)).toBe(ActivityTypes.Running);
    expect(morningRoutineSport(preferences, morningNow, strength.slice(0, 1))).toBe(ActivityTypes.Running);
    expect(morningRoutineSport(preferences, morningNow, [...strength,
      ...activities(ActivityTypes.Cycling, ['2026-10-09', '2026-10-16'])])).toBe(ActivityTypes.Running);
  });
});

describe('bounded current-day coverage for cached suggestions', () => {
  it('uses only current-day activity summaries and existing schedule/rest reads', async () => {
    const callTool = vi.fn(async (name: string) => ({ structuredContent: name === 'query_activities'
      ? { activities: [], scanComplete: true } : name === 'query_planned_workouts_by_date'
      ? { workouts: [], scanComplete: true, scheduleRevision: 1 }
      : { plans: [], scanComplete: true, scheduleRevision: 1 } }));
    expect(await collectMorningWorkoutCoverage(morningControls, { callTool })).toBeNull();
    expect(callTool.mock.calls.map(call => call[0])).toEqual(['query_activities', 'query_planned_workouts_by_date', 'list_training_plans']);
    expect(callTool).toHaveBeenCalledWith('query_activities', { relativePeriod: 'today', timeZone: 'Europe/Helsinki', limit: 1 });
  });
  it('uses positive existence without scanning more activities, and rejects partial empty reads', async () => {
    const callTool = vi.fn().mockResolvedValueOnce({ structuredContent: { activities: [{}], scanComplete: false } });
    expect(await collectMorningWorkoutCoverage(morningControls, { callTool })).toBe('completed'); expect(callTool).toHaveBeenCalledOnce();
    callTool.mockResolvedValueOnce({ structuredContent: { activities: [], scanComplete: false } });
    await expect(collectMorningWorkoutCoverage(morningControls, { callTool })).rejects.toThrow('incomplete');
  });
});
