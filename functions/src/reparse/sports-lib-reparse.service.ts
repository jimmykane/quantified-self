import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as xmldom from 'xmldom';
import semver from 'semver';
import {
    EventImporterFIT,
    EventImporterGPX,
    EventImporterSuuntoJSON,
    EventImporterSuuntoSML,
    EventImporterTCX,
    EventInterface,
    EventUtilities,
} from '@sports-alliance/sports-lib';
import { FirestoreEventJSON, OriginalFileMetaData } from '../shared/app-event.interface';
import { createParsingOptions } from '../shared/parsing-options';
import { FirestoreAdapter, LogAdapter, EventWriter } from '../shared/event-writer';
import { ProcessingMetaData } from '../shared/processing-metadata.interface';
import { SPORTS_LIB_REPARSE_TARGET_VERSION } from './sports-lib-reparse.config';

export const SPORTS_LIB_REPARSE_CHECKPOINT_PATH = 'systemJobs/sportsLibReparse';
export const SPORTS_LIB_REPARSE_JOBS_COLLECTION = 'sportsLibReparseJobs';
export const SPORTS_LIB_REPARSE_STATUS_DOC_ID = 'reparseStatus';
export const SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES = 'NO_ORIGINAL_FILES';
export const SPORTS_LIB_PRIMARY_BUCKET = 'quantified-self-io';
export const SPORTS_LIB_LEGACY_APPSPOT_BUCKET = 'quantified-self-io.appspot.com';
export {
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    SPORTS_LIB_REPARSE_TARGET_VERSION,
} from './sports-lib-reparse.config';

export type SportsLibReparseJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface SportsLibReparseCheckpoint {
    cursorEventPath?: string | null;
    overrideCursorByUid?: Record<string, string | null>;
    lastScanAt?: unknown;
    lastPassStartedAt?: unknown;
    lastPassCompletedAt?: unknown;
    lastScanCount?: number;
    lastEnqueuedCount?: number;
    targetSportsLibVersion?: string;
}

export interface SportsLibReparseJob {
    uid: string;
    eventId: string;
    eventPath: string;
    targetSportsLibVersion: string;
    status: SportsLibReparseJobStatus;
    attemptCount: number;
    lastError?: string;
    createdAt: unknown;
    updatedAt: unknown;
    enqueuedAt?: unknown;
    processedAt?: unknown;
    expireAt?: unknown;
}

export interface ReparseStatusWrite {
    status: 'skipped' | 'completed' | 'failed';
    reason?: string;
    targetSportsLibVersion: string;
    checkedAt: unknown;
    processedAt?: unknown;
    lastError?: string;
}

export interface SourceFileMeta {
    path: string;
    bucket?: string;
    startDate?: Date;
    originalFilename?: string;
}

export interface ParseFromSourceResult {
    finalEvent: EventInterface;
    parsedEvents: EventInterface[];
    sourceFilesCount: number;
    resolvedSourceBuckets: ResolvedSourceBucketInfo[];
}

interface ResolvedSourceBucketInfo {
    path: string;
    metadataBucket?: string;
    resolvedBucket: string;
    usedFallbackBucket: boolean;
}

interface DownloadSourceResult {
    rawBytes: Buffer;
    resolvedBucket: string;
    usedFallbackBucket: boolean;
}

export interface ReparseExecutionResult {
    status: 'completed' | 'skipped';
    reason?: string;
    sourceFilesCount: number;
    parsedActivitiesCount: number;
    staleActivitiesDeleted: number;
}

function toDateOrUndefined(value: unknown): Date | undefined {
    if (!value) {
        return undefined;
    }
    if (value instanceof Date) {
        return value;
    }
    if (typeof (value as any).toDate === 'function') {
        return (value as any).toDate();
    }
    if (typeof (value as any).toMillis === 'function') {
        return new Date((value as any).toMillis());
    }
    if (typeof value === 'object' && value !== null && 'seconds' in (value as any)) {
        const seconds = Number((value as any).seconds);
        const nanos = Number((value as any).nanoseconds || 0);
        return new Date((seconds * 1000) + Math.floor(nanos / 1000000));
    }
    if (typeof value === 'number' || typeof value === 'string') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
}

