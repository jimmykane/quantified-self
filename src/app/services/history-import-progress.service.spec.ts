import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames, User } from '@sports-alliance/sports-lib';
import { Auth, type FirebaseUserType } from 'app/firebase/auth';
import { AppUserService } from './app.user.service';
import { HistoryImportProgressService } from './history-import-progress.service';
import { HISTORY_IMPORT_RECENT_MS } from '../helpers/history-import-progress.helper';
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
  function session(uid: string): FirebaseUserType { return {uid} as FirebaseUserType; }
  function connect(uid: string) {
    auth.currentUser = session(uid); sessions$.next(auth.currentUser); profiles$.next(new User(uid));
  }
  function stream(uid: string, service = ServiceNames.SuuntoApp) { return reads.get(uid + '/' + service)!; }
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    sessions$ = new BehaviorSubject<FirebaseUserType | null>(null);
    profiles$ = new BehaviorSubject<User | null>(null);
    auth = {currentUser: null}; reads = new Map();
    sdk.authState.mockReturnValue(sessions$);
    getMeta = vi.fn((user: User, service: ServiceNames) => {
      const key = user.uid + '/' + service;
      if (!reads.has(key)) reads.set(key, new BehaviorSubject<Record<string, unknown> | undefined>(undefined));
      return reads.get(key)!;
    });
    TestBed.configureTestingModule({providers: [{provide: Auth, useValue: auth},
      {provide: AppUserService, useValue: {user$: profiles$, getUserMetaForService: getMeta}}]});
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });
  it('waits for a verified matching profile and creates only four shared owner reads', () => {
    const service = TestBed.inject(HistoryImportProgressService);
    auth.currentUser = session('a'); sessions$.next(auth.currentUser);
    expect(getMeta).not.toHaveBeenCalled();
    profiles$.next(new User('a'));
    expect(getMeta).toHaveBeenCalledTimes(4);
    stream('a').next({connectionHistoryImport: status()});
    const header = service.view, dashboard = service.view;
    expect(header().items).toBe(dashboard().items);
    expect(header().items[0].steps[0].count).toBe(7);
    profiles$.next(new User('a'));
    expect(getMeta).toHaveBeenCalledTimes(4);
    stream('a').next({connectionHistoryImport: {...status(), steps: [{id: 'activities', resources: ['activities'], status: 'requesting', count: 12}]}});
    expect(dashboard().items[0].steps[0].count).toBe(12);
  });
  it('clears immediately on raw sign-out, before a delayed profile emission', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionHistoryImport: status()});
    auth.currentUser = null; sessions$.next(null);
    expect(service.view().items).toEqual([]);
    expect(stream('a').observed).toBe(false);
    stream('a').next({connectionHistoryImport: status()});
    service.refresh();
    expect(service.view().items).toEqual([]);
    expect(getMeta).toHaveBeenCalledTimes(4);
  });
  it('never exposes another owner and discards old reads across A/B/A', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionHistoryImport: status()});
    const first = service.owner();
    auth.currentUser = session('b'); sessions$.next(auth.currentUser);
    expect(service.view().items).toEqual([]);
    profiles$.next(new User('b'));
    stream('a').next({connectionHistoryImport: status()});
    expect(service.view().items).toEqual([]);
    connect('a');
    expect(service.owner()).not.toBe(first);
    expect(getMeta).toHaveBeenCalledTimes(12);
  });
  it('shows unavailable and retries read errors without changing the owner identity', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a'); const owner = service.owner();
    stream('a').error(new Error('read unavailable'));
    expect(service.view().items[0].kind).toBe('unavailable');
    reads.set('a/' + ServiceNames.SuuntoApp, new BehaviorSubject<Record<string, unknown> | undefined>({connectionHistoryImport: status()}));
    service.refresh();
    expect(service.owner()).toBe(owner);
    expect(service.view().items[0].kind).toBe('active');
    expect(getMeta).toHaveBeenCalledTimes(8);
  });
  it('expires recent terminal context without polling or further metadata reads', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionHistoryImport: status(false)}); TestBed.flushEffects();
    expect(service.view().items).toHaveLength(1);
    vi.advanceTimersByTime(HISTORY_IMPORT_RECENT_MS); TestBed.flushEffects();
    expect(service.view().items).toEqual([]);
    expect(getMeta).toHaveBeenCalledTimes(4);
  });
  it('unsubscribes and cancels timers on destruction', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionHistoryImport: status(false)}); TestBed.flushEffects();
    TestBed.resetTestingModule();
    expect(stream('a').observed).toBe(false);
    service.refresh();
    expect(getMeta).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not subscribe to account or metadata reads during server rendering', () => {
    TestBed.overrideProvider(PLATFORM_ID, {useValue: 'server'});
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    expect(service.view().items).toEqual([]);
    expect(getMeta).not.toHaveBeenCalled();
  });
  it('clears retained status if the verified profile stream fails', () => {
    const service = TestBed.inject(HistoryImportProgressService); connect('a');
    stream('a').next({connectionHistoryImport: status()});
    profiles$.error(new Error('profile unavailable'));
    expect(service.view().items).toEqual([]);
    expect(stream('a').observed).toBe(false);
  });
});
