import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, filter, firstValueFrom, of } from 'rxjs';
import { createHash, webcrypto } from 'node:crypto';
import { defaultAppliedTrainingLoadPolicy, type TrainingLoadMetadata } from '@shared/training-load-policy';
import { serializeTrainingLoadSource } from '@shared/training-load-source';
import { collectionData, Firestore, runTransaction } from 'app/firebase/firestore';
import { AppUserService } from './app.user.service';
import { TrainingLoadService } from './training-load.service';
import { ActivityCalendarService } from './activity-calendar.service';
import { AppEventService } from './app.event.service';
import type { User } from '@sports-alliance/sports-lib';

vi.mock('app/firebase/firestore', async importOriginal => ({ ...await importOriginal<any>(),
  doc: vi.fn((...parts: any[]) => ({ path: parts.slice(1).join('/') })),
  serverTimestamp: vi.fn(() => 'SERVER_TIME'), runTransaction: vi.fn(), collectionData: vi.fn(),
  collection: vi.fn((...parts: unknown[]) => parts.slice(1).join('/')), query: vi.fn((...parts: unknown[]) => parts),
  where: vi.fn((...parts: unknown[]) => parts), limit: vi.fn(value => value),
}));
describe('TrainingLoadService', () => {
  let service: TrainingLoadService;
  let records: Record<string, any>;
  const update = vi.fn(); const set = vi.fn(); const watchEventDocumentsBy = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', webcrypto);
    records = { 'users/u/events/e': {}, 'users/u/events/e/metaData/trainingLoad': {
      version: 1, revision: 4, excluded: false, controls: { leg: { override: 22 }, other: { included: false } },
    } };
    vi.mocked(runTransaction).mockImplementation(async (_db, callback: any) => callback({
      get: async (ref: any) => ({ exists: () => !!records[ref.path], data: () => records[ref.path] }), update, set,
    }));
    TestBed.configureTestingModule({ providers: [TrainingLoadService, { provide: Firestore, useValue: {} },
      { provide: AppUserService, useValue: { user$: of({ uid: 'u' }) } },
      ActivityCalendarService, { provide: AppEventService, useValue: { watchEventDocumentsBy } }] });
    service = TestBed.inject(TrainingLoadService);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('uses the backend source fingerprint in the browser and preserves explicit exclusion while sources update', async () => {
    const data = { startDate: new Date(1000), endDate: new Date(3601000), stats: { 'Training Stress Score': 9 } };
    const metadata = { version: 1 as const, revision: 1, excluded: false, controls: {},
      parentFingerprint: createHash('sha256').update(serializeTrainingLoadSource(data)).digest('hex') };
    vi.spyOn(service, 'watch').mockReturnValue(of(metadata));
    const event = { getID: () => 'e', getActivities: () => [], stats: data.stats, toJSON: () => data } as never;
    expect((await firstValueFrom(service.watchEffective('u', [event]))).get('e')).toMatchObject({ score: 9 });
    data.stats['Training Stress Score'] = 87.3;
    expect((await firstValueFrom(service.watchEffective('u', [event]))).get('e')).toMatchObject({ score: null, reasons: ['source-updating'] });
    metadata.excluded = true;
    expect((await firstValueFrom(service.watchEffective('u', [event]))).get('e')).toMatchObject({ score: 0, status: 'excluded' });
  });
  const parent = { startDate: 1000, endDate: 3601000, stats: { 'Training Stress Score': 9 } };
  const child = { ...parent, id: 'leg', eventID: 'e', type: 'Walking' };
  const fingerprint = (data: typeof parent) => createHash('sha256').update(serializeTrainingLoadSource(data)).digest('hex');
  const parsedMetadata = (): TrainingLoadMetadata => ({ version: 1, revision: 1, excluded: false, controls: {},
    parentFingerprint: fingerprint(parent), legs: { saved: { activityId: 'leg', sourceFingerprint: fingerprint(child),
      identity: { startMs: 1000, endMs: 3601000, type: 'Walking', duration: 3600, distance: null },
      evaluations: null, recordedTss: 9, policy: defaultAppliedTrainingLoadPolicy('Walking') } } });
  const summaryEvent = { getID: () => 'e', getActivities: () => [], toJSON: () => parent, stats: parent.stats } as never;

  it('resolves real Calendar summaries for legacy and parsed workouts without changing recorded stats', async () => {
    watchEventDocumentsBy.mockReturnValue(of([{ ...parent, id: 'e', name: 'Recovery walk' }]));
    const [event] = await firstValueFrom(TestBed.inject(ActivityCalendarService).watchEvents(
      { uid: 'u' } as User, { startMs: 1, endExclusiveMs: 4000000 }));
    const watch = vi.spyOn(service, 'watch').mockReturnValue(of(null));
    expect((await firstValueFrom(service.watchEffective('u', [event]))).get('e')?.score).toBe(9);
    const metadata = parsedMetadata(); metadata.controls.saved = { override: 0 };
    watch.mockReturnValue(of(metadata)); vi.mocked(collectionData).mockReturnValue(of([child]));
    const result = await firstValueFrom(service.watchEffective('u', [event]).pipe(filter(values => values.get('e')?.status === 'available')));
    expect(result.get('e')).toMatchObject({ score: 0, status: 'available', method: 'OVERRIDE' });
    expect(event.getStat('Training Stress Score')?.getValue()).toBe(9);
  });

  it('fails when a selected workout exceeds the bounded child query', async () => {
    vi.spyOn(service, 'watch').mockReturnValue(of(parsedMetadata()));
    vi.mocked(collectionData).mockReturnValue(of(Array.from({ length: 101 }, (_, i) => ({ ...child, id: `leg-${i}` }))));
    await expect(firstValueFrom(service.watchEffective('u', [summaryEvent]))).rejects.toThrow('Too many workout legs');
  });

  it('observes legacy override siblings without querying untouched legacy history', async () => {
    vi.spyOn(service, 'watch').mockReturnValue(of({ version: 1, revision: 1, excluded: false,
      controls: { leg: { override: 0 } } }));
    const children$ = new BehaviorSubject([child, { ...child, id: 'other' }]);
    vi.mocked(collectionData).mockReturnValue(children$);
    const scores: Array<number | null | undefined> = [];
    const subscription = service.watchEffective('u', [summaryEvent]).subscribe(values => scores.push(values.get('e')?.score));
    await vi.waitFor(() => expect(scores.at(-1)).toBe(9));
    children$.next([child, { ...child, id: 'other', stats: { 'Training Stress Score': 20 } }]);
    await vi.waitFor(() => expect(scores.at(-1)).toBe(20));
    subscription.unsubscribe(); expect(children$.observed).toBe(false);
  });

  it('checks loaded leg sources without reading them again', async () => {
    const metadata = parsedMetadata(); vi.spyOn(service, 'watch').mockReturnValue(of(metadata));
    const source = { ...child, stats: { Duration: 3000 } };
    const event = { getID: () => 'e', stats: parent.stats, toJSON: () => parent,
      getActivities: () => [{ getID: () => 'leg', type: 'Walking', getStat: () => undefined, toJSON: () => source }] } as never;
    expect((await firstValueFrom(service.watchEffective('u', [event]))).get('e')).toMatchObject({ score: null, reasons: ['source-updating'] });
    expect(collectionData).not.toHaveBeenCalled();
    metadata.excluded = true;
    expect((await firstValueFrom(service.watchEffective('u', [event]))).get('e')).toMatchObject({ score: 0, status: 'excluded' });
  });

  it('watches bounded selected-workout legs for summary events and releases the listener', async () => {
    const metadata$ = new BehaviorSubject(parsedMetadata()); vi.spyOn(service, 'watch').mockReturnValue(metadata$);
    const children$ = new BehaviorSubject([child]); vi.mocked(collectionData).mockReturnValue(children$);
    const loads: unknown[] = [];
    const subscription = service.watchEffective('u', [summaryEvent]).subscribe(values => loads.push(values.get('e')));
    await vi.waitFor(() => expect(loads.at(-1)).toMatchObject({ score: 9 }));
    expect(collectionData).toHaveBeenCalledWith(['users/u/activities', ['eventID', '==', 'e'], 101], { idField: 'id' });
    children$.next([{ ...child, stats: { 'Training Stress Score': 20 } }]);
    await vi.waitFor(() => expect(loads.at(-1)).toMatchObject({ score: null, reasons: ['source-updating'] }));
    const beforeDelete = loads.length;
    children$.next([]);
    await vi.waitFor(() => {
      expect(loads.length).toBeGreaterThan(beforeDelete);
      expect(loads.at(-1)).toMatchObject({ score: null, reasons: ['source-updating'] });
    });
    children$.next([child]);
    await vi.waitFor(() => expect(loads.at(-1)).toMatchObject({ score: 9 }));
    metadata$.next({ ...parsedMetadata(), excluded: true });
    await vi.waitFor(() => expect(loads.at(-1)).toMatchObject({ score: 0, status: 'excluded' }));
    expect(children$.observed).toBe(false);
    subscription.unsubscribe(); expect(metadata$.observed).toBe(false);
  });

  it.each([null, { ...parsedMetadata(), sourceWritePending: true }, { ...parsedMetadata(), excluded: true }])(
    'skips source reads for untouched legacy, pending and excluded workouts', async metadata => {
      vi.spyOn(service, 'watch').mockReturnValue(of(metadata));
      await firstValueFrom(service.watchEffective('u', [summaryEvent]));
      expect(collectionData).not.toHaveBeenCalled();
    });

  it('replaces the controls map so a single reset removes its old override without changing siblings', async () => {
    await service.save('u', 'e', 4, { key: 'leg', control: null });
    expect(update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      revision: 5, controls: { other: { included: false } }, updatedAt: 'SERVER_TIME' }));
    expect(set).not.toHaveBeenCalled();
  });
  it('does not advance the load timestamp for a semantic no-op', async () => {
    await service.save('u', 'e', 4, { excluded: false });
    expect(update).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
  });
  it('refuses stale revisions and deleted workouts', async () => {
    await expect(service.save('u', 'e', 3, { excluded: true })).rejects.toThrow('changed elsewhere');
    delete records['users/u/events/e'];
    await expect(service.save('u', 'e', 4, { excluded: true })).rejects.toThrow('no longer exists');
    expect(update).not.toHaveBeenCalled();
  });
  it('accepts a zero override, rejects out-of-range scores, and copies only the supplied future preferences', async () => {
    await service.save('u', 'e', 4, { key: 'leg', control: { override: 0, method: 'HR', included: true } },
      { family: 'walking-hiking', expectedRevision: 0, policy: { method: 'HR', included: true } });
    expect(update.mock.calls[0][1].controls.leg.override).toBe(0);
    expect(set).toHaveBeenCalledTimes(2);
    for (const [, policy] of set.mock.calls) {
      expect(policy).toMatchObject({ revision: 1, method: 'HR', included: true, effectiveAt: 'SERVER_TIME' });
      expect(policy).not.toHaveProperty('override');
    }
    await expect(service.save('u', 'e', 4, { key: 'leg', control: { override: -1 } })).rejects.toThrow('between 0 and 9999');
  });
});
