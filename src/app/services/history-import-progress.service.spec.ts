import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames, User } from '@sports-alliance/sports-lib';
import { Auth, type FirebaseUserType } from 'app/firebase/auth';
import { AppUserService } from './app.user.service';
import { HistoryImportProgressService } from './history-import-progress.service';
import { HISTORY_IMPORT_RECENT_MS } from '../helpers/history-import-progress.helper';
import { APP_STORAGE } from './storage/app.storage.token';
import { MemoryStorage } from './storage/memory.storage';
const sdk = vi.hoisted(() => ({authState: vi.fn()}));
vi.mock('app/firebase/auth', async original => ({...await original<typeof import('app/firebase/auth')>(), authState: sdk.authState}));
const now = Date.UTC(2026, 9, 26);
const status = (active = true) => ({runId: 'run', rangePreset: '30_days', active, updatedAtMs: now,
  steps: [{id: 'activities', resources: ['activities'], status: active ? 'requesting' : 'processed', count: 7}]});

describe('HistoryImportProgressService', () => {
  let sessions$: BehaviorSubject<FirebaseUserType | null>;
  let profiles$: BehaviorSubject<User | null>;
  let auth: {currentUser: FirebaseUserType | null};
  let reads: Map<string, BehaviorSubject<Record<string, unknown> | undefined>>;
  let getMeta: ReturnType<typeof vi.fn>;
  let storage: MemoryStorage;
  function session(uid: string): FirebaseUserType { return {uid} as FirebaseUserType; }
  function connect(uid: string) {
    auth.currentUser = session(uid); sessions$.next(auth.currentUser); profiles$.next(new User(uid));
  }
  function stream(uid: string, service = ServiceNames.SuuntoApp) { return reads.get(uid + '/' + service)!; }
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    sessions$ = new BehaviorSubject<FirebaseUserType | null>(null);
    profiles$ = new BehaviorSubject<User | null>(null);
    auth = {currentUser: null}; reads = new Map(); storage = new MemoryStorage();
    sdk.authState.mockReturnValue(sessions$);
    getMeta = vi.fn((user: User, service: ServiceNames) => {
      const key = user.uid + '/' + service;
      if (!reads.has(key)) reads.set(key, new BehaviorSubject<Record<string, unknown> | undefined>(undefined));
      return reads.get(key)!;
    });
    TestBed.configureTestingModule({providers: [{provide: Auth, useValue: auth}, {provide: APP_STORAGE, useValue: storage},
      {provide: AppUserService, useValue: {user$: profiles$, getUserMetaForService: getMeta}}]});
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });
  it('waits for a verified matching profile and creates only four shared owner reads', () => {
    const service = TestBed.inject(HistoryImportProgressService);
    auth.currentUser = session('a'); sessions$.next(auth.currentUser);
    expect(getMeta).not.toHaveBeenCalled();
    profiles$.next(new User('a'));
    expect(getMeta).toHaveBeenCalledTimes(4);
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status()});
    const header = service.view, dashboard = service.view;
    expect(header().items).toBe(dashboard().items);
    expect(header().items[0].steps[0].count).toBe(7);
    profiles$.next(new User('a'));
    expect(getMeta).toHaveBeenCalledTimes(4);
    stream('a').next({connectionState: 'connected', connectionHistoryImport: {...status(), steps: [{id: 'activities', resources: ['activities'], status: 'requesting', count: 12}]}});
    expect(dashboard().items[0].steps[0].count).toBe(12);
  });
  it('clears immediately on raw sign-out, before a delayed profile emission', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status()});
    auth.currentUser = null; sessions$.next(null);
    expect(service.view().items).toEqual([]);
    expect(stream('a').observed).toBe(false);
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status()});
    service.refresh();
    expect(service.view().items).toEqual([]);
    expect(getMeta).toHaveBeenCalledTimes(4);
  });
  it('never exposes another owner and discards old reads across A/B/A', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status()});
    const first = service.owner();
    auth.currentUser = session('b'); sessions$.next(auth.currentUser);
    expect(service.view().items).toEqual([]);
    profiles$.next(new User('b'));
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status()});
    expect(service.view().items).toEqual([]);
    connect('a');
    expect(service.owner()).not.toBe(first);
    expect(getMeta).toHaveBeenCalledTimes(12);
  });
  it('shows unavailable and retries read errors without changing the owner identity', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a'); const owner = service.owner();
    stream('a').error(new Error('read unavailable'));
    expect(service.view().items[0].kind).toBe('unavailable');
    reads.set('a/' + ServiceNames.SuuntoApp, new BehaviorSubject<Record<string, unknown> | undefined>({connectionState: 'connected', connectionHistoryImport: status()}));
    service.refresh();
    expect(service.owner()).toBe(owner);
    expect(service.view().items[0].kind).toBe('active');
    expect(getMeta).toHaveBeenCalledTimes(8);
  });
  it('expires recent terminal context without polling or further metadata reads', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status(false)}); TestBed.flushEffects();
    expect(service.view().items).toHaveLength(1);
    vi.advanceTimersByTime(HISTORY_IMPORT_RECENT_MS); TestBed.flushEffects();
    expect(service.view().items).toEqual([]);
    expect(getMeta).toHaveBeenCalledTimes(4);
  });
  it('unsubscribes and cancels timers on destruction', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status(false)}); TestBed.flushEffects();
    TestBed.resetTestingModule();
    expect(stream('a').observed).toBe(false);
    service.refresh();
    expect(getMeta).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not subscribe to account or metadata reads during server rendering', () => {
    const getStoredPreference = vi.spyOn(storage, 'getItem');
    const setStoredPreference = vi.spyOn(storage, 'setItem');
    TestBed.overrideProvider(PLATFORM_ID, {useValue: 'server'});
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    expect(service.view().items).toEqual([]);
    expect(getMeta).not.toHaveBeenCalled();
    expect(service.dashboardHidden()).toBe(false);
    expect(service.setDashboardHidden(true, service.owner())).toBe(false);
    expect(getStoredPreference).not.toHaveBeenCalled();
    expect(setStoredPreference).not.toHaveBeenCalled();
  });
  it('clears retained status if the verified profile stream fails', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status()});
    profiles$.error(new Error('profile unavailable'));
    expect(service.view().items).toEqual([]);
    expect(stream('a').observed).toBe(false);
  });
  it('uses current connection lifecycle from the same metadata read to stop stale active status', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    const projection = status();
    stream('a').next({connectionState: 'connected', connectionHistoryImport: projection});
    expect(service.view().active).toBe(true);
    stream('a').next({connectionState: 'reconnect_required', connectionHistoryImport: projection});
    expect(service.view().active).toBe(false);
    expect(service.view().items[0].label).toBe('Reconnect required');
    stream('a').next({connectionState: 'disconnect_pending', connectionHistoryImport: projection});
    expect(service.view().items).toEqual([]);
    // Disconnect completion clears connectionState but retains the old projection.
    stream('a').next({connectionHistoryImport: projection});
    expect(service.view().items).toEqual([]);
    expect(getMeta).toHaveBeenCalledTimes(4);
  });
  it('keeps the last status visible while refreshed metadata is pending and ignores repeat refreshes', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status()});
    const owner = service.owner();
    const pending = new Map<ServiceNames, Subject<Record<string, unknown> | undefined>>();
    getMeta.mockImplementation((_user: User, provider: ServiceNames) => {
      const next = new Subject<Record<string, unknown> | undefined>(); pending.set(provider, next); return next;
    });
    service.refresh();
    expect(service.owner()).toBe(owner);
    expect(service.view().items[0]?.steps[0].count).toBe(7);
    expect(service.refreshing()).toBe(true);
    service.refresh();
    expect(getMeta).toHaveBeenCalledTimes(8);
    pending.get(ServiceNames.SuuntoApp)!.next({connectionState: 'disconnect_pending', connectionHistoryImport: status()});
    expect(service.view().items).toEqual([]);
    expect(service.refreshing()).toBe(true);
    for (const [provider, source] of pending) source.next(provider === ServiceNames.SuuntoApp
      ? {connectionState: 'connected', connectionHistoryImport: {...status(), steps: [{id: 'activities', resources: ['activities'], status: 'requesting', count: 12}]}} : undefined);
    expect(service.refreshing()).toBe(false);
    expect(service.view().items[0]?.steps[0].count).toBe(12);
    service.refresh();
    const oldRead = pending.get(ServiceNames.SuuntoApp)!;
    auth.currentUser = null; sessions$.next(null);
    oldRead.next({connectionState: 'connected', connectionHistoryImport: status()});
    expect(oldRead.observed).toBe(false);
    expect(service.refreshing()).toBe(false);
    expect(service.view().items).toEqual([]);
  });
  it('remembers dashboard visibility for this account while retaining live header status', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionState: 'connected', connectionHistoryImport: status()});
    const owner = service.owner();
    expect(service.dashboardHidden()).toBe(false);
    expect(service.setDashboardHidden(true, owner)).toBe(true);
    expect(service.setDashboardHidden(true, owner)).toBe(false);
    expect(service.dashboardHidden()).toBe(true);
    expect(service.view().active).toBe(true);
    expect(getMeta).toHaveBeenCalledTimes(4);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({providers: [{provide: Auth, useValue: auth}, {provide: APP_STORAGE, useValue: storage},
      {provide: AppUserService, useValue: {user$: profiles$, getUserMetaForService: getMeta}}]});
    const restored = TestBed.inject(HistoryImportProgressService);
    expect(restored.dashboardHidden()).toBe(true);
    expect(restored.setDashboardHidden(false, restored.owner())).toBe(true);
    expect(restored.dashboardHidden()).toBe(false);
    expect(storage.length).toBe(0);
  });
  it('keeps visibility preferences separate between accounts and rejects stale panel actions', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a'); const firstOwner = service.owner();
    service.setDashboardHidden(true, firstOwner);
    connect('b');
    expect(service.dashboardHidden()).toBe(false);
    expect(service.setDashboardHidden(true, firstOwner)).toBe(false);
    auth.currentUser = null; sessions$.next(null);
    expect(service.dashboardHidden()).toBe(false);
    expect(service.setDashboardHidden(true, service.owner())).toBe(false);
    connect('a');
    expect(service.dashboardHidden()).toBe(true);
  });
  it('allows hide and restore for this session if browser storage is unavailable', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    vi.spyOn(storage, 'removeItem').mockImplementation(() => { throw new Error('storage blocked'); });
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    expect(service.dashboardHidden()).toBe(false);
    expect(service.setDashboardHidden(true, service.owner())).toBe(true);
    expect(service.dashboardHidden()).toBe(true);
    expect(service.setDashboardHidden(false, service.owner())).toBe(true);
    expect(service.dashboardHidden()).toBe(false);
  });
});
