import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { Firestore, collectionData, docData, query, where, limit } from 'app/firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { AppUserService } from './app.user.service';
import { TrainingDeliveryService, TRAINING_DELIVERY_SUMMARY_LIMIT } from './training-delivery.service';

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
  it('reads only parent settings alongside a plan-bound workout, not all of its siblings', async () => {
    await firstValueFrom(TestBed.inject(TrainingDeliveryService).watchSummaryScope('owner', 'workout', 'w', 'p'));
    expect(where).toHaveBeenCalledWith('workoutId', '==', 'w'); expect(where).not.toHaveBeenCalledWith('planId', '==', 'p');
    expect(collectionData).toHaveBeenCalledTimes(1); expect(docData).toHaveBeenCalledTimes(8);
    expect(vi.mocked(docData).mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([
      'users/owner/trainingDeliverySettings/workout_w_garmin', 'users/owner/trainingDeliverySettings/plan_p_garmin',
    ]));
    expect(call).not.toHaveBeenCalled();
  });
  it('does not touch Firestore for an absent owner', async () => {
    await firstValueFrom(TestBed.inject(TrainingDeliveryService).watchSummaryScope('', 'workout', 'w', 'p'));
    expect(collectionData).not.toHaveBeenCalled(); expect(docData).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
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
