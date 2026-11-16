import { Injectable, inject } from '@angular/core';
import { Auth } from 'app/firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { Firestore, doc, serverTimestamp, setDoc } from 'app/firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { INACTIVITY_DELETION_LIMIT, INACTIVITY_MODES, INACTIVITY_WARNING_LIMIT,
  type InactivityAdminRequest, type InactivityAdminResponse, type InactivitySettings } from '@shared/admin-inactivity';

@Injectable({ providedIn: 'root' })
export class AdminInactivityService {
  private readonly auth = inject(Auth);
  private readonly db = inject(Firestore);
  private readonly functions = inject(AppFunctionsService);
  currentUid(): string | null { return this.auth.currentUser?.uid ?? null; }
  watchOwner(callback: (uid: string | null) => void): () => void {
    return onAuthStateChanged(this.auth, user => callback(user?.uid ?? null));
  }
  async read(request: InactivityAdminRequest): Promise<InactivityAdminResponse> {
    const owner = this.auth.currentUser;
    if (!owner) throw new Error('Sign in as an administrator.');
    const result = await this.functions.call<InactivityAdminRequest, InactivityAdminResponse>('getInactivityAdmin', request,
      { canExecute: () => this.auth.currentUser === owner });
    if (this.auth.currentUser !== owner) throw new Error('The signed-in account changed.');
    return result.data;
  }
  async save(settings: InactivitySettings, expectedUid: string): Promise<void> {
    const owner = this.auth.currentUser;
    if (!owner || owner.uid !== expectedUid) throw new Error('The signed-in account changed.');
    if (!INACTIVITY_MODES.includes(settings.mode)
      || !Number.isSafeInteger(settings.warningDailyLimit) || settings.warningDailyLimit < 0 || settings.warningDailyLimit > INACTIVITY_WARNING_LIMIT
      || !Number.isSafeInteger(settings.deletionDailyLimit) || settings.deletionDailyLimit < 0 || settings.deletionDailyLimit > INACTIVITY_DELETION_LIMIT
      || !Number.isSafeInteger(settings.revision) || settings.revision < 0 || settings.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid retention settings.');
    // Rules enforce this narrow patch and compare revisions, without granting raw control reads.
    await setDoc(doc(this.db, 'configuration/inactiveAccounts'), {
      mode: settings.mode, warningDailyLimit: settings.warningDailyLimit, deletionDailyLimit: settings.deletionDailyLimit,
      settingsRevision: settings.revision + 1, settingsUpdatedAt: serverTimestamp(), settingsUpdatedBy: owner.uid,
    }, { merge: true });
    if (this.auth.currentUser !== owner) throw new Error('The signed-in account changed.');
  }
}
