import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { SwPush } from '@angular/service-worker';
import { Auth, user } from 'app/firebase/auth';
import { Firestore, getDocFromServer, setDoc, updateDoc, deleteDoc } from 'app/firebase/firestore';
import { AppNotificationPreferencesService } from './app.notification-preferences.service';
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
  doc: vi.fn((_db, path) => ({ path })), getDocFromServer: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn() }));
const id = '00000000-0000-4000-8000-000000000001';
const key = 'B' + 'A'.repeat(86);
const categoryEnabled = signal(true);
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
let config: { configLoaded: ReturnType<typeof signal<boolean>>; webPushEnabled: ReturnType<typeof signal<boolean>>; webPushHistoryEnabled: ReturnType<typeof signal<boolean>>; webPushDeliveryEnabled: ReturnType<typeof signal<boolean>>; webPushPublicKey: ReturnType<typeof signal<string>> };
let functions: { call: ReturnType<typeof vi.fn> };
let rotations: Subject<unknown>;
let workerReady: Subject<unknown>;
let notifications: { permission: string; requestPermission: ReturnType<typeof vi.fn> };
let support: { checkPushSupport: ReturnType<typeof vi.fn>; createRandomUUID: ReturnType<typeof vi.fn> };
function setup(platform = 'browser', conventional = false) {
  TestBed.configureTestingModule({ providers: [
    AppPushService, AuthSessionCleanupService,
    { provide: AppNotificationPreferencesService, useValue: { isEnabled: () => categoryEnabled() } },
    { provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} },
    { provide: AppRemoteConfigService, useValue: config }, { provide: AppFunctionsService, useValue: functions },
    { provide: AppWindowService, useValue: { windowRef: windows } }, { provide: APP_STORAGE, useValue: storage },
    { provide: BrowserCompatibilityService, useValue: support }, { provide: PLATFORM_ID, useValue: platform },
    { provide: SwPush, useValue: { isEnabled: conventional, subscription: workerReady, pushSubscriptionChanges: rotations } },
  ] });
  return TestBed.inject(AppPushService);
}
beforeEach(() => {
  vi.clearAllMocks(); categoryEnabled.set(true); storage = window.localStorage; storage.clear();
  owner = { uid: 'owner', getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }) };
  owner$ = new BehaviorSubject(owner); auth = { currentUser: owner }; vi.mocked(user).mockReturnValue(owner$ as never);
  subscription = { endpoint: registration.endpoint, options: { applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer },
    toJSON: vi.fn(() => ({ endpoint: registration.endpoint, keys: registration.keys })), unsubscribe: vi.fn().mockResolvedValue(true) };
  manager = { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockResolvedValue(subscription) };
  windows = { pushManager: manager, location: { origin: registration.origin }, navigator: { userAgent: 'desktop',
    serviceWorker: { ready: Promise.resolve({ pushManager: manager }) } }, document: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
    addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: vi.fn().mockReturnValue({ matches: false }) } as unknown as typeof windows;
  config = { configLoaded: signal(true), webPushEnabled: signal(true), webPushHistoryEnabled: signal(true), webPushDeliveryEnabled: signal(true), webPushPublicKey: signal(key) };
  functions = { call: vi.fn().mockResolvedValue({ data: { status: 'accepted' } }) }; rotations = new Subject(); workerReady = new Subject();
  notifications = { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') }; vi.stubGlobal('Notification', notifications);
  support = { checkPushSupport: vi.fn().mockReturnValue(true), createRandomUUID: vi.fn().mockReturnValue(id) };
  vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => true, data: () => registration } as never);
  vi.mocked(setDoc).mockResolvedValue(undefined); vi.mocked(updateDoc).mockResolvedValue(undefined); vi.mocked(deleteDoc).mockResolvedValue(undefined);
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
    setup(); workerReady.next(null); rotations.next({}); await tick();
    expect(storage.getItem(localKey)).not.toBeNull(); expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
  it('observes configuration loading even when the first effect runs before Auth hydration', async () => {
    const pending = new Subject<typeof owner>(); vi.mocked(user).mockReturnValue(pending as never);
    config.configLoaded.set(false); config.webPushEnabled.set(false); config.webPushPublicKey.set('');
    const service = setup(); await tick(); pending.next(owner); await tick();
    expect(service.state()).toBe('unavailable');
    config.webPushEnabled.set(true); config.webPushPublicKey.set(key); config.configLoaded.set(true); await tick();
    expect(service.canEnable()).toBe(true); expect(notifications.requestPermission).not.toHaveBeenCalled();
  });
  it('discovers and revokes a retained browser subscription on signed-out startup', async () => {
    auth.currentUser = null; owner$.next(null); manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick();
    expect(subscription.unsubscribe).toHaveBeenCalled(); expect(storage.getItem(localKey)).toBeNull();
    expect(service.state()).toBe('signed-out'); expect(deleteDoc).not.toHaveBeenCalled();
  });
  it('retains cleanup evidence when signed-out browser revocation fails', async () => {
    auth.currentUser = null; owner$.next(null); manager.getSubscription.mockResolvedValue(subscription);
    subscription.unsubscribe.mockRejectedValue(new Error('browser unavailable'));
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick();
    expect(storage.getItem(localKey)).not.toBeNull(); expect(service.state()).toBe('unavailable');
  });
  it('explains Home Screen installation when iOS hides the push APIs in a browser tab', async () => {
    Object.assign(windows.navigator, { userAgent: 'iPhone' }); support.checkPushSupport.mockReturnValue(false);
    const service = setup(); await tick(); expect(service.state()).toBe('install-required');
    expect(manager.getSubscription).not.toHaveBeenCalled();
    expect(workerReady.observed).toBe(false); expect(rotations.observed).toBe(false);
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
  it.each(['fcm/send', 'wp'])('retains a Chrome subscription with a colon in its %s token', async path => {
    const endpoint = `https://fcm.googleapis.com/${path}/synthetic-client:synthetic-token`;
    delete windows.pushManager;
    subscription.endpoint = endpoint;
    subscription.toJSON.mockReturnValue({ endpoint, keys: registration.keys });
    vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => true, data: () => ({ ...registration, endpoint }) } as never);
    const service = setup('browser', true); await tick();
    const enabling = service.enable();
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    await enabling; await tick();
    expect(setDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ endpoint }));
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
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
  it.each(['missing', 'invalid-origin'])('does not recreate %s registration on a worker rotation', async kind => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick(); expect(service.state()).toBe('enabled');
    vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => kind !== 'missing',
      data: () => kind === 'missing' ? undefined : { ...registration, origin: 'https://beta.quantified-self.io' } } as never);
    rotations.next({}); await tick();
    expect(setDoc).not.toHaveBeenCalled(); expect(updateDoc).not.toHaveBeenCalled(); expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(service.state()).toBe('disabled');
  });
  it('reconciles changed subscription encryption keys only while consent is still stored', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick();
    const keys = { ...registration.keys, auth: 'C'.repeat(22) };
    subscription.toJSON.mockReturnValue({ endpoint: registration.endpoint, keys });
    rotations.next({}); await tick();
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ keys }));
    expect(setDoc).not.toHaveBeenCalled();
    expect(service.state()).toBe('enabled');
  });
  it('does not unsubscribe a valid rotation when a newer refresh overtakes its write', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick();
    const keys = { ...registration.keys, auth: 'C'.repeat(22) };
    subscription.toJSON.mockReturnValue({ endpoint: registration.endpoint, keys });
    let finish!: () => void;
    vi.mocked(updateDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    rotations.next({}); await tick(); expect(updateDoc).toHaveBeenCalledTimes(1);
    vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => true, data: () => ({ ...registration, keys }) } as never);
    workerReady.next(subscription); await tick(); expect(service.state()).toBe('enabled');
    finish(); await tick();
    expect(subscription.unsubscribe).not.toHaveBeenCalled(); expect(service.state()).toBe('enabled');
  });
  it('does not let a stale browser read replace the subscription used by a newer refresh', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick();
    let finishOldRead!: (value: typeof subscription) => void;
    manager.getSubscription.mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve; }));
    workerReady.next(null); await tick();
    const replacement = { ...subscription, endpoint: 'https://web.push.apple.com/replacement',
      toJSON: vi.fn(() => ({ endpoint: 'https://web.push.apple.com/replacement', keys: registration.keys })) };
    manager.getSubscription.mockResolvedValue(replacement);
    let finishServerRead!: (value: unknown) => void;
    vi.mocked(getDocFromServer).mockImplementationOnce(() => new Promise(resolve => { finishServerRead = resolve; }));
    rotations.next({}); await tick();
    finishOldRead(subscription); await tick();
    finishServerRead({ exists: () => true, data: () => ({ ...registration, endpoint: replacement.endpoint }) }); await tick();
    expect(updateDoc).not.toHaveBeenCalled(); expect(service.state()).toBe('enabled');
  });
  it('does not revoke a replacement subscription when an earlier self-test expires', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick();
    let finishTest!: (value: unknown) => void;
    functions.call.mockImplementationOnce(() => new Promise(resolve => { finishTest = resolve; }));
    const test = service.sendTest();
    const replacement = { ...subscription, endpoint: 'https://web.push.apple.com/replacement', unsubscribe: vi.fn().mockResolvedValue(true),
      toJSON: vi.fn(() => ({ endpoint: 'https://web.push.apple.com/replacement', keys: registration.keys })) };
    manager.getSubscription.mockResolvedValue(replacement);
    vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => true,
      data: () => ({ ...registration, endpoint: replacement.endpoint, generation: '00000000-0000-4000-8000-000000000002' }) } as never);
    rotations.next({}); // Delivered while the self-test is still pending.
    finishTest({ data: { status: 'subscription_expired' } }); await test; await tick();
    expect(replacement.unsubscribe).not.toHaveBeenCalled(); expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(storage.getItem(localKey)).not.toBeNull(); expect(service.state()).toBe('enabled');
  });
  it.each([
    ['lookup', false], ['lookup', true], ['unsubscribe', false], ['unsubscribe', true],
  ])('preserves replacement consent after late cleanup (%s, account change %s)', async (stage, accountChange) => {
    vi.useFakeTimers();
    try {
      notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
      storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
      const service = setup(); await tick();
      const replacementOwner = accountChange
        ? { uid: 'replacement-owner', getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }) } : owner;
      const replacementId = '00000000-0000-4000-8000-000000000002';
      const replacement = { ...subscription, endpoint: 'https://web.push.apple.com/replacement', unsubscribe: vi.fn().mockResolvedValue(true),
        toJSON: vi.fn(() => ({ endpoint: 'https://web.push.apple.com/replacement', keys: registration.keys })) };
      let finishCleanup!: () => void;
      if (stage === 'lookup') {
        manager.getSubscription.mockImplementationOnce(() => new Promise(resolve => { finishCleanup = () => resolve(replacement); }));
      } else {
        subscription.unsubscribe.mockImplementationOnce(() => new Promise(resolve => { finishCleanup = () => resolve(true); }));
      }
      const cleanup = TestBed.inject(AuthSessionCleanupService).run(); await tick();
      await vi.advanceTimersByTimeAsync(2000); await cleanup;
      manager.getSubscription.mockResolvedValue(replacement);
      storage.setItem(localKey, JSON.stringify({ uid: replacementOwner.uid, installationId: replacementId }));
      vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => true, data: () => ({ ...registration, endpoint: replacement.endpoint }) } as never);
      if (accountChange) { auth.currentUser = replacementOwner; owner$.next(replacementOwner); }
      await tick(); expect(service.state()).toBe('enabled');
      finishCleanup(); await tick();
      expect(JSON.parse(storage.getItem(localKey)!)).toEqual({ uid: replacementOwner.uid, installationId: replacementId });
      expect(service.state()).toBe('enabled'); expect(service.registered()).toBe(true);
      expect(replacement.unsubscribe).not.toHaveBeenCalled();
      expect(deleteDoc).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: `users/owner/pushSubscriptions/${id}` }));
    } finally { vi.useRealTimers(); }
  });
  it('finishes checking when another tab replaces consent during background revocation', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    const service = setup(); await tick();
    let finishUnsubscribe!: (value: boolean) => void;
    subscription.unsubscribe.mockImplementationOnce(() => new Promise(resolve => { finishUnsubscribe = resolve; }));
    vi.mocked(getDocFromServer).mockResolvedValueOnce({ exists: () => false, data: () => undefined } as never);
    rotations.next({}); await tick(); expect(service.state()).toBe('loading');
    const replacementId = '00000000-0000-4000-8000-000000000002';
    const replacement = { ...subscription, endpoint: 'https://web.push.apple.com/replacement', unsubscribe: vi.fn().mockResolvedValue(true),
      toJSON: vi.fn(() => ({ endpoint: 'https://web.push.apple.com/replacement', keys: registration.keys })) };
    manager.getSubscription.mockResolvedValue(replacement);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: replacementId }));
    vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => true, data: () => ({ ...registration, endpoint: replacement.endpoint }) } as never);
    finishUnsubscribe(true); await tick();
    expect(service.state()).toBe('enabled'); expect(service.registered()).toBe(true);
    expect(JSON.parse(storage.getItem(localKey)!).installationId).toBe(replacementId);
    expect(replacement.unsubscribe).not.toHaveBeenCalled();
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
    functions.call.mockImplementationOnce(async () => {
      vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => false, data: () => undefined } as never);
      return { data: { status: 'subscription_expired' } };
    });
    await service.sendTest(); await tick(); expect(service.state()).toBe('disabled'); expect(subscription.unsubscribe).toHaveBeenCalled();
  });
  it('detaches before auth cleanup, including browser revocation when deletion fails', async () => {
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    setup(); await tick(); vi.mocked(deleteDoc).mockRejectedValueOnce(new Error('offline'));
    await TestBed.inject(AuthSessionCleanupService).run(); expect(subscription.unsubscribe).toHaveBeenCalled(); expect(storage.getItem(localKey)).toBeNull();
  });
});


