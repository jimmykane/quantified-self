import { info } from 'firebase-functions/logger';
import type { Firestore, Transaction, DocumentReference, DocumentData } from 'firebase-admin/firestore';
import type { NotificationCategoryId } from '../../../shared/notification-categories';
import { logPushRemoval } from '../../../shared/web-push';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export function deleteExpiredGeneration(tx: Transaction, ref: DocumentReference, registration: DocumentData | undefined, generation: string) {
  if (!registration || registration.generation !== generation) return null;
  // Registrations are leaves. Return only the labels from the winning transaction attempt.
  tx.delete(ref);
  return { origin: registration.origin, device: registration.device };
}

export async function logExpiredDevice(uid: string, installationId: string, labels: { origin: unknown; device: unknown },
  sender: NotificationCategoryId | 'test') {
  await logPushRemoval(info, { uid, installationId, ...labels, reason: 'push_service_expired', action: 'registration_removed', sender });
}

export async function removeExpiredDevice(db: Firestore, uid: string, installationId: string, generation: string,
  sender: NotificationCategoryId | 'test', now: number) {
  const ref = db.doc(`users/${uid}/pushSubscriptions/${installationId}`);
  const removed = await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) return null;
    return deleteExpiredGeneration(tx, ref, (await tx.get(ref)).data(), generation);
  });
  if (removed) await logExpiredDevice(uid, installationId, removed, sender);
}
