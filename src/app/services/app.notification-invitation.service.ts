import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth, user, type FirebaseUserType } from 'app/firebase/auth';
import { Firestore, doc, onSnapshot, runTransaction } from 'app/firebase/firestore';
import { APP_STORAGE } from './storage/app.storage.token';
import { AppWindowService } from './app.window.service';
import { nextNotificationInvitation, notificationInvitationDue, type NotificationInvitationChoice } from '../helpers/notification-invitation.helper';

/** Invitation preferences only. This never grants permission or changes category consent. */
@Injectable({ providedIn: 'root' })
export class AppNotificationInvitationService {
  private readonly auth = inject(Auth);
  private readonly db = inject(Firestore);
  private readonly storage = inject(APP_STORAGE);
  private readonly window = inject(AppWindowService).windowRef;
  private readonly destroy = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly saved = signal<unknown>(null);
  private readonly locallyStopped = signal(true);
  private readonly now = signal(Date.now());
  readonly uid = signal<string | null>(null);
  readonly ready = signal(false);
  readonly saving = signal(false);
  readonly message = signal('');
  readonly due = computed(() => this.ready() && !this.saving() && !this.locallyStopped()
    && notificationInvitationDue(this.saved(), this.now()));
  private owner: FirebaseUserType | null = null;
  private epoch = 0;
  private writes = 0;
  private unsubscribe?: () => void;
  private observing = Promise.resolve();
  private readonly stoppedAccounts = new Set<string>();

  constructor() {
    this.destroy.onDestroy(() => { this.epoch++; this.stopListening(); });
    if (!this.browser) return;
    user(this.auth).pipe(takeUntilDestroyed()).subscribe(owner => { this.observing = this.observe(owner); });
    const refresh = () => {
      this.now.set(Date.now());
      // A failed storage write must not undo this session's explicit opt-out.
      if (this.owner && this.readLocalStop(this.owner.uid)) this.locallyStopped.set(true);
    };
    this.window.addEventListener('focus', refresh);
    this.window.addEventListener('storage', refresh);
    this.destroy.onDestroy(() => {
      this.window.removeEventListener('focus', refresh);
      this.window.removeEventListener('storage', refresh);
    });
  }

  private current(owner: FirebaseUserType, epoch: number): boolean {
    return !this.destroy.destroyed && this.owner === owner && this.auth.currentUser === owner && this.epoch === epoch;
  }
  private key(uid: string): string { return `qs.notification-invitation.stopped.${uid}`; }
  private readLocalStop(uid: string): boolean {
    if (this.stoppedAccounts.has(uid)) return true;
    try { return this.storage.getItem(this.key(uid)) !== null; } catch { return true; }
  }
  private stopListening(): void {
    const unsubscribe = this.unsubscribe; this.unsubscribe = undefined;
    // Firestore can throw here after its queue has failed. The epoch already
    // fences callbacks; cleanup must not abort account reset or destruction.
    try { unsubscribe?.(); } catch { /* The invitation remains unavailable until a confirmed read. */ }
  }
  private async observe(owner: FirebaseUserType | null): Promise<void> {
    const epoch = ++this.epoch;
    this.stopListening();
    this.owner = owner; this.uid.set(null); this.ready.set(false); this.writes = 0; this.saving.set(false); this.saved.set(null);
    this.message.set(''); this.locallyStopped.set(true);
    if (!owner) return;
    try {
      const token = await owner.getIdTokenResult();
      if (!this.current(owner, epoch) || 'impersonatedBy' in token.claims) return;
      this.uid.set(owner.uid); this.locallyStopped.set(this.readLocalStop(owner.uid));
      this.unsubscribe = onSnapshot(doc(this.db, `users/${owner.uid}/config/settings`), { includeMetadataChanges: true }, snapshot => {
        if (!this.current(owner, epoch)) return;
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) { this.ready.set(false); return; }
        this.saved.set(snapshot.data()?.appSettings?.notificationInvitation);
        this.now.set(Date.now()); this.ready.set(true);
      }, () => { if (this.current(owner, epoch)) this.ready.set(false); });
    } catch { /* An unknown account/preference state must not invite. */ }
  }

  /** Called for explicit enable/disable only, never sign-out, expiry, or background reconciliation. */
  recordDeviceChoice(uid: string, choice: 'enabled' | 'disabled'): void {
    if (!this.browser || this.owner?.uid !== uid || this.auth.currentUser !== this.owner) return;
    const owner = this.owner, epoch = this.epoch;
    this.stoppedAccounts.add(uid);
    try { this.storage.setItem(this.key(uid), choice); } catch { /* Keep the in-memory stop even without storage. */ }
    this.locallyStopped.set(true);
    // Push and invitation state verify claims independently. A completed device gesture
    // must still save its account-wide choice if our claim check has not finished yet.
    void this.observing.then(() => {
      if (this.current(owner, epoch)) return this.choose(choice, uid);
    });
  }

  async choose(choice: NotificationInvitationChoice, expectedUid = this.uid()): Promise<boolean> {
    const owner = this.owner, epoch = this.epoch;
    if (!this.browser || !owner || owner.uid !== expectedUid || this.uid() !== expectedUid
      || !this.current(owner, epoch) || (this.saving() && choice !== 'enabled' && choice !== 'disabled')) return false;
    this.writes++;
    this.saving.set(true); this.message.set('');
    try {
      const value = await runTransaction(this.db, async tx => {
        if (!this.current(owner, epoch)) throw new Error('Account changed.');
        const ref = doc(this.db, `users/${owner.uid}/config/settings`);
        const [snapshot, account] = await Promise.all([tx.get(ref), tx.get(doc(this.db, `users/${owner.uid}`))]);
        if (!this.current(owner, epoch) || !account.exists()) throw new Error('Account changed.');
        const next = nextNotificationInvitation(snapshot.data()?.appSettings?.notificationInvitation, choice, Date.now());
        tx.set(ref, { appSettings: { notificationInvitation: next } }, { merge: true });
        return next;
      });
      if (!this.current(owner, epoch)) return false;
      this.saved.set(value); this.now.set(Date.now());
      return true;
    } catch {
      if (this.current(owner, epoch)) this.message.set('Could not save this choice. Please try again.');
      return false;
    } finally { if (this.current(owner, epoch)) { this.writes--; this.saving.set(this.writes > 0); } }
  }
}
