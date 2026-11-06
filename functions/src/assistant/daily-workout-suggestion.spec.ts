import { readDailyWorkoutHistoryImportActive } from './daily-workout-suggestion-store';
import { CONNECTION_HISTORY_CAPABILITIES as importServices, hasActiveDataHistoryImport } from '../../../shared/connection-history';
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
  const store = { replace: vi.fn(async (_uid, _preferences, _expected, controls, result) => { status = { localDate: controls.localDate, state: 'ready', controls, result }; return status; }), read: vi.fn(async () => ({ preferences, status })), begin: vi.fn(async () => 'lease'),
    assertActive: vi.fn(), charge: vi.fn(async () => true), finish: vi.fn(async (_uid, _date, _token, state, controls, result) => { status = { localDate: '2026-10-30', state, ...(controls ? { controls } : {}), ...(result ? { result } : {}) }; }),
    dismiss: vi.fn(async () => ({ localDate: '2026-10-30', state: 'dismissed' as const })) };
  return { store, regenerate: vi.fn(async request => ({ requestId: request.requestId, observedAt: dailyNow.toISOString(), kind: 'rest' as const, rationale: 'Recovery.', draft: null, usedContext: [], missingContext: [], previousLoads: [] })), now: () => dailyNow, legal: vi.fn(), pro: vi.fn(async () => true), selectSport: vi.fn(async () => dailyControls),
    importActive: vi.fn(async () => false), coverage: vi.fn(async () => null as 'planned' | 'completed' | 'rest-day' | null), context: vi.fn(async () => evidence()), generate: vi.fn(async (_request, _evidence, _correction, usage) => {
      usage?.({ available: true, inputTokens: 100, outputTokens: 20, thoughtsTokens: 40 }); return { kind: 'rest', rationale: 'Keep today easy.' };
    }), log: vi.fn() } satisfies DailyWorkoutSuggestionDependencies;
}
describe('daily workout preparation', () => {
  const identity = { auth: { uid: 'owner' }, app: {} };
  it.each(['override', 'shared'] as const)('resolves %s power after routine sport selection and retains it after settings change', async origin => {
    const deps = dependencies(), controls = { ...dailyControls, sport: ActivityTypes.Cycling };
    const powerReference = origin === 'shared' ? { kind: 'training-ftp' as const, sport: ActivityTypes.Cycling, family: 'cycling' as const,
      revision: 3, effectiveAtMs: Date.parse('2026-10-25T12:00Z'), reference: { kind: 'functional-threshold-power' as const, watts: 280 } }
      : { sport: ActivityTypes.Cycling, provider: 'garmin' as const, source: 'Bike power meter',
        reference: { kind: 'functional-threshold-power' as const, watts: 240 }, referenceDate: '2026-10-25', zoneUpperBoundsWatts: [150, 200] };
    deps.selectSport.mockResolvedValue(controls);
    deps.context.mockImplementation(async (_uid, request) => {
      expect(request.controls.sport).toBe(ActivityTypes.Cycling);
      return { ...evidence(), powerReference, references: [{ kind: 'power', mode: 'relative' as const,
        minimumPercent: 100, maximumPercent: 100, reference: powerReference.reference }] };
    });
    deps.generate.mockResolvedValue({ kind: 'workout', title: 'Easy ride', rationale: 'Keep it easy.', structure: { version: 1,
      sport: ActivityTypes.Cycling, nodes: [{ kind: 'step', id: 'ride', purpose: 'work', ending: { kind: 'time', seconds: 600 },
        targets: [{ kind: 'power', mode: 'relative', minimumPercent: 60, maximumPercent: 80, reference: powerReference.reference }] }] } } as never);
    const input = { mode: 'daily-suggestion', action: 'prepare' };
    const result = await runDailyWorkoutSuggestion(input, identity, deps);
    expect(result.result).toMatchObject({ kind: 'workout', powerReference });
    deps.context.mockResolvedValue(evidence());
    expect(await runDailyWorkoutSuggestion(input, identity, deps)).toEqual(result);
    expect(deps.context).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });

  it('does not attribute an unused power source to a prepared effort-only workout', async () => {
    const deps = dependencies();
    const powerReference = { sport: dailyControls.sport, provider: 'suunto' as const, source: 'Watch power',
      reference: { kind: 'critical-power' as const, watts: 250 }, referenceDate: '2026-10-25', zoneUpperBoundsWatts: [] };
    deps.context.mockResolvedValue({ ...evidence(), powerReference });
    deps.generate.mockResolvedValue({ kind: 'workout', title: 'Easy effort', rationale: 'Keep it easy.', structure: { version: 1,
      sport: dailyControls.sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } } as never);
    const result = await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    expect(result.result?.kind).toBe('workout'); expect(result.result).not.toHaveProperty('powerReference');
  });

  it('regenerates explicitly through the quota-funded generator and replaces only a current ready suggestion', async () => {
    const deps = dependencies();
    const previous = { requestId: 'daily-suggestion:2026-10-30', kind: 'rest', draft: null };
    deps.store.read.mockResolvedValue({ preferences: { enabled: true, followRoutine: true, controls: dailyControls },
      status: { localDate: dailyControls.localDate, state: 'ready', controls: dailyControls, result: previous } });
    const request = { requestId: 'manual-regeneration', controls: dailyControls };
    await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'regenerate', expectedRequestId: previous.requestId, request }, identity, deps);
    expect(deps.regenerate).toHaveBeenCalledWith(expect.objectContaining(request), identity, expect.objectContaining({ context: expect.any(Function) }));
    expect(deps.store.replace).toHaveBeenCalledWith('owner', expect.anything(), previous.requestId, expect.objectContaining(dailyControls),
      expect.objectContaining({ requestId: request.requestId }));
    expect(deps.store.begin).not.toHaveBeenCalled(); expect(deps.store.charge).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled();
    deps.coverage.mockResolvedValue('planned'); deps.regenerate.mockClear();
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'regenerate', expectedRequestId: previous.requestId, request }, identity, deps))
      .rejects.toMatchObject({ code: 'aborted' });
    expect(deps.regenerate).not.toHaveBeenCalled();
  });
  it('preserves the previous suggestion when explicit regeneration fails', async () => {
    const deps = dependencies();
    deps.store.read.mockResolvedValue({ preferences: { enabled: true, followRoutine: true, controls: dailyControls },
      status: { localDate: dailyControls.localDate, state: 'ready', result: { requestId: 'daily-suggestion:2026-10-30', kind: 'rest' } } });
    deps.regenerate.mockRejectedValue(Error('Unavailable'));
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'regenerate', expectedRequestId: 'daily-suggestion:2026-10-30',
      request: { requestId: 'manual-regeneration', controls: dailyControls } }, identity, deps)).rejects.toThrow('Unavailable');
    expect(deps.store.replace).not.toHaveBeenCalled(); expect(deps.store.finish).not.toHaveBeenCalled();
  });
  it('prepares event guidance once, without a workout or provider context, and replays it after goal edits', async () => {
    const deps = dependencies();
    deps.context.mockResolvedValue({ ...evidence(), goalsRevision: 4, eventGoals: [{ name: 'Marathon', localDate: dailyControls.localDate }] });
    deps.generate.mockResolvedValue({ kind: 'event-advice', rationale: 'Follow your practiced event routine.' } as never);
    const input = { mode: 'daily-suggestion', action: 'prepare', resultVersion: 2 };
    const result = await runDailyWorkoutSuggestion(input, identity, deps);
    expect(result).toMatchObject({ state: 'ready', result: { version: 1, kind: 'event-advice', draft: null, previousLoads: [] } });
    expect(deps.generate.mock.calls[0][1]).toMatchObject({ adviceOnly: true });
    expect(deps.generate.mock.calls[0][1].evidence).not.toHaveProperty('deliveryProviders');
    expect(deps.store.charge).toHaveBeenCalledWith('owner', dailyControls.localDate, 'lease', false, 4);
    deps.context.mockResolvedValue({ ...evidence(), goalsRevision: 5, eventGoals: [] });
    expect(await runDailyWorkoutSuggestion(input, identity, deps)).toEqual(result);
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
    expect(await runDailyWorkoutSuggestion({ ...input, resultVersion: undefined, action: 'status' }, identity, deps)).toEqual({ localDate: dailyControls.localDate, state: 'failed' });
  });
  it('does not spend an old client’s daily receipt on unsupported event guidance', async () => {
    const deps = dependencies();
    deps.context.mockResolvedValue({ ...evidence(), goalsRevision: 1, eventGoals: [{ name: 'Race', localDate: dailyControls.localDate }] });
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).state).toBe('failed');
    expect(deps.store.charge).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled();
  });
  it.each(['planned', 'completed', 'rest-day'] as const)('preserves %s coverage ahead of event guidance', async coverage => {
    const deps = dependencies(); deps.coverage.mockResolvedValue(coverage);
    deps.context.mockResolvedValue({ ...evidence(), goalsRevision: 1, eventGoals: [{ name: 'Race', localDate: dailyControls.localDate }] });
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare', resultVersion: 2 }, identity, deps)).state).toBe(coverage);
    expect(deps.generate).not.toHaveBeenCalled(); expect(deps.store.charge).not.toHaveBeenCalled();
  });
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
  it('defers active imports without collecting context or charging, then prepares once when finished', async () => {
    const deps = dependencies(); deps.importActive.mockResolvedValue(true);
    const input = { mode: 'daily-suggestion', action: 'prepare' };
    expect((await runDailyWorkoutSuggestion(input, identity, deps)).state).toBe('waiting-import');
    expect(deps.context).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled(); expect(deps.store.charge).not.toHaveBeenCalled();
    deps.importActive.mockResolvedValue(false);
    expect((await runDailyWorkoutSuggestion(input, identity, deps)).state).toBe('ready');
    await runDailyWorkoutSuggestion(input, identity, deps);
    expect(deps.store.charge).toHaveBeenCalledOnce(); expect(deps.generate).toHaveBeenCalledOnce();
  });
  it('defers an import that starts while context is collected, before spending the allowance', async () => {
    const deps = dependencies(); deps.store.charge.mockResolvedValueOnce(false);
    expect((await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).state).toBe('waiting-import');
    expect(deps.context).toHaveBeenCalledOnce(); expect(deps.generate).not.toHaveBeenCalled(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it('reuses the explicit available-data action for import deferral without changing preferences', async () => {
    const deps = dependencies(); deps.importActive.mockResolvedValue(true);
    await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    const result = await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'use-available-data', localDate: dailyControls.localDate }, identity, deps);
    expect(result.state).toBe('ready'); expect(result.result?.missingContext.join(' ')).toContain('History may still be importing');
    expect(deps.store.charge).toHaveBeenCalledOnce(); expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.importActive).toHaveBeenCalledTimes(2);
  });
  it.each(['active', 'unavailable'])('discloses %s import status when available data is requested from sleep deferral', async state => {
    const deps = dependencies(), read = deps.store.read.getMockImplementation()!;
    deps.store.read.mockImplementation(async () => ({ ...await read(), status: { localDate: dailyControls.localDate, state: 'waiting-sleep' } }));
    if (state === 'active') deps.importActive.mockResolvedValue(true);
    else deps.importActive.mockRejectedValueOnce(Error('Import status unavailable'));
    await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'use-available-data', localDate: dailyControls.localDate }, identity, deps);
    expect(deps.generate.mock.calls[0][1].missingContext.join(' ')).toContain('History may still be importing');
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
    expect(deps.store.finish).toHaveBeenCalledWith('owner', dailyControls.localDate, 'lease', 'ready', expect.anything(), expect.anything());
  });
  it('keeps metadata failures retryable without spending the daily allowance', async () => {
    const deps = dependencies(); deps.importActive.mockRejectedValueOnce(Error('Import read unavailable'));
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).rejects.toMatchObject({ code: 'unavailable' });
    expect(deps.store.charge).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled();
  });
  it.each([null, 'disconnect_pending', 'reconnect_required'])('ignores retained import checkpoints for unavailable connection %s', async connectionState => {
    const snapshot = { get: vi.fn(field => field === 'connectionState' ? connectionState : {
      active: true, steps: [{ status: 'requesting', resources: ['activities'] }],
    }) };
    const db = { doc: vi.fn(path => ({ path })), getAll: vi.fn(async () => [snapshot]) };
    expect(await readDailyWorkoutHistoryImportActive('owner', db as unknown as FirebaseFirestore.Firestore)).toBe(false);
  });
  it('reads only the existing owner import projections and recognizes active data steps', async () => {
    const get = vi.fn(field => field === 'connectionHistoryImport' ? { active: true, steps: [{ status: 'requesting', resources: ['activities'] }] } : 'connected');
    const db = { doc: vi.fn(path => ({ path })), getAll: vi.fn(async () => [{ get }]) };
    expect(await readDailyWorkoutHistoryImportActive('owner', db as unknown as FirebaseFirestore.Firestore)).toBe(true);
    expect(db.doc.mock.calls.map(([path]) => path)).toEqual(Object.keys(importServices).map(service => `users/owner/meta/${service}`));
    expect(db.getAll).toHaveBeenCalledWith(...db.doc.mock.results.map(item => item.value), { fieldMask: ['connectionHistoryImport', 'connectionState'] });
    expect(get).toHaveBeenCalledWith('connectionHistoryImport');
  });
  it('uses selected provider formats for new suggestions without regenerating a cached day after provider changes', async () => {
    const deps = dependencies(), originalRead = deps.store.read.getMockImplementation()!;
    let deliveryPreferences = { enabled: true, providers: ['wahoo' as 'wahoo' | 'garmin'] };
    deps.store.read.mockImplementation(async () => ({ ...await originalRead(), deliveryPreferences }));
    const generated = (ending: { kind: 'time'; seconds: number } | { kind: 'distance'; meters: number }) => ({
      kind: 'workout' as const, title: 'Easy run', rationale: 'Keep it controlled', structure: { version: 1 as const,
        sport: dailyControls.sport, nodes: [{ kind: 'step' as const, id: 'work', purpose: 'work' as const, ending, targets: [] }] },
    });
    deps.generate.mockResolvedValueOnce(generated({ kind: 'distance', meters: 1000 }))
      .mockResolvedValueOnce(generated({ kind: 'time', seconds: 1200 }));
    const result = await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    expect(result.result?.draft?.structure.nodes[0]).toMatchObject({ ending: { kind: 'time', seconds: 1200 } });
    expect(deps.generate).toHaveBeenCalledTimes(2); expect(deps.store.charge).toHaveBeenCalledOnce();
    expect(deps.generate.mock.calls[0][1].evidence.deliveryProviders).toMatchObject({ providers: [{ provider: 'wahoo' }] });
    expect(deps.generate.mock.calls[1][2]).toContain('Wahoo: unsupported');
    expect(result.result?.usedContext.some(value => value.includes('Wahoo'))).toBe(true);
    deliveryPreferences = { enabled: true, providers: ['garmin'] };
    expect(await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).toEqual(result);
    expect(deps.generate).toHaveBeenCalledTimes(2); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it('keeps recovery evidence within the existing context limit when optional provider guidance will not fit', async () => {
    const deps = dependencies(), originalRead = deps.store.read.getMockImplementation()!;
    deps.store.read.mockImplementation(async () => ({ ...await originalRead(), deliveryPreferences: { enabled: true, providers: ['wahoo'] } }));
    const context = evidence();
    context.evidence.padding = '';
    const paddingLength = 160_000 - JSON.stringify(context.evidence).length;
    context.evidence.padding = 'x'.repeat(paddingLength);
    deps.context.mockResolvedValue(context);
    const result = await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    const generatedContext = deps.generate.mock.calls[0][1];
    expect(JSON.stringify(generatedContext.evidence).length).toBeLessThanOrEqual(160_000);
    expect(generatedContext.evidence).not.toHaveProperty('deliveryProviders');
    expect(String(generatedContext.evidence.padding).length).toBe(paddingLength);
    expect(result.result?.missingContext.join(' ')).toContain('Local provider formats were omitted');
    expect(deps.generate).toHaveBeenCalledOnce(); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it.each(['invalid-output', 'model-error', 'rest', 'still-incompatible'] as const)('keeps a valid prescription if an optional mapping correction fails: %s', async failure => {
    const deps = dependencies(), originalRead = deps.store.read.getMockImplementation()!;
    deps.store.read.mockImplementation(async () => ({ ...await originalRead(), deliveryPreferences: { enabled: true, providers: ['wahoo'] } }));
    deps.generate.mockResolvedValueOnce({ kind: 'workout', title: 'Easy run', rationale: 'Controlled training', structure: {
      version: 1, sport: dailyControls.sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 1000 }, targets: [] }],
    } });
    if (failure === 'model-error') deps.generate.mockRejectedValueOnce(Error('Provider response unavailable'));
    else if (failure === 'still-incompatible') deps.generate.mockResolvedValueOnce({ kind: 'workout', title: 'Different run', rationale: 'Another prescription', structure: {
      version: 1, sport: dailyControls.sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 2000 }, targets: [] }],
    } });
    else deps.generate.mockResolvedValueOnce(failure === 'rest' ? { kind: 'rest', rationale: 'Cannot send to device' } : { invented: true });
    const result = await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    expect(result.state).toBe('ready'); expect(result.result?.kind).toBe('workout');
    expect(result.result?.draft?.structure.nodes[0]).toMatchObject({ ending: { kind: 'distance', meters: 1000 } });
    expect(result.result?.missingContext.join(' ')).toContain('Delivery to Wahoo needs Review sync');
    expect(deps.generate).toHaveBeenCalledTimes(2); expect(deps.store.charge).toHaveBeenCalledOnce();
  });
  it('does not return a mapping fallback after the generation lease is revoked', async () => {
    const deps = dependencies(), originalRead = deps.store.read.getMockImplementation()!;
    deps.store.read.mockImplementation(async () => ({ ...await originalRead(), deliveryPreferences: { enabled: true, providers: ['wahoo'] } }));
    deps.generate.mockResolvedValueOnce({ kind: 'workout', title: 'Easy run', rationale: 'Controlled training', structure: {
      version: 1, sport: dailyControls.sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 1000 }, targets: [] }],
    } }).mockImplementationOnce(async () => {
      deps.store.assertActive.mockRejectedValueOnce(Error('Generation lease revoked')); throw Error('Model unavailable');
    });
    await expect(runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps)).rejects.toMatchObject({ code: 'unavailable' });
    expect(deps.store.finish).not.toHaveBeenCalledWith('owner', expect.any(String), expect.any(String), 'ready', expect.anything(), expect.anything());
  });
  it('omits provider context and mapping retries when Send after approval is off', async () => {
    const deps = dependencies(), originalRead = deps.store.read.getMockImplementation()!;
    deps.store.read.mockImplementation(async () => ({ ...await originalRead(), deliveryPreferences: { enabled: false, providers: ['wahoo'] } }));
    await runDailyWorkoutSuggestion({ mode: 'daily-suggestion', action: 'prepare' }, identity, deps);
    expect(deps.generate.mock.calls[0][1].evidence).not.toHaveProperty('deliveryProviders');
    expect(deps.generate).toHaveBeenCalledOnce();
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
    expect(dailyWorkoutSuggestionRoutineSport({ ...preferences, controls: { ...preferences.controls, garminPowerAveragingSeconds: 30 } }, dailyNow, strength)).toBe(ActivityTypes.Running);
    expect(dailyWorkoutSuggestionRoutineSport({ ...preferences, controls: { ...dailyControls, timing: 'strict' } }, dailyNow, strength)).toBe(ActivityTypes.Running);
    expect(dailyWorkoutSuggestionRoutineSport(preferences, dailyNow, strength.slice(0, 1))).toBe(ActivityTypes.Running);
    expect(dailyWorkoutSuggestionRoutineSport(preferences, dailyNow, [...strength,
      ...activities(ActivityTypes.Cycling, ['2026-10-09', '2026-10-16'])])).toBe(ActivityTypes.Running);
  });
});

