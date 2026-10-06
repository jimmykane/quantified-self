import { TestBed } from '@angular/core/testing';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
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
