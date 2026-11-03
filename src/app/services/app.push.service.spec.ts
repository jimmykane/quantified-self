import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { SwPush } from '@angular/service-worker';
import { Auth, user } from 'app/firebase/auth';
import { Firestore, getDocFromServer, setDoc, deleteDoc } from 'app/firebase/firestore';
import { AppPushService } from './app.push.service';
import { AppRemoteConfigService } from './app.remote-config.service';
import { AppFunctionsService } from './app.functions.service';
import { AppWindowService } from './app.window.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { APP_STORAGE } from './storage/app.storage.token';
import { AuthSessionCleanupService } from './auth-session-cleanup.service';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('app/firebase/auth', async original => ({ ...await original<typeof import('app/firebase/auth')>(), user: vi.fn() }));
vi.mock('app/firebase/firestore', async original => ({ ...await original<typeof import('app/firebase/firestore')>(),
  doc: vi.fn((_db, path) => ({ path })), getDocFromServer: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn() }));
const id = '00000000-0000-4000-8000-000000000001';
const key = 'B' + 'A'.repeat(86);
const localKey = 'qs.web-push.installation.v1';
const registration = { schemaVersion: 1, origin: 'https://quantified-self.io', vapidPublicKey: key, generation: id,
  endpoint: 'https://web.push.apple.com/test', keys: { p256dh: key, auth: 'A'.repeat(22) } };