describe('bounded current-day coverage for cached suggestions', () => {
  it('uses only current-day activity summaries and existing schedule/rest reads', async () => {
    const callTool = vi.fn(async (name: string, args: Record<string, unknown> = {}) => ({ structuredContent: name === 'get_training_calendar_rest_days'
      ? { ...args, scanComplete: true, restDays: [] } : name === 'query_activities'
      ? { activities: [], scanComplete: true } : name === 'query_planned_workouts_by_date'
      ? { workouts: [], scanComplete: true, scheduleRevision: 1 }
      : { plans: [], scanComplete: true, scheduleRevision: 1 } }));
    expect(await collectDailyWorkoutSuggestionCoverage(dailyControls, { callTool })).toBeNull();
    expect(callTool.mock.calls.map(call => call[0])).toEqual(['query_activities', 'query_planned_workouts_by_date', 'list_training_plans', 'get_training_calendar_rest_days']);
    expect(callTool).toHaveBeenCalledWith('query_activities', { relativePeriod: 'today', timeZone: 'Europe/Helsinki', limit: 1 });
  });
  it('uses positive existence without scanning more activities, and rejects partial empty reads', async () => {
    const callTool = vi.fn().mockResolvedValueOnce({ structuredContent: { activities: [{}], scanComplete: false } });
    expect(await collectDailyWorkoutSuggestionCoverage(dailyControls, { callTool })).toBe('completed'); expect(callTool).toHaveBeenCalledOnce();
    callTool.mockResolvedValueOnce({ structuredContent: { activities: [], scanComplete: false } });
    await expect(collectDailyWorkoutSuggestionCoverage(dailyControls, { callTool })).rejects.toThrow('incomplete');
  });
});

describe('active data history policy', () => {
  it.each(['queued', 'requesting', 'retrying'])('blocks active data work: %s', status => {
    for (const resource of ['activities', 'sleep', 'health']) expect(hasActiveDataHistoryImport({ active: true,
      steps: [{ status, resources: [resource] }] })).toBe(true);
  });
  it.each(['requested', 'processed', 'failed', 'skipped'])('does not invent pending delivery for terminal statuses: %s', status => {
    expect(hasActiveDataHistoryImport({ active: false, steps: [{ status, resources: ['activities'] }] })).toBe(false);
    expect(hasActiveDataHistoryImport({ active: true, steps: [{ status, resources: ['activities'] }] })).toBe(false);
  });
  it('ignores routes-only work even if the overall run is still active', () => {
    expect(hasActiveDataHistoryImport({ active: true, steps: [{ status: 'processed', resources: ['activities'] },
      { status: 'requesting', resources: ['routes'] }] })).toBe(false);
  });
});
