import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { createHash } from 'node:crypto';

import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '../../../shared/app-route.interface';

export const REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME = 'routeOriginalFileCleanup';
const REJECTED_ROUTE_ORIGINAL_CLEANUP_SCHEMA_VERSION = 1;
const ROUTE_SYNC_WORKER_TIMEOUT_MS = 9 * 60 * 1000;
export const REJECTED_ROUTE_ORIGINAL_RESERVATION_MS = ROUTE_SYNC_WORKER_TIMEOUT_MS + (6 * 60 * 1000);
const REDRIVE_PAGE_SIZE = 100;
const REDRIVE_MAX_TASKS = 500;
const CLEANUP_FAILURE_BACKOFF_MS = 30 * 60 * 1000;
const MAX_ROUTE_ID_LENGTH = 256;
const MAX_STORAGE_BUCKET_LENGTH = 222;
const MAX_STORAGE_PATH_LENGTH = 1024;

interface RejectedRouteOriginalCleanupDocument {
  schemaVersion: typeof REJECTED_ROUTE_ORIGINAL_CLEANUP_SCHEMA_VERSION;
  userID: string;
  routeID: string;
  bucket: string;
  path: string;
  cleanupAfter: admin.firestore.Timestamp;
  createdAt: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
}

export interface RejectedRouteOriginalCleanupReservation {
  cleanupID: string;
  ref: admin.firestore.DocumentReference;
}

function getRejectedRouteOriginalCleanupID(bucket: string, path: string): string {
  return createHash('sha256')
    .update(bucket)
    .update('\0')
    .update(path)
    .digest('hex');
}

function getRejectedRouteOriginalCleanupRef(
  db: admin.firestore.Firestore,
  cleanupID: string,
): admin.firestore.DocumentReference {
  return db.collection(REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME).doc(cleanupID);
}

function normalizeRequiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  return value.trim() === value ? value : null;
}

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object' || typeof (value as { toMillis?: unknown }).toMillis !== 'function') {
    return null;
  }
  const millis = (value as { toMillis: () => number }).toMillis();
  return Number.isFinite(millis) ? millis : null;
}

function routeReferencesOriginalPath(route: FirestoreRouteJSON | undefined, path: string): boolean {
  if (route?.originalFile?.path === path) return true;
  return Array.isArray(route?.originalFiles)
    && route.originalFiles.some(file => file?.path === path);
}

function parseRejectedRouteOriginalCleanupDocument(
  data: Record<string, unknown> | undefined,
  expectedCleanupID: string,
  expectedBucket: string,
): (Omit<RejectedRouteOriginalCleanupDocument, 'createdAt' | 'updatedAt' | 'cleanupAfter'> & {
  cleanupAfterMs: number;
}) | null {
  const userID = normalizeRequiredString(data?.userID, 128);
  const routeID = normalizeRequiredString(data?.routeID, MAX_ROUTE_ID_LENGTH);
  const bucket = normalizeRequiredString(data?.bucket, MAX_STORAGE_BUCKET_LENGTH);
  const path = normalizeRequiredString(data?.path, MAX_STORAGE_PATH_LENGTH);
  const cleanupAfterMs = timestampMillis(data?.cleanupAfter);
  const fileName = path?.split('/').pop() || '';
  if (data?.schemaVersion !== REJECTED_ROUTE_ORIGINAL_CLEANUP_SCHEMA_VERSION
    || !userID
    || !routeID
    || routeID.includes('/')
    || bucket !== expectedBucket
    || !path
    || cleanupAfterMs === null
    || !path.startsWith(`users/${userID}/routes/${routeID}/uploads/provider-sync/original-`)
    || !/^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9]{1,16}$/.test(fileName.slice('original-'.length))
    || getRejectedRouteOriginalCleanupID(bucket, path) !== expectedCleanupID) {
    return null;
  }
  return {
    schemaVersion: REJECTED_ROUTE_ORIGINAL_CLEANUP_SCHEMA_VERSION,
    userID,
    routeID,
    bucket,
    path,
    cleanupAfterMs,
  };
}

export function reserveRejectedRouteOriginalCleanupInTransaction(params: {
  db: admin.firestore.Firestore;
  transaction: admin.firestore.Transaction;
  userID: string;
  routeID: string;
  originalFile: OriginalRouteFileMetaData;
  nowMs?: number;
}): RejectedRouteOriginalCleanupReservation {
  const defaultBucket = admin.storage().bucket();
  const bucket = params.originalFile.bucket || defaultBucket.name;
  const cleanupID = getRejectedRouteOriginalCleanupID(bucket, params.originalFile.path);
  const ref = getRejectedRouteOriginalCleanupRef(params.db, cleanupID);
  const serverTimestamp = FieldValue.serverTimestamp();
  params.transaction.set(ref, {
    schemaVersion: REJECTED_ROUTE_ORIGINAL_CLEANUP_SCHEMA_VERSION,
    userID: params.userID,
    routeID: params.routeID,
    bucket,
    path: params.originalFile.path,
    cleanupAfter: Timestamp.fromMillis((params.nowMs ?? Date.now()) + REJECTED_ROUTE_ORIGINAL_RESERVATION_MS),
    createdAt: serverTimestamp,
    updatedAt: serverTimestamp,
  } satisfies RejectedRouteOriginalCleanupDocument);
  return { cleanupID, ref };
}

