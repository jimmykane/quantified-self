import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom } from 'rxjs';
import { Auth } from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { TrainingRestDaysService } from './training-rest-days.service';
import type { TrainingRestDayV1 } from '@shared/training-rest-days';

const sdk = vi.hoisted(() => ({ doc: vi.fn((...parts) => parts.slice(1).join('/')), docData: vi.fn(), collectionData: vi.fn(),
  collection: vi.fn((...parts) => parts.slice(1).join('/')), query: vi.fn((...parts) => parts),
  where: vi.fn((...parts) => parts), orderBy: vi.fn((...parts) => parts), limit: vi.fn(value => value), runTransaction: vi.fn() }));
vi.mock('app/firebase/firestore', async original => ({ ...await original<typeof import('app/firebase/firestore')>(), ...sdk }));

function setup() {
  const auth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'owner' } };
  const day$ = new Subject<unknown>(), range$ = new Subject<Record<string, unknown>[]>();
  let record: TrainingRestDayV1 | null = null;
  const get = vi.fn(async () => ({ exists: () => record !== null, data: () => record }));
  const set = vi.fn((_ref, value) => { record = value; });
  sdk.docData.mockReturnValue(day$); sdk.collectionData.mockReturnValue(range$);
  sdk.runTransaction.mockImplementation(async (_db, write) => write({ get, set }));
  TestBed.configureTestingModule({ providers: [{ provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} }] });
  return { service: TestBed.inject(TrainingRestDaysService), auth, day$, range$, get, set,
    seed: (value: TrainingRestDayV1 | null) => { record = value; } };
}
const date = '2026-10-31';
const rest: TrainingRestDayV1 = { schemaVersion: 1, localDate: date, isRestDay: true, revision: 1 };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('calendar rest-day persistence', () => {
  it('shares one bounded initial timeout retry and waits for verified rest evidence', async () => {
    vi.useFakeTimers();
    const { service, day$ } = setup(); const next = vi.fn(), error = vi.fn();
    const first = service.watchDay('owner', date).subscribe({ next, error });
    const second = service.watchDay('owner', date).subscribe({ error });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(day$.observed).toBe(false); expect(error).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled(); expect(service.lastRevision('owner', date)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(499); expect(sdk.docData).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(sdk.docData).toHaveBeenCalledTimes(2);
    expect(sdk.docData.mock.calls.every(([, options]) => options.waitForServer === true)).toBe(true);
    expect(next).not.toHaveBeenCalled(); day$.next(rest);
    expect(next).toHaveBeenCalledExactlyOnceWith(rest); expect(service.lastRevision('owner', date)).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(error).not.toHaveBeenCalled(); expect(sdk.docData).toHaveBeenCalledTimes(2);
    first.unsubscribe(); expect(day$.observed).toBe(true); second.unsubscribe(); expect(day$.observed).toBe(false);
    expect(service.lastRevision('owner', date)).toBeUndefined();
  });
  it('reports an exhausted initial timeout as deadline-exceeded without inventing absence or looping', async () => {
    vi.useFakeTimers();
    const { service } = setup(); const next = vi.fn(), error = vi.fn(), changes = vi.fn();
    const updates = service.changes$.subscribe(changes);
    service.watchDay('owner', date).subscribe({ next, error });
    await vi.advanceTimersByTimeAsync(30_500);
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'deadline-exceeded' }));
    expect(next).not.toHaveBeenCalled(); expect(changes).not.toHaveBeenCalled();
    expect(service.lastRevision('owner', date)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000); expect(sdk.docData).toHaveBeenCalledTimes(2);
    updates.unsubscribe();
  });
  it.each(['aborted', 'deadline-exceeded', 'internal', 'unavailable'])(
    'recovers an initial %s failure once without emitting an empty day', async code => {
      vi.useFakeTimers();
      const { service, day$ } = setup(); const failed$ = new Subject<unknown>(), next = vi.fn(), error = vi.fn();
      sdk.docData.mockReturnValueOnce(failed$);
      const subscription = service.watchDay('owner', date).subscribe({ next, error });
      failed$.error({ code });
      expect(next).not.toHaveBeenCalled(); expect(service.lastRevision('owner', date)).toBeUndefined();
      await vi.advanceTimersByTimeAsync(500); day$.next(undefined);
      expect(next).toHaveBeenCalledExactlyOnceWith(null); expect(error).not.toHaveBeenCalled();
      expect(sdk.docData).toHaveBeenCalledTimes(2); subscription.unsubscribe();
    });
  it.each(['permission-denied', 'unauthenticated', 'invalid-argument', 'resource-exhausted', 'unknown'])(
    'propagates initial %s errors without retrying', async code => {
      vi.useFakeTimers();
      const { service, day$ } = setup(); const next = vi.fn(), error = vi.fn();
      const failure = { code };
      service.watchDay('owner', date).subscribe({ next, error }); day$.error(failure);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(error).toHaveBeenCalledExactlyOnceWith(failure); expect(next).not.toHaveBeenCalled();
      expect(sdk.docData).toHaveBeenCalledOnce(); expect(service.lastRevision('owner', date)).toBeUndefined();
    });
  it.each([0, 15_000])('cancels the initial read/retry when its last consumer leaves at %s ms', async elapsed => {
    vi.useFakeTimers();
    const { service, day$ } = setup(); const error = vi.fn();
    const subscription = service.watchDay('owner', date).subscribe({ error });
    await vi.advanceTimersByTimeAsync(elapsed); subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(day$.observed).toBe(false); expect(sdk.docData).toHaveBeenCalledOnce(); expect(error).not.toHaveBeenCalled();
  });
  it.each(['other-account', 'same-uid-session', 'signed-out'] as const)(
    'does not start a pending retry after %s changes', async change => {
      vi.useFakeTimers();
      const { service, auth, day$ } = setup(); const error = vi.fn();
      service.watchDay('owner', date).subscribe({ error }); day$.error({ code: 'unavailable' });
      auth.currentUser = change === 'signed-out' ? null : { uid: change === 'other-account' ? 'other' : 'owner' };
      await vi.advanceTimersByTimeAsync(500);
      expect(sdk.docData).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'cancelled' }));
      expect(service.lastRevision('owner', date)).toBeUndefined();
    });
  it('retains the acknowledged revision floor across an initial read retry', async () => {
    vi.useFakeTimers();
    const { service, day$ } = setup(); const failed$ = new Subject<unknown>(), next = vi.fn(), error = vi.fn();
    await service.setDay('owner', date, true, 0, () => true);
    await service.setDay('owner', date, false, 1, () => true);
    sdk.docData.mockReturnValueOnce(failed$);
    const subscription = service.watchDay('owner', date).subscribe({ next, error }); failed$.error({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(500); day$.next(rest);
    expect(next).not.toHaveBeenCalled(); expect(service.lastRevision('owner', date)).toBeUndefined();
    day$.next({ ...rest, isRestDay: false, revision: 2 });
    expect(next).toHaveBeenCalledExactlyOnceWith({ ...rest, isRestDay: false, revision: 2 });
    expect(service.lastRevision('owner', date)).toBe(2); expect(error).not.toHaveBeenCalled(); subscription.unsubscribe();
  });
  it('shares one server-confirmed day listener, publishes changed revisions once and tears it down', () => {
    const { service, day$ } = setup(); const next = vi.fn(), changes = vi.fn(); service.changes$.subscribe(changes);
    const first = service.watchDay('owner', date).subscribe(next), second = service.watchDay('owner', date).subscribe();
    expect(next).not.toHaveBeenCalled(); day$.next(undefined); day$.next(undefined); day$.next(rest);
    expect(next).toHaveBeenCalledTimes(2); expect(changes.mock.calls.map(([value]) => value.revision)).toEqual([0, 1]);
    expect(sdk.docData).toHaveBeenCalledWith('users/owner/trainingRestDays/2026-10-31', { waitForServer: true });
    first.unsubscribe(); expect(day$.observed).toBe(true); second.unsubscribe(); expect(day$.observed).toBe(false);
  });
  it('requires fresh evidence after the last day listener disconnects and reconnects', () => {
    const { service, day$ } = setup();
    const first = service.watchDay('owner', date).subscribe(); day$.next(undefined);
    expect(service.lastRevision('owner', date)).toBe(0);
    first.unsubscribe(); expect(service.lastRevision('owner', date)).toBeUndefined();
    const next = vi.fn(), second = service.watchDay('owner', date).subscribe(next);
    expect(next).not.toHaveBeenCalled(); expect(service.lastRevision('owner', date)).toBeUndefined();
    day$.next(rest); expect(service.lastRevision('owner', date)).toBe(1);
    second.unsubscribe(); expect(service.lastRevision('owner', date)).toBeUndefined();
  });
  it('does not treat a write acknowledgement without a live day read as current cache evidence', async () => {
    const { service } = setup();
    await service.setDay('owner', date, true, 0, () => true);
    expect(service.lastRevision('owner', date)).toBeUndefined();
  });
  it('writes calendar intent directly and keeps an acknowledged revision ahead of older SDK echoes', async () => {
    const { service, day$, set } = setup(); const values: (TrainingRestDayV1 | null)[] = [];
    const sub = service.watchDay('owner', date).subscribe(value => values.push(value)); day$.next(undefined);
    expect(await service.setDay('owner', date, true, 0, () => true)).toEqual(rest);
    expect(set).toHaveBeenCalledWith('users/owner/trainingRestDays/2026-10-31', rest);
    day$.next(undefined); expect(values.at(-1)).toEqual(rest);
    expect(await service.setDay('owner', date, false, 1, () => true)).toEqual({ ...rest, isRestDay: false, revision: 2 });
    day$.next(rest); expect(values.at(-1)?.isRestDay).toBe(false); sub.unsubscribe();
  });
  it('does not verify an older server echo when reconnecting after a newer acknowledged removal', async () => {
    const { service, day$ } = setup();
    await service.setDay('owner', date, true, 0, () => true); await service.setDay('owner', date, false, 1, () => true);
    const next = vi.fn(), subscription = service.watchDay('owner', date).subscribe(next);
    day$.next(rest); expect(next).not.toHaveBeenCalled(); expect(service.lastRevision('owner', date)).toBeUndefined();
    day$.next({ ...rest, isRestDay: false, revision: 2 });
    expect(next).toHaveBeenCalledExactlyOnceWith({ ...rest, isRestDay: false, revision: 2 }); subscription.unsubscribe();
  });
  it('makes desired-state retries idempotent and rejects a conflicting revision', async () => {
    const { service, seed, set } = setup(); seed({ ...rest, revision: 3 });
    expect(await service.setDay('owner', date, true, 0, () => true)).toEqual({ ...rest, revision: 3 });
    await expect(service.setDay('owner', date, false, 0, () => true)).rejects.toThrow('changed');
    expect(set).not.toHaveBeenCalled();
    seed(null); expect(await service.setDay('owner', date, false, 0, () => true)).toBeNull(); expect(set).not.toHaveBeenCalled();
  });
  it.each(['context', 'account', 'return-to-owner'] as const)('fences a transaction waiting for its read after %s changes', async change => {
    const { service, auth, get, set } = setup(); let finish!: (value: unknown) => void; let current = true;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = service.setDay('owner', date, true, 0, () => current);
    if (change === 'context') current = false;
    else auth.currentUser = { uid: change === 'account' ? 'other' : 'owner' };
    finish({ exists: () => false }); await expect(pending).rejects.toThrow('changed'); expect(set).not.toHaveBeenCalled();
  });
  it('bounds range queries and rejects inconsistent rows rather than treating them as free training days', async () => {
    const { service, range$ } = setup();
    const pending = firstValueFrom(service.watchRange('owner', date, date)); range$.next([{ ...rest, id: date }]);
    expect(await pending).toEqual([rest]); expect(sdk.limit).toHaveBeenCalledWith(367);
    const invalid = firstValueFrom(service.watchRange('owner', date, date)); range$.next([{ ...rest, id: '2026-11-01' }]);
    await expect(invalid).rejects.toThrow('identity');
  });
  it('bridges bounded range reads with acknowledged writes without claiming an unloaded range is complete', async () => {
    const { service, range$ } = setup(); const next = vi.fn();
    const sub = service.watchRange('owner', date, date).subscribe(next);
    await service.setDay('owner', date, true, 0, () => true); expect(next).not.toHaveBeenCalled();
    range$.next([]); expect(next).toHaveBeenLastCalledWith([rest]);
    await service.setDay('owner', date, false, 1, () => true);
    range$.next([{ ...rest, id: date }]); expect(next).toHaveBeenLastCalledWith([{ ...rest, isRestDay: false, revision: 2 }]);
    range$.next([{ ...rest, isRestDay: false, revision: 3, id: date }]);
    expect(next).toHaveBeenLastCalledWith([{ ...rest, isRestDay: false, revision: 3 }]); sub.unsubscribe();
  });
  it('propagates failed or malformed day evidence without publishing absence', async () => {
    const { service, day$ } = setup(); const changes = vi.fn(); service.changes$.subscribe(changes);
    const pending = firstValueFrom(service.watchDay('owner', date)); day$.next({ ...rest, revision: 0 });
    await expect(pending).rejects.toThrow(); expect(changes).not.toHaveBeenCalled();
  });
  it('retires known evidence after a listener failure so stale recipes cannot use it as verified absence', () => {
    const { service, day$ } = setup(); const error = vi.fn();
    service.watchDay('owner', date).subscribe({ error }); day$.next(undefined);
    expect(service.lastRevision('owner', date)).toBe(0); day$.error(new Error('offline'));
    expect(error).toHaveBeenCalledOnce(); expect(service.lastRevision('owner', date)).toBeUndefined();
  });
  it('immediately retires live evidence after a transient failure instead of hiding it behind a retry', async () => {
    vi.useFakeTimers();
    const { service, day$ } = setup(); const error = vi.fn();
    service.watchDay('owner', date).subscribe({ error }); day$.next(undefined); day$.error({ code: 'unavailable' });
    expect(error).toHaveBeenCalledExactlyOnceWith({ code: 'unavailable' });
    expect(service.lastRevision('owner', date)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000); expect(sdk.docData).toHaveBeenCalledOnce();
  });
  it('does not reuse an old authenticated session’s verified revision or replay buffer', () => {
    const { service, auth, day$ } = setup(); const old = service.watchDay('owner', date).subscribe(); day$.next(rest);
    auth.currentUser = { uid: 'owner' }; expect(service.lastRevision('owner', date)).toBeUndefined();
    const next = vi.fn(), subscription = service.watchDay('owner', date).subscribe(next);
    expect(next).not.toHaveBeenCalled(); day$.next(undefined);
    expect(next).toHaveBeenCalledExactlyOnceWith(null); expect(service.lastRevision('owner', date)).toBe(0);
    old.unsubscribe(); expect(service.lastRevision('owner', date)).toBe(0);
    subscription.unsubscribe(); expect(service.lastRevision('owner', date)).toBeUndefined();
  });
  it('does not let a delayed earlier acknowledgement resurrect rest after a newer removal', async () => {
    const { service, range$, get, set } = setup(); const next = vi.fn();
    const subscription = service.watchRange('owner', date, date).subscribe(next); range$.next([]);
    let acknowledge!: () => void;
    sdk.runTransaction.mockImplementationOnce(async (_db, write) => {
      const result = await write({ get, set }); await new Promise<void>(resolve => { acknowledge = resolve; }); return result;
    });
    const earlier = service.setDay('owner', date, true, 0, () => true);
    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    await service.setDay('owner', date, false, 1, () => true); acknowledge();
    await expect(earlier).rejects.toThrow('changed again');
    expect(next).toHaveBeenLastCalledWith([{ ...rest, isRestDay: false, revision: 2 }]);
    expect(service.lastRevision('owner', date)).toBeUndefined(); subscription.unsubscribe();
  });
});
