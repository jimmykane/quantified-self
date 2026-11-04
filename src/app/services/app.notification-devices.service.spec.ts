import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth, user } from 'app/firebase/auth';
import { Firestore, Timestamp, getDocsFromServer, runTransaction } from 'app/firebase/firestore';
import { AppPushService } from './app.push.service';
import { AppNotificationDevicesService } from './app.notification-devices.service';

vi.mock('app/firebase/auth', async original => ({ ...await original<typeof import('app/firebase/auth')>(), user: vi.fn() }));
vi.mock('app/firebase/firestore', async original => ({ ...await original<typeof import('app/firebase/firestore')>(),
  collection: vi.fn((_db, path) => ({ path })), doc: vi.fn((_db, path) => ({ path })),
  query: vi.fn((ref, ...constraints) => ({ ...ref, constraints })), orderBy: vi.fn(value => ({ orderBy: value })),
  documentId: vi.fn(() => '__name__'), limit: vi.fn(value => ({ limit: value })), startAfter: vi.fn(value => ({ startAfter: value })),
  getDocsFromServer: vi.fn(), runTransaction: vi.fn() }));
const id = '00000000-0000-4000-8000-000000000001';
const betaId = '00000000-0000-4000-8000-000000000002';
const origin = 'https://quantified-self.io';
const data = { generation: id, origin, device: { browser: 'Chrome', platform: 'macOS' },
  updatedAt: Timestamp.fromMillis(1000), endpoint: 'private-endpoint', keys: { auth: 'private-key' } };