function normalizeExtension(path: string): string {
    const lower = path.toLowerCase();
    const withoutGz = lower.endsWith('.gz') ? lower.slice(0, -3) : lower;
    const parts = withoutGz.split('.');
    return parts.pop() || '';
}

function isGzip(path: string): boolean {
    return path.toLowerCase().endsWith('.gz');
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function decodeText(buffer: Buffer): string {
    return new TextDecoder().decode(bufferToArrayBuffer(buffer));
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
    pushBucketCandidate(candidates, SPORTS_LIB_PRIMARY_BUCKET);
    pushBucketCandidate(candidates, SPORTS_LIB_LEGACY_APPSPOT_BUCKET);

    try {
        const defaultBucketName = admin.storage().bucket().name;
        pushBucketCandidate(candidates, defaultBucketName);
    } catch (_error) {
        // Ignore and continue with explicit metadata bucket candidates.
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

async function downloadSourceBytesWithBucketFallback(sourceFile: SourceFileMeta): Promise<DownloadSourceResult> {
    const bucketCandidates = resolveBucketCandidates(sourceFile.bucket);

    let lastNotFoundReason = '';

    for (const bucketName of bucketCandidates) {
        try {
            const [rawBytes] = await admin.storage().bucket(bucketName).file(sourceFile.path).download();
            if (sourceFile.bucket && bucketName !== sourceFile.bucket) {
                logger.warn('[sports-lib-reparse] Source file loaded from fallback bucket', {
                    path: sourceFile.path,
                    metadataBucket: sourceFile.bucket,
                    resolvedBucket: bucketName,
                });
            }
            return {
                rawBytes,
                resolvedBucket: bucketName,
                usedFallbackBucket: !!sourceFile.bucket && sourceFile.bucket !== bucketName,
            };
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

function ensureEventPath(path: string): { uid: string; eventId: string } | null {
    const parts = path.split('/');
    if (parts.length !== 4) {
        return null;
    }
    if (parts[0] !== 'users' || parts[2] !== 'events') {
        return null;
    }
    return { uid: parts[1], eventId: parts[3] };
}

export function parseUidAndEventIdFromEventPath(path: string): { uid: string; eventId: string } | null {
    return ensureEventPath(path);
}

export function resolveTargetSportsLibVersion(): string {
    return SPORTS_LIB_REPARSE_TARGET_VERSION;
}

export function parseUIDAllowlist(input?: string | null): Set<string> | null {
    if (!input) {
        return null;
    }
    const values = input
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    return values.length > 0 ? new Set(values) : null;
}

function isGracePeriodActive(gracePeriodUntil?: number): boolean {
    return !!gracePeriodUntil && gracePeriodUntil > Date.now();
}

function isPaidRole(role?: string): boolean {
    return role === 'basic' || role === 'pro';
}

export async function hasPaidOrGraceAccess(uid: string): Promise<boolean> {
    try {
        const userRecord = await admin.auth().getUser(uid);
        const role = userRecord.customClaims?.['stripeRole'] as string | undefined;
        const gracePeriodUntil = userRecord.customClaims?.['gracePeriodUntil'] as number | undefined;
        if (isPaidRole(role) || isGracePeriodActive(gracePeriodUntil)) {
            return true;
        }
    } catch (error: any) {
        if (error?.code !== 'auth/user-not-found') {
            logger.warn(`[sports-lib-reparse] Claims access check failed for ${uid}`, error);
        }
    }

    const activeSubscriptionSnapshot = await admin.firestore()
        .collection(`customers/${uid}/subscriptions`)
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc')
        .limit(1)
        .get();

    if (!activeSubscriptionSnapshot.empty) {
        const role = activeSubscriptionSnapshot.docs[0].data()?.role as string | undefined;
        if (isPaidRole(role)) {
            return true;
        }
    }

    const systemDoc = await admin.firestore().doc(`users/${uid}/system/status`).get();
    const gracePeriodUntil = systemDoc.data()?.gracePeriodUntil as { toMillis?: () => number } | undefined;
    if (gracePeriodUntil && typeof gracePeriodUntil.toMillis === 'function' && gracePeriodUntil.toMillis() > Date.now()) {
        return true;
    }

    return false;
}

export function extractSourceFiles(eventDoc: FirestoreEventJSON | Record<string, unknown>): SourceFileMeta[] {
    const eventAny = eventDoc as any;
    const files: OriginalFileMetaData[] = Array.isArray(eventAny.originalFiles) && eventAny.originalFiles.length > 0
        ? eventAny.originalFiles
        : eventAny.originalFile
            ? [eventAny.originalFile]
            : [];

    return files
        .filter(file => !!file?.path)
        .map(file => ({
            path: file.path,
            bucket: file.bucket,
            startDate: toDateOrUndefined(file.startDate),
            originalFilename: file.originalFilename,
        }));
}

export async function parseFromOriginalFilesStrict(sourceFiles: SourceFileMeta[]): Promise<ParseFromSourceResult> {
    const parsedEvents: EventInterface[] = [];
    const failedFiles: { path: string; reason: string }[] = [];
    const resolvedSourceBuckets: ResolvedSourceBucketInfo[] = [];

    for (const sourceFile of sourceFiles) {
        try {
            const downloadResult = await downloadSourceBytesWithBucketFallback(sourceFile);
            if (downloadResult.resolvedBucket) {
                resolvedSourceBuckets.push({
                    path: sourceFile.path,
                    metadataBucket: sourceFile.bucket,
                    resolvedBucket: downloadResult.resolvedBucket,
                    usedFallbackBucket: downloadResult.usedFallbackBucket,
                });
            }
            const rawBytes = downloadResult.rawBytes;
            const fileBytes = isGzip(sourceFile.path) ? gunzipSync(rawBytes) : rawBytes;
            const extension = normalizeExtension(sourceFile.path);
            const options = createParsingOptions();

            let parsedEvent: EventInterface;
            if (extension === 'fit') {
                parsedEvent = await EventImporterFIT.getFromArrayBuffer(bufferToArrayBuffer(fileBytes), options);
            } else if (extension === 'gpx') {
                parsedEvent = await EventImporterGPX.getFromString(decodeText(fileBytes), xmldom.DOMParser, options);
            } else if (extension === 'tcx') {
                const xml = new xmldom.DOMParser().parseFromString(decodeText(fileBytes), 'application/xml');
                parsedEvent = await EventImporterTCX.getFromXML(xml, options);
            } else if (extension === 'json') {
                parsedEvent = await EventImporterSuuntoJSON.getFromJSONString(decodeText(fileBytes));
            } else if (extension === 'sml') {
                parsedEvent = await EventImporterSuuntoSML.getFromXML(decodeText(fileBytes));
            } else {
                throw new Error(`Unsupported original file extension: ${extension}`);
            }

            parsedEvents.push(parsedEvent);
        } catch (error) {
            failedFiles.push({
                path: sourceFile.path,
                reason: (error as Error)?.message || 'Could not parse source file',
            });
        }
    }

    if (failedFiles.length > 0) {
        const details = failedFiles.map(file => `${file.path}: ${file.reason}`).join('; ');
        throw new Error(`Strict original-file reparse failed. ${details}`);
    }

    if (parsedEvents.length === 0) {
        throw new Error('No source files produced a parsed event.');
    }

    const finalEvent = parsedEvents.length > 1 ? EventUtilities.mergeEvents(parsedEvents) : parsedEvents[0];
    return {
        finalEvent,
        parsedEvents,
        sourceFilesCount: sourceFiles.length,
        resolvedSourceBuckets,
    };
}

export function applyAutoHealedSourceBucketMetadata(
    existingEventDoc: FirestoreEventJSON | Record<string, unknown>,
    resolvedSourceBuckets: ResolvedSourceBucketInfo[],
): { eventData: FirestoreEventJSON | Record<string, unknown>; healedEntries: number } {
    const pathToResolvedBucket = new Map<string, string>();
    for (const resolved of resolvedSourceBuckets) {
        if (!resolved.path || !resolved.resolvedBucket) {
            continue;
        }
        if (
            resolved.usedFallbackBucket
            || !resolved.metadataBucket
            || resolved.metadataBucket !== resolved.resolvedBucket
        ) {
            pathToResolvedBucket.set(resolved.path, resolved.resolvedBucket);
        }
    }

    if (pathToResolvedBucket.size === 0) {
        return { eventData: existingEventDoc, healedEntries: 0 };
    }

    const eventAny = existingEventDoc as Record<string, unknown>;
    const nextEvent: Record<string, unknown> = { ...eventAny };
    let healedEntries = 0;

    const originalFile = eventAny['originalFile'] as Record<string, unknown> | undefined;
    if (originalFile && typeof originalFile['path'] === 'string') {
        const resolvedBucket = pathToResolvedBucket.get(originalFile['path'] as string);
        if (resolvedBucket && originalFile['bucket'] !== resolvedBucket) {
            nextEvent['originalFile'] = {
                ...originalFile,
                bucket: resolvedBucket,
            };
            healedEntries++;
        }
    }

    const originalFiles = Array.isArray(eventAny['originalFiles']) ? eventAny['originalFiles'] as Record<string, unknown>[] : null;
    if (originalFiles) {
        let changed = false;
        const rewrittenOriginalFiles = originalFiles.map((sourceFile) => {
            if (!sourceFile || typeof sourceFile !== 'object') {
                return sourceFile;
            }
            const sourcePath = typeof sourceFile['path'] === 'string' ? sourceFile['path'] as string : '';
            const resolvedBucket = sourcePath ? pathToResolvedBucket.get(sourcePath) : undefined;
            if (!resolvedBucket || sourceFile['bucket'] === resolvedBucket) {
                return sourceFile;
            }
            changed = true;
            healedEntries++;
            return {
                ...sourceFile,
                bucket: resolvedBucket,
            };
        });
        if (changed) {
            nextEvent['originalFiles'] = rewrittenOriginalFiles;
        }
    }

    return {
        eventData: nextEvent as FirestoreEventJSON | Record<string, unknown>,
        healedEntries,
    };
}

export function applyPreservedFields(parsedEvent: EventInterface, existingEventDoc: FirestoreEventJSON | Record<string, unknown>): void {
    const parsedAny = parsedEvent as any;
    const existingAny = existingEventDoc as any;

    if (Object.prototype.hasOwnProperty.call(existingAny, 'description')) {
        parsedAny.description = existingAny.description;
    }
    if (Object.prototype.hasOwnProperty.call(existingAny, 'privacy')) {
        parsedAny.privacy = existingAny.privacy;
    }
    if (Object.prototype.hasOwnProperty.call(existingAny, 'notes')) {
        parsedAny.notes = existingAny.notes;
    }
}

export function mapActivityIdentity(
    parsedEvent: EventInterface,
    existingActivityDocs: Array<Pick<admin.firestore.QueryDocumentSnapshot, 'id' | 'data'>>,
): void {
    const activities = parsedEvent.getActivities();
    activities.forEach((activity, index) => {
        const existing = existingActivityDocs[index];
        if (!existing) {
            return;
        }
        activity.setID(existing.id);

        const existingCreatorName = `${existing.data()?.creator?.name ?? ''}`.trim();
        if (!existingCreatorName) {
            return;
        }

        if ((activity as any).creator) {
            (activity as any).creator.name = existingCreatorName;
        }
    });
}

function getWriterLogAdapter(): LogAdapter {
    return {
        info: (message: string, ...args: unknown[]) => logger.info('[sports-lib-reparse]', message, ...args),
        warn: (message: string, ...args: unknown[]) => logger.warn('[sports-lib-reparse]', message, ...args),
        error: (message: string | Error, ...args: unknown[]) => logger.error('[sports-lib-reparse]', message, ...args),
    };
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

async function deleteStaleActivities(
    uid: string,
    existingActivityDocs: Array<Pick<admin.firestore.QueryDocumentSnapshot, 'id'>>,
    newActivityIDs: Set<string>,
): Promise<number> {
    const staleActivityIDs = existingActivityDocs
        .map(doc => doc.id)
        .filter(activityID => !newActivityIDs.has(activityID));

    if (staleActivityIDs.length === 0) {
        return 0;
    }

    const db = admin.firestore();
    const BATCH_LIMIT = 400;
    let deleted = 0;

    for (let i = 0; i < staleActivityIDs.length; i += BATCH_LIMIT) {
        const chunk = staleActivityIDs.slice(i, i + BATCH_LIMIT);
        const batch = db.batch();
        chunk.forEach(activityID => {
            batch.delete(db.doc(`users/${uid}/activities/${activityID}`));
        });
        await batch.commit();
        deleted += chunk.length;
    }

    return deleted;
}

export async function persistReparsedEvent(
    uid: string,
    eventId: string,
    parsedEvent: EventInterface,
    existingEventDoc: FirestoreEventJSON | Record<string, unknown>,
    existingActivityDocs: Array<Pick<admin.firestore.QueryDocumentSnapshot, 'id' | 'data'>>,
    targetSportsLibVersion: string,
): Promise<{ staleActivitiesDeleted: number }> {
    parsedEvent.setID(eventId);
    const parsedEventAny = parsedEvent as any;
    const existingEventAny = existingEventDoc as any;

    if (existingEventAny.originalFiles) {
        parsedEventAny.originalFiles = existingEventAny.originalFiles;
    }
    if (existingEventAny.originalFile) {
        parsedEventAny.originalFile = existingEventAny.originalFile;
    }

    const writer = new EventWriter(getFirestoreAdapter(), undefined, undefined, getWriterLogAdapter());
    await writer.writeAllEventData(uid, parsedEvent as any);

    const newActivityIDs = new Set<string>();
    parsedEvent.getActivities().forEach(activity => {
        if (activity.getID()) {
            newActivityIDs.add(activity.getID() as string);
        }
    });

    const staleActivitiesDeleted = await deleteStaleActivities(uid, existingActivityDocs, newActivityIDs);

    const processingMetaData: ProcessingMetaData = {
        sportsLibVersion: targetSportsLibVersion,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await admin.firestore().doc(`users/${uid}/events/${eventId}/metaData/processing`).set(processingMetaData, { merge: true });

    return { staleActivitiesDeleted };
}

export async function shouldEventBeReparsed(
    eventRef: admin.firestore.DocumentReference,
    targetSportsLibVersion: string,
): Promise<boolean> {
    const validatedTargetVersion = semver.valid(targetSportsLibVersion);
    if (!validatedTargetVersion) {
        throw new Error(`[sports-lib-reparse] Invalid target sports-lib version "${targetSportsLibVersion}"`);
    }

    const processingDoc = await eventRef.collection('metaData').doc('processing').get();
    if (!processingDoc.exists) {
        return true;
    }

    const rawVersion = processingDoc.data()?.sportsLibVersion;
    if (!rawVersion) {
        return true;
    }

    const storedVersion = semver.valid(`${rawVersion}`);
    if (!storedVersion) {
        throw new Error(
            `[sports-lib-reparse] Invalid stored sports-lib version "${rawVersion}" at ${eventRef.path}. ` +
            `Target version: ${validatedTargetVersion}`,
        );
    }

    return semver.lt(storedVersion, validatedTargetVersion);
}

export async function writeReparseStatus(
    uid: string,
    eventId: string,
    payload: ReparseStatusWrite,
): Promise<void> {
    const statusRef = admin.firestore().doc(`users/${uid}/events/${eventId}/metaData/${SPORTS_LIB_REPARSE_STATUS_DOC_ID}`);
    await statusRef.set(payload, { merge: true });
}

export function buildSportsLibReparseJobId(uid: string, eventId: string, targetSportsLibVersion: string): string {
    return createHash('sha256').update(`${uid}:${eventId}:${targetSportsLibVersion}`).digest('hex');
}

export async function getEventAndActivitiesForReparse(uid: string, eventId: string): Promise<{
    eventRef: admin.firestore.DocumentReference;
    eventData: FirestoreEventJSON | Record<string, unknown>;
    activityDocs: admin.firestore.QueryDocumentSnapshot[];
}> {
    const eventRef = admin.firestore().doc(`users/${uid}/events/${eventId}`);
    const eventDoc = await eventRef.get();
    if (!eventDoc.exists) {
        throw new Error(`Event ${eventId} was not found for user ${uid}`);
    }

    const activitiesSnapshot = await admin.firestore()
        .collection(`users/${uid}/activities`)
        .where('eventID', '==', eventId)
        .get();
    // Keep deterministic identity mapping without relying on a composite index.
    // We intentionally include docs missing startDate (legacy/malformed records),
    // then place them after dated docs for stable index-based ID preservation.
    const sortedActivityDocs = [...activitiesSnapshot.docs].sort((a, b) => {
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

    return {
        eventRef,
        eventData: eventDoc.data() as FirestoreEventJSON,
        activityDocs: sortedActivityDocs,
    };
}

export async function reparseEventFromOriginalFiles(
    uid: string,
    eventId: string,
    options?: {
        targetSportsLibVersion?: string;
        eventData?: FirestoreEventJSON | Record<string, unknown>;
        activityDocs?: admin.firestore.QueryDocumentSnapshot[];
    },
): Promise<ReparseExecutionResult> {
    const targetSportsLibVersion = options?.targetSportsLibVersion || resolveTargetSportsLibVersion();
    const eventAndActivities = options?.eventData && options?.activityDocs
        ? {
            eventData: options.eventData,
            activityDocs: options.activityDocs,
        }
        : await getEventAndActivitiesForReparse(uid, eventId);

    const sourceFiles = extractSourceFiles(eventAndActivities.eventData);
    if (sourceFiles.length === 0) {
        return {
            status: 'skipped',
            reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
            sourceFilesCount: 0,
            parsedActivitiesCount: 0,
            staleActivitiesDeleted: 0,
        };
    }

    const parseResult = await parseFromOriginalFilesStrict(sourceFiles);
    const autoHealResult = applyAutoHealedSourceBucketMetadata(
        eventAndActivities.eventData,
        parseResult.resolvedSourceBuckets,
    );
    if (autoHealResult.healedEntries > 0) {
        logger.warn('[sports-lib-reparse] Auto-healed original-file bucket metadata', {
            uid,
            eventId,
            healedEntries: autoHealResult.healedEntries,
        });
    }
    const reparsedEvent = parseResult.finalEvent;
    reparsedEvent.setID(eventId);
    applyPreservedFields(reparsedEvent, autoHealResult.eventData);
    mapActivityIdentity(reparsedEvent, eventAndActivities.activityDocs);
    EventUtilities.reGenerateStatsForEvent(reparsedEvent);

    const persistResult = await persistReparsedEvent(
        uid,
        eventId,
        reparsedEvent,
        autoHealResult.eventData,
        eventAndActivities.activityDocs,
        targetSportsLibVersion,
    );

    return {
        status: 'completed',
        sourceFilesCount: parseResult.sourceFilesCount,
        parsedActivitiesCount: reparsedEvent.getActivities().length,
        staleActivitiesDeleted: persistResult.staleActivitiesDeleted,
    };
}
