import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Auth, user } from 'app/firebase/auth';
import { Firestore, onSnapshot, runTransaction } from 'app/firebase/firestore';
import { APP_STORAGE } from './storage/app.storage.token';
import { AppWindowService } from './app.window.service';
import { AppNotificationInvitationService } from './app.notification-invitation.service';

vi.mock('app/firebase/auth', async original => ({ ...await original<typeof import('app/firebase/auth')>(), user: vi.fn() }));
vi.mock('app/firebase/firestore', async original => ({ ...await original<typeof import('app/firebase/firestore')>(),
  doc: vi.fn((_db, path) => ({ path })), onSnapshot: vi.fn(), runTransaction: vi.fn() }));
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
let owner, auth, owners, settings, accountExists, transaction, listeners, errors, stops;
function setup(platform = 'browser') {
  TestBed.configureTestingModule({ providers: [AppNotificationInvitationService,
    { provide: PLATFORM_ID, useValue: platform }, { provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} },
    { provide: APP_STORAGE, useValue: localStorage }, { provide: AppWindowService, useValue: { windowRef: window } },
  ] });
  return TestBed.inject(AppNotificationInvitationService);
}
function publish(value = settings, metadata = { fromCache: false, hasPendingWrites: false }, index = listeners.length - 1) {
  listeners[index]({ data: () => value, metadata });
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); listeners = []; errors = []; stops = []; settings = {}; accountExists = true;
  owner = { uid: 'owner', getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }) };
  auth = { currentUser: owner }; owners = new BehaviorSubject(owner); vi.mocked(user).mockReturnValue(owners);
  vi.mocked(onSnapshot).mockImplementation((_ref, _options, next, error) => {
    const stop = vi.fn(); stops.push(stop); listeners.push(next); errors.push(error); return stop;
  });
  transaction = { get: vi.fn(async ref => ({ exists: () => accountExists,
    data: () => ref.path.endsWith('/config/settings') ? settings : {} })), set: vi.fn() };
  vi.mocked(runTransaction).mockImplementation(async (_db, fn) => fn(transaction));
});
afterEach(() => TestBed.resetTestingModule());