const row = (deviceId = id, value = data) => ({ id: deviceId, data: () => value });
const snapshot = (docs = [row()]) => ({ docs }) as never;
const tick = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
let owner: { uid: string; getIdTokenResult: ReturnType<typeof vi.fn> };
let owner$: BehaviorSubject<typeof owner | null>;
let auth: { currentUser: typeof owner | null };
let tx: { get: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
const push = { state: signal('disabled'), operation: signal(null), isCurrentDevice: vi.fn(), refreshRegistration: vi.fn() };
function setup(platform = 'browser') {
  TestBed.configureTestingModule({ providers: [AppNotificationDevicesService,
    { provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} },
    { provide: AppPushService, useValue: push }, { provide: PLATFORM_ID, useValue: platform }] });
  return TestBed.inject(AppNotificationDevicesService);
}
beforeEach(() => {
  vi.clearAllMocks(); push.state.set('disabled'); push.operation.set(null);
  push.isCurrentDevice.mockReturnValue(false); push.refreshRegistration.mockResolvedValue(undefined);
  owner = { uid: 'owner', getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }) };
  auth = { currentUser: owner }; owner$ = new BehaviorSubject(owner); vi.mocked(user).mockReturnValue(owner$ as never);
  vi.mocked(getDocsFromServer).mockReset().mockResolvedValue(snapshot());
  tx = { get: vi.fn().mockResolvedValue({ exists: () => true, data: () => data }), delete: vi.fn() };
  vi.mocked(runTransaction).mockImplementation(async (_db, update) => update(tx as never));
});
afterEach(() => TestBed.resetTestingModule());
describe('notification device management', () => {
  it('lists both sites with safe hints, dates and no subscription credentials', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([row(), row(betaId, { ...data, origin: 'https://beta.quantified-self.io', device: undefined })]));
    push.isCurrentDevice.mockImplementation((deviceId, site) => deviceId === id && site === origin);
    const service = setup(); await tick();
    expect(service.devices()).toEqual([
      { id, generation: id, origin, site: 'Production', label: 'Chrome on macOS', registeredAt: new Date(1000), current: true },
      { id: betaId, generation: id, origin: 'https://beta.quantified-self.io', site: 'Beta', label: 'Browser device', registeredAt: new Date(1000), current: false },
    ]);
    expect(getDocsFromServer).toHaveBeenCalledWith({ path: 'users/owner/pushSubscriptions', constraints: [{ orderBy: '__name__' }, { limit: 26 }] });
    expect(JSON.stringify(service.devices())).not.toMatch(/private-|endpoint|keys/);
  });
  it('does not query on SSR, sign-out or impersonation', async () => {
    setup('server'); await tick(); expect(getDocsFromServer).not.toHaveBeenCalled();
    TestBed.resetTestingModule(); auth.currentUser = null; owner$.next(null);
    const signedOut = setup(); await tick(); expect(signedOut.status()).toBe('signed-out');
    auth.currentUser = owner; owner.getIdTokenResult.mockResolvedValue({ claims: { impersonatedBy: '' } }); owner$.next(owner); await tick();
    expect(signedOut.status()).toBe('impersonating'); expect(getDocsFromServer).not.toHaveBeenCalled();
  });
  it('paginates without truncating accounts with more than 25 registrations', async () => {
    const rows = Array.from({ length: 26 }, (_, index) => row(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`));
    vi.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot(rows)).mockResolvedValueOnce(snapshot([rows[25]]));
    const service = setup(); await tick(); expect(service.devices()).toHaveLength(25); expect(service.hasMore()).toBe(true);
    await service.loadMore(); expect(service.devices()).toHaveLength(26); expect(service.hasMore()).toBe(false);
    expect(getDocsFromServer).toHaveBeenLastCalledWith(expect.objectContaining({ constraints: [{ orderBy: '__name__' }, { startAfter: rows[24].id }, { limit: 26 }] }));
  });
  it('retains rows but blocks mutations after a read failure until refreshed', async () => {
    const service = setup(); await tick(); vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('offline'));
    await service.reload(); expect(service.status()).toBe('error'); expect(service.devices()).toHaveLength(1);
    expect(await service.disable(service.devices()[0])).toBe(false); expect(runTransaction).not.toHaveBeenCalled();
    await service.reload(); expect(service.canManage()).toBe(true);
  });
  it('supersedes an initial read when a completed device change requests a fresh list', async () => {
    let finish!: (value: never) => void;
    vi.mocked(getDocsFromServer).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(snapshot([row(betaId)]));
    const service = setup(); await tick(); expect(service.status()).toBe('loading');
    await service.reload();
    finish(snapshot([])); await tick();
    expect(service.devices().map(device => device.id)).toEqual([betaId]);
    expect(service.status()).toBe('ready');
  });
  it('drops an obsolete pagination result after refreshing for a local device change', async () => {
    const rows = Array.from({ length: 26 }, (_, index) => row(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`));
    let finish!: (value: never) => void;
    vi.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot(rows))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(snapshot([row(betaId)]));
    const service = setup(); await tick();
    const loading = service.loadMore(); await tick(); expect(service.loadingMore()).toBe(true);
    await service.reload(); finish(snapshot([rows[25]])); await loading;
    expect(service.devices().map(device => device.id)).toEqual([betaId]);
    expect(service.loadingMore()).toBe(false); expect(service.hasMore()).toBe(false);
  });
  it('removes only the chosen site registration and reconciles this browser after server acknowledgement', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([row(), row(betaId, { ...data, origin: 'https://beta.quantified-self.io' })]));
    push.isCurrentDevice.mockImplementation(deviceId => deviceId === betaId);
    const service = setup(); await tick();
    tx.get.mockResolvedValue({ exists: () => true, data: () => ({ ...data, origin: 'https://beta.quantified-self.io' }) });
    expect(await service.disable(service.devices()[1])).toBe(true);
    expect(tx.delete).toHaveBeenCalledExactlyOnceWith({ path: `users/owner/pushSubscriptions/${betaId}` });
    expect(service.devices().map(device => device.id)).toEqual([id]); expect(push.refreshRegistration).toHaveBeenCalledOnce();
    expect(service.message()).toContain('(Beta)');
  });
  it('does not change local browser permission when disabling another device', async () => {
    const service = setup(); await tick(); await service.disable(service.devices()[0]);
    expect(push.refreshRegistration).not.toHaveBeenCalled();
  });
  it('preserves replacement registrations and keeps failed removals visible', async () => {
    const service = setup(); await tick(); tx.get.mockResolvedValue({ exists: () => true, data: () => ({ ...data, generation: betaId }) });
    await expect(service.disable(service.devices()[0])).rejects.toThrow('Could not disable');
    expect(tx.delete).not.toHaveBeenCalled(); expect(service.devices()).toHaveLength(1); expect(service.saving()).toBeNull();
    expect(service.message()).toContain('Refresh');
  });
  it('handles a registration already removed elsewhere without claiming a new mutation', async () => {
    const service = setup(); await tick(); tx.get.mockResolvedValue({ exists: () => false });
    expect(await service.disable(service.devices()[0])).toBe(false); expect(tx.delete).not.toHaveBeenCalled();
    expect(service.devices()).toEqual([]); expect(service.message()).toContain('already disabled');
  });
  it('does not show old account results after a switch during a list read', async () => {
    let resolve!: (value: never) => void;
    vi.mocked(getDocsFromServer).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const service = setup(); await tick(); auth.currentUser = null; owner$.next(null); resolve(snapshot()); await tick();
    expect(service.devices()).toEqual([]); expect(service.status()).toBe('signed-out');
  });
  it('aborts a transaction if the account changes while its registration is read', async () => {
    const service = setup(); await tick();
    tx.get.mockImplementation(async () => { auth.currentUser = null; owner$.next(null); return { exists: () => true, data: () => data }; });
    expect(await service.disable(service.devices()[0])).toBe(false); expect(tx.delete).not.toHaveBeenCalled();
    expect(service.devices()).toEqual([]); expect(service.message()).toBe('');
  });
  it('ignores late results after the Settings service is destroyed', async () => {
    let resolve!: (value: never) => void;
    vi.mocked(getDocsFromServer).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const service = setup(); await tick(); TestBed.resetTestingModule(); resolve(snapshot()); await tick();
    expect(service.devices()).toEqual([]);
  });
  it('does not restart reads when a device action completes after Settings is closed', async () => {
    const service = setup(); await tick(); TestBed.resetTestingModule();
    await service.reload();
    expect(getDocsFromServer).toHaveBeenCalledOnce();
    expect(await service.disable(service.devices()[0])).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
