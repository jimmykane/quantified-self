import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  ActivityJSONInterface,
  EventImporterJSON,
  EventJSONInterface,
  EventInterface,
  EventUtilities,
} from '@sports-alliance/sports-lib';

import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasBasicAccess, hasProAccess } from '../utils';
import { EventWriter, FirestoreAdapter, OriginalFile, StorageAdapter } from '../shared/event-writer';
import { FirestoreEventJSON, OriginalFileMetaData } from '../../../shared/app-event.interface';
import { ProcessingMetaData } from '../shared/processing-metadata.interface';
import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';
import { sportsLibVersionToCode } from '../reparse/sports-lib-reparse.service';
import { USAGE_LIMITS } from '../../../shared/limits';
import { stripStreamsRecursivelyInPlace } from '../../../shared/firestore-write-sanitizer';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';

type MergeType = 'benchmark' | 'multi';

interface MergeEventRequest {
  eventIds: string[];
  mergeType: MergeType;
}

interface SourceFileMeta {
  path: string;
  bucket?: string;
  startDate?: Date;
  originalFilename?: string;
}

interface SourceEventLoadResult {
  event: EventInterface;
  sourceFiles: SourceFileMeta[];
}

const MAX_SOURCE_EVENTS = 10;
const GENERATED_MERGE_DESCRIPTION_PREFIX = 'a merge of 2 or more activit';
const PRIMARY_BUCKET = 'quantified-self-io';
const LEGACY_BUCKET = 'quantified-self-io.appspot.com';

function toDateOrUndefined(value: unknown): Date | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    return ((value as { toDate: () => Date }).toDate());
  }
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return new Date((value as { toMillis: () => number }).toMillis());
  }
  if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
    const seconds = Number((value as Record<string, unknown>).seconds);
    const nanos = Number((value as Record<string, unknown>).nanoseconds || 0);
    return new Date((seconds * 1000) + Math.floor(nanos / 1000000));
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function normalizeEventIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'eventIds must be an array of event IDs.');
  }

  const normalized = value
    .map(id => `${id || ''}`.trim())
    .filter(Boolean);

  if (normalized.length < 2) {
    throw new HttpsError('invalid-argument', 'At least 2 event IDs are required to merge.');
  }
  if (normalized.length > MAX_SOURCE_EVENTS) {
    throw new HttpsError('invalid-argument', `You can merge up to ${MAX_SOURCE_EVENTS} events at once.`);
  }

  if (new Set(normalized).size !== normalized.length) {
    throw new HttpsError('invalid-argument', 'eventIds must be unique.');
  }

  return normalized;
}

function normalizeMergeType(value: unknown): MergeType {
  const normalized = `${value || ''}`.trim();
  if (normalized !== 'benchmark' && normalized !== 'multi') {
    throw new HttpsError('invalid-argument', 'mergeType must be either "benchmark" or "multi".');
  }
  return normalized;
}

function normalizeBucketName(bucketName?: string): string | null {
  if (!bucketName) {
    return null;
  }
  const normalized = bucketName.trim();
  return normalized.length > 0 ? normalized : null;
}

function getAppspotVariant(bucketName: string): string {
  if (bucketName.endsWith('.appspot.com')) {
    return bucketName.replace(/\.appspot\.com$/, '');
  }
  return `${bucketName}.appspot.com`;
}

function pushBucketCandidate(candidates: string[], bucketName?: string | null): void {
  const normalized = normalizeBucketName(bucketName || undefined);
  if (!normalized) {
    return;
  }
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

function resolveBucketCandidates(metadataBucket?: string): string[] {
  const candidates: string[] = [];
  pushBucketCandidate(candidates, metadataBucket);
  pushBucketCandidate(candidates, PRIMARY_BUCKET);
  pushBucketCandidate(candidates, LEGACY_BUCKET);

  try {
    const defaultBucketName = admin.storage().bucket().name;
    pushBucketCandidate(candidates, defaultBucketName);
  } catch (_error) {
    // Ignore and continue with explicit candidates.
  }

  const baseCandidates = [...candidates];
  for (const bucketName of baseCandidates) {
    pushBucketCandidate(candidates, getAppspotVariant(bucketName));
  }

  return candidates;
}

function isObjectNotFoundError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'number' && code === 404) {
    return true;
  }
  if (typeof code === 'string') {
    const normalizedCode = code.toLowerCase();
    if (
      normalizedCode === '404'
      || normalizedCode === 'not_found'
      || normalizedCode === 'storage/object-not-found'
    ) {
      return true;
    }
  }

  const message = ((error as { message?: unknown })?.message || '').toString().toLowerCase();
  return message.includes('no such object') || message.includes('not found');
}

