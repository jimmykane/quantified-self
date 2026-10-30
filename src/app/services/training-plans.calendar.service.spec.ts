import { TestBed } from '@angular/core/testing';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { filter, firstValueFrom, of, Subject, throwError } from 'rxjs';
import type { TrainingPlanV1 } from '@shared/training-plans';
import { Firestore, collectionData, docData, where, limit, getDoc as getCachedDoc } from 'app/firebase/firestore';
import { getDoc, getFirestore } from 'firebase/firestore/lite';
import { TrainingPlansService, TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS, type CurrentTrainingScheduleV1 } from './training-plans.service';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';

vi.mock('app/firebase/firestore', () => ({ Firestore: class {},
  collection: vi.fn((_db, ...path: string[]) => ({ path: path.join('/') })), doc: vi.fn((_db, ...path: string[]) => ({ path: path.join('/') })),
  documentId: vi.fn(() => '__name__'), docData: vi.fn(), collectionData: vi.fn(), getDoc: vi.fn(),
  limit: vi.fn(value => ({ limit: value })), orderBy: vi.fn((field, direction) => ({ field, direction })),
  query: vi.fn((ref, ...constraints) => ({ ref, constraints })), where: vi.fn((field, op, value) => ({ field, op, value })),
}));
vi.mock('firebase/firestore/lite', () => ({
  getFirestore: vi.fn(() => ({ transport: 'uncached' })),
  doc: vi.fn((_db, ...path: string[]) => ({ path: path.join('/') })), getDoc: vi.fn(),
}));
const row = (id: string) => ({ schemaVersion: 1, id, planId: null, localDate: '2026-10-06', lifecycle: 'planned', title: id,
  revision: 1, createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running,
    nodes: [{ kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] }] } });
