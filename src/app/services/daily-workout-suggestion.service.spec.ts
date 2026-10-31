import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, map, tap } from 'rxjs';
import type { TrainingRestDayV1 } from '@shared/training-rest-days';
import { Auth } from 'app/firebase/auth';
import { defaultDayWorkoutControls } from '@shared/day-workout';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { projectStrengthWorkoutToV1, type StrengthWorkoutDraftV1 } from '@shared/strength-workout';
import type { DailyWorkoutSuggestionStatus } from '@shared/daily-workout-suggestion';
import { DailyWorkoutSuggestionService } from './daily-workout-suggestion.service';
import { AppUserService } from './app.user.service';
import { AppFunctionsService } from './app.functions.service';
import { AppAnalyticsService } from './app.analytics.service';
import { AppWindowService } from './app.window.service';
import { TrainingPlansService } from './training-plans.service';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function setup(saved = storage(), enabled = true, sport = ActivityTypes.Running, knownRevision?: number | null) {
  TestBed.resetTestingModule();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-30T07:00Z'));
  const auth = { currentUser: { uid: 'owner' } };
  const controls = defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki', sport);
  const user = signal<any>({ uid: 'owner', settings: { appSettings: { dailyWorkoutSuggestion: { enabled, followRoutine: true, controls } } } });
  const restDay$ = new BehaviorSubject<TrainingRestDayV1 | null>(null);
  const restChanges = new Subject<{ uid: string; localDate: string; revision: number }>();
  const restRevisions = new Map<string, number>([['owner|2026-10-30', 0]]);
  const pro = signal(true), revisions = new Subject<{ uid: string; revision: number | null }>();
  const verifiedRevisions = new Map<string, number | null>();
  if (knownRevision !== undefined) verifiedRevisions.set('owner', knownRevision);
  revisions.subscribe(({ uid, revision }) => verifiedRevisions.set(uid, revision));
  const updateUserProperties = vi.fn().mockResolvedValue(undefined), logEvent = vi.fn();
  const result = (): DailyWorkoutSuggestionStatus => ({ localDate: service.preferences().controls.localDate, state: 'ready', controls,
    result: { requestId: `daily-suggestion:${service.preferences().controls.localDate}`, observedAt: new Date().toISOString(), kind: 'rest',
      rationale: 'An easy day.', draft: null, usedContext: [], missingContext: [], previousLoads: [] } });
  const call = vi.fn(async () => ({ data: result() }));
  TestBed.configureTestingModule({ providers: [DailyWorkoutSuggestionService,
    { provide: Auth, useValue: auth }, { provide: AppUserService, useValue: { user, updateUserProperties, isProSignal: pro } },
    { provide: AppFunctionsService, useValue: { call } }, { provide: AppAnalyticsService, useValue: { logEvent } },
    { provide: AppWindowService, useValue: { windowRef: { sessionStorage: saved } } },
    { provide: TrainingPlansService, useValue: { stateRevisionChanges$: revisions,
      lastVerifiedStateRevision: (uid: string) => verifiedRevisions.get(uid), calendarRestDayChanges$: restChanges,
      lastCalendarRestDayRevision: (uid: string, date: string) => restRevisions.get(uid + '|' + date),
      watchCalendarRestDay: (uid: string, date: string) => restDay$.pipe(map(record => record?.localDate === date ? record : null),
        tap(record => restRevisions.set(uid + '|' + date, record?.revision ?? 0))) } },
  ] });
  const service = TestBed.inject(DailyWorkoutSuggestionService);
  return { service, auth, user, pro, revisions, call, updateUserProperties, logEvent, saved, result, restDay$, restChanges, restRevisions,
    setRest: (record: TrainingRestDayV1) => { restRevisions.set('owner|' + record.localDate, record.revision);
      restChanges.next({ uid: 'owner', localDate: record.localDate, revision: record.revision }); restDay$.next(record); } };
}
afterEach(() => vi.useRealTimers());