const tick = async () => { TestBed.tick(); for (let n = 0; n < 30; n++) await Promise.resolve(); };
let owner: { uid: string; getIdTokenResult: ReturnType<typeof vi.fn> };
let owner$: BehaviorSubject<typeof owner | null>;
let auth: { currentUser: typeof owner | null };
let manager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
let subscription: { endpoint: string; options: { applicationServerKey: ArrayBuffer }; toJSON: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> };
let windows: Window & { pushManager?: unknown };
let storage: Storage;
let config: { configLoaded: ReturnType<typeof signal<boolean>>; webPushEnabled: ReturnType<typeof signal<boolean>>; webPushPublicKey: ReturnType<typeof signal<string>> };
let functions: { call: ReturnType<typeof vi.fn> };
let rotations: Subject<unknown>;
let workerReady: Subject<unknown>;
let notifications: { permission: string; requestPermission: ReturnType<typeof vi.fn> };
let support: { checkPushSupport: ReturnType<typeof vi.fn>; createRandomUUID: ReturnType<typeof vi.fn> };
function setup(platform = 'browser', conventional = false) {
  TestBed.configureTestingModule({ providers: [
    AppPushService, AuthSessionCleanupService,
    { provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} },
    { provide: AppRemoteConfigService, useValue: config }, { provide: AppFunctionsService, useValue: functions },
    { provide: AppWindowService, useValue: { windowRef: windows } }, { provide: APP_STORAGE, useValue: storage },
    { provide: BrowserCompatibilityService, useValue: support }, { provide: PLATFORM_ID, useValue: platform },
    { provide: SwPush, useValue: { isEnabled: conventional, subscription: workerReady, pushSubscriptionChanges: rotations } },
  ] });
  return TestBed.inject(AppPushService);
}
beforeEach(() => {
  vi.clearAllMocks(); storage = window.localStorage; storage.clear();
  owner = { uid: 'owner', getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }) };
  owner$ = new BehaviorSubject(owner); auth = { currentUser: owner }; vi.mocked(user).mockReturnValue(owner$ as never);
  subscription = { endpoint: registration.endpoint, options: { applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer },
    toJSON: vi.fn(() => ({ endpoint: registration.endpoint, keys: registration.keys })), unsubscribe: vi.fn().mockResolvedValue(true) };
  manager = { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockResolvedValue(subscription) };
  windows = { pushManager: manager, location: { origin: registration.origin }, navigator: { userAgent: 'desktop',
    serviceWorker: { ready: Promise.resolve({ pushManager: manager }) } }, document: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
    addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: vi.fn().mockReturnValue({ matches: false }) } as unknown as typeof windows;
  config = { configLoaded: signal(true), webPushEnabled: signal(true), webPushPublicKey: signal(key) };
  functions = { call: vi.fn().mockResolvedValue({ data: { status: 'accepted' } }) }; rotations = new Subject(); workerReady = new Subject();
  notifications = { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') }; vi.stubGlobal('Notification', notifications);
  support = { checkPushSupport: vi.fn().mockReturnValue(true), createRandomUUID: vi.fn().mockReturnValue(id) };
  vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => true, data: () => registration } as never);
  vi.mocked(setDoc).mockResolvedValue(undefined); vi.mocked(deleteDoc).mockResolvedValue(undefined);
});
afterEach(() => { TestBed.resetTestingModule(); vi.unstubAllGlobals(); });
describe('device notification lifecycle', () => {
  it('does not touch browser APIs or request permission during SSR', async () => {
    const service = setup('server'); await tick(); expect(service.state()).toBe('unsupported');
    expect(user).not.toHaveBeenCalled(); expect(manager.getSubscription).not.toHaveBeenCalled(); expect(notifications.requestPermission).not.toHaveBeenCalled();
  });
  it('waits for authoritative Auth before touching a retained registration', async () => {
    const pending = new Subject<typeof owner>(); vi.mocked(user).mockReturnValue(pending as never);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    setup(); await tick(); expect(storage.getItem(localKey)).not.toBeNull(); expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
  it.each([false, true])('uses the available push manager (conventional %s) and requests only in a click', async conventional => {
    if (conventional) delete windows.pushManager;
    const service = setup('browser', conventional); await tick(); expect(service.canEnable()).toBe(true);
    expect(notifications.requestPermission).not.toHaveBeenCalled();
    const enabling = service.enable(); expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription); await enabling; await tick();
    expect(manager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(setDoc).toHaveBeenCalledWith(expect.objectContaining({ path: `users/owner/pushSubscriptions/${id}` }), expect.objectContaining(registration));
    expect(service.state()).toBe('enabled');
  });
  it.each(['flag', 'key', 'origin', 'browser', 'worker'])('does not prompt when %s is unavailable', async missing => {
    if (missing === 'flag') config.webPushEnabled.set(false);
    if (missing === 'key') config.webPushPublicKey.set('');
    if (missing === 'origin') Object.assign(windows.location, { origin: 'https://evil.example' });
    if (missing === 'browser') support.checkPushSupport.mockReturnValue(false);
    if (missing === 'worker') delete windows.pushManager;
    const service = setup(); await tick(); expect(service.canEnable()).toBe(false); await service.enable(); expect(notifications.requestPermission).not.toHaveBeenCalled();
  });
  it.each([{ userAgent: 'iPhone' }, { userAgent: 'Mac desktop', platform: 'MacIntel', maxTouchPoints: 5 }])('explains mobile Apple installation and blocked permissions %j', async navigator => {
    Object.assign(windows.navigator, navigator);
    const service = setup(); await tick(); expect(service.state()).toBe('install-required');
    Object.assign(windows.navigator, { standalone: true }); notifications.permission = 'denied';
    windows.addEventListener = vi.fn(); rotations.next({}); await tick(); expect(service.state()).toBe('denied');
  });
  it('recovers when the conventional worker registers after the initial readiness timeout', async () => {
    vi.useFakeTimers();
    try {
      delete windows.pushManager;
      Object.assign(windows.navigator.serviceWorker, { ready: new Promise(() => undefined) });
      const service = setup('browser', true); await tick(); await vi.advanceTimersByTimeAsync(3001); await tick();
      expect(service.state()).toBe('unavailable');
      Object.assign(windows.navigator.serviceWorker, { ready: Promise.resolve({ pushManager: manager }) });
      workerReady.next(null); await tick(); expect(service.canEnable()).toBe(true);
      expect(notifications.requestPermission).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('blocks impersonation without inspecting subscriptions', async () => {
    owner.getIdTokenResult.mockResolvedValue({ claims: { impersonatedBy: 'admin' } });
    const service = setup(); await tick(); expect(service.state()).toBe('impersonating'); expect(manager.getSubscription).not.toHaveBeenCalled();
  });
  it('requires fresh account opt-in even with existing browser permission', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'previous-owner', installationId: id }));
    const service = setup(); await tick(); expect(subscription.unsubscribe).toHaveBeenCalled(); expect(service.state()).toBe('disabled'); expect(setDoc).not.toHaveBeenCalled();
  });
  it('reconciles a saved registration without prompting or rewriting it', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick(); expect(service.state()).toBe('enabled'); expect(setDoc).not.toHaveBeenCalled();
    await service.sendTest(); expect(functions.call).toHaveBeenCalledWith('sendTestPushNotification', { installationId: id }, expect.any(Object));
    expect(service.message()).toContain('Test notification sent');
  });
  it('revokes stale subscriptions after key rotation', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    config.webPushPublicKey.set('B' + 'C'.repeat(86)); storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick(); expect(service.state()).toBe('disabled'); expect(subscription.unsubscribe).toHaveBeenCalled(); expect(deleteDoc).toHaveBeenCalled();
  });
  it('revokes permission-denied registrations and deletes them as the owner', async () => {
    notifications.permission = 'denied'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick(); expect(service.state()).toBe('denied'); expect(deleteDoc).toHaveBeenCalled(); expect(subscription.unsubscribe).toHaveBeenCalled();
  });
  it('unsubscribes if account changes while registration is pending', async () => {
    let finish!: () => void; vi.mocked(setDoc).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const service = setup(); await tick(); const task = service.enable(); for (let n = 0; n < 20; n++) await Promise.resolve();
    auth.currentUser = null; owner$.next(null); finish(); await expect(task).rejects.toThrow(); await tick();
    expect(subscription.unsubscribe).toHaveBeenCalled(); expect(storage.getItem(localKey)).toBeNull(); expect(service.canTest()).toBe(false);
  });
  it('removes expired tests and masks temporary errors', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick(); functions.call.mockRejectedValueOnce({ code: 'functions/resource-exhausted', message: 'private-canary' });
    await expect(service.sendTest()).rejects.toThrow(); expect(service.message()).toContain('one per minute'); expect(service.message()).not.toContain('private-canary');
    functions.call.mockResolvedValueOnce({ data: { status: 'subscription_expired' } }); await service.sendTest(); expect(service.state()).toBe('disabled'); expect(subscription.unsubscribe).toHaveBeenCalled();
  });
  it('detaches before auth cleanup, including browser revocation when deletion fails', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    setup(); await tick(); vi.mocked(deleteDoc).mockRejectedValueOnce(new Error('offline'));
    await TestBed.inject(AuthSessionCleanupService).run(); expect(subscription.unsubscribe).toHaveBeenCalled(); expect(storage.getItem(localKey)).toBeNull();
  });
});