describe('one-import notification device consent', () => {
  async function enabled() {
    storage.setItem(localKey, JSON.stringify({ uid: 'owner', installationId: id }));
    notifications.permission = 'granted'; manager.getSubscription.mockResolvedValue(subscription);
    const service = setup(); await tick(); return service;
  }
  it('returns only the current installation and generation, never endpoint or keys', async () => {
    const service = await enabled();
    expect(service.canNotifyHistory()).toBe(true);
    expect(await service.historyNotificationTarget('owner')).toEqual({ installationId: id, generation: id });
    expect(notifications.requestPermission).not.toHaveBeenCalled();
  });
  it('gets a fresh delivery target and respects its independent flag and category', async () => {
    const service = await enabled();
    expect(await service.deliveryNotificationTarget('owner')).toEqual({ installationId: id, generation: id });
    config.webPushDeliveryEnabled.set(false); expect(service.deliveryNotificationsAvailable()).toBe(false);
    await expect(service.deliveryNotificationTarget('owner')).rejects.toThrow('Activity delivery');
    config.webPushDeliveryEnabled.set(true); categoryEnabled.set(false);
    await expect(service.deliveryNotificationTarget('owner')).rejects.toThrow('Activity delivery');
  });
  it('keeps beta and a disabled history switch out of automatic notification consent', async () => {
    const service = await enabled(); config.webPushHistoryEnabled.set(false);
    expect(service.historyNotificationsAvailable()).toBe(false);
    await expect(service.historyNotificationTarget('owner')).rejects.toThrow();
    config.webPushHistoryEnabled.set(true);
    Object.defineProperty(windows, 'location', { value: { origin: 'https://beta.quantified-self.io' }, configurable: true });
    config.webPushEnabled.set(false); config.webPushEnabled.set(true);
    expect(service.historyNotificationsAvailable()).toBe(false);
  });
  it('keeps category opt-out separate from device permission and self-tests', async () => {
    const service = await enabled(); categoryEnabled.set(false);
    expect(service.canNotifyHistory()).toBe(false); expect(service.canTest()).toBe(true);
    await expect(service.historyNotificationTarget('owner')).rejects.toThrow('History imports category');
  });
  it('rechecks category opt-out after the device lookup', async () => {
    const service = await enabled();
    let resolve!: (value: unknown) => void;
    vi.mocked(getDocFromServer).mockReturnValueOnce(new Promise(done => { resolve = done; }) as never);
    const pending = service.historyNotificationTarget('owner'); categoryEnabled.set(false);
    resolve({ exists: () => true, data: () => registration });
    await expect(pending).rejects.toThrow('changed');
  });
  it('rejects account changes during the authoritative registration lookup', async () => {
    const service = await enabled();
    let resolve: (value: unknown) => void;
    vi.mocked(getDocFromServer).mockReturnValueOnce(new Promise(done => { resolve = done; }) as never);
    const pending = service.historyNotificationTarget('owner'); auth.currentUser = null;
    resolve!({ exists: () => true, data: () => registration });
    await expect(pending).rejects.toThrow('changed');
  });
  it('rejects missing, revoked and cross-account consent', async () => {
    const service = await enabled();
    await expect(service.historyNotificationTarget('other')).rejects.toThrow();
    vi.mocked(getDocFromServer).mockResolvedValueOnce({ data: () => undefined } as never);
    await expect(service.historyNotificationTarget('owner')).rejects.toThrow();
  });
});
