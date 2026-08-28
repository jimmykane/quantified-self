import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { createHash } from 'node:crypto';

import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '../../../shared/app-route.interface';

const REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME = 'routeOriginalFileCleanup';
const REJECTED_ROUTE_ORIGINAL_CLEANUP_SCHEMA_VERSION = 1;
const MAX_ROUTE_ID_LENGTH = 256;
const MAX_STORAGE_BUCKET_LENGTH = 222;
const MAX_STORAGE_PATH_LENGTH = 1024;

interface RejectedRouteOriginalCleanupDocument {
  schemaVersion: typeof REJECTED_ROUTE_ORIGINAL_CLEANUP_SCHEMA_VERSION;
  userID: string;
  routeID: string;
  bucket: string;
  path: string;
  createdAt: admin.firestore.FieldValue;
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
  userID: string,
  cleanupID: string,
): admin.firestore.DocumentReference {
  return db.collection('users').doc(userID)
    .collection(REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME)
    .doc(cleanupID);
}

function normalizeRequiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  return value.trim() === value ? value : null;
}

function routeReferencesOriginalPath(route: FirestoreRouteJSON | undefined, path: string): boolean {
  if (route?.originalFile?.path === path) return true;
  return Array.isArray(route?.originalFiles)
    && route.originalFiles.some(file => file?.path === path);
}

function parseRejectedRouteOriginalCleanupDocument(
  data: Record<string, unknown> | undefined,
  expectedUserID: string,
  expectedCleanupID: string,
  expectedBucket: string,
): Omit<RejectedRouteOriginalCleanupDocument, 'createdAt'> | null {
  const userID = normalizeRequiredString(data?.userID, 128);
  const routeID = normalizeRequiredString(data?.routeID, MAX_ROUTE_ID_LENGTH);
  const bucket = normalizeRequiredString(data?.bucket, MAX_STORAGE_BUCKET_LENGTH);
  const path = normalizeRequiredString(data?.path, MAX_STORAGE_PATH_LENGTH);
  const fileName = path?.split('/').pop() || '';
  if (data?.schemaVersion !== REJECTED_ROUTE_ORIGINAL_CLEANUP_SCHEMA_VERSION
    || userID !== expectedUserID
    || !routeID
    || routeID.includes('/')
    || bucket !== expectedBucket
    || !path
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
  };
}

export async function enqueueRejectedRouteOriginalCleanup(params: {
  userID: string;
  routeID: string;
  originalFile: OriginalRouteFileMetaData;
}): Promise<void> {
  const defaultBucket = admin.storage().bucket();
  const bucket = params.originalFile.bucket || defaultBucket.name;
  const cleanupID = getRejectedRouteOriginalCleanupID(bucket, params.originalFile.path);
  const cleanupRef = getRejectedRouteOriginalCleanupRef(
    admin.firestore(),
    params.userID,
    cleanupID,
  );
  await cleanupRef.set({
    schemaVersion: REJECTED_ROUTE_ORIGINAL_CLEANUP_SCHEMA_VERSION,
    userID: params.userID,
    routeID: params.routeID,
    bucket,
    path: params.originalFile.path,
    createdAt: FieldValue.serverTimestamp(),
  } satisfies RejectedRouteOriginalCleanupDocument);
}

export async function processRejectedRouteOriginalCleanupDocument(
  snapshot: admin.firestore.QueryDocumentSnapshot,
  userID: string,
  cleanupID: string,
): Promise<void> {
  const defaultBucket = admin.storage().bucket();
  const cleanup = parseRejectedRouteOriginalCleanupDocument(
    snapshot.data() as Record<string, unknown> | undefined,
    userID,
    cleanupID,
    defaultBucket.name,
  );
  if (!cleanup) {
    logger.error('[RouteSync] Rejected malformed original-file cleanup task.', {
      cleanupID,
    });
    await snapshot.ref.delete();
    return;
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
    return;
  }

  await defaultBucket.file(cleanup.path).delete({ ignoreNotFound: true });
  await snapshot.ref.delete();
  logger.info('[RouteSync] Deleted rejected synced-route original file.', {
    cleanupID,
  });
}

export const cleanupRejectedRouteOriginalFile = onDocumentCreated({
  document: `users/{userID}/${REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME}/{cleanupID}`,
  region: 'europe-west2',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 20,
  concurrency: 1,
  retry: true,
}, async (event) => {
  if (!event.data) return;
  await processRejectedRouteOriginalCleanupDocument(
    event.data,
    event.params.userID,
    event.params.cleanupID,
  );
});
