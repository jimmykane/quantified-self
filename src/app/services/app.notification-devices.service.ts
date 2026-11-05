import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth, user, type FirebaseUserType } from 'app/firebase/auth';
import { Firestore, Timestamp, collection, doc, documentId, getDocsFromServer, limit, orderBy, query, runTransaction, startAfter } from 'app/firebase/firestore';
import { isPushDeviceInfo, isPushId, isPushOrigin, type PushDeviceInfo } from '@shared/web-push';
import { AppPushService } from './app.push.service';

export interface NotificationDevice {
  id: string;
  generation: string;
  origin: string;
  label: string;
  site: 'Production' | 'Beta';
  registeredAt: Date | null;
}
const PAGE_SIZE = 25;

/** Scoped to the Settings component; subscription credentials never enter view state. */
@Injectable()
export class AppNotificationDevicesService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly push = inject(AppPushService);
  private readonly destroy = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly records = signal<NotificationDevice[]>([]);
  readonly status = signal<'loading' | 'ready' | 'error' | 'signed-out' | 'impersonating'>('loading');
  readonly saving = signal<string | null>(null);
  readonly loadingMore = signal(false);
  readonly hasMore = signal(false);
  readonly message = signal('');
  readonly canManage = computed(() => this.status() === 'ready' && !this.saving() && !this.loadingMore() && !this.push.operation());
  readonly canReload = computed(() => ['ready', 'error'].includes(this.status()) && !this.saving() && !this.loadingMore() && !this.push.operation());
  readonly devices = computed(() => {
    this.push.state(); // Re-evaluate the local installation marker after enable/disable/reconciliation.
    return this.records().map(record => ({ ...record, current: this.push.isCurrentDevice(record.id, record.origin) }));
  });
  private owner: FirebaseUserType | null = null;
  private epoch = 0;
  private destroyed = false;
  private cursor: string | null = null;

  constructor() {
    this.destroy.onDestroy(() => { this.destroyed = true; this.epoch++; });
    if (!this.browser) { this.status.set('signed-out'); return; }
    user(this.auth).pipe(takeUntilDestroyed()).subscribe(owner => { void this.observe(owner); });
  }
  private current(owner: FirebaseUserType, epoch: number): boolean {
    return !this.destroyed && this.owner === owner && this.auth.currentUser === owner && this.epoch === epoch;
  }
  private async observe(owner: FirebaseUserType | null): Promise<void> {
    if (this.destroyed) return;
    const epoch = ++this.epoch;
    if (this.owner !== owner) this.records.set([]);
    this.owner = owner; this.cursor = null; this.hasMore.set(false); this.saving.set(null);
    this.loadingMore.set(false); this.message.set(''); this.status.set(owner ? 'loading' : 'signed-out');
    if (!owner) return;
    try {
      const token = await owner.getIdTokenResult();
      if (!this.current(owner, epoch)) return;
      if ('impersonatedBy' in token.claims) { this.records.set([]); this.status.set('impersonating'); return; }
      await this.loadPage(owner, epoch, false);
    } catch { this.failLoad(owner, epoch); }
  }
  private failLoad(owner: FirebaseUserType, epoch: number): void {
    if (!this.current(owner, epoch)) return;
    this.status.set('error'); this.message.set('Could not load notification devices. Refresh the list to try again.');
  }
  async reload(): Promise<void> {
    // A completed local enable/disable must supersede any older list or pagination read.
    if (this.browser && !this.saving() && !this.push.operation()
      && ['loading', 'ready', 'error'].includes(this.status())) await this.observe(this.auth.currentUser);
  }
  async loadMore(): Promise<void> {
    const owner = this.owner, epoch = this.epoch;
    if (!owner || !this.current(owner, epoch) || !this.canManage() || !this.hasMore()) return;
    this.loadingMore.set(true); this.message.set('');
    try { await this.loadPage(owner, epoch, true); }
    catch { this.failLoad(owner, epoch); }
    finally { if (this.current(owner, epoch)) this.loadingMore.set(false); }
  }
  private async loadPage(owner: FirebaseUserType, epoch: number, append: boolean): Promise<void> {
    const constraints = [orderBy(documentId()), ...(append && this.cursor ? [startAfter(this.cursor)] : []), limit(PAGE_SIZE + 1)];
    const snapshot = await getDocsFromServer(query(collection(this.firestore, `users/${owner.uid}/pushSubscriptions`), ...constraints));
    if (!this.current(owner, epoch)) return;
    const page = snapshot.docs.slice(0, PAGE_SIZE);
    const devices: NotificationDevice[] = [];
    for (const item of page) {
      const data = item.data();
      if (!isPushId(item.id) || !isPushId(data.generation) || !isPushOrigin(data.origin)) continue;
      const device: PushDeviceInfo | null = isPushDeviceInfo(data.device) ? data.device : null;
      devices.push({ id: item.id, generation: data.generation, origin: data.origin,
        label: device ? `${device.browser} on ${device.platform}` : 'Browser device',
        site: data.origin === 'https://quantified-self.io' ? 'Production' : 'Beta',
        registeredAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null });
    }
    this.records.set(append ? [...this.records(), ...devices] : devices);
    this.cursor = page.at(-1)?.id ?? null;
    this.hasMore.set(snapshot.docs.length > PAGE_SIZE); this.status.set('ready');
  }
  async disable(device: NotificationDevice): Promise<boolean> {
    const owner = this.owner, epoch = this.epoch;
    if (!owner || !this.current(owner, epoch) || !this.canManage()
      || !this.records().some(record => record.id === device.id && record.generation === device.generation && record.origin === device.origin)) return false;
    this.saving.set(device.id); this.message.set('');
    try {
      const removed = await runTransaction(this.firestore, async transaction => {
        if (!this.current(owner, epoch)) throw new Error('Account changed.');
        const ref = doc(this.firestore, `users/${owner.uid}/pushSubscriptions/${device.id}`);
        const snapshot = await transaction.get(ref);
        if (!this.current(owner, epoch)) throw new Error('Account changed.');
        if (!snapshot.exists()) return false;
        const current = snapshot.data();
        // A stale page must never revoke a replacement registration after a transaction retry.
        if (current.generation !== device.generation || current.origin !== device.origin) throw new Error('Registration changed.');
        const account = await transaction.get(doc(this.firestore, `users/${owner.uid}`));
        if (!this.current(owner, epoch) || !account.exists()) throw new Error('Account changed.');
        // Persist the explicit choice with revocation. Removed registrations alone cannot explain an opt-out.
        transaction.set(doc(this.firestore, `users/${owner.uid}/config/settings`), {
          appSettings: { notificationInvitation: { version: 1, choice: 'disabled' } },
        }, { merge: true });
        // Registrations are leaves: Rules prohibit all descendants.
        transaction.delete(ref);
        return true;
      });
      if (!this.current(owner, epoch)) return false;
      this.records.update(records => records.filter(record => record.id !== device.id));
      this.message.set(removed ? `Notifications disabled for ${device.label} (${device.site}).` : 'This device was already disabled.');
      if (this.push.isCurrentDevice(device.id, device.origin)) await this.push.refreshRegistration();
      return this.current(owner, epoch) && removed;
    } catch {
      if (!this.current(owner, epoch)) return false;
      this.message.set('Could not disable this device. Refresh the list and try again.');
      throw new Error('Could not disable notification device.');
    } finally { if (this.current(owner, epoch)) this.saving.set(null); }
  }
}
