import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, firstValueFrom, filter } from 'rxjs';
import { Auth } from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { TRAINING_GOAL_FIELDS, parseTrainingGoalFields, type TrainingGoalV1 } from '@shared/training-goals';
import { TrainingGoalsService } from './training-goals.service';
import { AppUserService } from './app.user.service';
import { AppFunctionsService } from './app.functions.service';
import { HistoryImportProgressService } from './history-import-progress.service';
const mocks = vi.hoisted(() => ({ data: vi.fn(), transaction: vi.fn() }));
vi.mock('app/firebase/firestore', () => ({ Firestore: class {}, collection: (_db: unknown, ...path: string[]) => path.join('/'),
  doc: (_db: unknown, ...path: string[]) => path.join('/'), query: (value: unknown) => value, limit: (value: number) => value,
  collectionData: mocks.data, runTransaction: mocks.transaction }));
const goal: TrainingGoalV1 = { schemaVersion: 1, id: 'goal', name: 'Stay consistent', kind: 'ongoing', lifecycle: 'active', priority: 'normal',
  startLocalDate: '2026-11-01', targetLocalDate: null, sportScope: 'all', sport: null, objective: '', planId: null,
  weeklyTarget: { kind: 'days', value: 3 }, revision: 1, createdAtMs: 1, updatedAtMs: 1 };
function setup() {
  const user = signal<any>({ uid: 'owner' }), auth = { currentUser: { uid: 'owner' } }, dataImportActive = signal(false);
  const rows = new BehaviorSubject([{ ...goal, documentId: goal.id }]); mocks.data.mockReset().mockReturnValue(rows);
  const records = new Map<string, any>(), set = vi.fn((path: string, value: unknown) => records.set(path, value));
  mocks.transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => unknown) => fn({
    get: async (path: string) => ({ exists: () => records.has(path), data: () => records.get(path) }), set }));
  const call = vi.fn(async () => ({ data: { goalsRevision: 1, progress: [], weekStartsOn: 1, complete: true } }));
  TestBed.configureTestingModule({ providers: [TrainingGoalsService, { provide: Firestore, useValue: {} }, { provide: Auth, useValue: auth },
    { provide: AppUserService, useValue: { user } }, { provide: AppFunctionsService, useValue: { call } },
    { provide: MatDialog, useValue: { open: vi.fn() } }, { provide: HistoryImportProgressService, useValue: { dataImportActive } }] });
  const service = TestBed.inject(TrainingGoalsService); TestBed.flushEffects();
  return { service, user, auth, rows, records, set, call, dataImportActive };
}
afterEach(() => vi.useRealTimers());
describe('TrainingGoalsService', () => {
  it('shares one owner listener and reconnects after errors instead of caching failure', async () => {
    const { service, rows } = setup(); const a = service.watch('owner').subscribe(), b = service.watch('owner').subscribe();
    expect(mocks.data).toHaveBeenCalledOnce();
    expect(await firstValueFrom(service.watch('other'))).toEqual({ status: 'ready', goals: [] });
    rows.error(Error('unavailable')); a.unsubscribe(); b.unsubscribe();
    mocks.data.mockReturnValue(new BehaviorSubject([]));
    expect(await firstValueFrom(service.watch('owner').pipe(filter(state => state.status === 'ready')))).toEqual({ status: 'ready', goals: [] });
    expect(mocks.data).toHaveBeenCalledTimes(2);
  });
  it('atomically saves goal and separate state, replays uncertain saves and rejects stale edits', async () => {
    const { service, records, set } = setup();
    const fields = parseTrainingGoalFields(Object.fromEntries(TRAINING_GOAL_FIELDS.map(key => [key, goal[key]])));
    const saved = await service.save('owner', 'new', fields, null);
    expect(saved.revision).toBe(1); expect(set).toHaveBeenCalledTimes(2);
    expect(records.get('users/owner/trainingGoalState/current')).toEqual({ schemaVersion: 1, revision: 1, goalCount: 1, lastGoalId: 'new' });
    expect(await service.save('owner', 'new', fields, null)).toEqual(saved); expect(set).toHaveBeenCalledTimes(2);
    await service.save('owner', 'new', { ...fields, name: 'Changed' }, saved);
    await expect(service.save('owner', 'new', { ...fields, name: 'Stale' }, saved)).rejects.toThrow('changed');
    await expect(service.save('other', 'new', fields, null)).rejects.toThrow();
    expect([...records.keys()].some(key => key.includes('trainingPlanState'))).toBe(false);
  });
  it('coalesces progress readers and calendar/import invalidations and isolates account changes', async () => {
    vi.useFakeTimers(); const { service, call, dataImportActive, auth, user } = setup();
    const a = service.watchProgress('owner', 'UTC', 1).subscribe(), b = service.watchProgress('owner', 'UTC', 1).subscribe();
    await vi.advanceTimersByTimeAsync(800); expect(call).toHaveBeenCalledOnce();
    service.invalidateProgress('owner'); service.invalidateProgress('owner');
    await vi.advanceTimersByTimeAsync(800); expect(call).toHaveBeenCalledTimes(2);
    dataImportActive.set(true); TestBed.flushEffects(); await vi.advanceTimersByTimeAsync(800); expect(call).toHaveBeenCalledTimes(3);
    const guard = call.mock.calls[2][2].canExecute; expect(guard()).toBe(true);
    auth.currentUser = { uid: 'other' }; user.set({ uid: 'other' }); TestBed.flushEffects(); expect(guard()).toBe(false);
    a.unsubscribe(); b.unsubscribe();
  });
  it('skips progress reads without weekly targets', async () => {
    vi.useFakeTimers(); const { service, rows, call } = setup(); rows.next([]);
    const sub = service.watchProgress('owner', 'UTC', 1).subscribe(); await vi.advanceTimersByTimeAsync(800);
    expect(call).not.toHaveBeenCalled(); sub.unsubscribe();
  });
});
