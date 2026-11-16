import { Injectable, inject } from '@angular/core';
import { Auth } from 'app/firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { Firestore, doc, getDocFromServer, runTransaction, serverTimestamp } from 'app/firebase/firestore';
import { BILLING_TRIAL_POLICY_PATH, isBillingTrialDays, parseBillingTrialPolicy, type BillingTrialPolicy } from '@shared/billing-trial-policy';

export interface AdminBillingTrialPolicyView {
  policy: BillingTrialPolicy;
  updatedAt: Date | null;
  updatedBy: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminBillingTrialPolicyService {
  private readonly auth = inject(Auth);
  private readonly db = inject(Firestore);
  currentUid(): string | null { return this.auth.currentUser?.uid ?? null; }
  watchOwner(callback: (uid: string | null) => void): () => void {
    return onAuthStateChanged(this.auth, user => callback(user?.uid ?? null));
  }
  async read(): Promise<AdminBillingTrialPolicyView> {
    const owner = this.auth.currentUser;
    if (!owner) throw new Error('Sign in as an administrator.');
    const snapshot = await getDocFromServer(doc(this.db, BILLING_TRIAL_POLICY_PATH));
    const policy = parseBillingTrialPolicy(snapshot.data());
    const history = policy.revision ? await getDocFromServer(doc(this.db, `${BILLING_TRIAL_POLICY_PATH}/history/${policy.revision}`)) : null;
    if (this.auth.currentUser !== owner) throw new Error('The signed-in account changed.');
    return { policy, updatedAt: snapshot.data()?.['updatedAt']?.toDate() ?? null, updatedBy: history?.data()?.['updatedBy'] ?? null };
  }
  async save(draft: BillingTrialPolicy, expectedUid: string): Promise<void> {
    const owner = this.auth.currentUser;
    if (!owner || owner.uid !== expectedUid) throw new Error('The signed-in account changed.');
    if (!Number.isSafeInteger(draft.revision) || draft.revision < 0 || draft.revision >= Number.MAX_SAFE_INTEGER
      || !isBillingTrialDays(draft.basicTrialDays) || !isBillingTrialDays(draft.proTrialDays)) throw new Error('Invalid trial settings.');
    // Rules enforce the same validation and atomic audit. No privileged Stripe mutation or callable is needed.
    await runTransaction(this.db, async transaction => {
      const ref = doc(this.db, BILLING_TRIAL_POLICY_PATH);
      const previous = parseBillingTrialPolicy((await transaction.get(ref)).data());
      if (this.auth.currentUser !== owner) throw new Error('The signed-in account changed.');
      if (previous.revision !== draft.revision) throw new Error('Trial settings changed. Refresh before saving.');
      if (previous.basicTrialDays === draft.basicTrialDays && previous.proTrialDays === draft.proTrialDays) return;
      const next = { basicTrialDays: draft.basicTrialDays, proTrialDays: draft.proTrialDays,
        revision: draft.revision + 1, updatedAt: serverTimestamp() };
      transaction.set(ref, next);
      transaction.set(doc(this.db, `${BILLING_TRIAL_POLICY_PATH}/history/${next.revision}`), { ...next, previous, updatedBy: owner.uid });
    });
    if (this.auth.currentUser !== owner) throw new Error('The signed-in account changed.');
  }
}
