import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';

type EventPrivacy = 'public' | 'private';

interface SetEventSharingRequest {
  userID?: unknown;
  eventID?: unknown;
  enabled?: unknown;
}

interface SourceFileReference {
  path: string;
}

const PUBLIC_EVENT_ROUTE_PREFIX = '/share/event';
const PUBLIC_COMPARISON_ROUTE_PREFIX = '/share/comparison';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requirePathSegment(value: unknown, fieldName: 'userID' | 'eventID'): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${fieldName} is required.`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.includes('/')) {
    throw new HttpsError('invalid-argument', `${fieldName} is invalid.`);
  }

  return normalized;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new HttpsError('invalid-argument', 'enabled must be a boolean.');
  }

  return value;
}

function resolveHydrationSourceFileCandidates(eventData: Record<string, unknown>): Record<string, unknown>[] {
  const originalFiles = Array.isArray(eventData.originalFiles) ? eventData.originalFiles : [];
  if (originalFiles.length > 0) {
    return originalFiles.flatMap((originalFile) => {
      const candidate = asRecord(originalFile);
      return candidate ? [candidate] : [];
    });
  }

  const legacyOriginalFile = asRecord(eventData.originalFile);
  return legacyOriginalFile ? [legacyOriginalFile] : [];
}

function resolveSourceFilesRequiredForPublicHydration(
  eventData: Record<string, unknown>,
  userID: string,
  eventID: string,
  defaultBucketName: string,
): SourceFileReference[] {
  const sourcePrefix = `users/${userID}/events/${eventID}/`;
  const sourceFilesByPath = new Map<string, SourceFileReference>();

  for (const candidate of resolveHydrationSourceFileCandidates(eventData)) {
    if (!Object.prototype.hasOwnProperty.call(candidate, 'path')) {
      continue;
    }

    const rawPath = candidate.path;
    if (typeof rawPath !== 'string') {
      throw new HttpsError('failed-precondition', 'Event source file metadata is invalid.');
    }

    const path = rawPath.trim();
    if (!path || path !== rawPath) {
      throw new HttpsError('failed-precondition', 'Event source file metadata is invalid.');
    }

    if (!path.startsWith(sourcePrefix)) {
      throw new HttpsError('failed-precondition', 'Event source file metadata points outside this event.');
    }

    const bucket = typeof candidate.bucket === 'string' && candidate.bucket.trim()
      ? candidate.bucket.trim()
      : undefined;
    if (bucket && bucket !== defaultBucketName) {
      throw new HttpsError('failed-precondition', 'Event source file metadata points outside this storage bucket.');
    }

    sourceFilesByPath.set(path, { path });
  }

  const sourceFiles = [...sourceFilesByPath.values()];
  if (!sourceFiles.length) {
    throw new HttpsError('failed-precondition', 'Event has no original source files to share.');
  }

  return sourceFiles;
}

function isStorageNotFound(error: unknown): boolean {
  const errorRecord = asRecord(error);
  const code = errorRecord?.code;
  const statusCode = errorRecord?.statusCode;
  return code === 404 || code === '404' || statusCode === 404 || statusCode === '404';
}

async function validateSourceFilesAvailableForPublicHydration(params: {
  bucket: { file(path: string): { getMetadata(): Promise<unknown> } };
  sourceFiles: SourceFileReference[];
  userID: string;
  eventID: string;
}): Promise<void> {
  const { bucket, sourceFiles, userID, eventID } = params;

  for (const sourceFile of sourceFiles) {
    try {
      await bucket.file(sourceFile.path).getMetadata();
    } catch (error) {
      if (isStorageNotFound(error)) {
        throw new HttpsError('failed-precondition', 'Event source file is missing and cannot be shared.');
      }

      logger.error('[setEventSharing] Failed to verify event source file availability.', {
        userID,
        eventID,
        path: sourceFile.path,
        error,
      });
      throw new HttpsError('internal', 'Could not verify event source files.');
    }
  }
}

function buildSharePath(prefix: string, userID: string, eventID: string): string {
  return `${prefix}/${encodeURIComponent(userID)}/${encodeURIComponent(eventID)}`;
}

export const setEventSharing = onCall({
  region: FUNCTIONS_MANIFEST.setEventSharing.region,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const data = asRecord(request.data) as SetEventSharingRequest | null;
  const userID = requirePathSegment(data?.userID, 'userID');
  const eventID = requirePathSegment(data?.eventID, 'eventID');
  const enabled = requireBoolean(data?.enabled);

  if (request.auth.uid !== userID) {
    throw new HttpsError('permission-denied', 'You can only update sharing for your own events.');
  }

  const eventRef = admin.firestore().doc(`users/${userID}/events/${eventID}`);
  const eventSnapshot = await eventRef.get();
  if (!eventSnapshot.exists) {
    throw new HttpsError('not-found', `Event ${eventID} was not found for this user.`);
  }

  if (enabled) {
    const eventData = asRecord(eventSnapshot.data()) || {};
    const defaultBucket = admin.storage().bucket();
    const sourceFiles = resolveSourceFilesRequiredForPublicHydration(
      eventData,
      userID,
      eventID,
      defaultBucket.name,
    );
    await validateSourceFilesAvailableForPublicHydration({
      bucket: defaultBucket,
      sourceFiles,
      userID,
      eventID,
    });
  }

  const privacy: EventPrivacy = enabled ? 'public' : 'private';
  const eventPatch = sanitizeEventFirestoreWritePayload({ privacy });

  try {
    await eventRef.update(eventPatch);
  } catch (error) {
    logger.error('[setEventSharing] Failed to update event sharing', { userID, eventID, enabled, error });
    throw new HttpsError('internal', 'Could not update event sharing.');
  }

  return {
    eventID,
    privacy,
    publicEventUrl: buildSharePath(PUBLIC_EVENT_ROUTE_PREFIX, userID, eventID),
    publicComparisonUrl: buildSharePath(PUBLIC_COMPARISON_ROUTE_PREFIX, userID, eventID),
  };
});
