import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';

export async function assertAssistantLegalAccess(uid: string,
  db: Pick<FirebaseFirestore.Firestore, 'doc'> = admin.firestore()): Promise<void> {
  const snapshot = await db.doc(`users/${uid}/legal/agreements`).get();
  const agreements = snapshot.data();
  if (!snapshot.exists || agreements?.acceptedPrivacyPolicy !== true
    || agreements?.acceptedDataPolicy !== true || agreements?.acceptedTos !== true) {
    throw new HttpsError('permission-denied', 'Complete onboarding before using the Assistant.');
  }
}
