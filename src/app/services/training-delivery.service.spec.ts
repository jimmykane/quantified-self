import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Firestore, getDocFromServer } from 'app/firebase/firestore';
import { getFirestore, getDoc } from 'firebase/firestore/lite';
import type { TrainingDeliveryCommandV1 } from '@shared/training-provider-delivery';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { isTrainingDeliverySetupAvailableInApp, TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS, TrainingDeliveryService } from './training-delivery.service';
import { AppUserService } from './app.user.service';

vi.mock('app/firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('app/firebase/firestore')>(),
  doc: vi.fn((_db, ...path: string[]) => ({ path: path.join('/') })),
  getDocFromServer: vi.fn(),
}));
vi.mock('firebase/firestore/lite', () => ({
  getFirestore: vi.fn(() => ({ transport: 'uncached' })),
  doc: vi.fn((_db, ...path: string[]) => ({ path: path.join('/') })),
  getDoc: vi.fn(),
}));

const state = { schemaVersion: 1, activePlanId: null, revision: 1, currentWorkoutCount: 1, updatedAtMs: 1 };
const workout = { schemaVersion: 1, id: 'workout', planId: null, localDate: '2026-10-10', lifecycle: 'planned',
  title: 'Test workout', revision: 1, createdAtMs: 1, updatedAtMs: 1,
  structure: { version: 1, sport: 'Running', nodes: [{ kind: 'step', id: 'work', purpose: 'work',
    ending: { kind: 'time', seconds: 300 }, targets: [] }] } };
const settings = { schemaVersion: 1, scope: 'workout', scopeId: 'workout', provider: 'garmin', revision: 134,
  enabled: true, suppressed: false, timeZone: 'UTC', destinationKey: 'safe', connectionEpoch: 1, scopeGeneration: 1,
  associationPlanId: null, approvedDigest: null, updatedAtMs: 1 };
const command: TrainingDeliveryCommandV1 = { schemaVersion: 1, scope: 'workout', scopeId: 'workout', provider: 'garmin',
  mutationId: 'request', action: 'stop', expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: 0 };
const app = {};
const snapshot = (data: unknown) =>
  ({ exists: () => data !== undefined, data: () => data }) as Awaited<ReturnType<typeof getDoc>>;

