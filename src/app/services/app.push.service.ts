import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { Auth, user, type FirebaseUserType } from 'app/firebase/auth';
import { Firestore, doc, getDocFromServer, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'app/firebase/firestore';
import { APP_STORAGE } from './storage/app.storage.token';
import { AppWindowService } from './app.window.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { AppRemoteConfigService } from './app.remote-config.service';
import { AppFunctionsService } from './app.functions.service';
import { AuthSessionCleanupService } from './auth-session-cleanup.service';
import { isPushId, isPushOrigin, isPushRegistration, isVapidPublicKey, type PushRegistration, type PushTestRequest, type PushTestResponse } from '../../../shared/web-push';
import { environment } from '../../environments/environment';

type PushState = 'loading' | 'signed-out' | 'unsupported' | 'install-required' | 'unavailable' | 'impersonating' | 'denied' | 'disabled' | 'enabled';
interface LocalInstallation { uid: string; installationId: string; }
const STORAGE_KEY = 'qs.web-push.installation.v1';
@Injectable({ providedIn: 'root' })
export class AppPushService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly config = inject(AppRemoteConfigService);
  private readonly functions = inject(AppFunctionsService);
  private readonly storage = inject(APP_STORAGE);
  private readonly windows = inject(AppWindowService);
  private readonly compatibility = inject(BrowserCompatibilityService);
  private readonly cleanup = inject(AuthSessionCleanupService);
  private readonly sw = inject(SwPush);
  private readonly destroy = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly state = signal<PushState>('loading');
  readonly operation = signal<'enable' | 'disable' | 'test' | null>(null);
  readonly message = signal('');
  readonly registered = signal(false);
  readonly canEnable = computed(() => this.state() === 'disabled' && !this.operation());
  readonly canTest = computed(() => this.state() === 'enabled' && !this.operation());
  readonly canDisable = computed(() => this.registered() && !this.operation() && this.state() !== 'impersonating');
  private manager: PushManager | null = null;
  private subscription: PushSubscription | null = null;
  private owner: FirebaseUserType | null = null;
  private epoch = 0;
  private authObserved = false;

  constructor() {
    if (!this.browser) { this.state.set('unsupported'); return; }
    const unregister = this.cleanup.register(() => this.detach());
    this.destroy.onDestroy(unregister);
    user(this.auth).pipe(takeUntilDestroyed()).subscribe(owner => {
      this.authObserved = true; this.owner = owner; void this.refresh();
    });
    effect(() => {
      // Track configuration even when Auth has not emitted yet; authObserved is not a signal.
      const loaded = this.config.configLoaded();
      if (this.authObserved && loaded) void this.refresh();
    });
    // Conventional workers can register after the initial bounded readiness wait.
    if (this.compatibility.checkPushSupport()) {
      this.sw.subscription.pipe(takeUntilDestroyed()).subscribe(() => void this.refresh());
      this.sw.pushSubscriptionChanges.pipe(takeUntilDestroyed()).subscribe(() => void this.refresh());
    }
    const refresh = () => { if (this.windows.windowRef.document.visibilityState === 'visible') void this.refresh(); };
    this.windows.windowRef.addEventListener('focus', refresh);
    this.windows.windowRef.document.addEventListener('visibilitychange', refresh);
    this.destroy.onDestroy(() => {
      this.windows.windowRef.removeEventListener('focus', refresh);
      this.windows.windowRef.document.removeEventListener('visibilitychange', refresh);
    });
  }

  private current(owner: FirebaseUserType, epoch: number): boolean {
    return this.owner === owner && this.auth.currentUser === owner && this.epoch === epoch;
  }
  private readLocal(): LocalInstallation | null {
    try {
      const value = JSON.parse(this.storage.getItem(STORAGE_KEY) || 'null');
      return value && typeof value.uid === 'string' && isPushId(value.installationId) ? value : null;
    } catch { return null; }
  }
  private origin(): string { return this.windows.windowRef.location.origin; }
  private async pushManager(): Promise<PushManager | null> {
    const window = this.windows.windowRef as Window & { pushManager?: PushManager };
    if (window.pushManager) return window.pushManager;
    // A normal development build has no worker; do not wait forever on .ready.
    if (!this.sw.isEnabled) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const registration = await Promise.race([
      window.navigator.serviceWorker.ready,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 3000); }),
    ]).finally(() => clearTimeout(timer));
    return registration?.pushManager ?? null;
  }
  private async refresh(): Promise<void> {
    if (!this.browser || !this.authObserved || this.operation()) return;
    const epoch = ++this.epoch;
    const owner = this.owner;
    this.registered.set(false);
    this.state.set('loading');
    try {
      if (!owner || this.auth.currentUser !== owner) {
        if (this.readLocal()) {
          const manager = await this.pushManager();
          if (this.epoch !== epoch) return;
          if (!manager) throw new Error('Browser cleanup unavailable.');
          this.manager = manager;
          await this.revokeBrowser();
        }
        if (this.epoch === epoch) this.state.set('signed-out');
        return;
      }
      const token = await owner.getIdTokenResult();
      if (!this.current(owner, epoch)) return;
      if (token.claims['impersonatedBy']) { this.state.set('impersonating'); return; }
      const window = this.windows.windowRef;
      if ((/iPad|iPhone|iPod/.test(window.navigator.userAgent)
        || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1))
        && !window.matchMedia?.('(display-mode: standalone)').matches
        && !(window.navigator as Navigator & { standalone?: boolean }).standalone) {
        this.state.set('install-required'); return;
      }
      // iOS browser tabs can hide these APIs until the app is opened from the Home Screen.
      if (!this.compatibility.checkPushSupport()) { this.state.set('unsupported'); return; }
      this.manager = await this.pushManager();
      if (!this.current(owner, epoch)) return;
      if (!this.manager) { this.state.set('unavailable'); return; }
      this.subscription = await this.manager.getSubscription();
      if (!this.current(owner, epoch)) return;
      const local = this.readLocal();
      if (local && local.uid !== owner.uid) {
        await this.revokeBrowser(); if (!this.current(owner, epoch)) return;
        this.subscription = null;
      }
      this.registered.set(!!this.subscription);
      if (Notification.permission === 'denied') {
        if (local?.uid === owner.uid) await this.detach();
        if (this.owner === owner && this.auth.currentUser === owner) this.state.set('denied');
        return;
      }
      if (!this.config.webPushEnabled() || !isVapidPublicKey(this.config.webPushPublicKey())
        || !isPushOrigin(this.origin(), environment.useFunctionsEmulator === true)) { this.state.set('unavailable'); return; }
      if (Notification.permission !== 'granted') { this.state.set('disabled'); return; }
      if (!this.subscription && local?.uid === owner.uid) {
        await this.detach(); return;
      }
      if (!this.subscription || !local || local.uid !== owner.uid) {
        // A browser permission is not account consent. Orphan subscriptions must not cross accounts.
        if (this.subscription) await this.revokeBrowser();
        if (this.current(owner, epoch)) { this.registered.set(false); this.state.set('disabled'); }
        return;
      }
      const key = this.subscription.options.applicationServerKey;
      const actualKey = key ? this.encodeKey(key) : '';
      if (actualKey !== this.config.webPushPublicKey()) {
        await this.detach(); this.state.set('disabled'); return;
      }
      const ref = doc(this.firestore, `users/${owner.uid}/pushSubscriptions/${local.installationId}`);
      const snapshot = await getDocFromServer(ref);
      if (!this.current(owner, epoch)) return;
      const saved = snapshot.data();
      if (!snapshot.exists()) { await this.revokeBrowser(); this.registered.set(false); this.state.set('disabled'); return; }
      if (!isPushRegistration(saved, environment.useFunctionsEmulator === true) || saved.origin !== this.origin()
        || saved.vapidPublicKey !== actualKey) { await this.detach(); this.state.set('disabled'); return; }
      const current = this.subscription.toJSON();
      if (saved.endpoint !== current.endpoint || saved.keys.p256dh !== current.keys?.['p256dh'] || saved.keys.auth !== current.keys?.['auth']) {
        await this.persist(owner, local.installationId, this.subscription, epoch, true);
      }
      if (this.current(owner, epoch)) this.state.set('enabled');
    } catch { if (this.epoch === epoch) this.state.set('unavailable'); }
  }
  private encodeKey(key: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  private async persist(owner: FirebaseUserType, id: string, subscription: PushSubscription, epoch: number, reconcile = false): Promise<void> {
    if (!this.current(owner, epoch)) throw new Error('Account changed.');
    const json = subscription.toJSON();
    const value: PushRegistration = { schemaVersion: 1, origin: this.origin(), generation: this.compatibility.createRandomUUID() ?? '',
      vapidPublicKey: this.config.webPushPublicKey(), endpoint: json.endpoint ?? '', keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' } };
    if (!isPushRegistration(value, environment.useFunctionsEmulator === true)) throw new Error('Invalid subscription.');
    const ref = doc(this.firestore, `users/${owner.uid}/pushSubscriptions/${id}`);
    const record = { ...value, updatedAt: serverTimestamp() };
    // Background rotation must not resurrect consent removed after our server read.
    if (reconcile) await updateDoc(ref, record); else await setDoc(ref, record);
    if (!this.current(owner, epoch)) {
      // Another refresh can supersede this write without revoking the same account's consent.
      if (this.owner !== owner || this.auth.currentUser !== owner) await subscription.unsubscribe();
      throw new Error('Registration context changed.');
    }
    if (!reconcile) this.storage.setItem(STORAGE_KEY, JSON.stringify({ uid: owner.uid, installationId: id }));
  }
  async enable(): Promise<void> {
    if (!this.canEnable() || !this.manager || !this.owner) return;
    const owner = this.owner; const epoch = ++this.epoch;
    // Request synchronously in the button gesture, before any network or worker awaits.
    const permission = Notification.requestPermission();
    this.operation.set('enable'); this.message.set('');
    try {
      if (await permission !== 'granted') throw new Error('Permission was not granted.');
      if (!this.current(owner, epoch)) throw new Error('Account changed.');
      const id = this.compatibility.createRandomUUID(); if (!id) throw new Error('Device storage unavailable.');
      const key = this.config.webPushPublicKey();
      const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const subscription = await this.manager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      this.subscription = subscription;
      try { await this.persist(owner, id, subscription, epoch); } catch (error) { await subscription.unsubscribe(); throw error; }
      this.registered.set(true); this.state.set('enabled'); this.message.set('Notifications enabled on this device.');
    } catch { this.message.set('Notifications could not be enabled. Check permission and try again.'); throw new Error('Notification enable failed.'); }
    finally { this.operation.set(null); void this.refresh(); }
  }
  async disable(): Promise<void> {
    if (!this.canDisable()) return;
    this.operation.set('disable'); this.message.set('');
    try { await this.detach(); this.message.set('Notifications disabled on this device.'); }
    catch { this.message.set('Could not finish disabling notifications. Please retry.'); throw new Error('Notification disable failed.'); }
    finally { this.operation.set(null); void this.refresh(); }
  }
  async sendTest(): Promise<boolean> {
    if (!this.canTest() || !this.owner) return false;
    const owner = this.owner; const local = this.readLocal(); const epoch = this.epoch;
    if (!local || local.uid !== owner.uid) return false;
    this.operation.set('test'); this.message.set('');
    try {
      const response = await this.functions.call<PushTestRequest, PushTestResponse>('sendTestPushNotification', { installationId: local.installationId },
        { canExecute: () => this.current(owner, epoch) });
      if (!this.current(owner, epoch)) return false;
      if (response.data.status === 'subscription_expired') {
        await this.revokeBrowser(); this.registered.set(false); this.state.set('disabled'); this.message.set('This registration expired. Enable notifications again.');
        return false;
      } else this.message.set('Test notification sent. If it does not appear, check your device notification settings.');
      return true;
    } catch (error: unknown) {
      if (this.current(owner, epoch)) this.message.set((error as { code?: string })?.code === 'functions/resource-exhausted'
        ? 'Please wait before sending another test. Tests are limited to one per minute and ten per day.' : 'The test could not be sent. Please try again later.');
      throw new Error('Notification test failed.');
    } finally { this.operation.set(null); if (this.owner !== owner) void this.refresh(); }
  }
  private async revokeBrowser(): Promise<void> {
    const manager = this.manager ?? await this.pushManager();
    if (!manager && this.readLocal()) throw new Error('Browser cleanup unavailable.');
    const subscription = await manager?.getSubscription() ?? this.subscription;
    if (subscription && !await subscription.unsubscribe()) {
      const remaining = await manager?.getSubscription();
      if (remaining?.endpoint === subscription.endpoint) throw new Error('Unsubscribe failed.');
    }
    this.subscription = null; this.storage.removeItem(STORAGE_KEY);
  }
  async detach(): Promise<void> {
    ++this.epoch;
    const local = this.readLocal();
    // Start the owner-authorized delete while Auth is still valid; revoke the browser even if it fails.
    const deletion = local && local.uid === this.auth.currentUser?.uid
      ? deleteDoc(doc(this.firestore, `users/${local.uid}/pushSubscriptions/${local.installationId}`)) : Promise.resolve();
    // Attach a rejection handler immediately, even while browser revocation is pending.
    const deleted = deletion.then(() => true, () => false);
    const revoked = await this.revokeBrowser().then(() => true, () => false);
    if (revoked) { this.registered.set(false); this.state.set('disabled'); }
    const removed = await deleted;
    if (!revoked || !removed) throw new Error('Registration cleanup failed.');
  }
}
