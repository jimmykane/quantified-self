import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import { Firestore, collectionData, docData, getDoc as getCachedDoc } from 'app/firebase/firestore';
import { getFirestore, getDoc } from 'firebase/firestore/lite';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { TrainingPlansService, TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS, type CurrentTrainingScheduleV1 } from './training-plans.service';

vi.mock('app/firebase/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_db, ...path: string[]) => path.join('/')),
  doc: vi.fn((_db, ...path: string[]) => ({ path: path.join('/') })),
  query: vi.fn((path, ...constraints) => ({ path, constraints })),
  where: vi.fn((...args) => ({ where: args })),
  collectionData: vi.fn(), docData: vi.fn(), getDoc: vi.fn(),
}));
vi.mock('firebase/firestore/lite', () => ({
  getFirestore: vi.fn(() => ({ transport: 'uncached' })),
  doc: vi.fn((_db, ...path: string[]) => ({ path: path.join('/') })),
  getDoc: vi.fn(),
}));

describe('current Training schedule-state reads', () => {
  const app = {};
  const state = { schemaVersion: 1, activePlanId: null, revision: 253, currentWorkoutCount: 0, updatedAtMs: 1 };
  let stateSignals: Subject<Record<string, unknown> | undefined>;
  let availability: Subject<Record<string, unknown> | undefined>;
  let serverState: Record<string, unknown> | undefined;
  let service: TrainingPlansService;

  beforeEach(() => {
    vi.clearAllMocks();
    stateSignals = new Subject(); availability = new Subject(); serverState = state;
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? availability : stateSignals);
    vi.mocked(collectionData).mockReturnValue(of([]));
    vi.mocked(getDoc).mockImplementation(async () => ({ data: () => serverState }) as Awaited<ReturnType<typeof getDoc>>);
    TestBed.configureTestingModule({ providers: [TrainingPlansService,
      { provide: Firestore, useValue: { app } }, { provide: AppFunctionsService, useValue: {} },
      { provide: BrowserCompatibilityService, useValue: {} }] });
    service = TestBed.inject(TrainingPlansService);
  });

  it('verifies an incorrect missing watch through the same app before publishing any revision', async () => {
    const observed: CurrentTrainingScheduleV1[] = [];
    const subscription = service.watchSchedule('owner').subscribe(value => observed.push(value));
    availability.next(undefined); stateSignals.next(undefined);
    expect(observed).toEqual([]);
    await vi.waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0].state).toEqual(state);
    expect(getFirestore).toHaveBeenCalledWith(app);
    expect(getDoc).toHaveBeenCalledWith({ path: 'users/owner/trainingPlanState/current' });
    expect(docData).toHaveBeenCalledWith({ path: 'users/owner/trainingPlanState/current' }, { waitForServer: true });
    serverState = { ...state, revision: 254 }; stateSignals.next(undefined);
    await vi.waitFor(() => expect(observed[1]?.state.revision).toBe(254));
    expect(getCachedDoc).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('shares the live owner stream instead of adding one server verification per consumer', async () => {
    const stream = service.watchSchedule('owner');
    expect(service.watchSchedule('owner')).toBe(stream);
    const first = stream.subscribe(); const second = stream.subscribe();
    availability.next(undefined); stateSignals.next(state);
    await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
    first.unsubscribe(); second.unsubscribe();
  });

  it('allows zero only when REST independently confirms an absent state', async () => {
    serverState = undefined;
    const pending = firstValueFrom(service.watchSchedule('owner'));
    availability.next(undefined); stateSignals.next(state);
    expect((await pending).state.revision).toBe(0);
  });

  it('does not start Training data listeners while restore availability is present', async () => {
    const pending = firstValueFrom(service.watchSchedule('owner'));
    availability.next({ schemaVersion: 1, status: 'restoring' });
    expect(await pending).toMatchObject({ restoreUnavailable: true, workouts: [] });
    expect(collectionData).not.toHaveBeenCalled(); expect(getDoc).not.toHaveBeenCalled();
  });

  it.each(['malformed', 'failed'] as const)('rejects a %s state verification instead of returning an empty schedule', async failure => {
    vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? availability : of(undefined));
    if (failure === 'malformed') serverState = { revision: 253 };
    else vi.mocked(getDoc).mockRejectedValue(new Error('Unavailable'));
    vi.mocked(getCachedDoc).mockResolvedValue({ exists: () => false } as never);
    const pending = firstValueFrom(service.watchSchedule('owner'));
    const rejected = expect(pending).rejects.toThrow();
    availability.next(undefined);
    await rejected;
  });

  it('cannot publish a late verification after the consumer unsubscribes', async () => {
    let finish!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
    vi.mocked(getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const observed: CurrentTrainingScheduleV1[] = [];
    const subscription = service.watchSchedule('owner').subscribe(value => observed.push(value));
    availability.next(undefined); stateSignals.next(undefined);
    await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
    subscription.unsubscribe(); finish({ data: () => state } as Awaited<ReturnType<typeof getDoc>>);
    await Promise.resolve();
    expect(observed).toEqual([]);
  });

  it('ignores a superseded verification rather than regressing the live revision', async () => {
    let finish!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
    vi.mocked(getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const observed: CurrentTrainingScheduleV1[] = [];
    const subscription = service.watchSchedule('owner').subscribe(value => observed.push(value));
    availability.next(undefined); stateSignals.next(undefined);
    await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
    serverState = { ...state, revision: 254 }; stateSignals.next(undefined);
    await vi.waitFor(() => expect(observed[0]?.state.revision).toBe(254));
    finish({ data: () => state } as Awaited<ReturnType<typeof getDoc>>); await Promise.resolve();
    expect(observed.map(value => value.state.revision)).toEqual([254]);
    subscription.unsubscribe();
  });

  it('bounds stalled verification and keeps timed-out results out of the schedule', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
      const read = new Promise<Awaited<ReturnType<typeof getDoc>>>(resolve => { finish = resolve; });
      vi.mocked(getDoc).mockReturnValue(read);
      vi.mocked(getCachedDoc).mockResolvedValue({ exists: () => false } as never);
      vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? availability : of(undefined));
      const pending = firstValueFrom(service.watchSchedule('owner'));
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      availability.next(undefined);
      // The existing schedule retry policy permits two bounded retries.
      await vi.advanceTimersByTimeAsync(3 * TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS + 2000);
      await rejected;
      finish({ data: () => state } as Awaited<ReturnType<typeof getDoc>>);
      await vi.advanceTimersByTimeAsync(0);
      expect(getDoc).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('bounds a watch that never acknowledges the state instead of loading forever', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getCachedDoc).mockResolvedValue({ exists: () => false } as never);
      const pending = firstValueFrom(service.watchSchedule('owner'));
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      availability.next(undefined);
      await vi.advanceTimersByTimeAsync(3 * TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS + 2000);
      await rejected;
      expect(getDoc).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it.each(['availability', 'plans', 'workouts'] as const)('bounds a stalled initial %s read', async source => {
    vi.useFakeTimers();
    try {
      vi.mocked(getCachedDoc).mockResolvedValue({ exists: () => false } as never);
      if (source !== 'availability') {
        vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? availability : of(undefined));
        const stalled$ = new Subject<Record<string, unknown>[]>();
        vi.mocked(collectionData).mockImplementation(ref => {
          const path = typeof ref === 'string' ? ref : (ref as unknown as { path: string }).path;
          return path.endsWith(source === 'plans' ? '/trainingPlans' : '/scheduledWorkouts') ? stalled$ : of([]);
        });
      }
      const pending = firstValueFrom(service.watchSchedule('owner'));
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      if (source !== 'availability') availability.next(undefined);
      await vi.advanceTimersByTimeAsync(source === 'availability'
        ? TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS : 3 * TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS + 2000);
      await rejected;
      if (source === 'availability') {
        expect(collectionData).not.toHaveBeenCalled();
        expect(getDoc).not.toHaveBeenCalled();
      }
    } finally { vi.useRealTimers(); }
  });

  it('does not time out an acknowledged restore that takes longer than the read deadline', async () => {
    vi.useFakeTimers();
    try {
      const observed: CurrentTrainingScheduleV1[] = [];
      const failed = vi.fn();
      const subscription = service.watchSchedule('owner').subscribe({ next: value => observed.push(value), error: failed });
      availability.next({ schemaVersion: 1, status: 'restoring' });
      await vi.advanceTimersByTimeAsync(3 * TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS);
      expect(subscription.closed).toBe(false);
      expect(failed).not.toHaveBeenCalled();
      expect(observed).toHaveLength(1);
      expect(observed[0].restoreUnavailable).toBe(true);
      expect(getDoc).not.toHaveBeenCalled();
      availability.next(undefined); stateSignals.next(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(observed[1]?.state.revision).toBe(253);
      subscription.unsubscribe();
    } finally { vi.useRealTimers(); }
  });

  it('recovers a stalled list on retry and keeps its later idle subscription alive', async () => {
    vi.useFakeTimers();
    try {
      const workouts$ = new Subject<Record<string, unknown>[]>();
      vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? availability : of(undefined));
      vi.mocked(collectionData).mockImplementation(ref => typeof ref === 'string' ? of([]) : workouts$);
      const observed: CurrentTrainingScheduleV1[] = [];
      const failed = vi.fn();
      const subscription = service.watchSchedule('owner').subscribe({ next: value => observed.push(value), error: failed });
      availability.next(undefined);
      await vi.advanceTimersByTimeAsync(TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS + 1000);
      expect(observed).toEqual([]);
      expect(getDoc).toHaveBeenCalledTimes(2);
      workouts$.next([]); await vi.advanceTimersByTimeAsync(0);
      expect(observed[0]?.state.revision).toBe(253);
      await vi.advanceTimersByTimeAsync(2 * TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS);
      expect(subscription.closed).toBe(false);
      expect(failed).not.toHaveBeenCalled();
      expect(getCachedDoc).not.toHaveBeenCalled();
      subscription.unsubscribe();
    } finally { vi.useRealTimers(); }
  });

  it('bounds the final restore-fence lookup after a failed verification', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(docData).mockImplementation(ref => ref.path.endsWith('/availability/restore') ? availability : of(undefined));
      vi.mocked(getDoc).mockRejectedValue(new Error('Unavailable'));
      vi.mocked(getCachedDoc).mockReturnValue(new Promise(() => {}));
      const pending = firstValueFrom(service.watchSchedule('owner'));
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      availability.next(undefined);
      await vi.advanceTimersByTimeAsync(TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS + 2000);
      await rejected;
      expect(getCachedDoc).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('keeps a healthy acknowledged watch alive when the schedule is idle', async () => {
    vi.useFakeTimers();
    try {
      const observed: CurrentTrainingScheduleV1[] = [];
      const failed = vi.fn();
      const subscription = service.watchSchedule('owner').subscribe({ next: value => observed.push(value), error: failed });
      availability.next(undefined); stateSignals.next(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(observed[0]?.state.revision).toBe(253);
      await vi.advanceTimersByTimeAsync(2 * TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS);
      expect(subscription.closed).toBe(false);
      expect(failed).not.toHaveBeenCalled();
      serverState = { ...state, revision: 254 }; stateSignals.next(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(observed.map(value => value.state.revision)).toEqual([253, 254]);
      subscription.unsubscribe();
    } finally { vi.useRealTimers(); }
  });

  it('discards a pending state verification when a restore fence arrives', async () => {
    let finish!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
    vi.mocked(getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const observed: CurrentTrainingScheduleV1[] = [];
    const subscription = service.watchSchedule('owner').subscribe(value => observed.push(value));
    availability.next(undefined); stateSignals.next(undefined);
    await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
    availability.next({ schemaVersion: 1, status: 'restoring' });
    expect(observed).toHaveLength(1);
    expect(observed[0].restoreUnavailable).toBe(true);
    finish({ data: () => state } as Awaited<ReturnType<typeof getDoc>>); await Promise.resolve();
    expect(observed).toHaveLength(1);
    serverState = { ...state, revision: 254 }; availability.next(undefined); stateSignals.next(undefined);
    await vi.waitFor(() => expect(observed[1]?.state.revision).toBe(254));
    expect(observed[1].restoreUnavailable).toBeUndefined();
    subscription.unsubscribe();
  });

  it('makes no Firestore reads without an owner', async () => {
    expect((await firstValueFrom(service.watchSchedule(null))).state.revision).toBe(0);
    expect(collectionData).not.toHaveBeenCalled(); expect(docData).not.toHaveBeenCalled(); expect(getDoc).not.toHaveBeenCalled();
  });
});
