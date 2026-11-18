import type { NotificationCategoryId } from '../../../shared/notification-categories';
import { FieldValue, type DocumentData, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { pushRemovalPath, pushRemovalRecord } from '../../../shared/web-push';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export function recordExpiredDevice(db: Firestore, tx: Transaction, uid: string, installationId: string,
  ref: DocumentReference, registration: DocumentData, sender: NotificationCategoryId | 'test', now: number) {
  // Registrations are leaves. Commit diagnostic and deletion together, once per matched generation.
  tx.delete(ref);
  tx.set(db.doc(pushRemovalPath(uid, installationId)),
    { ...pushRemovalRecord('push_service_expired', registration.origin, registration.device, FieldValue.serverTimestamp(), now), sender });
}

export async function removeExpiredDevice(db: Firestore, uid: string, installationId: string, generation: string,
  sender: NotificationCategoryId | 'test', now: number) {
  const ref = db.doc(`users/${uid}/pushSubscriptions/${installationId}`);
  await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) return;
    const registration = (await tx.get(ref)).data();
    if (registration && registration.generation === generation) {
      recordExpiredDevice(db, tx, uid, installationId, ref, registration, sender, now);
    }
  });
}
