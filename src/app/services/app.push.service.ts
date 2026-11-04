import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
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
import { isAutomaticPushOrigin } from '../../../shared/web-push';
import type { DeliveryNotificationTarget } from '../../../shared/activity-delivery-notifications';
import type { HistoryNotificationTarget } from '../../../shared/history-import-notifications';
import { AppNotificationPreferencesService } from './app.notification-preferences.service';
import { pushDeviceInfo } from '../helpers/push-device.helper';
import { isPushDeviceInfo } from '@shared/web-push';

type PushState = 'loading' | 'signed-out' | 'unsupported' | 'install-required' | 'unavailable' | 'impersonating' | 'denied' | 'disabled' | 'enabled';
interface LocalInstallation { uid: string; installationId: string; }
const STORAGE_KEY = 'qs.web-push.installation.v1';
@Injectable({ providedIn: 'root' })
export class AppPushService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly config = inject(AppRemoteConfigService);
  private readonly preferences = inject(AppNotificationPreferencesService);
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
  readonly historyNotificationsAvailable = computed(() => this.browser && this.config.webPushEnabled()
    && this.config.webPushHistoryEnabled() && isAutomaticPushOrigin(this.origin()));
  readonly canNotifyHistory = computed(() => this.historyNotificationsAvailable() && this.canTest()
    && this.preferences.isEnabled('history_import'));
  readonly deliveryNotificationsAvailable = computed(() => this.browser && this.config.webPushEnabled()
    && this.config.webPushDeliveryEnabled() && isAutomaticPushOrigin(this.origin()));
  readonly canNotifyDelivery = computed(() => this.deliveryNotificationsAvailable() && this.canTest()
    && this.preferences.isEnabled('activity_delivery'));
  private manager: PushManager | null = null;
  private subscription: PushSubscription | null = null;
  private owner: FirebaseUserType | null = null;
  private epoch = 0;
  private authObserved = false;

  constructor() {
    if (!this.browser) { this.state.set('unsupported'); return; }
    const unregister = this.cleanup.register(async () => { await this.detach(); });
    this.destroy.onDestroy(unregister);
    user(this.auth).pipe(takeUntilDestroyed()).subscribe(owner => {
      this.authObserved = true; this.owner = owner; void this.refresh();
    });
    effect(() => {
      // Track configuration even when Auth has not emitted yet; authObserved is not a signal.
      const loaded = this.config.configLoaded();
      if (this.authObserved && loaded) untracked(() => void this.refresh());
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

  private current(owner: FirebaseUserType | null, epoch: number): boolean {
    return this.owner === owner && this.auth.currentUser === owner && this.epoch === epoch;
  }
  private sameInstallation(expected: LocalInstallation | null): boolean {
    const current = this.readLocal();
    return current?.uid === expected?.uid && current?.installationId === expected?.installationId;
  }
  private readLocal(): LocalInstallation | null {
    try {
      const value = JSON.parse(this.storage.getItem(STORAGE_KEY) || 'null');
      return value && typeof value.uid === 'string' && isPushId(value.installationId) ? value : null;
    } catch { return null; }
  }
  private origin(): string { return this.windows.windowRef.location.origin; }
  isCurrentDevice(installationId: string, origin: string): boolean {
    const local = this.readLocal();
    return this.browser && !!this.owner && this.auth.currentUser === this.owner
      && local?.uid === this.owner.uid && local.installationId === installationId && origin === this.origin();
  }
  async refreshRegistration(): Promise<void> { await this.refresh(); }
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
          if (!await this.revokeBrowser()) return;
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
      const manager = await this.pushManager();
      if (!this.current(owner, epoch)) return;
      this.manager = manager;
      if (!manager) { this.state.set('unavailable'); return; }
      let subscription = await manager.getSubscription();
      if (!this.current(owner, epoch)) return;
      this.subscription = subscription;
      const local = this.readLocal();
      if (local && local.uid !== owner.uid) {
        if (!await this.revokeBrowser(local, subscription) || !this.current(owner, epoch)) return;
        subscription = null;
      }
      this.registered.set(!!subscription);
      if (Notification.permission === 'denied') {
        const cleanupEpoch = local?.uid === owner.uid ? await this.detach() : epoch;
        if (this.current(owner, cleanupEpoch)) this.state.set('denied');
        return;
      }
      if (!this.config.webPushEnabled() || !isVapidPublicKey(this.config.webPushPublicKey())
        || !isPushOrigin(this.origin(), environment.useFunctionsEmulator === true)) { this.state.set('unavailable'); return; }
      if (Notification.permission !== 'granted') { this.state.set('disabled'); return; }
      if (!subscription && local?.uid === owner.uid) {
        await this.detach(); return;
      }
      if (!subscription || !local || local.uid !== owner.uid) {
        // A browser permission is not account consent. Orphan subscriptions must not cross accounts.
        if (subscription && !await this.revokeBrowser(local, subscription)) return;
        if (this.current(owner, epoch)) { this.registered.set(false); this.state.set('disabled'); }
        return;
      }
      const key = subscription.options.applicationServerKey;
      const actualKey = key ? this.encodeKey(key) : '';
      if (actualKey !== this.config.webPushPublicKey()) {
        await this.detach(); return;
      }
      const ref = doc(this.firestore, `users/${owner.uid}/pushSubscriptions/${local.installationId}`);
      const snapshot = await getDocFromServer(ref);
      if (!this.current(owner, epoch)) return;
      if (!this.sameInstallation(local)) { void this.refresh(); return; }
      const saved = snapshot.data();
      if (!snapshot.exists()) {
        if (await this.revokeBrowser(local, subscription) && this.current(owner, epoch)) {
          this.registered.set(false); this.state.set('disabled');
        }
        return;
      }
      if (!isPushRegistration(saved, environment.useFunctionsEmulator === true) || saved.origin !== this.origin()
        || saved.vapidPublicKey !== actualKey) { await this.detach(); return; }
      const current = subscription.toJSON();
      if (saved.endpoint !== current.endpoint || saved.keys.p256dh !== current.keys?.['p256dh'] || saved.keys.auth !== current.keys?.['auth']) {
        await this.persist(owner, local.installationId, subscription, epoch, true);
      } else if (!isPushDeviceInfo(saved.device)) {
        // Enrich legacy registrations without rotating consent or recreating a removed document.
        await updateDoc(ref, { device: pushDeviceInfo(window.navigator), updatedAt: serverTimestamp() });
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
    const record = { ...value, device: pushDeviceInfo(this.windows.windowRef.navigator), updatedAt: serverTimestamp() };
    // Background rotation must not resurrect consent removed after our server read.
    if (reconcile) await updateDoc(ref, record); else await setDoc(ref, record);
    if (!this.current(owner, epoch)) {
      // Another refresh can supersede this write without revoking the same account's consent.
      if (this.owner !== owner || this.auth.currentUser !== owner) await subscription.unsubscribe();
      throw new Error('Registration context changed.');
    }
    if (!reconcile) this.storage.setItem(STORAGE_KEY, JSON.stringify({ uid: owner.uid, installationId: id }));
  }
  async historyNotificationTarget(expectedUserID: string): Promise<HistoryNotificationTarget> {
    return this.notificationTarget(expectedUserID, () => this.canNotifyHistory(),
      'Enable this device and the History imports category in Settings, or uncheck the import notification option.');
  }
  async deliveryNotificationTarget(expectedUserID: string): Promise<DeliveryNotificationTarget> {
    return this.notificationTarget(expectedUserID, () => this.canNotifyDelivery(),
      'Enable this device and the Activity delivery category, or uncheck the send notification option.');
  }
  private async notificationTarget(expectedUserID: string, canNotify: () => boolean, hint: string): Promise<DeliveryNotificationTarget> {
    const owner = this.owner, epoch = this.epoch, local = this.readLocal();
    if (!canNotify() || !owner || owner.uid !== expectedUserID || local?.uid !== expectedUserID) {
      throw new Error(hint);
    }
    const snapshot = await getDocFromServer(doc(this.firestore, `users/${owner.uid}/pushSubscriptions/${local.installationId}`));
    const saved = snapshot.data();
    if (!this.current(owner, epoch) || !this.sameInstallation(local) || !canNotify()
      || !isPushRegistration(saved) || saved.origin !== this.origin() || saved.vapidPublicKey !== this.config.webPushPublicKey()) {
      throw new Error('Notification registration changed. Please check this device and retry.');
    }
    return { installationId: local.installationId, generation: saved.generation };
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
    const owner = this.owner;
    this.operation.set('disable'); this.message.set('');
    try {
      const epoch = await this.detach();
      if (this.current(owner, epoch)) this.message.set('Notifications disabled on this device.');
    }
    catch { this.message.set('Could not finish disabling notifications. Please retry.'); throw new Error('Notification disable failed.'); }
    finally { this.operation.set(null); void this.refresh(); }
  }
  async sendTest(): Promise<boolean> {
    if (!this.canTest() || !this.owner) return false;
    const owner = this.owner; const local = this.readLocal(); const epoch = this.epoch;
    if (!local || local.uid !== owner.uid) return false;
    let expired = false;
    this.operation.set('test'); this.message.set('');
    try {
      const response = await this.functions.call<PushTestRequest, PushTestResponse>('sendTestPushNotification', { installationId: local.installationId },
        { canExecute: () => this.current(owner, epoch) });
      if (!this.current(owner, epoch) || !this.sameInstallation(local)) return false;
      if (response.data.status === 'subscription_expired') {
        // The server may have preserved a newer generation. Reconcile it before revoking anything.
        expired = true;
        return false;
      } else this.message.set('Test notification sent. If it does not appear, check your device notification settings.');
      return true;
    } catch (error: unknown) {
      if (this.current(owner, epoch)) this.message.set((error as { code?: string })?.code === 'functions/resource-exhausted'
        ? 'Please wait before sending another test. Tests are limited to one per minute and ten per day.' : 'The test could not be sent. Please try again later.');
      throw new Error('Notification test failed.');
    } finally {
      this.operation.set(null);
      await this.refresh();
      if (expired && this.owner === owner && this.auth.currentUser === owner) {
        this.message.set(this.state() === 'disabled' ? 'This registration expired. Enable notifications again.'
          : 'The test used an expired registration. Check notification status and try again.');
      }
    }
  }
  private async revokeBrowser(local = this.readLocal(), observed?: PushSubscription | null): Promise<boolean> {
    const owner = this.owner; const epoch = this.epoch; const cached = this.subscription;
    const current = () => this.current(owner, epoch) && this.sameInstallation(local);
    const superseded = () => {
      // Another tab can replace consent without changing this tab's Auth or observation epoch.
      if (this.current(owner, epoch)) void this.refresh();
      return false;
    };
    const manager = this.manager ?? await this.pushManager();
    if (!current()) return superseded();
    if (!manager && local) throw new Error('Browser cleanup unavailable.');
    const subscription = observed === undefined ? await manager?.getSubscription() ?? cached : observed;
    if (!current()) return superseded();
    if (subscription && !await subscription.unsubscribe()) {
      const remaining = await manager?.getSubscription();
      if (remaining?.endpoint === subscription.endpoint) throw new Error('Unsubscribe failed.');
    }
    if (!current()) {
      // A newer observation of the same consent may have completed while revocation was pending.
      if (this.current(owner, epoch) || this.sameInstallation(local)) void this.refresh();
      return false;
    }
    this.subscription = null; this.storage.removeItem(STORAGE_KEY);
    return true;
  }
  private async detach(): Promise<number> {
    const epoch = ++this.epoch; const owner = this.owner;
    const local = this.readLocal();
    // Start the owner-authorized delete while Auth is still valid; revoke the browser even if it fails.
    const deletion = local && local.uid === this.auth.currentUser?.uid
      ? deleteDoc(doc(this.firestore, `users/${local.uid}/pushSubscriptions/${local.installationId}`)) : Promise.resolve();
    // Attach a rejection handler immediately, even while browser revocation is pending.
    const deleted = deletion.then(() => true, () => false);
    const revoked = await this.revokeBrowser(local).catch(() => false);
    if (revoked && this.current(owner, epoch)) { this.registered.set(false); this.state.set('disabled'); }
    const removed = await deleted;
    if (!revoked || !removed) throw new Error('Registration cleanup failed.');
    return epoch;
  }
}
