import * as admin from 'firebase-admin';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { FieldValue } from 'firebase-admin/firestore';

/** Deletes only this immutable feature-owned object; quota release is idempotent. */
export async function cleanupSendSourceRow(row: admin.firestore.DocumentReference): Promise<void> {
  const data = (await row.get()).data();
  const retiredLocal = data?.digest && data.reservedBytes === 0;
  if (!data || !data.reservedBytes && !data.cleanupPending && !retiredLocal) return;
  const operation = row.parent.parent!;
  const uid = operation.parent.parent!.id;
  const path = `users/${uid}/activitySendSources/${operation.id}/${row.id}.fit`;
  let generation = data.originalFile?.generation;
  let exists = true;
  // A late staging write can have a newer generation after its reservation was released.
  if (data.digest && (data.cleanupPending || retiredLocal)) {
    const [metadata] = await admin.storage().bucket().file(path).getMetadata().catch(error => {
      if (Number((error as { code?: unknown }).code) === 404) return [undefined];
      throw error;
    });
    exists = !!metadata;
    if (metadata) generation = `${metadata.generation}`;
  }
  // Saved originals reserve no temporary bytes and must never be deleted here.
  if (exists && (data.reservedBytes || data.digest && (data.cleanupPending || retiredLocal))) await admin.storage().bucket().file(path, generation ? { generation } : undefined).delete({ ignoreNotFound: true });
  await admin.firestore().runTransaction(async tx => {
    const quotaRef = admin.firestore().doc(`users/${uid}/activitySendQuota/current`);
    const [current, quota, guard] = await Promise.all([tx.get(row), tx.get(quotaRef), getUserDeletionGuardStateInTransaction(admin.firestore(), tx, uid)]);
    if (guard.shouldSkip || !current.exists || !current.data()?.reservedBytes && !current.data()?.cleanupPending) return;
    if (quota.exists && current.data()?.reservedBytes) tx.update(quotaRef, { bytes: Math.max(0, Number(quota.data()?.bytes || 0) - Number(current.data()?.reservedBytes)) });
    // Do not erase a newer request committed while Storage deletion was in flight.
    const sameRevision = Number(current.data()?.cleanupRevision || 0) === Number(data.cleanupRevision || 0);
    tx.update(row, { reservedBytes: 0, ...(sameRevision ? { cleanupPending: false } : {}) });
  });
}

/** Rearm cleanup when a failed in-flight staging write outlives its removed/retired row. */
export async function queueRetiredSendSourceCleanup(row: admin.firestore.DocumentReference, digest: string): Promise<void> {
  const operation = row.parent.parent!;
  const uid = operation.parent.parent!.id;
  await admin.firestore().runTransaction(async tx => {
    const [current, parent, guard] = await Promise.all([tx.get(row), tx.get(operation), getUserDeletionGuardStateInTransaction(admin.firestore(), tx, uid)]);
    if (guard.shouldSkip || !current.exists || !parent.exists) return;
    const data = current.data()!;
    if (data.digest !== digest || !data.removed && data.reservedBytes !== 0) return;
    tx.update(row, { cleanupPending: true, cleanupRevision: Number(data.cleanupRevision || 0) + 1 });
    tx.update(operation, { sourceCleanupProgressAt: Date.now(), sourceCleanupRevision: FieldValue.increment(1) });
  });
}