describe('TrainingDeliveryService boundary', () => {
  let documents: Map<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks();
    documents = new Map([['users/owner/trainingPlanState/current', state], ['users/owner/scheduledWorkouts/workout', workout]]);
    vi.mocked(getDoc).mockImplementation(async ref => snapshot(documents.get(ref.path)));
  });
  it('reacts to public provider readiness, account changes and sign-out without sending consent or delivery work', async () => {
    const call = vi.fn(async (_name: string, _payload: unknown, _options?: { canExecute: () => boolean }) => ({ data: { schemaVersion: 1 } }));
    const user = signal<{ uid: string } | null>(null);
    TestBed.configureTestingModule({ providers: [TrainingDeliveryService,
      { provide: Firestore, useValue: { app } }, { provide: AppFunctionsService, useValue: { call } },
      { provide: BrowserCompatibilityService, useValue: { createRandomUUID: () => 'mutation-id' } },
      { provide: AppUserService, useValue: { user } },
    ] });
    const service = TestBed.inject(TrainingDeliveryService);
    expect(service.anyReady()).toBe(false);
    for (const provider of ['garmin', 'coros', 'wahoo', 'suunto'] as const) expect(service.isReady(provider)).toBe(false);
    user.set({ uid: 'owner' });
    expect(service.anyReady()).toBe(true);
    expect(service.isReady('garmin')).toBe(true);
    expect(service.isReady('coros')).toBe(false);
    expect(isTrainingDeliverySetupAvailableInApp('coros', user()?.uid, true)).toBe(false);
    expect(isTrainingDeliverySetupAvailableInApp('coros', user()?.uid, false)).toBe(false);
    expect(isTrainingDeliverySetupAvailableInApp('garmin', user()?.uid, true)).toBe(true);
    expect(service.isReady('suunto')).toBe(true);
    expect(service.isReady('wahoo')).toBe(true);
    user.set({ uid: 'another-user' });
    expect(service.anyReady()).toBe(true);
    expect(service.isReady('coros')).toBe(false);
    for (const provider of ['garmin', 'wahoo', 'suunto'] as const) expect(service.isReady(provider)).toBe(true);
    user.set({ uid: 'owner' });
    user.set(null);
    expect(service.anyReady()).toBe(false);
    expect(call).not.toHaveBeenCalled();
    const command = { schemaVersion: 1 as const, scope: 'workout' as const, scopeId: 'workout', provider: 'garmin' as const,
      mutationId: service.createMutationId(), action: 'stop' as const, expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: 0 };
    user.set({ uid: 'owner' });
    await service.preview(command); await service.mutate(command);
    expect(call.mock.calls.map(args => args[0])).toEqual(['previewTrainingProviderDelivery', 'mutateTrainingProviderDelivery']);
    expect(call).toHaveBeenLastCalledWith('mutateTrainingProviderDelivery', command, expect.objectContaining({ canExecute: expect.any(Function) }));
    expect(await firstValueFrom(service.watchPresence('', 'workout', 'id'))).toBe(false);
  });
  it('bounds readiness waits and fences late execution after timeout or account/view changes', async () => {
    vi.useFakeTimers();
    try {
      const user = signal<{ uid: string } | null>({ uid: 'owner' });
      const call = vi.fn((_name: string, _payload: unknown, _options?: { canExecute: () => boolean }) => new Promise(() => {}));
      TestBed.configureTestingModule({ providers: [TrainingDeliveryService,
        { provide: Firestore, useValue: { app } }, { provide: AppFunctionsService, useValue: { call } },
        { provide: BrowserCompatibilityService, useValue: {} }, { provide: AppUserService, useValue: { user } },
      ] });
      const service = TestBed.inject(TrainingDeliveryService);
      let viewOpen = true;
      const result = service.preview(command, () => viewOpen);
      const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(0);
      const guard = call.mock.calls[0][2]!.canExecute;
      expect(guard()).toBe(true);
      viewOpen = false; expect(guard()).toBe(false); viewOpen = true;
      user.set({ uid: 'other' }); expect(guard()).toBe(false); user.set({ uid: 'owner' });
      await vi.advanceTimersByTimeAsync(TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS);
      await rejected; expect(guard()).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  function configure() {
    const user = signal<{ uid: string } | null>({ uid: 'owner' });
    const call = vi.fn(async (_name: string, _payload: unknown, _options?: { canExecute: () => boolean }) => ({ data: {} }));
    TestBed.configureTestingModule({ providers: [TrainingDeliveryService,
      { provide: Firestore, useValue: { app } }, { provide: AppFunctionsService, useValue: { call } },
      { provide: BrowserCompatibilityService, useValue: {} }, { provide: AppUserService, useValue: { user } },
    ] });
    return { service: TestBed.inject(TrainingDeliveryService), user, call };
  }
  it('refreshes the exact Check revisions without changing consent or provider action', async () => {
    documents.set('users/owner/trainingPlanState/current', { ...state, revision: 20 });
    documents.set('users/owner/scheduledWorkouts/workout', { ...workout, revision: 8 });
    documents.set('users/owner/trainingDeliverySettings/workout_workout_garmin', settings);
    const { service, call } = configure();
    await service.check({ ...command, action: 'check' });
    expect(getFirestore).toHaveBeenCalledWith(app);
    expect(getDocFromServer).not.toHaveBeenCalled();
    expect(vi.mocked(getDoc).mock.calls.map(([ref]) => ref.path)).toEqual([
      'users/owner/trainingPlanState/current', 'users/owner/scheduledWorkouts/workout',
      'users/owner/trainingDeliverySettings/workout_workout_garmin',
    ]);
    expect(call).toHaveBeenCalledWith('mutateTrainingProviderDelivery', { ...command, action: 'check',
      expectedScheduleRevision: 20, expectedScopeRevision: 8, expectedSettingsRevision: 134 }, expect.anything());
    expect(documents.get('users/owner/trainingDeliverySettings/workout_workout_garmin')).toEqual(settings);
  });
  it.each(['send', 'replace', 'stop'] as const)('rejects a stale %s review without regranting consent', async action => {
    documents.set('users/owner/trainingDeliverySettings/workout_workout_garmin', settings);
    const { service, call } = configure();
    await expect(service.preview({ ...command, action })).rejects.toMatchObject({ code: 'aborted' });
    expect(call).not.toHaveBeenCalled();
  });
  it('preserves the exact approved request for an uncertain save receipt replay', async () => {
    documents.set('users/owner/trainingDeliverySettings/workout_workout_garmin', settings);
    const { service, call } = configure();
    await service.mutate(command);
    expect(getDocFromServer).not.toHaveBeenCalled();
    expect(getFirestore).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith('mutateTrainingProviderDelivery', command, expect.anything());
  });
  it('allows revision zero only for confirmed absent source/settings during retained-copy recovery', async () => {
    documents.delete('users/owner/scheduledWorkouts/workout');
    const { service, call } = configure();
    const recovery = { ...command, expectedScopeRevision: 0 };
    await service.preview(recovery);
    expect(call).toHaveBeenCalledWith('previewTrainingProviderDelivery', recovery, expect.anything());
  });
  it('reads a plan scope exactly and keeps an already-current consent review unchanged', async () => {
    documents.set('users/owner/trainingPlans/plan', { schemaVersion: 1, id: 'plan', name: 'Test plan', lifecycle: 'active',
      startLocalDate: '2026-10-10', endLocalDate: '2026-10-20', revision: 8, lastCheckpointRevision: 1,
      workoutCount: 1, createdAtMs: 1, updatedAtMs: 1 });
    documents.set('users/owner/trainingDeliverySettings/plan_plan_garmin', { ...settings, scope: 'plan', scopeId: 'plan' });
    const { service, call } = configure();
    const review: TrainingDeliveryCommandV1 = { ...command, scope: 'plan', scopeId: 'plan', action: 'configure',
      timeZone: 'UTC', expectedScopeRevision: 8, expectedSettingsRevision: 134 };
    await service.preview(review);
    expect(vi.mocked(getDoc).mock.calls.map(([ref]) => ref.path)).toContain('users/owner/trainingPlans/plan');
    expect(call).toHaveBeenCalledWith('previewTrainingProviderDelivery', review, expect.anything());
  });
  it.each(['read failure', 'invalid document', 'wrong scope', 'wrong provider'] as const)('never invents revision zero after %s', async failure => {
    const { service, call } = configure();
    if (failure === 'read failure') vi.mocked(getDoc).mockRejectedValue(new Error('Offline'));
    else documents.set('users/owner/trainingDeliverySettings/workout_workout_garmin', failure === 'invalid document'
      ? { enabled: true } : { ...settings, ...(failure === 'wrong scope' ? { scopeId: 'another-workout' } : { provider: 'wahoo' }) });
    await expect(service.check({ ...command, action: 'check' })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it.each([
    { fromCache: false, hasPendingWrites: false },
    { fromCache: false, hasPendingWrites: true },
    { fromCache: true, hasPendingWrites: false },
  ])('bypasses incorrect full-SDK absence and local overlays: %j', async metadata => {
    documents.set('users/owner/trainingPlanState/current', { ...state, revision: 253 });
    documents.set('users/owner/trainingDeliverySettings/workout_workout_garmin', settings);
    vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => false, data: () => undefined, metadata } as
      Awaited<ReturnType<typeof getDocFromServer>>);
    const { service, call } = configure();
    await service.check({ ...command, action: 'check' });
    expect(getDocFromServer).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith('mutateTrainingProviderDelivery', { ...command, action: 'check',
      expectedScheduleRevision: 253, expectedScopeRevision: 1, expectedSettingsRevision: 134 }, expect.anything());
  });
  it('uses zero for an independently confirmed missing schedule state', async () => {
    documents.delete('users/owner/trainingPlanState/current');
    const { service, call } = configure();
    await service.check({ ...command, action: 'check' });
    expect(call).toHaveBeenCalledWith('mutateTrainingProviderDelivery', { ...command, action: 'check',
      expectedScheduleRevision: 0 }, expect.anything());
  });
  it.each(['account', 'view'] as const)('fences a %s change while the uncached reader loads', async change => {
    const { service, user, call } = configure();
    let viewOpen = true;
    const pending = service.check({ ...command, action: 'check' }, () => viewOpen);
    if (change === 'account') user.set({ uid: 'other' });
    else viewOpen = false;
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(getFirestore).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });
  it('fences an account change during a server read without reading the next owner or dispatching', async () => {
    const { service, user, call } = configure();
    let finish!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
    vi.mocked(getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = service.check({ ...command, action: 'check' });
    await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(3));
    user.set({ uid: 'other' }); finish(snapshot(state));
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(call).not.toHaveBeenCalled();
    expect(vi.mocked(getDoc).mock.calls.every(([ref]) => ref.path.startsWith('users/owner/'))).toBe(true);
  });
  it('bounds server reads and prevents late dispatch after timeout', async () => {
    vi.useFakeTimers();
    try {
      const { service, call } = configure();
      let finish!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
      vi.mocked(getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = service.preview(command);
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS); await rejected;
      finish(snapshot(state)); await vi.advanceTimersByTimeAsync(0);
      expect(call).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
