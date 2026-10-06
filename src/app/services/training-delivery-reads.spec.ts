import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import { Firestore, collectionData, docData, query, where, limit } from 'app/firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { AppUserService } from './app.user.service';
import { TrainingDeliveryService, TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS, TRAINING_DELIVERY_SUMMARY_LIMIT } from './training-delivery.service';

vi.mock('app/firebase/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_db, ...path) => path.join('/')),
  doc: vi.fn((_db, ...path) => path.join('/')),
  query: vi.fn((path, ...constraints) => ({ path, constraints })),
  where: vi.fn((...args) => ({ where: args })),
  limit: vi.fn(count => ({ limit: count })),
  orderBy: vi.fn(field => ({ orderBy: field })),
  collectionData: vi.fn(), docData: vi.fn(),
}));

describe('Training summary read bounds and ownership', () => {
  const call = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); vi.mocked(collectionData).mockReturnValue(of([])); vi.mocked(docData).mockReturnValue(of(undefined));
    TestBed.configureTestingModule({ providers: [TrainingDeliveryService,
      { provide: Firestore, useValue: {} }, { provide: AppFunctionsService, useValue: { call } },
      { provide: BrowserCompatibilityService, useValue: {} }, { provide: AppUserService, useValue: { user: signal({ uid: 'owner' }) } },
    ] });
  });
  it('uses one full-plan bounded query independently from the dialog page size', async () => {
    const service = TestBed.inject(TrainingDeliveryService);
    expect(await firstValueFrom(service.watchSummaryScope('owner', 'plan', 'p', null)))
      .toEqual({ settings: [], statuses: [], verifications: [], summaryComplete: true });
    expect(TRAINING_DELIVERY_SUMMARY_LIMIT).toBe(1601);
    expect(limit).toHaveBeenCalledWith(1601); expect(where).toHaveBeenCalledWith('planId', '==', 'p');
    expect(collectionData).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledWith('associationPlanId', '==', 'p');
    expect(query).toHaveBeenCalledWith('users/owner/trainingDeliveryStatuses', expect.anything(), expect.anything(), expect.anything());
    expect(docData).toHaveBeenCalledTimes(4); expect(call).not.toHaveBeenCalled();
  });
  it('reads verification only for the bounded details page, without invoking a provider check', async () => {
    const view = await firstValueFrom(TestBed.inject(TrainingDeliveryService).watchScope('owner', 'plan', 'p', 25));
    expect(view.verifications).toEqual([]);
    expect(query).toHaveBeenCalledWith('users/owner/trainingDeliveryVerifications',
      { where: ['planId', '==', 'p'] }, { orderBy: '__name__' }, { limit: 25 });
    expect(collectionData).toHaveBeenCalledTimes(2);
    expect(call).not.toHaveBeenCalled();
  });
  it('reads the bounded workout verification and parent settings, not sibling workouts', async () => {
    await firstValueFrom(TestBed.inject(TrainingDeliveryService).watchSummaryScope('owner', 'workout', 'w', 'p'));
    expect(where).toHaveBeenCalledWith('workoutId', '==', 'w'); expect(where).not.toHaveBeenCalledWith('planId', '==', 'p');
    expect(collectionData).toHaveBeenCalledTimes(2); expect(docData).toHaveBeenCalledTimes(8);
    expect(query).toHaveBeenCalledWith('users/owner/trainingDeliveryVerifications',
      { where: ['workoutId', '==', 'w'] }, { orderBy: '__name__' }, { limit: TRAINING_DELIVERY_SUMMARY_LIMIT });
    expect(vi.mocked(docData).mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([
      'users/owner/trainingDeliverySettings/workout_w_garmin', 'users/owner/trainingDeliverySettings/plan_p_garmin',
    ]));
    expect(call).not.toHaveBeenCalled();
  });
  it('does not touch Firestore for an absent owner', async () => {
    await firstValueFrom(TestBed.inject(TrainingDeliveryService).watchSummaryScope('', 'workout', 'w', 'p'));
    expect(collectionData).not.toHaveBeenCalled(); expect(docData).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  });
  it.each(['plan', 'workout', 'history'] as const)('waits for server confirmation in every %s presence and detail read', async scope => {
    const service = TestBed.inject(TrainingDeliveryService);
    await firstValueFrom(service.watchPresence('owner', scope, 'p'));
    await firstValueFrom(service.watchScope('owner', scope, 'p'));
    expect(vi.mocked(collectionData).mock.calls.every(([, options]) => options?.waitForServer === true)).toBe(true);
    expect(vi.mocked(docData).mock.calls.every(([, options]) => options?.waitForServer === true)).toBe(true);
  });
  it('waits for all exact provider documents and keeps subsequent MCP settings changes live', () => {
    const reads = new Map<string, Subject<Record<string, unknown> | undefined>>();
    vi.mocked(docData).mockImplementation(ref => {
      const stream = new Subject<Record<string, unknown> | undefined>(); reads.set(String(ref), stream); return stream;
    });
    const observed: unknown[] = [];
    const subscription = TestBed.inject(TrainingDeliveryService).watchScope('owner', 'workout', 'w').subscribe(view => observed.push(view));
    expect(observed).toEqual([]);
    for (const [path, stream] of reads) if (!path.endsWith('_garmin')) stream.next(undefined);
    expect(observed).toEqual([]);
    const setting = { schemaVersion: 1, scope: 'workout', scopeId: 'w', provider: 'garmin', revision: 134,
      enabled: true, suppressed: false, timeZone: 'UTC', destinationKey: 'safe', connectionEpoch: 1, scopeGeneration: 1,
      associationPlanId: null, approvedDigest: null, updatedAtMs: 10 };
    reads.get('users/owner/trainingDeliverySettings/workout_w_garmin')!.next(setting);
    expect(observed).toEqual([{ settings: [setting], statuses: [], verifications: [] }]);
    reads.get('users/owner/trainingDeliverySettings/workout_w_garmin')!.next({ ...setting, enabled: false, revision: 135 });
    expect(observed).toHaveLength(2);
    expect(observed[1]).toMatchObject({ settings: [{ enabled: false, revision: 135 }] });
    expect(vi.mocked(docData).mock.calls.every(([, options]) => options?.waitForServer === true)).toBe(true);
    expect(call).not.toHaveBeenCalled(); subscription.unsubscribe();
  });
  it('rejects a valid setting stored under the wrong exact document', async () => {
    vi.mocked(docData).mockReturnValue(of({ schemaVersion: 1, scope: 'workout', scopeId: 'other', provider: 'garmin', revision: 134,
      enabled: true, suppressed: false, timeZone: 'UTC', destinationKey: 'safe', connectionEpoch: 1, scopeGeneration: 1,
      associationPlanId: null, approvedDigest: null, updatedAtMs: 10 }));
    await expect(firstValueFrom(TestBed.inject(TrainingDeliveryService).watchScope('owner', 'workout', 'w')))
      .rejects.toThrow('do not match');
    expect(call).not.toHaveBeenCalled();
  });
  it('bounds incomplete server reads rather than leaving sync actions loading indefinitely', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(docData).mockReturnValue(new Subject());
      const pending = firstValueFrom(TestBed.inject(TrainingDeliveryService).watchScope('owner', 'workout', 'w'));
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS); await rejected;
      expect(call).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('withholds complete totals when the plan-override look-ahead reaches its bound', async () => {
    const override = { schemaVersion: 1, scope: 'workout', scopeId: 'w', provider: 'garmin', revision: 1,
      enabled: false, suppressed: true, timeZone: 'UTC', destinationKey: 'safe', connectionEpoch: 0, scopeGeneration: 1,
      associationPlanId: 'p', approvedDigest: null, updatedAtMs: 10 };
    vi.mocked(collectionData).mockImplementation(ref => of((ref as unknown as { path: string }).path.endsWith('trainingDeliverySettings')
      ? Array.from({ length: TRAINING_DELIVERY_SUMMARY_LIMIT }, () => override) : []));
    const view = await firstValueFrom(TestBed.inject(TrainingDeliveryService).watchSummaryScope('owner', 'plan', 'p', null));
    expect(view.summaryComplete).toBe(false); expect(view.settings[0].suppressed).toBe(true);
  });
});
