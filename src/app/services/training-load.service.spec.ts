import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { createHash, webcrypto } from 'node:crypto';
import { serializeTrainingLoadSource } from '@shared/training-load-source';
import { Firestore, runTransaction } from 'app/firebase/firestore';
import { AppUserService } from './app.user.service';
import { TrainingLoadService } from './training-load.service';

vi.mock('app/firebase/firestore', async importOriginal => ({ ...await importOriginal<any>(),
  doc: vi.fn((...parts: any[]) => ({ path: parts.slice(1).join('/') })),
  serverTimestamp: vi.fn(() => 'SERVER_TIME'), runTransaction: vi.fn(),
}));
describe('TrainingLoadService', () => {
  let service: TrainingLoadService;
  let records: Record<string, any>;
  const update = vi.fn(); const set = vi.fn();
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
      { provide: AppUserService, useValue: { user$: of({ uid: 'u' }) } }] });
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
