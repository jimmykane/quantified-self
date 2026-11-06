import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Auth, user } from 'app/firebase/auth';
import { Firestore, onSnapshot, runTransaction } from 'app/firebase/firestore';
import { NOTIFICATION_CATEGORIES } from '@shared/notification-categories';
import { AppNotificationPreferencesService } from './app.notification-preferences.service';
vi.mock('app/firebase/auth', async original => ({ ...await original<typeof import('app/firebase/auth')>(), user: vi.fn() }));
vi.mock('app/firebase/firestore', async original => ({ ...await original<typeof import('app/firebase/firestore')>(),
  doc: vi.fn((_db, path) => ({ path })), onSnapshot: vi.fn(), runTransaction: vi.fn(), serverTimestamp: () => 'server-time' }));
const tick = async () => { for (let n = 0; n < 15; n++) await Promise.resolve(); };
const preference = (enabled: boolean, revision: number) => ({ schemaVersion: 1, enabled, revision });
let owner: { uid: string; getIdTokenResult: ReturnType<typeof vi.fn> };
let auth: { currentUser: typeof owner | null };
let owners: BehaviorSubject<typeof owner | null>;
let listeners: { next: (snapshot: unknown) => void; error: () => void; stop: ReturnType<typeof vi.fn> }[];
let saved: unknown;
let tx: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
const emit = (value: unknown, metadata = { fromCache: false, hasPendingWrites: false }, index?: number) => {
  // Existing cases exercise History imports; independently confirm the other category.
  if (index === undefined) for (const listener of listeners.slice(-NOTIFICATION_CATEGORIES.length + 1)) listener.next({ data: () => undefined, metadata });
  listeners[index ?? listeners.length - NOTIFICATION_CATEGORIES.length].next({ data: () => value, metadata });
};
function setup(platform = 'browser') {
  TestBed.configureTestingModule({ providers: [{ provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} },
    { provide: PLATFORM_ID, useValue: platform }] });
  return TestBed.inject(AppNotificationPreferencesService);
}
beforeEach(() => {
  vi.clearAllMocks(); saved = undefined; listeners = [];
  owner = { uid: 'owner', getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }) };
  auth = { currentUser: owner }; owners = new BehaviorSubject(owner); vi.mocked(user).mockReturnValue(owners as never);
  vi.mocked(onSnapshot).mockImplementation(((_ref, _options, next, error) => {
    const stop = vi.fn(); listeners.push({ next, error, stop }); return stop;
  }) as never);
  tx = { get: vi.fn(async () => ({ data: () => saved })), set: vi.fn() };
  vi.mocked(runTransaction).mockImplementation((async (_db, action) => action(tx as never)) as typeof runTransaction);
});
afterEach(() => TestBed.resetTestingModule());
describe('account notification categories', () => {
  it('enables every category atomically using fresh revisions, including choices changed on another device', async () => {
    const service = setup(); await tick(); emit(undefined);
    tx.get.mockImplementation(async ref => ({ data: () => preference(false, ref.path.endsWith('activity_sync') ? 8 : 2) }));
    tx.set.mockImplementation(() => expect(tx.get).toHaveBeenCalledTimes(NOTIFICATION_CATEGORIES.length));
    expect(await service.enableAll()).toBe(true);
    expect(tx.set).toHaveBeenCalledTimes(NOTIFICATION_CATEGORIES.length);
    expect(tx.set).toHaveBeenCalledWith({ path: 'users/owner/notificationPreferences/activity_sync' },
      { ...preference(true, 9), updatedAt: 'server-time' });
    expect(service.categories().every(category => category.enabled)).toBe(true);
    emit(preference(false, 2)); expect(service.isEnabled('activity_sync')).toBe(true);
  });
  it.each(['malformed', 'overflow'])('does not write any category if one server preference is %s', async reason => {
    const service = setup(); await tick(); emit(preference(false, 1));
    tx.get.mockImplementation(async ref => ({ data: () => ref.path.endsWith('activity_delivery')
      ? reason === 'malformed' ? {} : preference(false, Number.MAX_SAFE_INTEGER) : preference(false, 1) }));
    await expect(service.enableAll()).rejects.toThrow('Could not turn on all');
    expect(tx.set).not.toHaveBeenCalled(); expect(service.categories()[0].enabled).toBe(false);
    expect(service.saving()).toBeNull();
  });
  it('accepts already enabled categories without creating or rewriting preference documents', async () => {
    const service = setup(); await tick(); emit(undefined);
    expect(await service.enableAll()).toBe(true); expect(tx.set).not.toHaveBeenCalled();
  });
  it('cancels master On before writing if the account changes during its reads', async () => {
    const service = setup(); await tick(); emit(preference(false, 1));
    tx.get.mockImplementation(async () => {
      auth.currentUser = null; owners.next(null); return { data: () => preference(false, 1) };
    });
    expect(await service.enableAll()).toBe(false); expect(tx.set).not.toHaveBeenCalled();
    expect(service.status()).toBe('signed-out');
  });
  it('serializes master On with individual category writes and leaves failed saves unchanged', async () => {
    const service = setup(); await tick(); emit(preference(false, 1));
    let reject!: (error: Error) => void;
    vi.mocked(runTransaction).mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
    const pending = service.enableAll();
    expect(service.saving()).toBe('all');
    expect(await service.enableAll()).toBe(false); expect(await service.setEnabled('activity_sync', true)).toBe(false);
    reject(new Error('Offline')); await expect(pending).rejects.toThrow('Could not turn on all');
    expect(service.categories()[0].enabled).toBe(false); expect(service.saving()).toBeNull();
  });
  it('waits for all categories and saves their independent choices to separate documents', async () => {
    const service = setup(); await tick();
    emit(undefined, { fromCache: false, hasPendingWrites: false }, 0);
    expect(service.status()).toBe('loading'); expect(service.isEnabled('activity_sync')).toBe(false);
    listeners[1].next({ data: () => preference(false, 1), metadata: { fromCache: false, hasPendingWrites: false } });
    expect(service.status()).toBe('loading');
    listeners[2].next({ data: () => undefined, metadata: { fromCache: false, hasPendingWrites: false } });
    expect(service.status()).toBe('loading');
    listeners[3].next({ data: () => undefined, metadata: { fromCache: false, hasPendingWrites: false } });
    expect(service.isEnabled('training_sync')).toBe(true);
    expect(service.isEnabled('activity_delivery')).toBe(true);
    expect(service.isEnabled('history_import')).toBe(true); expect(service.isEnabled('activity_sync')).toBe(false);
    saved = preference(false, 1); await service.setEnabled('activity_sync', true);
    expect(tx.set).toHaveBeenLastCalledWith({ path: 'users/owner/notificationPreferences/activity_sync' },
      { ...preference(true, 2), updatedAt: 'server-time' });
    expect(service.isEnabled('history_import')).toBe(true);
  });
  it('defaults a new category on only after an authoritative read, independently of device permission', async () => {
    const service = setup(); await tick();
    expect(service.canEdit()).toBe(false); expect(service.isEnabled('history_import')).toBe(false);
    emit(undefined, { fromCache: true, hasPendingWrites: false }); expect(service.status()).toBe('loading');
    emit(undefined, { fromCache: false, hasPendingWrites: true }); expect(service.status()).toBe('loading');
    emit(undefined); expect(service.isEnabled('history_import')).toBe(true); expect(service.canEdit()).toBe(true);
    expect(runTransaction).not.toHaveBeenCalled();
    emit(preference(false, 1)); expect(service.isEnabled('history_import')).toBe(false);
  });
  it('writes only explicit changes and increments the server revision across off/on toggles', async () => {
    const service = setup(); await tick(); emit(undefined);
    expect(await service.setEnabled('history_import', true)).toBe(false); expect(tx.set).not.toHaveBeenCalled();
    await service.setEnabled('history_import', false);
    expect(tx.set).toHaveBeenLastCalledWith({ path: 'users/owner/notificationPreferences/history_import' },
      { ...preference(false, 1), updatedAt: 'server-time' });
    saved = preference(false, 1); await service.setEnabled('history_import', true);
    expect(tx.set).toHaveBeenLastCalledWith(expect.anything(), { ...preference(true, 2), updatedAt: 'server-time' });
    emit(preference(false, 1)); expect(service.isEnabled('history_import')).toBe(true); // A lagging listener cannot undo the commit.
  });
  it('uses the latest transaction revision when another device changed the preference', async () => {
    const service = setup(); await tick(); emit(undefined); saved = preference(true, 4);
    await service.setEnabled('history_import', false);
    expect(tx.set).toHaveBeenCalledWith(expect.anything(), { ...preference(false, 5), updatedAt: 'server-time' });
  });
  it('does not optimistically change a failed save or allow overlapping saves', async () => {
    const service = setup(); await tick(); emit(undefined);
    let reject!: (error: Error) => void;
    vi.mocked(runTransaction).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = service.setEnabled('history_import', false);
    expect(service.saving()).toBe('history_import'); expect(service.isEnabled('history_import')).toBe(true);
    expect(await service.setEnabled('history_import', false)).toBe(false);
    reject(new Error('synthetic failure')); await expect(pending).rejects.toThrow('Could not save');
    expect(service.saving()).toBeNull(); expect(service.isEnabled('history_import')).toBe(true);
    expect(service.message()).toContain('Could not save');
  });
  it('ignores stale listeners and cancels an in-flight write after account switching', async () => {
    const service = setup(); await tick(); emit(undefined);
    let read!: (value: unknown) => void; tx.get.mockImplementationOnce(() => new Promise(resolve => { read = resolve; }));
    const pending = service.setEnabled('history_import', false);
    const replacement = { ...owner, uid: 'other' }; auth.currentUser = replacement; owners.next(replacement); await tick();
    expect(listeners[0].stop).toHaveBeenCalledOnce(); emit(undefined);
    read({ data: () => undefined }); expect(await pending).toBe(false);
    emit(preference(false, 1), { fromCache: false, hasPendingWrites: false }, 0);
    expect(tx.set).not.toHaveBeenCalled(); expect(service.isEnabled('history_import')).toBe(true);
    expect(service.message()).toBe('');
  });
  it('discards a late successful write result after sign-out', async () => {
    const service = setup(); await tick(); emit(undefined);
    let resolve!: (value: unknown) => void;
    vi.mocked(runTransaction).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = service.setEnabled('history_import', false);
    auth.currentUser = null; owners.next(null); resolve({ enabled: false, revision: 1 });
    expect(await pending).toBe(false); expect(service.status()).toBe('signed-out'); expect(service.message()).toBe('');
  });
  it.each(['read failure', 'malformed'])('does not interpret %s as a default-on preference and supports retry', async reason => {
    const service = setup(); await tick();
    if (reason === 'read failure') listeners[0].error(); else emit({ enabled: true });
    expect(service.status()).toBe('error'); expect(service.isEnabled('history_import')).toBe(false);
    service.reload(); await tick(); expect(listeners[0].stop).toHaveBeenCalledOnce(); emit(undefined);
    expect(service.status()).toBe('ready'); expect(service.message()).toBe('');
  });
  it.each(['read failure', 'malformed'])('preserves a confirmed opt-out through %s and an explicit reload', async reason => {
    const service = setup(); await tick(); emit(preference(false, 3));
    if (reason === 'read failure') listeners[0].error(); else emit({ enabled: true });
    expect(service.status()).toBe('error'); expect(service.canEdit()).toBe(false);
    expect(service.categories()[0].enabled).toBe(false);
    expect(service.isEnabled('history_import')).toBe(false);
    service.reload(); await tick();
    expect(service.status()).toBe('loading'); expect(service.categories()[0].enabled).toBe(false);
    emit(preference(false, 3)); expect(service.status()).toBe('ready'); expect(service.categories()[0].enabled).toBe(false);
  });
  it('recovers from a corrected malformed snapshot without retaining the error message', async () => {
    const service = setup(); await tick(); emit(undefined); emit({ enabled: false });
    expect(service.status()).toBe('error'); expect(service.isEnabled('history_import')).toBe(false);
    emit(preference(true, 2)); expect(service.status()).toBe('ready'); expect(service.message()).toBe('');
  });
  it('fences impersonated accounts and performs no SSR reads', async () => {
    const server = setup('server'); await tick(); expect(onSnapshot).not.toHaveBeenCalled(); expect(server.canEdit()).toBe(false);
    TestBed.resetTestingModule(); owner.getIdTokenResult.mockResolvedValue({ claims: { impersonatedBy: 'admin' } });
    const client = setup(); await tick(); expect(client.status()).toBe('impersonating'); expect(onSnapshot).not.toHaveBeenCalled();
    expect(await client.setEnabled('history_import', false)).toBe(false);
  });
  it('does not attach a listener for a stale token result or after destruction', async () => {
    let resolve!: (value: unknown) => void; owner.getIdTokenResult.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    setup(); TestBed.resetTestingModule(); resolve({ claims: {} }); await tick(); expect(onSnapshot).not.toHaveBeenCalled();
  });
});
