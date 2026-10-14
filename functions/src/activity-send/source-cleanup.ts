import * as admin from 'firebase-admin';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

/** Deletes only this immutable feature-owned object; quota release is idempotent. */
export async function cleanupSendSourceRow(row: admin.firestore.DocumentReference): Promise<void> {
  const data = (await row.get()).data();
  if (!data?.reservedBytes) return;
  const operation = row.parent.parent!;
  const uid = operation.parent.parent!.id;
  const path = `users/${uid}/activitySendSources/${operation.id}/${row.id}.fit`;
  const generation = data.originalFile?.generation;
  await admin.storage().bucket().file(path, generation ? { generation } : undefined).delete({ ignoreNotFound: true });
  await admin.firestore().runTransaction(async tx => {
    const quotaRef = admin.firestore().doc(`users/${uid}/activitySendQuota/current`);
    const [current, quota, guard] = await Promise.all([tx.get(row), tx.get(quotaRef), getUserDeletionGuardStateInTransaction(admin.firestore(), tx, uid)]);
    if (guard.shouldSkip || !current.exists || !current.data()?.reservedBytes) return;
    if (quota.exists) tx.update(quotaRef, { bytes: Math.max(0, Number(quota.data()?.bytes || 0) - Number(current.data()?.reservedBytes)) });
    tx.update(row, { reservedBytes: 0 });
  });
}
