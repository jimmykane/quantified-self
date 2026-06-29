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
  bucket?: string;
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

function resolveSourceFileCandidates(eventData: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  if (Array.isArray(eventData.originalFiles)) {
    for (const originalFile of eventData.originalFiles) {
      const candidate = asRecord(originalFile);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  const legacyOriginalFile = asRecord(eventData.originalFile);
  if (legacyOriginalFile) {
    candidates.push(legacyOriginalFile);
  }

  return candidates;
}

function resolveSourceFiles(
  eventData: Record<string, unknown>,
  userID: string,
  eventID: string,
  defaultBucketName: string,
): SourceFileReference[] {
  const sourcePrefix = `users/${userID}/events/${eventID}/`;
  const sourceFilesByPath = new Map<string, SourceFileReference>();

  for (const candidate of resolveSourceFileCandidates(eventData)) {
    const path = typeof candidate.path === 'string' ? candidate.path.trim().replace(/^\/+/, '') : '';
    if (!path) {
      throw new HttpsError('failed-precondition', 'Event source file metadata is missing a storage path.');
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
    sourceFilesByPath.set(`${bucket || ''}:${path}`, { path, bucket });
  }

  const sourceFiles = [...sourceFilesByPath.values()];
  if (!sourceFiles.length) {
    throw new HttpsError('failed-precondition', 'Event has no original source files to share.');
  }

  return sourceFiles;
}

function toStringMetadata(value: unknown): Record<string, string> {
  const metadata = asRecord(value);
  if (!metadata) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, metadataValue] of Object.entries(metadata)) {
    if (typeof metadataValue === 'string') {
      normalized[key] = metadataValue;
    }
  }

  return normalized;
}

async function updateStorageFilePrivacy(sourceFile: SourceFileReference, privacy: EventPrivacy): Promise<void> {
  const storageBucket = sourceFile.bucket
    ? admin.storage().bucket(sourceFile.bucket)
    : admin.storage().bucket();
  const storageFile = storageBucket.file(sourceFile.path);
  const [metadata] = await storageFile.getMetadata();
  const existingCustomMetadata = toStringMetadata(asRecord(metadata)?.metadata);
  await storageFile.setMetadata({
    metadata: {
      ...existingCustomMetadata,
      privacy,
    },
  });
}

async function updateSourceFilesPrivacy(
  sourceFiles: SourceFileReference[],
  privacy: EventPrivacy,
  updatedSourceFiles: SourceFileReference[] = [],
): Promise<void> {
  for (const sourceFile of sourceFiles) {
    await updateStorageFilePrivacy(sourceFile, privacy);
    updatedSourceFiles.push(sourceFile);
  }
}

async function updateSourceFilesPrivacyBestEffort(
  sourceFiles: SourceFileReference[],
  privacy: EventPrivacy,
): Promise<void> {
  const results = await Promise.allSettled(
    sourceFiles.map((sourceFile) => updateStorageFilePrivacy(sourceFile, privacy)),
  );
  const rejectedResults = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejectedResults.length) {
    logger.warn('[setEventSharing] Could not update every source file privacy metadata.', {
      failedCount: rejectedResults.length,
      privacy,
      reasons: rejectedResults.map((result) => result.reason),
    });
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

  const eventData = asRecord(eventSnapshot.data()) || {};
  const defaultBucketName = admin.storage().bucket().name;
  const privacy: EventPrivacy = enabled ? 'public' : 'private';
  const eventPatch = sanitizeEventFirestoreWritePayload({ privacy });

  if (enabled) {
    const sourceFiles = resolveSourceFiles(eventData, userID, eventID, defaultBucketName);
    try {
      const updatedSourceFiles: SourceFileReference[] = [];
      try {
        await updateSourceFilesPrivacy(sourceFiles, privacy, updatedSourceFiles);
        await eventRef.update(eventPatch);
      } catch (error) {
        await Promise.allSettled(updatedSourceFiles.map((sourceFile) => updateStorageFilePrivacy(sourceFile, 'private')));
        throw error;
      }
    } catch (error) {
      logger.error('[setEventSharing] Failed to update event sharing', { userID, eventID, enabled, error });
      throw new HttpsError('internal', 'Could not update event sharing.');
    }
  } else {
    try {
      let sourceFiles: SourceFileReference[] = [];
      try {
        sourceFiles = resolveSourceFiles(eventData, userID, eventID, defaultBucketName);
      } catch (error) {
        logger.warn('[setEventSharing] Could not resolve source files while disabling sharing.', {
          userID,
          eventID,
          error,
        });
      }
      await updateSourceFilesPrivacyBestEffort(sourceFiles, privacy);
      await eventRef.update(eventPatch);
    } catch (error) {
      logger.error('[setEventSharing] Failed to update event sharing', { userID, eventID, enabled, error });
      throw new HttpsError('internal', 'Could not update event sharing.');
    }
  }

  return {
    eventID,
    privacy,
    publicEventUrl: buildSharePath(PUBLIC_EVENT_ROUTE_PREFIX, userID, eventID),
    publicComparisonUrl: buildSharePath(PUBLIC_COMPARISON_ROUTE_PREFIX, userID, eventID),
  };
});
