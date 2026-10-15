import * as admin from 'firebase-admin';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export const SEND_UPLOAD_CLEANUP_COLLECTION = 'activitySendUploadCleanup';
// Beyond the 120-second upload handler and SDK retry deadline. Unknown writes retain this delay.
export const SEND_UPLOAD_RESERVATION_MS = 15 * 60_000;
const CLEANUP_LEASE_MS = 30 * 60_000; // Beyond the 300-second handler plus two 600-second SDK read/delete retry deadlines.
const FAILURE_BACKOFF_MS = 30 * 60_000;
const PAGE_SIZE = 100;
const MAX_TASKS = 500;

export function sendUploadCleanupRef(path: string): admin.firestore.DocumentReference {
  return admin.firestore().collection(SEND_UPLOAD_CLEANUP_COLLECTION).doc(createHash('sha256').update(path).digest('hex'));
}

function parseReservation(data: admin.firestore.DocumentData | undefined, id: string) {
  if (!data || data.version !== 1 || typeof data.userID !== 'string' || !data.userID.length || data.userID.length > 128 || data.userID.includes('/')
    || typeof data.batchID !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.batchID)
    || typeof data.rowID !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.rowID)
    || typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/.test(data.digest) || !(data.cleanupAfter instanceof Timestamp)
    || data.leaseUntil !== undefined && !(data.leaseUntil instanceof Timestamp)) throw new Error('Invalid temporary upload cleanup reservation.');
  const path = `users/${data.userID}/activitySendSources/${data.batchID}/${data.rowID}.fit`;
  if (data.path !== path || createHash('sha256').update(path).digest('hex') !== id) throw new Error('Invalid temporary upload cleanup path.');
  return { userID: data.userID as string, batchID: data.batchID as string, rowID: data.rowID as string,
    digest: data.digest as string, path, cleanupAfterMs: data.cleanupAfter.toMillis(), leaseUntilMs: data.leaseUntil?.toMillis() || 0 };
}

/** Call only inside the upload's deletion-guarded source/quota transaction, before any Storage write. */
export function reserveSendUploadCleanup(tx: admin.firestore.Transaction, snapshot: admin.firestore.DocumentSnapshot, params: {
  uid: string; batchId: string; rowId: string; path: string; digest: string;
}, now = Date.now()): void {
  if (snapshot.exists) {
    const current = parseReservation(snapshot.data(), snapshot.id);
    if (current.digest !== params.digest) throw new HttpsError('failed-precondition', 'Temporary file identity changed. Start a new draft.');
    if (current.leaseUntilMs > now) throw new HttpsError('unavailable', 'Temporary file cleanup is running. Retry this file shortly.');
  }
  tx.set(snapshot.ref, {
    version: 1, userID: params.uid, batchID: params.batchId, rowID: params.rowId,
    path: params.path, digest: params.digest, cleanupAfter: Timestamp.fromMillis(now + SEND_UPLOAD_RESERVATION_MS),
  });
}

async function reconcileReservation(ref: admin.firestore.DocumentReference, now: number): Promise<void> {
  const db = admin.firestore();
  const leaseID = randomUUID();
  const cleanup = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;
    const data = parseReservation(snapshot.data(), snapshot.id);
    if (data.cleanupAfterMs > now || data.leaseUntilMs > now) return;
    const operation = db.doc(`users/${data.userID}/activitySendOperations/${data.batchID}`);
    const [parent, source, guard] = await Promise.all([
      tx.get(operation), tx.get(operation.collection('rows').doc(data.rowID)),
      getUserDeletionGuardStateInTransaction(db, tx, data.userID),
    ]);
    const row = source.data();
    if (!guard.shouldSkip && row && row.digest === data.digest && row.reservedBytes > 0 && !row.removed) {
      if (row.originalFile?.path === data.path && typeof row.originalFile.generation === 'string') {
        // Permanent backend-only leaf: no writer or Rules path can create descendants.
        tx.delete(ref);
        return;
      }
      const draft = parent.data();
      if (draft?.state === 'draft' && !draft.stopped && draft.expiresAt > now) {
        // A failed active preview remains resumable; retry renews this same reservation atomically.
        tx.update(ref, { cleanupAfter: Timestamp.fromMillis(draft.expiresAt) });
        return;
      }
    }
    tx.update(ref, { leaseID, leaseUntil: Timestamp.fromMillis(now + CLEANUP_LEASE_MS), cleanupAfter: Timestamp.fromMillis(now + CLEANUP_LEASE_MS) });
    return data;
  });
  if (!cleanup) return;
  try {
    const bucket = admin.storage().bucket();
    const [metadata] = await bucket.file(cleanup.path).getMetadata().catch(error => {
      if (Number((error as { code?: unknown }).code) === 404) return [undefined];
      throw error;
    });
    if (metadata) {
      if (metadata.metadata?.sendDigest !== cleanup.digest || !metadata.generation) throw new Error('Temporary upload cleanup identity changed.');
      await bucket.file(cleanup.path, { generation: `${metadata.generation}` }).delete({ ignoreNotFound: true });
    }
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      // Permanent backend-only leaf; never erase a replacement producer/cleanup claim.
      if (current.data()?.leaseID === leaseID) tx.delete(ref);
    });
  } catch (error) {
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.data()?.leaseID === leaseID) tx.update(ref, { cleanupAfter: Timestamp.fromMillis(now + FAILURE_BACKOFF_MS) });
    });
    throw error;
  }
}

/** Bounded redrive also serves account cleanup. Active upload/cleanup leases always remain intact. */
export async function cleanupSendUploadReservations(now = Date.now(), uid?: string): Promise<void> {
  const collection = admin.firestore().collection(SEND_UPLOAD_CLEANUP_COLLECTION);
  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  let processed = 0;
  let failed = 0;
  while (processed < MAX_TASKS) {
    let query = uid ? collection.where('userID', '==', uid).orderBy(FieldPath.documentId())
      : collection.where('cleanupAfter', '<=', Timestamp.fromMillis(now)).orderBy('cleanupAfter');
    query = query.limit(Math.min(PAGE_SIZE, MAX_TASKS - processed));
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const reservation of page.docs) {
      try { await reconcileReservation(reservation.ref, now); } catch { failed++; }
    }
    processed += page.size;
    cursor = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }
  if (failed) throw new Error('Temporary upload reservations must be retried.');
}