describe('DailyWorkoutSuggestionService daily browser cache', () => {
  it('immediately hides a cached suggestion on calendar rest and reuses the daily result after removal', async () => {
    const { service, setRest, call, result } = setup(); TestBed.flushEffects();
    await service.request('owner', 'prepare', () => true);
    setRest({ schemaVersion: 1, localDate: '2026-10-30', isRestDay: true, revision: 1 });
    expect(service.cached('owner')?.status?.state).toBe('rest-day');
    expect((await service.request('owner', 'prepare', () => true)).state).toBe('rest-day');
    expect(call).toHaveBeenCalledOnce();
    setRest({ schemaVersion: 1, localDate: '2026-10-30', isRestDay: false, revision: 2 });
    expect(service.cached('owner')).toBeNull(); call.mockResolvedValueOnce({ data: result() });
    expect((await service.request('owner', 'status', () => true)).state).toBe('ready');
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith('generateDayWorkout', { mode: 'daily-suggestion', action: 'status' }, expect.anything());
  });
  it('moves the shared rest listener to the new saved-zone date without changing the user object', async () => {
    const { service, setRest } = setup(); TestBed.flushEffects();
    await service.request('owner', 'prepare', () => true);
    vi.setSystemTime(new Date('2026-10-31T07:00Z'));
    service.cached('owner'); TestBed.flushEffects();
    setRest({ schemaVersion: 1, localDate: '2026-10-31', isRestDay: true, revision: 1 });
    expect(service.cached('owner')?.status).toEqual({ localDate: '2026-10-31', state: 'rest-day' });
  });
  it('replaces a same-date listener after the authenticated session changes, even if the user object is unchanged', async () => {
    const { service, auth, setRest } = setup();
    const watch = vi.spyOn(TestBed.inject(TrainingPlansService), 'watchCalendarRestDay'); TestBed.flushEffects();
    await service.request('owner', 'prepare', () => true); expect(watch).toHaveBeenCalledTimes(1);
    auth.currentUser = { uid: 'owner' }; service.cached('owner'); TestBed.flushEffects();
    expect(watch).toHaveBeenCalledTimes(2);
    setRest({ schemaVersion: 1, localDate: '2026-10-30', isRestDay: true, revision: 1 });
    expect(service.cached('owner')?.status?.state).toBe('rest-day');
  });
  it.each(['session', 'controls'] as const)('rejects a changed %s while waiting for current calendar evidence', async change => {
    const { service, auth, user, restRevisions, call } = setup(); restRevisions.clear();
    const pendingRead = new Subject<TrainingRestDayV1 | null>();
    vi.spyOn(TestBed.inject(TrainingPlansService), 'watchCalendarRestDay').mockReturnValue(pendingRead);
    const pending = service.request('owner', 'prepare', () => true);
    if (change === 'session') auth.currentUser = { uid: 'owner' };
    else user.update(value => ({ ...value, settings: { appSettings: { dailyWorkoutSuggestion: {
      ...value.settings.appSettings.dailyWorkoutSuggestion, followRoutine: false } } } }));
    pendingRead.next(null); await expect(pending).rejects.toThrow('changed'); expect(call).not.toHaveBeenCalled();
  });
  it('keeps a recovered day listener after an explicit retry, without retrying from cache reads', async () => {
    const { service, restDay$, restRevisions, call } = setup(); TestBed.flushEffects();
    await service.request('owner', 'prepare', () => true);
    restRevisions.clear(); restDay$.error(new Error('Read failed'));
    const watch = vi.spyOn(TestBed.inject(TrainingPlansService), 'watchCalendarRestDay');
    service.cached('owner'); TestBed.flushEffects(); expect(watch).not.toHaveBeenCalled();
    const recovered$ = new BehaviorSubject<TrainingRestDayV1 | null>(null);
    watch.mockImplementation((uid, date) => recovered$.pipe(tap(record => restRevisions.set(uid + '|' + date, record?.revision ?? 0))));
    await service.request('owner', 'status', () => true); expect(watch).toHaveBeenCalledOnce();
    expect(recovered$.observed).toBe(true);
    recovered$.next({ schemaVersion: 1, localDate: '2026-10-30', isRestDay: true, revision: 1 });
    expect(service.cached('owner')?.status?.state).toBe('rest-day'); expect(call).toHaveBeenCalledTimes(2);
  });
  it('withholds a restored recipe until current calendar rest intent has been verified', async () => {
    const first = setup(); await first.service.request('owner', 'prepare', () => true);
    const next = setup(first.saved); next.restRevisions.clear();
    const evidence = new Subject<TrainingRestDayV1 | null>();
    TestBed.inject(TrainingPlansService).watchCalendarRestDay = () => evidence.pipe(tap(record => next.restRevisions.set('owner|2026-10-30', record?.revision ?? 0)));
    expect(next.service.cached('owner')).toBeNull();
    const pending = next.service.request('owner', 'prepare', () => true); expect(next.call).not.toHaveBeenCalled();
    evidence.next(null); expect((await pending).state).toBe('ready'); expect(next.call).not.toHaveBeenCalled();
  });
  it('preserves dismissal and ignores calendar revisions for other owners or dates', async () => {
    const { service, restChanges, setRest, call } = setup(); TestBed.flushEffects();
    await service.request('owner', 'prepare', () => true);
    restChanges.next({ uid: 'other', localDate: '2026-10-30', revision: 5 });
    restChanges.next({ uid: 'owner', localDate: '2026-10-31', revision: 5 });
    expect(service.cached('owner')?.status?.state).toBe('ready');
    service.remember('owner', { localDate: '2026-10-30', state: 'dismissed' });
    setRest({ schemaVersion: 1, localDate: '2026-10-30', isRestDay: true, revision: 1 });
    expect(service.cached('owner')?.status?.state).toBe('dismissed'); expect(call).toHaveBeenCalledOnce();
  });
  it('defaults off with all data selected, persists preferences and fences account changes', async () => {
    const { service, auth, user, updateUserProperties, call, logEvent } = setup(storage(), false);
    const preferences = service.preferences();
    expect(preferences.enabled).toBe(false); expect(preferences.controls.timelineContext).toBe(true);
    expect(preferences.controls.hrvContext).toBe(true);
    let acknowledge!: () => void;
    updateUserProperties.mockReturnValueOnce(new Promise<void>(resolve => { acknowledge = resolve; }));
    const write = service.save('owner', { ...preferences, enabled: true }); await Promise.resolve();
    expect(service.saving()).toBe(true); acknowledge(); await write; expect(service.saving()).toBe(false);
    expect(updateUserProperties).toHaveBeenCalledWith(user(), { settings: { appSettings: { dailyWorkoutSuggestion: { ...preferences, enabled: true } } } });
    await service.request('owner', 'prepare', () => true);
    expect(call).toHaveBeenCalledWith('generateDayWorkout', { mode: 'daily-suggestion', action: 'prepare' }, expect.any(Object));
    expect(call.mock.calls[0][2].canExecute()).toBe(true);
    await expect(service.request('owner', 'use-available-data', () => true)).rejects.toThrow('displayed day');
    await service.request('owner', 'use-available-data', () => true, preferences.controls.localDate);
    expect(call).toHaveBeenLastCalledWith('generateDayWorkout', { mode: 'daily-suggestion', action: 'use-available-data', localDate: preferences.controls.localDate }, expect.any(Object));
    service.event('owner', 'reviewed', 'ready'); expect(logEvent).toHaveBeenCalledWith('daily_workout_suggestion', { action: 'reviewed', state: 'ready' });
    auth.currentUser = { uid: 'other' }; user.set({ uid: 'other' });
    expect(call.mock.calls[0][2].canExecute()).toBe(false);
    await expect(service.save('owner', preferences)).rejects.toThrow('account changed');
    service.event('owner', 'added'); expect(logEvent).toHaveBeenCalledTimes(1);
  });
  it('reuses settled status across callers and a full app recreation', async () => {
    const first = setup();
    const ready = await first.service.request('owner', 'status', () => true);
    expect(await first.service.request('owner', 'status', () => true)).toBe(ready);
    expect(first.call).toHaveBeenCalledOnce();
    const second = setup(first.saved);
    expect(second.service.cached('owner')?.status).toEqual(ready);
    expect(await second.service.request('owner', 'status', () => true)).toEqual(ready);
    expect(second.call).not.toHaveBeenCalled();
  });
  it.each(['status', 'prepare'] as const)('shares a pending %s request after its first component leaves', async action => {
    const { service, call, result } = setup(); let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let mounted = true;
    const first = service.request('owner', action, () => mounted); mounted = false;
    const second = service.request('owner', action, () => true);
    expect(call).toHaveBeenCalledOnce(); expect(call.mock.calls[0][2].canExecute()).toBe(true);
    finish({ data: result() });
    expect(await first).toBe(await second); expect(service.cached('owner')?.status?.state).toBe('ready');
  });
  it.each(['prepare', 'use-available-data'] as const)('joins in-flight %s when a recreated view refreshes status', async action => {
    const { service, call, result } = setup();
    let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const generation = service.request('owner', action, () => true, action === 'use-available-data' ? '2026-10-30' : undefined);
    const status = service.request('owner', 'status', () => true, undefined, true);
    expect(call).toHaveBeenCalledOnce(); finish({ data: result() });
    expect(await status).toBe(await generation); expect(service.cached('owner')?.status?.state).toBe('ready');
  });
  it.each(['prepare', 'use-available-data'] as const)('waits for an older status request before dispatching %s', async action => {
    const { service, call, result } = setup();
    let finishStatus!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    let finishGeneration!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finishStatus = resolve; }));
    call.mockImplementationOnce(() => new Promise(resolve => { finishGeneration = resolve; }));
    const status = service.request('owner', 'status', () => true);
    const generation = service.request('owner', action, () => true, action === 'use-available-data' ? '2026-10-30' : undefined);
    expect(call).toHaveBeenCalledOnce();
    finishStatus({ data: { localDate: '2026-10-30', state: 'waiting-sleep' } }); await status;
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2)); finishGeneration({ data: result() });
    expect((await generation).state).toBe('ready'); expect(service.cached('owner')?.status?.state).toBe('ready');
  });
  it('queues the explicit available-data choice after a pending sleep check', async () => {
    const { service, call, result } = setup();
    let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const check = service.request('owner', 'prepare', () => true);
    const fallback = service.request('owner', 'use-available-data', () => true, '2026-10-30');
    expect(call).toHaveBeenCalledOnce(); finish({ data: { localDate: '2026-10-30', state: 'waiting-sleep' } }); await check;
    expect((await fallback).state).toBe('ready'); expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith('generateDayWorkout', { mode: 'daily-suggestion', action: 'use-available-data', localDate: '2026-10-30' }, expect.anything());
    expect(service.cached('owner')?.status).toEqual(result());
  });
  it('shares an explicit available-data generation with a later automatic preparation', async () => {
    const { service, call, result } = setup();
    let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const explicit = service.request('owner', 'use-available-data', () => true, '2026-10-30');
    const automatic = service.request('owner', 'prepare', () => true);
    expect(call).toHaveBeenCalledOnce(); finish({ data: result() }); expect(await automatic).toBe(await explicit);
  });
  it.each(['rest', 'dismiss'] as const)('does not dispatch queued generation after %s supersedes the pending read', async change => {
    const { service, call, setRest } = setup(); TestBed.flushEffects();
    let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const status = service.request('owner', 'status', () => true);
    const generation = service.request('owner', 'prepare', () => true);
    if (change === 'rest') setRest({ schemaVersion: 1, localDate: '2026-10-30', isRestDay: true, revision: 1 });
    else {
      call.mockResolvedValueOnce({ data: { localDate: '2026-10-30', state: 'dismissed' } });
      await service.request('owner', 'dismiss', () => true, '2026-10-30');
    }
    finish({ data: { localDate: '2026-10-30', state: 'waiting' } });
    const results = await Promise.allSettled([status, generation]); expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(call).toHaveBeenCalledTimes(change === 'rest' ? 1 : 2);
    expect(service.cached('owner')?.status?.state).toBe(change === 'rest' ? 'rest-day' : 'dismissed');
  });
  it('joins a pending dismissal instead of reading and caching an older status', async () => {
    const { service, call } = setup();
    let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const dismissal = service.request('owner', 'dismiss', () => true, '2026-10-30');
    const status = service.request('owner', 'status', () => true, undefined, true);
    expect(call).toHaveBeenCalledOnce(); finish({ data: { localDate: '2026-10-30', state: 'dismissed' } });
    expect(await status).toBe(await dismissal); expect(service.cached('owner')?.status?.state).toBe('dismissed');
  });
  it.each(['planned', 'completed', 'rest-day', 'dismissed', 'failed', 'waiting-sleep'] as const)('caches %s without repeated status reads', async state => {
    const first = setup(); first.call.mockResolvedValue({ data: { localDate: '2026-10-30', state } });
    await first.service.request('owner', 'status', () => true);
    const next = setup(first.saved);
    expect((await next.service.request('owner', 'status', () => true)).state).toBe(state);
    expect(next.call).not.toHaveBeenCalled();
  });
  it.each([ActivityTypes.Running, ActivityTypes.StrengthTraining])('round-trips the full %s recipe through a reload', async sport => {
    const first = setup(storage(), true, sport);
    const ready = first.result();
    const strength: StrengthWorkoutDraftV1 = { version: 1, exercises: [{ id: 'squat', name: 'Goblet squat',
      sets: [{ id: 'set-a', ending: { kind: 'repetitions', repetitions: 8 }, restAfterSeconds: 90, externalLoadKg: 12.5 }] }] };
    ready.result = { ...ready.result!, kind: 'workout', draft: { title: 'Canonical recipe', structure: sport === ActivityTypes.StrengthTraining
      ? projectStrengthWorkoutToV1({ ...strength, workoutId: 'draft', revision: 1 }, sport)
      : { version: 1, sport, nodes: [{ kind: 'repeat', id: 'intervals', count: 3, steps: [
        { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 120 }, targets: [] },
        { kind: 'step', id: 'recovery', purpose: 'recovery', ending: { kind: 'time', seconds: 60 }, targets: [] },
      ] }] }, ...(sport === ActivityTypes.StrengthTraining ? { strength, estimatedMinutes: { minimum: 20, maximum: 30 } } : {}) } };
    first.call.mockResolvedValueOnce({ data: ready }); await first.service.request('owner', 'prepare', () => true);
    const next = setup(first.saved, true, sport);
    expect(next.service.cached('owner')?.status).toEqual(ready); expect(next.call).not.toHaveBeenCalled();
  });
  it('does not invalidate the daily cache when unchanged preferences are saved', async () => {
    const { service, call } = setup(); await service.request('owner', 'status', () => true);
    await service.save('owner', service.preferences());
    expect(service.cached('owner')?.status?.state).toBe('ready');
    await service.request('owner', 'status', () => true); expect(call).toHaveBeenCalledOnce();
  });
  it('lets an explicit refresh bypass cached status and shares that refresh', async () => {
    const { service, call, result } = setup(); await service.request('owner', 'status', () => true);
    let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = service.request('owner', 'status', () => true, undefined, true);
    const second = service.request('owner', 'status', () => true, undefined, true);
    expect(call).toHaveBeenCalledTimes(2); finish({ data: result() }); await Promise.all([first, second]);
  });
  it.each(['dismiss', 'use-available-data'] as const)('keeps the view cancellation fence on explicit %s actions', async action => {
    const { service, call, result } = setup(); let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let current = true;
    const pending = service.request('owner', action, () => current, '2026-10-30');
    expect(call.mock.calls[0][2].canExecute()).toBe(true);
    current = false; expect(call.mock.calls[0][2].canExecute()).toBe(false);
    finish({ data: result() }); await pending;
  });
  it('rechecks only changed Sleep evidence while waiting, retaining an existing ready result', async () => {
    const { service, call, result } = setup(); service.observeSleep('owner', 'night-a');
    call.mockResolvedValueOnce({ data: { localDate: '2026-10-30', state: 'waiting-sleep' } });
    await service.request('owner', 'prepare', () => true);
    service.observeSleep('owner', 'night-a'); expect(service.cached('owner')?.status?.state).toBe('waiting-sleep');
    service.observeSleep('owner', 'night-b'); expect(service.cached('owner')).toBeNull();
    await service.request('owner', 'status', () => true);
    service.observeSleep('owner', 'night-c'); expect(service.cached('owner')?.status).toEqual(result());
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('does not mistake a restored waiting receipt for a completed Sleep context check', async () => {
    const first = setup(); first.service.observeSleep('owner', 'night-a');
    first.call.mockResolvedValueOnce({ data: { localDate: '2026-10-30', state: 'waiting-sleep' } });
    await first.service.request('owner', 'status', () => true);
    const next = setup(first.saved);
    expect(next.service.cached('owner')?.sleepKey).toBeNull();
    next.service.observeSleep('owner', 'night-a');
    expect(next.service.cached('owner')).toBeNull();
    await next.service.request('owner', 'prepare', () => true);
    expect(next.call).toHaveBeenCalledOnce();
    expect(next.service.cached('owner')?.status?.state).toBe('ready');
  });
  it('invalidates changed verified schedule revisions, not repeated or other-owner emissions', async () => {
    const { service, revisions, call } = setup(); service.cached('owner');
    revisions.next({ uid: 'owner', revision: 4 }); await service.request('owner', 'status', () => true);
    revisions.next({ uid: 'other', revision: 99 }); revisions.next({ uid: 'owner', revision: 4 });
    expect(service.cached('owner')?.status?.state).toBe('ready');
    revisions.next({ uid: 'owner', revision: 5 }); expect(service.cached('owner')).toBeNull();
    await service.request('owner', 'status', () => true); expect(call).toHaveBeenCalledTimes(2);
  });
  it('rechecks a cached suggestion when a rest day is marked or removed, without preparing another suggestion', async () => {
    const { service, revisions, call, result } = setup();
    service.cached('owner'); revisions.next({ uid: 'owner', revision: 4 });
    await service.request('owner', 'prepare', () => true);
    call.mockResolvedValueOnce({ data: { localDate: '2026-10-30', state: 'rest-day' } });
    revisions.next({ uid: 'owner', revision: 5 }); expect(service.cached('owner')).toBeNull();
    expect((await service.request('owner', 'status', () => true)).state).toBe('rest-day');
    expect((await service.request('owner', 'prepare', () => true)).state).toBe('rest-day');
    expect(call).toHaveBeenCalledTimes(2);
    revisions.next({ uid: 'owner', revision: 6 }); call.mockResolvedValueOnce({ data: result() });
    expect((await service.request('owner', 'status', () => true)).state).toBe('ready');
    expect(call.mock.calls.map(([, request]) => request.action)).toEqual(['prepare', 'status', 'status']);
  });
  it('does not let invalidated in-flight replies replace newer coverage', async () => {
    const { service, call, revisions, result } = setup(); service.cached('owner'); revisions.next({ uid: 'owner', revision: 1 });
    let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = service.request('owner', 'status', () => true);
    revisions.next({ uid: 'owner', revision: 2 }); service.remember('owner', { localDate: '2026-10-30', state: 'planned' });
    finish({ data: result() }); await expect(pending).rejects.toThrow('access changed');
    expect(service.cached('owner')?.status?.state).toBe('planned');
  });
  it.each([undefined, 4])('rejects a restored revision %s when a newer schedule was verified before cache hydration', async revision => {
    const first = setup(storage(), true, ActivityTypes.Running, revision);
    await first.service.request('owner', 'status', () => true);
    const next = setup(first.saved, true, ActivityTypes.Running, 5);
    expect(next.service.cached('owner')).toBeNull();
    await next.service.request('owner', 'status', () => true); expect(next.call).toHaveBeenCalledOnce();
    const unchanged = setup(next.saved, true, ActivityTypes.Running, 5);
    expect(unchanged.service.cached('owner')?.status?.state).toBe('ready'); expect(unchanged.call).not.toHaveBeenCalled();
  });
  it('retains a verified revision emitted before the first cache request', async () => {
    const first = setup(); first.revisions.next({ uid: 'owner', revision: 4 });
    await first.service.request('owner', 'status', () => true);
    expect(setup(first.saved, true, ActivityTypes.Running, 5).service.cached('owner')).toBeNull();
  });
  it('invalidates an unversioned restored result on the first verified schedule while retaining dismissal', async () => {
    const first = setup(); await first.service.request('owner', 'status', () => true);
    const next = setup(first.saved); expect(next.service.cached('owner')?.status?.state).toBe('ready');
    next.revisions.next({ uid: 'owner', revision: 1 }); expect(next.service.cached('owner')).toBeNull();
    next.service.remember('owner', { localDate: '2026-10-30', state: 'dismissed' });
    next.revisions.next({ uid: 'owner', revision: 2 }); expect(next.service.cached('owner')?.status?.state).toBe('dismissed');
    const restored = setup(next.saved, true, ActivityTypes.Running, 3);
    expect(restored.service.cached('owner')?.status?.state).toBe('dismissed');
  });
  it('clears private session state on logout and rejects late replies', async () => {
    const { service, user, auth, call, result, saved } = setup(); await service.request('owner', 'status', () => true);
    expect(saved.values.size).toBe(1);
    let finish!: (value: { data: DailyWorkoutSuggestionStatus }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = service.request('owner', 'status', () => true, undefined, true);
    user.set(null); auth.currentUser = null; TestBed.tick();
    expect(saved.values.size).toBe(0);
    finish({ data: result() }); await expect(pending).rejects.toThrow('access changed');
    expect(saved.values.size).toBe(0);
  });
  it.each(['day', 'preferences', 'account'] as const)('does not reuse another %s scope', async change => {
    const { service, user, auth, call } = setup(); await service.request('owner', 'status', () => true);
    if (change === 'day') vi.setSystemTime(new Date('2026-10-31T07:00Z'));
    if (change === 'preferences') user.update(value => ({ ...value, settings: { appSettings: { dailyWorkoutSuggestion: {
      ...value.settings.appSettings.dailyWorkoutSuggestion, followRoutine: false } } } }));
    if (change === 'account') { auth.currentUser = { uid: 'other' }; user.update(value => ({ ...value, uid: 'other' })); }
    const uid = change === 'account' ? 'other' : 'owner';
    expect(service.cached(uid)).toBeNull(); await service.request(uid, 'status', () => true); expect(call).toHaveBeenCalledTimes(2);
  });
  it('treats malformed and obsolete session data as cache misses', async () => {
    const first = setup(); await first.service.request('owner', 'status', () => true);
    const key = [...first.saved.values.keys()][0];
    first.saved.setItem(key, '{broken'); const second = setup(first.saved); expect(second.service.cached('owner')).toBeNull();
    await second.service.request('owner', 'status', () => true);
    const saved = JSON.parse(second.saved.getItem(key)!); saved.status.result.draft = {};
    second.saved.setItem(key, JSON.stringify(saved)); const third = setup(second.saved);
    expect(third.service.cached('owner')).toBeNull();
  });
  it('continues caching in memory when browser storage is blocked', async () => {
    const saved = storage(); saved.setItem = () => { throw Error('Blocked'); };
    const { service, call } = setup(saved); await service.request('owner', 'status', () => true);
    await service.request('owner', 'status', () => true); expect(call).toHaveBeenCalledOnce();
  });
  it.each(['date', 'zone', 'missing-strength', 'different-strength', 'endurance-strength', 'endurance-estimate'] as const)(
    'rejects a restored recipe with inconsistent %s', async change => {
      const sport = change.includes('strength') && !change.startsWith('endurance') ? ActivityTypes.StrengthTraining : ActivityTypes.Running;
      const first = setup(storage(), true, sport), ready = first.result();
      const strength: StrengthWorkoutDraftV1 = { version: 1, exercises: [{ id: 'squat', name: 'Squat',
        sets: [{ id: 'set-a', ending: { kind: 'repetitions', repetitions: 8 } }] }] };
      ready.result = { ...ready.result!, kind: 'workout', draft: { title: 'Workout', structure: sport === ActivityTypes.StrengthTraining
        ? projectStrengthWorkoutToV1({ ...strength, workoutId: 'draft', revision: 1 }, sport)
        : { version: 1, sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 1800 }, targets: [] }] },
        ...(sport === ActivityTypes.StrengthTraining ? { strength } : {}) } };
      first.call.mockResolvedValueOnce({ data: ready }); await first.service.request('owner', 'prepare', () => true);
      const key = [...first.saved.values.keys()][0], saved = JSON.parse(first.saved.getItem(key)!);
      if (change === 'date') saved.status.controls.localDate = '2026-10-31';
      if (change === 'zone') saved.status.controls.timeZone = 'UTC';
      if (change === 'missing-strength') delete saved.status.result.draft.strength;
      if (change === 'different-strength') saved.status.result.draft.strength.exercises[0].sets[0].ending.repetitions = 12;
      if (change === 'endurance-strength') saved.status.result.draft.strength = strength;
      if (change === 'endurance-estimate') saved.status.result.draft.estimatedMinutes = { minimum: 20, maximum: 30 };
      first.saved.setItem(key, JSON.stringify(saved));
      expect(setup(first.saved, true, sport).service.cached('owner')).toBeNull();
    });
  it('does not let a late Add callback replace the next local day cache', async () => {
    const { service, call } = setup(); await service.request('owner', 'status', () => true);
    vi.setSystemTime(new Date('2026-10-31T07:00Z'));
    service.remember('owner', { localDate: '2026-10-30', state: 'planned' });
    expect(service.cached('owner')).toBeNull();
    await service.request('owner', 'status', () => true); expect(call).toHaveBeenCalledTimes(2);
  });
  it('does not restore an unfinished preparation after a reload', async () => {
    const first = setup(); first.call.mockResolvedValue({ data: { localDate: '2026-10-30', state: 'preparing' } });
    await first.service.request('owner', 'status', () => true);
    expect(setup(first.saved).service.cached('owner')).toBeNull();
  });
});