describe('account notification invitation preferences', () => {
  it('resets invitation state after a failed SDK cleanup and fences the old account', async () => {
    const service = setup(); await flush(); publish();
    stops[0].mockImplementation(() => { throw new Error('Firestore queue failed'); });
    const next = { ...owner, uid: 'next' }; auth.currentUser = next; owners.next(next); await flush();
    expect(service.uid()).toBe('next'); expect(service.ready()).toBe(false); expect(service.due()).toBe(false);
    publish({ appSettings: { notificationInvitation: { version: 1, choice: 'dismissed' } } }, undefined, 0);
    expect(service.ready()).toBe(false);
    publish(); expect(service.due()).toBe(true);
    auth.currentUser = null; owners.next(null); await flush();
    expect(service.uid()).toBeNull(); expect(service.due()).toBe(false);
    expect(stops[0]).toHaveBeenCalledOnce();
  });
  it('completes destruction even when Firestore unsubscribe throws', async () => {
    const service = setup(); await flush();
    stops[0].mockImplementation(() => { throw new Error('Firestore queue failed'); });
    expect(() => TestBed.resetTestingModule()).not.toThrow();
    publish(); expect(service.ready()).toBe(false); expect(stops[0]).toHaveBeenCalledOnce();
  });
  it('does not read browser storage or Firestore on the server', async () => {
    const service = setup('server'); await flush();
    expect(service.due()).toBe(false); expect(user).not.toHaveBeenCalled(); expect(onSnapshot).not.toHaveBeenCalled();
  });
  it('waits for server-confirmed settings and fails closed on read errors', async () => {
    const service = setup(); await flush();
    expect(service.due()).toBe(false);
    publish({}, { fromCache: true, hasPendingWrites: false }); expect(service.due()).toBe(false);
    publish(); expect(service.due()).toBe(true);
    errors[0](new Error()); expect(service.due()).toBe(false);
    publish(); expect(service.due()).toBe(true);
  });
  it('saves an isolated account-wide field without overwriting other app settings', async () => {
    const service = setup(); await flush(); publish();
    expect(await service.choose('snoozed')).toBe(true);
    expect(transaction.set).toHaveBeenCalledWith({ path: 'users/owner/config/settings' },
      { appSettings: { notificationInvitation: expect.objectContaining({ version: 1, choice: 'snoozed' }) } }, { merge: true });
    expect(service.due()).toBe(false);
  });
  it('reflects choices from another site and stops offers after explicit device disable', async () => {
    const service = setup(); await flush(); publish();
    publish({ appSettings: { notificationInvitation: { version: 1, choice: 'dismissed' } } });
    expect(service.due()).toBe(false);
    publish(); service.recordDeviceChoice('owner', 'disabled');
    expect(service.due()).toBe(false); await flush();
    expect(localStorage.getItem('qs.notification-invitation.stopped.owner')).toBe('disabled');
  });
  it('keeps local opt-out if saving fails, without making ordinary dismiss failures look successful', async () => {
    const service = setup(); await flush(); publish();
    vi.mocked(runTransaction).mockRejectedValue(new Error());
    expect(await service.choose('dismissed')).toBe(false); expect(service.due()).toBe(true);
    service.recordDeviceChoice('owner', 'disabled'); await flush(); expect(service.due()).toBe(false);
  });
  it('does not carry one account’s choice or late callback into another account', async () => {
    const service = setup(); await flush(); publish();
    service.recordDeviceChoice('owner', 'disabled'); await flush();
    const next = { ...owner, uid: 'next' }; auth.currentUser = next; owners.next(next); await flush();
    publish(); expect(service.due()).toBe(true);
    publish({ appSettings: { notificationInvitation: { version: 1, choice: 'disabled' } } }, undefined, 0);
    expect(service.due()).toBe(true);
    expect(await service.choose('dismissed', 'owner')).toBe(false);
  });
  it('retains this session’s explicit opt-out across focus when both persistence paths fail', async () => {
    const service = setup(); await flush(); publish();
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    vi.mocked(runTransaction).mockRejectedValue(new Error('Offline'));
    service.recordDeviceChoice('owner', 'disabled'); await flush();
    window.dispatchEvent(new Event('focus')); expect(service.due()).toBe(false);
    storageWrite.mockRestore();
  });
  it('retains an in-memory opt-out across token refresh when both persistence paths fail', async () => {
    const service = setup(); await flush(); publish();
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    vi.mocked(runTransaction).mockRejectedValue(new Error('Offline'));
    service.recordDeviceChoice('owner', 'disabled'); await flush();
    owners.next(owner); await flush(); publish();
    expect(service.due()).toBe(false);
    const next = { ...owner, uid: 'next' }; auth.currentUser = next; owners.next(next); await flush(); publish();
    expect(service.due()).toBe(true);
    auth.currentUser = owner; owners.next(owner); await flush(); publish();
    expect(service.due()).toBe(false);
    storageWrite.mockRestore();
  });
  it('persists an explicit device choice after a pending claim check finishes', async () => {
    let verify!: (value: { claims: object }) => void;
    owner.getIdTokenResult.mockReturnValue(new Promise(resolve => { verify = resolve; }));
    const service = setup(); service.recordDeviceChoice('owner', 'disabled');
    expect(runTransaction).not.toHaveBeenCalled();
    verify({ claims: {} }); await flush(); publish();
    expect(transaction.set).toHaveBeenCalledWith({ path: 'users/owner/config/settings' },
      { appSettings: { notificationInvitation: { version: 1, choice: 'disabled' } } }, { merge: true });
    expect(service.due()).toBe(false);
  });
  it.each(['signed out', 'impersonating'])('does not persist a deferred choice when %s after the claim check', async state => {
    let verify!: (value: { claims: object }) => void;
    owner.getIdTokenResult.mockReturnValue(new Promise(resolve => { verify = resolve; }));
    const service = setup(); service.recordDeviceChoice('owner', 'disabled');
    if (state === 'signed out') { auth.currentUser = null; owners.next(null); }
    verify({ claims: state === 'impersonating' ? { impersonatedBy: 'admin' } : {} }); await flush();
    expect(runTransaction).not.toHaveBeenCalled();
  });
  it('rejects a changed account before committing a pending choice', async () => {
    const service = setup(); await flush(); publish();
    transaction.get.mockImplementation(async () => { auth.currentUser = null; return { exists: () => true, data: () => ({}) }; });
    expect(await service.choose('dismissed')).toBe(false); expect(transaction.set).not.toHaveBeenCalled();
  });
  it('does not create preferences for a deleted account', async () => {
    const service = setup(); await flush(); publish(); accountExists = false;
    expect(await service.choose('dismissed')).toBe(false); expect(transaction.set).not.toHaveBeenCalled();
  });
  it('does not drop explicit device choices while another preference write is pending', async () => {
    const service = setup(); await flush(); publish();
    let finish!: () => void;
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
      await new Promise<void>(resolve => { finish = resolve; }); return fn(transaction);
    });
    const snoozing = service.choose('snoozed');
    service.recordDeviceChoice('owner', 'disabled'); await flush();
    expect(runTransaction).toHaveBeenCalledTimes(2); expect(service.saving()).toBe(true);
    // The retrying snooze sees the terminal preference committed by the other transaction.
    settings = { appSettings: { notificationInvitation: { version: 1, choice: 'disabled' } } };
    finish(); await snoozing; expect(service.due()).toBe(false); expect(service.saving()).toBe(false);
    expect(transaction.set.mock.calls.at(-1)[1].appSettings.notificationInvitation.choice).toBe('disabled');
  });
  it('does not read or change preferences when impersonating', async () => {
    owner.getIdTokenResult.mockResolvedValue({ claims: { impersonatedBy: 'admin' } });
    const service = setup(); await flush();
    expect(onSnapshot).not.toHaveBeenCalled(); expect(await service.choose('dismissed')).toBe(false);
  });
});
