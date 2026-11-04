import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth, user, type FirebaseUserType } from 'app/firebase/auth';
import { Firestore, doc, onSnapshot, runTransaction, serverTimestamp } from 'app/firebase/firestore';
import { NOTIFICATION_CATEGORIES, isNotificationCategory, notificationPreferencePath, readNotificationCategoryPreference,
  type NotificationCategoryId, type NotificationCategoryPreference } from '@shared/notification-categories';

@Injectable({ providedIn: 'root' })
export class AppNotificationPreferencesService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly destroy = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly preferences = signal<Partial<Record<NotificationCategoryId, NotificationCategoryPreference>>>({});
  readonly status = signal<'loading' | 'ready' | 'signed-out' | 'impersonating' | 'error'>('loading');
  readonly saving = signal<NotificationCategoryId | 'all' | null>(null);
  readonly message = signal('');
  readonly canEdit = computed(() => this.status() === 'ready' && !this.saving());
  readonly categories = computed(() => NOTIFICATION_CATEGORIES.map(category => ({
    ...category, enabled: this.preferences()[category.id]?.enabled ?? true,
  })));
  private owner: FirebaseUserType | null = null;
  private epoch = 0;
  private listeners: (() => void)[] = [];

  constructor() {
    this.destroy.onDestroy(() => { this.epoch++; this.stopListening(); });
    if (!this.browser) { this.status.set('signed-out'); return; }
    user(this.auth).pipe(takeUntilDestroyed()).subscribe(owner => { void this.observe(owner); });
  }

  isEnabled(category: NotificationCategoryId): boolean {
    return this.status() === 'ready' && this.preferences()[category]?.enabled === true;
  }

  reload(): void {
    if (this.browser && this.status() === 'error') void this.observe(this.auth.currentUser);
  }

  private current(owner: FirebaseUserType, epoch: number): boolean {
    return this.epoch === epoch && this.owner === owner && this.auth.currentUser === owner;
  }

  private stopListening(): void {
    this.listeners.forEach(unsubscribe => unsubscribe()); this.listeners = [];
  }

  private async observe(owner: FirebaseUserType | null): Promise<void> {
    const sameOwner = owner !== null && this.owner === owner;
    const epoch = ++this.epoch;
    this.owner = owner; this.stopListening(); this.message.set(''); this.saving.set(null);
    if (!sameOwner) this.preferences.set({});
    this.status.set(owner ? 'loading' : 'signed-out');
    if (!owner) return;
    // Keep the last confirmed values visible, but require a fresh successful read of every category.
    const confirmed = new Set<NotificationCategoryId>();
    const fail = (category?: NotificationCategoryId) => {
      if (!this.current(owner, epoch)) return;
      if (category) confirmed.delete(category); else confirmed.clear();
      this.status.set('error'); this.message.set('Could not load notification categories. Please try again.');
    };
    try {
      const token = await owner.getIdTokenResult();
      if (!this.current(owner, epoch)) return;
      if ('impersonatedBy' in token.claims) { this.status.set('impersonating'); return; }
      for (const category of NOTIFICATION_CATEGORIES) {
        this.listeners.push(onSnapshot(doc(this.firestore, notificationPreferencePath(owner.uid, category.id)),
          { includeMetadataChanges: true }, snapshot => {
            // A cache miss is not proof that the account has no preference.
            if (!this.current(owner, epoch) || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
            const preference = readNotificationCategoryPreference(snapshot.data());
            if (!preference) { fail(category.id); return; }
            this.acceptPreference(category.id, preference);
            confirmed.add(category.id);
            if (NOTIFICATION_CATEGORIES.every(item => confirmed.has(item.id))) {
              if (this.status() === 'error') this.message.set('');
              this.status.set('ready');
            }
          }, () => fail(category.id)));
      }
    } catch { fail(); }
  }

  private acceptPreference(category: NotificationCategoryId, preference: NotificationCategoryPreference): void {
    this.preferences.update(current => (current[category]?.revision ?? -1) > preference.revision
      ? current : { ...current, [category]: preference });
  }

  /** Explicit master On action: read and enable all categories atomically. */
  async enableAll(expectedUid = this.owner?.uid): Promise<boolean> {
    const owner = this.owner, epoch = this.epoch;
    if (!owner || owner.uid !== expectedUid || !this.current(owner, epoch) || !this.canEdit()) return false;
    this.saving.set('all'); this.message.set('');
    try {
      const preferences = await runTransaction(this.firestore, async tx => {
        if (!this.current(owner, epoch)) throw new Error('Account changed.');
        const records = await Promise.all(NOTIFICATION_CATEGORIES.map(async category => {
          const ref = doc(this.firestore, notificationPreferencePath(owner.uid, category.id));
          const current = readNotificationCategoryPreference((await tx.get(ref)).data());
          if (!current) throw new Error('Invalid notification preference.');
          const next = current.enabled ? current : { enabled: true, revision: current.revision + 1 };
          if (!Number.isSafeInteger(next.revision)) throw new Error('Invalid notification revision.');
          return { id: category.id, ref, current, next };
        }));
        if (!this.current(owner, epoch)) throw new Error('Account changed.');
        for (const record of records) {
          if (!record.current.enabled) tx.set(record.ref, { schemaVersion: 1, ...record.next, updatedAt: serverTimestamp() });
        }
        return records;
      });
      if (!this.current(owner, epoch)) return false;
      for (const record of preferences) this.acceptPreference(record.id, record.next);
      this.message.set('All notification categories are on.');
      return true;
    } catch {
      if (!this.current(owner, epoch)) return false;
      this.message.set('Could not turn on all notification categories. Please try again.');
      throw new Error('Could not turn on all notification categories.');
    } finally { if (this.current(owner, epoch)) this.saving.set(null); }
  }

  async setEnabled(category: NotificationCategoryId, enabled: boolean): Promise<boolean> {
    const owner = this.owner, epoch = this.epoch;
    if (!owner || !this.current(owner, epoch) || !isNotificationCategory(category) || typeof enabled !== 'boolean'
      || !this.canEdit() || this.preferences()[category]?.enabled === enabled) return false;
    this.saving.set(category); this.message.set('');
    try {
      const preference = await runTransaction(this.firestore, async tx => {
        if (!this.current(owner, epoch)) throw new Error('Account changed.');
        const ref = doc(this.firestore, notificationPreferencePath(owner.uid, category));
        const current = readNotificationCategoryPreference((await tx.get(ref)).data());
        if (!this.current(owner, epoch)) throw new Error('Account changed.');
        if (!current) throw new Error('Invalid notification preference.');
        if (current.enabled === enabled) return current;
        const next = { enabled, revision: current.revision + 1 };
        if (!Number.isSafeInteger(next.revision)) throw new Error('Invalid notification revision.');
        tx.set(ref, { schemaVersion: 1, ...next, updatedAt: serverTimestamp() });
        return next;
      });
      if (!this.current(owner, epoch)) return false;
      this.acceptPreference(category, preference); this.message.set('Notification preference saved.');
      return true;
    } catch {
      if (!this.current(owner, epoch)) return false;
      this.message.set('Could not save the notification preference. Please try again.');
      throw new Error('Could not save the notification preference.');
    } finally { if (this.current(owner, epoch)) this.saving.set(null); }
  }
}