export async function requestRejectedRouteOriginalCleanup(
  reservation: RejectedRouteOriginalCleanupReservation,
  nowMs = Date.now(),
): Promise<void> {
  await reservation.ref.update({
    cleanupAfter: Timestamp.fromMillis(nowMs),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function releaseRejectedRouteOriginalCleanupReservation(
  reservation: RejectedRouteOriginalCleanupReservation,
): Promise<void> {
  // Cleanup intents are permanent leaf documents: client access is denied and
  // no Admin writer creates descendants beneath them.
  await reservation.ref.delete();
}

export async function processRejectedRouteOriginalCleanupDocument(
  snapshot: admin.firestore.QueryDocumentSnapshot,
  cleanupID: string,
  nowMs = Date.now(),
): Promise<'cleaned' | 'not_due'> {
  const defaultBucket = admin.storage().bucket();
  const cleanup = parseRejectedRouteOriginalCleanupDocument(
    snapshot.data() as Record<string, unknown> | undefined,
    cleanupID,
    defaultBucket.name,
  );
  if (!cleanup) {
    logger.error('[RouteSync] Rejected malformed original-file cleanup task.', {
      cleanupID,
    });
    // Cleanup intents are permanent leaf documents; malformed server-owned
    // records cannot contain descendants by design.
    await snapshot.ref.delete();
    return 'cleaned';
  }

  if (cleanup.cleanupAfterMs > nowMs) {
    return 'not_due';
  }

  const routeSnapshot = await admin.firestore()
    .doc(`users/${cleanup.userID}/routes/${cleanup.routeID}`)
    .get();
  if (routeSnapshot.exists
    && routeReferencesOriginalPath(routeSnapshot.data() as FirestoreRouteJSON | undefined, cleanup.path)) {
    logger.info('[RouteSync] Discarding stale original-file cleanup task for a committed route.', {
      cleanupID,
    });
    await snapshot.ref.delete();
    return 'cleaned';
  }

  await defaultBucket.file(cleanup.path).delete({ ignoreNotFound: true });
  await snapshot.ref.delete();
  logger.info('[RouteSync] Deleted rejected synced-route original file.', {
    cleanupID,
  });
  return 'cleaned';
}

async function processCleanupSnapshotPage(
  docs: admin.firestore.QueryDocumentSnapshot[],
  nowMs: number,
): Promise<unknown[]> {
  const results = await Promise.allSettled(docs.map(doc => (
    processRejectedRouteOriginalCleanupDocument(doc, doc.id, nowMs)
  )));
  const failures = results.flatMap((result, index) => (
    result.status === 'rejected'
      ? [{ doc: docs[index], reason: result.reason }]
      : []
  ));

  await Promise.all(failures.map(async ({ doc }) => {
    try {
      await doc.ref.update({
        cleanupAfter: Timestamp.fromMillis(nowMs + CLEANUP_FAILURE_BACKOFF_MS),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      logger.error('[RouteSync] Failed to defer a route-original cleanup task after a retryable cleanup error.', {
        cleanupID: doc.id,
        error,
      });
    }
  }));

  return failures.map(failure => failure.reason);
}

export async function redriveRejectedRouteOriginalCleanupTasks(nowMs = Date.now()): Promise<void> {
  const collection = admin.firestore().collection(REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME);
  let lastDocument: admin.firestore.QueryDocumentSnapshot | null = null;
  let processed = 0;
  const failures: unknown[] = [];

  while (processed < REDRIVE_MAX_TASKS) {
    let query = collection
      .where('cleanupAfter', '<=', Timestamp.fromMillis(nowMs))
      .orderBy('cleanupAfter')
      .limit(Math.min(REDRIVE_PAGE_SIZE, REDRIVE_MAX_TASKS - processed));
    if (lastDocument) {
      query = query.startAfter(lastDocument);
    }
    const snapshot = await query.get();
    if (snapshot.empty) break;

    failures.push(...await processCleanupSnapshotPage(snapshot.docs, nowMs));
    processed += snapshot.docs.length;
    lastDocument = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < REDRIVE_PAGE_SIZE) break;
  }

  if (failures.length > 0) {
    logger.error('[RouteSync] Scheduled route-original cleanup redrive retained failed tasks.', {
      failureCount: failures.length,
    });
    throw new Error(`Failed to redrive ${failures.length} route-original cleanup task(s).`);
  }
}

export async function cleanupRejectedRouteOriginalFilesForUser(
  userID: string,
  nowMs = Date.now(),
): Promise<void> {
  const collection = admin.firestore().collection(REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME);
  let lastDocument: admin.firestore.QueryDocumentSnapshot | null = null;
  const failures: unknown[] = [];

  while (true) {
    let query = collection.where('userID', '==', userID).limit(REDRIVE_PAGE_SIZE);
    if (lastDocument) {
      query = query.startAfter(lastDocument);
    }
    const snapshot = await query.get();
    if (snapshot.empty) break;

    failures.push(...await processCleanupSnapshotPage(snapshot.docs, nowMs));
    lastDocument = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < REDRIVE_PAGE_SIZE) break;
  }

  if (failures.length > 0) {
    logger.error('[RouteSync] Account cleanup retained failed route-original cleanup tasks.', {
      userID,
      failureCount: failures.length,
    });
    throw new Error(`Failed to clean ${failures.length} route-original task(s) for deleted user.`);
  }
}

export const cleanupRejectedRouteOriginalFile = onDocumentUpdated({
  document: `${REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME}/{cleanupID}`,
  region: 'europe-west2',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 20,
  concurrency: 1,
  retry: true,
}, async (event) => {
  if (!event.data?.after.exists) return;
  await processRejectedRouteOriginalCleanupDocument(
    event.data.after,
    event.params.cleanupID,
  );
});

export const redriveRejectedRouteOriginalCleanup = onSchedule({
  schedule: 'every 30 minutes',
  region: 'europe-west2',
  timeoutSeconds: 540,
  memory: '256MiB',
  maxInstances: 1,
}, async () => {
  await redriveRejectedRouteOriginalCleanupTasks();
});