async function downloadSourceBytesWithBucketFallback(sourceFile: SourceFileMeta): Promise<Buffer> {
  const bucketCandidates = resolveBucketCandidates(sourceFile.bucket);
  let lastNotFoundReason = '';

  for (const bucketName of bucketCandidates) {
    try {
      const [rawBytes] = await admin.storage().bucket(bucketName).file(sourceFile.path).download();
      return rawBytes;
    } catch (error) {
      if (isObjectNotFoundError(error)) {
        lastNotFoundReason = (error as Error)?.message || `${error}`;
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `No such object in any candidate bucket (${bucketCandidates.join(', ')}) for ${sourceFile.path}. `
    + `Last error: ${lastNotFoundReason || 'No such object'}`,
  );
}

function resolveStoredExtensionFromPath(path: string): string {
  const lower = path.toLowerCase();
  const withoutGz = lower.endsWith('.gz') ? lower.slice(0, -3) : lower;
  const parts = withoutGz.split('.').filter(Boolean);
  const extension = parts.pop();

  if (!extension) {
    throw new Error(`Could not resolve file extension for source file path: ${path}`);
  }

  return lower.endsWith('.gz') ? `${extension}.gz` : extension;
}

function extractSourceFiles(eventDoc: FirestoreEventJSON | Record<string, unknown>): SourceFileMeta[] {
  const eventAny = eventDoc as Record<string, unknown>;
  const eventStartDate = toDateOrUndefined(eventAny.startDate);

  const files: OriginalFileMetaData[] = Array.isArray(eventAny.originalFiles) && eventAny.originalFiles.length > 0
    ? eventAny.originalFiles as OriginalFileMetaData[]
    : eventAny.originalFile
      ? [eventAny.originalFile as OriginalFileMetaData]
      : [];

  return files
    .filter(file => !!file?.path)
    .map(file => ({
      path: file.path,
      bucket: file.bucket,
      startDate: toDateOrUndefined(file.startDate) || eventStartDate,
      originalFilename: file.originalFilename,
    }));
}

function sortActivityDocs(
  docs: Array<Pick<admin.firestore.QueryDocumentSnapshot, 'id' | 'data'>>,
): Array<Pick<admin.firestore.QueryDocumentSnapshot, 'id' | 'data'>> {
  return [...docs].sort((a, b) => {
    const aStart = toDateOrUndefined(a.data()?.startDate)?.getTime();
    const bStart = toDateOrUndefined(b.data()?.startDate)?.getTime();
    const aHasStart = typeof aStart === 'number';
    const bHasStart = typeof bStart === 'number';

    if (aHasStart && bHasStart) {
      if (aStart !== bStart) {
        return (aStart as number) - (bStart as number);
      }
      return a.id.localeCompare(b.id);
    }
    if (aHasStart) {
      return -1;
    }
    if (bHasStart) {
      return 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function ensureArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toActivityJSON(snapshot: Pick<admin.firestore.QueryDocumentSnapshot, 'data'>): ActivityJSONInterface {
  const activityJSON = { ...(snapshot.data() as Record<string, unknown>) };
  // Mandatory shared write policy: sanitize reconstructed activity payloads before parse defaults.
  stripStreamsRecursivelyInPlace(activityJSON);
  delete activityJSON.eventID;
  delete activityJSON.userID;
  delete activityJSON.eventStartDate;

  // Activity docs are persisted without streams; sports-lib JSON import expects these fields.
  activityJSON.stats = ensureObject(activityJSON.stats);
  activityJSON.laps = ensureArray(activityJSON.laps);
  // Merge path is intentionally stream-less; never hydrate streams here.
  activityJSON.streams = [];
  activityJSON.intensityZones = ensureArray(activityJSON.intensityZones);
  activityJSON.events = ensureArray(activityJSON.events);

  return activityJSON as unknown as ActivityJSONInterface;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: `${error}` };
}

function clearGeneratedMergeDescription(event: EventInterface): void {
  const eventAny = event as { description?: unknown; setDescription?: (description: string) => unknown };
  const description = eventAny.description;
  if (typeof description !== 'string') {
    return;
  }

  const normalized = description.trim().toLowerCase();
  if (!normalized.startsWith(GENERATED_MERGE_DESCRIPTION_PREFIX)) {
    return;
  }

  if (typeof eventAny.setDescription === 'function') {
    eventAny.setDescription('');
    return;
  }

  eventAny.description = '';
}

function getFirestoreAdapter(): FirestoreAdapter {
  return {
    setDoc: async (path: string[], data: unknown) => {
      await admin.firestore().doc(path.join('/')).set(data as Record<string, unknown>);
    },
    createBlob: (data: Uint8Array) => Buffer.from(data),
    generateID: () => admin.firestore().collection('tmp').doc().id,
  };
}

function getStorageAdapter(): StorageAdapter {
  return {
    uploadFile: async (path: string, data: unknown) => {
      await admin.storage().bucket().file(path).save(data as Buffer);
    },
    getBucketName: () => admin.storage().bucket().name,
  };
}

async function persistProcessingMetadata(userID: string, eventID: string): Promise<void> {
  const processingPayload: ProcessingMetaData = {
    sportsLibVersion: SPORTS_LIB_VERSION,
    sportsLibVersionCode: sportsLibVersionToCode(SPORTS_LIB_VERSION),
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await admin.firestore()
    .doc(`users/${userID}/events/${eventID}/metaData/processing`)
    .set(processingPayload, { merge: true });
}

async function resolveUploadLimitForUser(userID: string): Promise<number | null> {
  if (await hasProAccess(userID)) {
    return null;
  }
  if (await hasBasicAccess(userID)) {
    return USAGE_LIMITS.basic;
  }
  return USAGE_LIMITS.free;
}

async function getEventCountForUser(userID: string): Promise<number> {
  const countSnapshot = await admin.firestore()
    .collection('users')
    .doc(userID)
    .collection('events')
    .count()
    .get();
  return countSnapshot.data().count;
}

async function loadSourceEvent(userID: string, eventID: string): Promise<SourceEventLoadResult> {
  const eventSnapshot = await admin.firestore().doc(`users/${userID}/events/${eventID}`).get();
  if (!eventSnapshot.exists) {
    throw new HttpsError('not-found', `Event ${eventID} was not found for this user.`);
  }

  const eventData = eventSnapshot.data() as FirestoreEventJSON | Record<string, unknown>;
  const activitiesSnapshot = await admin.firestore()
    .collection(`users/${userID}/activities`)
    .where('eventID', '==', eventID)
    .get();
  const sortedActivityDocs = sortActivityDocs(activitiesSnapshot.docs);

  let event: EventInterface;
  try {
    event = EventImporterJSON.getEventFromJSON(eventData as unknown as EventJSONInterface).setID(eventID);
  } catch (error) {
    throw new HttpsError('internal', `Could not parse event ${eventID}.`);
  }

  const activities = sortedActivityDocs.map((docSnapshot) => {
    const activity = EventImporterJSON
      .getActivityFromJSON(toActivityJSON(docSnapshot))
      .setID(docSnapshot.id);

    const creatorName = `${docSnapshot.data()?.creator?.name ?? ''}`.trim();
    if (creatorName && (activity as any).creator) {
      (activity as any).creator.name = creatorName;
    }

    return activity;
  });

  if (typeof (event as { clearActivities?: () => void }).clearActivities === 'function') {
    (event as { clearActivities: () => void }).clearActivities();
  }
  if (typeof (event as { addActivities?: (activities: unknown[]) => void }).addActivities === 'function') {
    (event as { addActivities: (activities: unknown[]) => void }).addActivities(activities);
  } else {
    (event as { activities?: unknown[] }).activities = activities;
  }

  const sourceFiles = extractSourceFiles(eventData);
  if (sourceFiles.length === 0) {
    throw new HttpsError('failed-precondition', `Event ${eventID} has no original source files.`);
  }

  return { event, sourceFiles };
}

async function downloadOriginalFilesForMerge(sourceFiles: SourceFileMeta[]): Promise<OriginalFile[]> {
  const originalFiles: OriginalFile[] = [];

  for (const sourceFile of sourceFiles) {
    try {
      const bytes = await downloadSourceBytesWithBucketFallback(sourceFile);
      originalFiles.push({
        data: bytes,
        extension: resolveStoredExtensionFromPath(sourceFile.path),
        startDate: sourceFile.startDate || new Date(),
        originalFilename: sourceFile.originalFilename,
      });
    } catch (error) {
      logger.warn('[mergeEvents] Failed to load source file for merge', {
        path: sourceFile.path,
        bucket: sourceFile.bucket,
        error,
      });
      throw new HttpsError('failed-precondition', `Could not access source file: ${sourceFile.path}`);
    }
  }

  return originalFiles;
}

export const mergeEvents = onCall({
  region: FUNCTIONS_MANIFEST.mergeEvents.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 540,
  maxInstances: 20,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const userID = request.auth.uid;
  const payload = request.data as MergeEventRequest | undefined;
  const eventIDs = normalizeEventIds(payload?.eventIds);
  const mergeType = normalizeMergeType(payload?.mergeType);

  const currentCount = await getEventCountForUser(userID);
  const uploadLimit = await resolveUploadLimitForUser(userID);
  if (uploadLimit !== null && currentCount >= uploadLimit) {
    throw new HttpsError(
      'resource-exhausted',
      `Upload limit reached for your tier. You have ${currentCount} events. Limit is ${uploadLimit}.`,
    );
  }

  try {
    const sourceLoadResults: SourceEventLoadResult[] = [];
    for (const eventID of eventIDs) {
      sourceLoadResults.push(await loadSourceEvent(userID, eventID));
    }

    const sourceEvents = sourceLoadResults.map(result => result.event);
    const sourceFiles = sourceLoadResults.flatMap(result => result.sourceFiles);
    const originalFiles = await downloadOriginalFilesForMerge(sourceFiles);

    const mergedEvent = EventUtilities.mergeEvents(sourceEvents);
    const mergedEventID = admin.firestore().collection('users').doc().id;
    mergedEvent.setID(mergedEventID);
    (mergedEvent as { isMerge?: boolean; mergeType?: MergeType }).isMerge = mergeType === 'benchmark';
    (mergedEvent as { isMerge?: boolean; mergeType?: MergeType }).mergeType = mergeType;
    clearGeneratedMergeDescription(mergedEvent);

    const writer = new EventWriter(getFirestoreAdapter(), getStorageAdapter());
    await writer.writeAllEventData(userID, mergedEvent as any, originalFiles);
    await admin.firestore().doc(`users/${userID}/events/${mergedEventID}`).set({
      isMerge: mergeType === 'benchmark',
      mergeType,
    }, { merge: true });
    await persistProcessingMetadata(userID, mergedEventID);

    return {
      eventId: mergedEventID,
      mergeType,
      sourceEventsCount: eventIDs.length,
      sourceFilesCount: originalFiles.length,
      activitiesCount: mergedEvent.getActivities().length,
      uploadLimit,
      uploadCountAfterWrite: currentCount + 1,
    };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    logger.error('[mergeEvents] Failed to merge events', {
      userID,
      eventIDs,
      mergeType,
      error: serializeError(error),
    });
    throw new HttpsError('internal', 'Could not merge events.');
  }
});