describe('bounded Calendar Training reads', () => {
  const app = {};
  const currentState = { schemaVersion: 1, activePlanId: null, revision: 253, currentWorkoutCount: 1, updatedAtMs: 1 };
  let serverState: Record<string, unknown> | undefined;
  let service: TrainingPlansService;
  beforeEach(() => {
    vi.resetAllMocks(); serverState = undefined;
    vi.mocked(getDoc).mockImplementation(async () => ({ data: () => serverState }) as Awaited<ReturnType<typeof getDoc>>);
    vi.mocked(getCachedDoc).mockResolvedValue({ exists: () => false } as never);
    TestBed.configureTestingModule({ providers: [TrainingPlansService, { provide: Firestore, useValue: { app } },
      { provide: AppFunctionsService, useValue: {} }, { provide: BrowserCompatibilityService, useValue: {} }] });
    service = TestBed.inject(TrainingPlansService);
    vi.mocked(docData).mockReturnValue(of(undefined));
  });
  it('shares an active-plan-only rest context without scanning workouts or plan collections', async () => {
    serverState = { ...currentState, activePlanId: 'active-plan' };
    const plan = { schemaVersion: 1, id: 'active-plan', name: 'Autumn', lifecycle: 'active', startLocalDate: '2026-10-05',
      endLocalDate: '2026-10-11', restDays: ['2026-10-06'], revision: 1, lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 1 };
    vi.mocked(docData).mockImplementation(ref => of(ref.path.endsWith('/trainingPlans/active-plan') ? plan : undefined));
    const shared = service.watchActivePlan('owner');
    expect(service.watchActivePlan('owner')).toBe(shared);
    expect(await firstValueFrom(shared.pipe(filter(value => value !== null)))).toEqual(plan);
    expect(collectionData).not.toHaveBeenCalled();
    expect(docData).toHaveBeenCalledTimes(3);
    expect(await firstValueFrom(service.watchActivePlan(''))).toBeNull();
  });
  it('withholds rest context behind the restore fence without querying a plan', async () => {
    vi.mocked(docData).mockReturnValue(of({ operation: 'restore' }));
    expect(await firstValueFrom(service.watchActivePlan('owner'))).toBeNull();
    expect(docData).toHaveBeenCalledOnce(); expect(collectionData).not.toHaveBeenCalled(); expect(getDoc).not.toHaveBeenCalled();
  });
  it('publishes standalone-workout deletion revisions even when there is no active plan', async () => {
    const stateSignals = new Subject<unknown>(), revisions: unknown[] = [];
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? of(undefined) : stateSignals);
    serverState = currentState;
    const revisionSubscription = service.stateRevisionChanges$.subscribe(value => revisions.push(value));
    const subscription = service.watchActivePlan('owner').subscribe();
    stateSignals.next(currentState);
    await vi.waitFor(() => expect(revisions).toEqual([{ uid: 'owner', revision: 253 }]));
    serverState = { ...currentState, currentWorkoutCount: 0, revision: 254 };
    stateSignals.next(serverState);
    await vi.waitFor(() => expect(revisions).toEqual([{ uid: 'owner', revision: 253 }, { uid: 'owner', revision: 254 }]));
    expect(service.lastVerifiedStateRevision('owner')).toBe(254);
    expect(collectionData).not.toHaveBeenCalled(); expect(docData).toHaveBeenCalledTimes(2);
    subscription.unsubscribe(); revisionSubscription.unsubscribe();
  });
  it.each(['paused', 'archived', 'missing'] as const)('keeps rest context live when the old plan becomes %s before the state changes', async lifecycle => {
    const stateSignals = new Subject<unknown>(), oldPlan = new Subject<unknown>(), nextPlan = new Subject<unknown>();
    const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'old', name: 'Autumn', lifecycle: 'active',
      startLocalDate: '2026-10-05', endLocalDate: '2026-10-11', restDays: ['2026-10-06'],
      revision: 1, lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 1 };
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? of(undefined)
      : ref.path.endsWith('/trainingPlanState/current') ? stateSignals
        : ref.path.endsWith('/trainingPlans/old') ? oldPlan : nextPlan);
    serverState = { ...currentState, activePlanId: 'old' };
    const observed: (TrainingPlanV1 | null)[] = [], error = vi.fn(), complete = vi.fn();
    const subscription = service.watchActivePlan('owner').subscribe({ next: value => observed.push(value), error, complete });
    stateSignals.next(undefined); await vi.waitFor(() => expect(oldPlan.observed).toBe(true));
    oldPlan.next(plan); expect(observed.at(-1)).toEqual(plan);
    oldPlan.next(lifecycle === 'missing' ? undefined : { ...plan, lifecycle });
    expect(observed.at(-1)).toBeNull(); expect(error).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    // A missing document can reappear before the state pointer catches up, too.
    if (lifecycle === 'missing') { oldPlan.next(plan); expect(observed.at(-1)).toEqual(plan); }
    serverState = { ...currentState, activePlanId: 'next', revision: 254 };
    stateSignals.next(undefined); await vi.waitFor(() => expect(nextPlan.observed).toBe(true));
    expect(oldPlan.observed).toBe(false); expect(observed.at(-1)).toBeNull();
    const replacement = { ...plan, id: 'next', name: 'Winter', restDays: ['2026-10-07'] };
    nextPlan.next(replacement); expect(observed.at(-1)).toEqual(replacement);
    expect(collectionData).not.toHaveBeenCalled(); subscription.unsubscribe();
    expect(stateSignals.observed).toBe(false); expect(nextPlan.observed).toBe(false);
  });
  it('clears the previous plan while its replacement loads and shares the live listener until the last subscriber leaves', async () => {
    const stateSignals = new Subject<unknown>(), oldPlan = new Subject<unknown>(), nextPlan = new Subject<unknown>();
    const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'old', name: 'Autumn', lifecycle: 'active',
      startLocalDate: '2026-10-05', endLocalDate: '2026-10-11', restDays: ['2026-10-06'],
      revision: 1, lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 1 };
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? of(undefined)
      : ref.path.endsWith('/trainingPlanState/current') ? stateSignals
        : ref.path.endsWith('/trainingPlans/old') ? oldPlan : nextPlan);
    serverState = { ...currentState, activePlanId: 'old' };
    const first: (TrainingPlanV1 | null)[] = [], second: (TrainingPlanV1 | null)[] = [];
    const shared = service.watchActivePlan('owner');
    const one = shared.subscribe(value => first.push(value)), two = shared.subscribe(value => second.push(value));
    stateSignals.next(undefined); await vi.waitFor(() => expect(oldPlan.observed).toBe(true));
    oldPlan.next(plan); expect(first.at(-1)).toEqual(plan); expect(second.at(-1)).toEqual(plan);
    serverState = { ...currentState, activePlanId: 'next', revision: 254 };
    stateSignals.next(undefined); await vi.waitFor(() => expect(nextPlan.observed).toBe(true));
    expect(first.at(-1)).toBeNull(); expect(second.at(-1)).toBeNull();
    oldPlan.next(plan); expect(first.at(-1)).toBeNull();
    nextPlan.next({ ...plan, id: 'next' }); expect(first.at(-1)?.id).toBe('next');
    expect(docData).toHaveBeenCalledTimes(4); expect(collectionData).not.toHaveBeenCalled();
    one.unsubscribe(); expect(nextPlan.observed).toBe(true);
    two.unsubscribe(); expect(nextPlan.observed).toBe(false); expect(stateSignals.observed).toBe(false);
  });
  it.each(['identity', 'listener'] as const)('withholds invalid rest context after a plan %s failure and recovers on fresh state', async failure => {
    const stateSignals = new Subject<unknown>(), planSignals = new Subject<unknown>();
    const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'active', name: 'Autumn', lifecycle: 'active',
      startLocalDate: '2026-10-05', endLocalDate: '2026-10-11', revision: 1,
      lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 1 };
    let recovering = false;
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? of(undefined)
      : ref.path.endsWith('/trainingPlanState/current') ? stateSignals : recovering ? of(plan) : planSignals);
    serverState = { ...currentState, activePlanId: plan.id };
    const observed: (TrainingPlanV1 | null)[] = [], error = vi.fn();
    const subscription = service.watchActivePlan('owner').subscribe({ next: value => observed.push(value), error });
    stateSignals.next(undefined); await vi.waitFor(() => expect(planSignals.observed).toBe(true));
    planSignals.next(plan); expect(observed.at(-1)).toEqual(plan);
    if (failure === 'identity') planSignals.next({ ...plan, id: 'wrong' }); else planSignals.error(new Error('Unavailable'));
    expect(observed.at(-1)).toBeNull(); expect(error).not.toHaveBeenCalled();
    recovering = true; stateSignals.next(undefined); await vi.waitFor(() => expect(observed.at(-1)).toEqual(plan));
    serverState = { ...currentState, activePlanId: null, revision: 254 };
    stateSignals.next(undefined); await vi.waitFor(() => expect(observed.at(-1)).toBeNull());
    expect(collectionData).not.toHaveBeenCalled(); subscription.unsubscribe();
  });
  it('keeps verified rest context visible while the same active plan reloads after a routine schedule revision', async () => {
    const stateSignals = new Subject<unknown>(), planSignals = new Subject<unknown>();
    const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'active', name: 'Autumn', lifecycle: 'active',
      startLocalDate: '2026-10-05', endLocalDate: '2026-10-11', restDays: ['2026-10-06'],
      revision: 1, lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 1 };
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? of(undefined)
      : ref.path.endsWith('/trainingPlanState/current') ? stateSignals : planSignals);
    serverState = { ...currentState, activePlanId: plan.id };
    const observed: (TrainingPlanV1 | null)[] = [];
    const subscription = service.watchActivePlan('owner').subscribe(value => observed.push(value));
    stateSignals.next(undefined); await vi.waitFor(() => expect(planSignals.observed).toBe(true));
    planSignals.next(plan); const beforeRefresh = observed.length;
    serverState = { ...serverState, revision: 254 };
    stateSignals.next(undefined); await vi.waitFor(() => expect(docData).toHaveBeenCalledTimes(4));
    // A standalone-workout edit does not change active-plan identity or rest intent.
    expect(observed).toHaveLength(beforeRefresh); expect(observed.at(-1)).toEqual(plan);
    planSignals.next(plan); expect(observed.at(-1)).toEqual(plan);
    expect(collectionData).not.toHaveBeenCalled(); subscription.unsubscribe();
  });
  it.each(['read', 'schema'] as const)('recovers rest context on a later state update after a state %s failure', async failure => {
    const stateSignals = new Subject<unknown>(), planSignals = new Subject<unknown>();
    const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'active', name: 'Autumn', lifecycle: 'active',
      startLocalDate: '2026-10-05', endLocalDate: '2026-10-11', restDays: ['2026-10-06'],
      revision: 1, lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 1 };
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? of(undefined)
      : ref.path.endsWith('/trainingPlanState/current') ? stateSignals : planSignals);
    serverState = { ...currentState, activePlanId: plan.id };
    const observed: (TrainingPlanV1 | null)[] = [], error = vi.fn();
    const subscription = service.watchActivePlan('owner').subscribe({ next: value => observed.push(value), error });
    stateSignals.next(undefined); await vi.waitFor(() => expect(planSignals.observed).toBe(true));
    planSignals.next(plan); expect(observed.at(-1)).toEqual(plan);
    if (failure === 'read') vi.mocked(getDoc).mockRejectedValueOnce(new Error('Temporarily unavailable'));
    else serverState = { revision: 254 };
    const beforeFailure = observed.length;
    stateSignals.next(undefined);
    await vi.waitFor(() => expect(observed.length + error.mock.calls.length).toBeGreaterThan(beforeFailure));
    expect(error).not.toHaveBeenCalled(); expect(observed.at(-1)).toBeNull();
    expect(stateSignals.observed).toBe(true); expect(planSignals.observed).toBe(false);
    serverState = { ...currentState, activePlanId: plan.id, revision: 255 };
    stateSignals.next(undefined); await vi.waitFor(() => expect(planSignals.observed).toBe(true));
    planSignals.next(plan); expect(observed.at(-1)).toEqual(plan);
    expect(getDoc).toHaveBeenCalledTimes(3); expect(collectionData).not.toHaveBeenCalled(); subscription.unsubscribe();
  });
  it('uses inclusive local dates with lookahead and never reports truncated workouts as a complete schedule', async () => {
    vi.mocked(collectionData).mockReturnValue(of(Array.from({ length: 401 }, (_, i) => row(`w${i}`))));
    const schedule = await firstValueFrom(service.watchCalendarSchedule('owner', '2026-10-05', '2026-10-11'));
    expect(schedule.workouts).toHaveLength(400); expect(schedule.workoutsComplete).toBe(false);
    expect(where).toHaveBeenCalledWith('localDate', '>=', '2026-10-05');
    expect(where).toHaveBeenCalledWith('localDate', '<=', '2026-10-11'); expect(limit).toHaveBeenCalledWith(401);
    expect(docData).toHaveBeenCalledTimes(2); // Availability and state; no all-plan scan.
  });
  it('keeps restore-fenced schedules unavailable without querying workouts', async () => {
    vi.mocked(docData).mockReturnValue(of({ operation: 'restore' }));
    expect((await firstValueFrom(service.watchCalendarSchedule('owner', '2026-10-05', '2026-10-11'))).restoreUnavailable).toBe(true);
    expect(collectionData).not.toHaveBeenCalled(); expect(getDoc).not.toHaveBeenCalled();
  });
  it.each(['missing', 'stale'] as const)('verifies a %s state watch before selecting the active plan and revision', async source => {
    serverState = { ...currentState, activePlanId: 'verified-plan' };
    vi.mocked(docData).mockImplementation(ref => {
      if (ref.path.endsWith('/availability/restore')) return of(undefined);
      if (ref.path.endsWith('/trainingPlanState/current')) return of(source === 'missing' ? undefined : { ...currentState, revision: 1, activePlanId: 'old-plan' });
      return of({ schemaVersion: 1, id: 'verified-plan', name: 'Current plan', lifecycle: 'active',
        startLocalDate: '2026-10-05', endLocalDate: '2026-10-11', revision: 1, lastCheckpointRevision: 1,
        workoutCount: 1, createdAtMs: 1, updatedAtMs: 1 });
    });
    vi.mocked(collectionData).mockReturnValue(of([{ ...row('planned'), planId: 'verified-plan' }]));
    const result = await firstValueFrom(service.watchCalendarSchedule('owner', '2026-10-05', '2026-10-11'));
    expect(result.state).toEqual(serverState);
    expect(result.plans.map(plan => plan.id)).toEqual(['verified-plan']);
    expect(getFirestore).toHaveBeenCalledWith(app);
    expect(getDoc).toHaveBeenCalledWith({ path: 'users/owner/trainingPlanState/current' });
    expect(docData).not.toHaveBeenCalledWith({ path: 'users/owner/trainingPlans/old-plan' }, expect.anything());
  });
  it('discards an older verification when another state signal supersedes it', async () => {
    const stateSignals = new Subject<Record<string, unknown> | undefined>();
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? of(undefined) : stateSignals);
    vi.mocked(collectionData).mockReturnValue(of([])); serverState = { ...currentState, revision: 254 };
    let finish!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
    vi.mocked(getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const observed: CurrentTrainingScheduleV1[] = [];
    const subscription = service.watchCalendarSchedule('owner', '2026-10-05', '2026-10-11').subscribe(value => observed.push(value));
    stateSignals.next(undefined); await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
    stateSignals.next(undefined); await vi.waitFor(() => expect(observed[0]?.state.revision).toBe(254));
    finish({ data: () => currentState } as Awaited<ReturnType<typeof getDoc>>); await Promise.resolve();
    expect(observed.map(value => value.state.revision)).toEqual([254]); subscription.unsubscribe();
  });
  it('cancels verification when a restore fence arrives', async () => {
    const availability = new Subject<Record<string, unknown> | undefined>();
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? availability : of(undefined));
    let finish!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
    vi.mocked(getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const observed: CurrentTrainingScheduleV1[] = [];
    const subscription = service.watchCalendarSchedule('owner', '2026-10-05', '2026-10-11').subscribe(value => observed.push(value));
    availability.next(undefined); await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
    availability.next({ operation: 'restore' });
    expect(observed).toHaveLength(1); expect(observed[0].restoreUnavailable).toBe(true);
    finish({ data: () => currentState } as Awaited<ReturnType<typeof getDoc>>); await Promise.resolve();
    expect(observed).toHaveLength(1); expect(collectionData).not.toHaveBeenCalled(); subscription.unsubscribe();
  });
  it.each(['watch', 'verification', 'restore lookup'] as const)('bounds a stalled %s instead of publishing an empty schedule', async source => {
    vi.useFakeTimers();
    try {
      const stateSignals = new Subject<Record<string, unknown> | undefined>();
      vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? of(undefined)
        : source === 'watch' ? stateSignals : of(undefined));
      if (source === 'restore lookup') {
        vi.mocked(getDoc).mockRejectedValue(new Error('Unavailable'));
        vi.mocked(getCachedDoc).mockReturnValue(new Promise(() => {}));
      } else vi.mocked(getDoc).mockReturnValue(new Promise(() => {}));
      const pending = firstValueFrom(service.watchCalendarSchedule('owner', '2026-10-05', '2026-10-11'));
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(3 * TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS + 2000);
      await rejected; expect(collectionData).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it.each(['availability', 'plan', 'workouts'] as const)('bounds an unacknowledged Calendar %s listener', async source => {
    vi.useFakeTimers();
    try {
      const pendingRead = new Subject<Record<string, unknown> | undefined>();
      serverState = source === 'plan' ? { ...currentState, activePlanId: 'plan' } : currentState;
      vi.mocked(docData).mockImplementation(ref => {
        if (ref.path.endsWith('/availability/restore')) return source === 'availability' ? pendingRead : of(undefined);
        if (ref.path.endsWith('/trainingPlanState/current')) return of(undefined);
        return pendingRead;
      });
      vi.mocked(collectionData).mockReturnValue(source === 'workouts' ? new Subject() : of([]));
      const result = firstValueFrom(service.watchCalendarSchedule('owner', '2026-10-05', '2026-10-11'));
      const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(3 * TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS + 2000);
      await rejected;
    } finally { vi.useRealTimers(); }
  });
  it('bounds an incomplete completion batch and keeps an acknowledged idle stream live', async () => {
    vi.useFakeTimers();
    try {
      const pendingBatch = new Subject<Record<string, unknown>[]>();
      vi.mocked(collectionData).mockReturnValueOnce(of([])).mockReturnValueOnce(pendingBatch);
      const result = firstValueFrom(service.watchWorkoutCompletionsForWorkouts('owner', Array.from({ length: 31 }, (_, i) => `w${i}`)));
      const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS); await rejected;
      expect(pendingBatch.observed).toBe(false);
      const ready = new Subject<Record<string, unknown>[]>(); vi.mocked(collectionData).mockReturnValue(ready);
      const observed: unknown[] = []; const failed = vi.fn();
      const subscription = service.watchWorkoutCompletionsForWorkouts('owner', ['w1']).subscribe({ next: value => observed.push(value), error: failed });
      ready.next([]); await vi.advanceTimersByTimeAsync(2 * TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS);
      expect(observed).toEqual([[]]); expect(failed).not.toHaveBeenCalled(); expect(subscription.closed).toBe(false);
      subscription.unsubscribe();
    } finally { vi.useRealTimers(); }
  });
  it('reads completion by exact ID in bounded batches, never by the old scheduled date', async () => {
    vi.mocked(collectionData).mockReturnValue(of([]));
    await firstValueFrom(service.watchWorkoutCompletionsForWorkouts('owner', Array.from({ length: 31 }, (_, i) => `w${i}`)));
    expect(collectionData).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledWith('__name__', 'in', expect.arrayContaining(['w0']));
    expect(where).not.toHaveBeenCalledWith('scheduledLocalDate', expect.anything(), expect.anything());
    expect(limit).toHaveBeenCalledWith(30);
  });
  it('propagates completion failures instead of converting failure to unlinked and avoids empty queries', async () => {
    await expect(firstValueFrom(service.watchWorkoutCompletionsForWorkouts('owner', []))).resolves.toEqual([]);
    expect(collectionData).not.toHaveBeenCalled();
    vi.mocked(collectionData).mockReturnValue(throwError(() => new Error('denied')));
    await expect(firstValueFrom(service.watchWorkoutCompletionsForWorkouts('owner', ['w1']))).rejects.toThrow('denied');
  });
});
