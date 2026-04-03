import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as xmldom from 'xmldom';
import semver from 'semver';
import {
    ActivityUtilities,
    DataDistance,
    DataDuration,
    EventImporterFIT,
    EventImporterGPX,
    EventImporterSuuntoJSON,
    EventImporterSuuntoSML,
    EventImporterTCX,
    EventInterface,
    EventUtilities,
} from '@sports-alliance/sports-lib';
import { FirestoreEventJSON, OriginalFileMetaData } from '../../../shared/app-event.interface';
import { createParsingOptions } from '../../../shared/parsing-options';
import { FirestoreAdapter, LogAdapter, EventWriter } from '../shared/event-writer';
import { generateActivityIDFromSourceKey } from '../shared/id-generator';
import { ProcessingMetaData } from '../shared/processing-metadata.interface';
import { SPORTS_LIB_REPARSE_TARGET_VERSION } from './sports-lib-reparse.config';

export const SPORTS_LIB_REPARSE_CHECKPOINT_PATH = 'systemJobs/sportsLibReparse';
export const SPORTS_LIB_REPARSE_JOBS_COLLECTION = 'sportsLibReparseJobs';
export const SPORTS_LIB_REPARSE_STATUS_DOC_ID = 'reparseStatus';
export const SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES = 'NO_ORIGINAL_FILES';
export const SPORTS_LIB_PRIMARY_BUCKET = 'quantified-self-io';
export const SPORTS_LIB_LEGACY_APPSPOT_BUCKET = 'quantified-self-io.appspot.com';
const MERGE_TYPE_VALUES = new Set(['benchmark', 'multi']);
export {
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    SPORTS_LIB_REPARSE_TARGET_VERSION,
} from './sports-lib-reparse.config';

export type SportsLibReparseJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface SportsLibReparseCheckpoint {
    cursorEventPath?: string | null;
    cursorProcessingDocPath?: string | null;
    cursorProcessingVersionCode?: number | null;
    overrideCursorByUid?: Record<string, string | null>;
    overrideProcessingCursorByUid?: Record<string, {
        docPath: string;
        sportsLibVersionCode: number;
    } | null>;
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

type MergeType = 'benchmark' | 'multi';
export type ReparseMode = 'reimport' | 'regenerate';

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

const SPORTS_LIB_VERSION_CODE_FACTOR_MINOR = 1_000;
const SPORTS_LIB_VERSION_CODE_FACTOR_MAJOR = 1_000_000;

export function sportsLibVersionToCode(version: string): number {
    const parsedVersion = semver.parse(version);
    if (!parsedVersion) {
        throw new Error(`[sports-lib-reparse] Invalid sports-lib version "${version}"`);
    }
    if (parsedVersion.major > 999 || parsedVersion.minor > 999 || parsedVersion.patch > 999) {
        throw new Error(`[sports-lib-reparse] sports-lib version "${version}" exceeds encoding bounds`);
    }

    return (parsedVersion.major * SPORTS_LIB_VERSION_CODE_FACTOR_MAJOR)
        + (parsedVersion.minor * SPORTS_LIB_VERSION_CODE_FACTOR_MINOR)
        + parsedVersion.patch;
}

export function resolveTargetSportsLibVersionCode(): number {
    return sportsLibVersionToCode(resolveTargetSportsLibVersion());
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
    const sourceContentHashes: string[] = [];

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
            const sourceContentHash = createHash('sha256').update(fileBytes).digest('hex');
            sourceContentHashes.push(sourceContentHash);
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
    const combinedSourceContentHash = createHash('sha256')
        .update(sourceContentHashes.slice().sort().join('|'))
        .digest('hex');
    stampSourceActivityKeysForActivities(finalEvent.getActivities() as ActivityIdentityLike[], combinedSourceContentHash);

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

    if (Object.prototype.hasOwnProperty.call(existingAny, 'isMerge') && typeof existingAny.isMerge === 'boolean') {
        parsedAny.isMerge = existingAny.isMerge;
    }
    if (
        Object.prototype.hasOwnProperty.call(existingAny, 'mergeType')
        && typeof existingAny.mergeType === 'string'
        && MERGE_TYPE_VALUES.has(existingAny.mergeType)
    ) {
        parsedAny.mergeType = existingAny.mergeType;
    }
    if (Object.prototype.hasOwnProperty.call(existingAny, 'description')) {
        parsedAny.description = existingAny.description;
    }
    if (Object.prototype.hasOwnProperty.call(existingAny, 'privacy')) {
        parsedAny.privacy = existingAny.privacy;
    }
    if (Object.prototype.hasOwnProperty.call(existingAny, 'notes')) {
        parsedAny.notes = existingAny.notes;
    }
    if (Object.prototype.hasOwnProperty.call(existingAny, 'rpe')) {
        parsedAny.rpe = existingAny.rpe;
    }
    if (Object.prototype.hasOwnProperty.call(existingAny, 'feeling')) {
        parsedAny.feeling = existingAny.feeling;
    }
}

type ActivityIdentityLike = {
    getID?: () => string | null | undefined;
    setID?: (id: string) => unknown;
    startDate?: unknown;
    endDate?: unknown;
    type?: unknown;
    creator?: { name?: string };
    getStat?: (statType: string) => { getValue?: () => unknown } | null;
    sourceActivityKey?: string;
};

export interface ActivityEditCarryoverResult {
    assignments: Map<number, number>;
    unmatchedParsedIndexes: number[];
    unmatchedExistingIndexes: number[];
}

function toTimestampMs(value: unknown): number | null {
    const date = toDateOrUndefined(value);
    if (!date) {
        return null;
    }
    const timestamp = date.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeIdentityType(type: unknown): string {
    return `${type || ''}`.trim().toLowerCase() || 'unknown';
}

function normalizeText(value: unknown): string {
    return `${value || ''}`.trim();
}

function getActivitySourceActivityKey(activity: ActivityIdentityLike): string | null {
    const key = normalizeText(activity.sourceActivityKey);
    return key.length > 0 ? key : null;
}

function setActivitySourceActivityKey(activity: ActivityIdentityLike, sourceActivityKey: string): void {
    const normalizedKey = normalizeText(sourceActivityKey);
    if (!normalizedKey) {
        return;
    }
    (activity as Record<string, unknown>).sourceActivityKey = normalizedKey;
}

function parseFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const asNumber = Number(value);
        return Number.isFinite(asNumber) ? asNumber : null;
    }
    return null;
}

function getStatValueFromJson(stats: Record<string, unknown>, statType: string): number | null {
    const raw = stats?.[statType];
    if (raw === null || raw === undefined) {
        return null;
    }

    const directValue = parseFiniteNumber(raw);
    if (directValue !== null) {
        return directValue;
    }

    if (typeof raw === 'object') {
        const rawAny = raw as Record<string, unknown>;
        const getValue = rawAny.getValue;
        if (typeof getValue === 'function') {
            const value = parseFiniteNumber(getValue.call(rawAny));
            if (value !== null) {
                return value;
            }
        }
        const valueField = parseFiniteNumber(rawAny.value);
        if (valueField !== null) {
            return valueField;
        }
        const privateValueField = parseFiniteNumber(rawAny._value);
        if (privateValueField !== null) {
            return privateValueField;
        }
    }
    return null;
}

function getActivityStatValue(activity: ActivityIdentityLike, statType: string): number | null {
    if (typeof activity.getStat !== 'function') {
        return null;
    }
    const stat = activity.getStat(statType);
    if (!stat || typeof stat.getValue !== 'function') {
        return null;
    }
    const value = Number(stat.getValue.call(stat));
    return Number.isFinite(value) ? value : null;
}

function getRoundedStat(activity: ActivityIdentityLike, statType: string): string {
    const value = getActivityStatValue(activity, statType);
    return value === null ? 'na' : `${Math.round(value)}`;
}

function getStrictIdentitySignature(activity: ActivityIdentityLike): string | null {
    const startMs = toTimestampMs(activity.startDate);
    if (startMs === null) {
        return null;
    }
    const endMs = toTimestampMs(activity.endDate);
    const type = normalizeIdentityType(activity.type);
    const roundedDuration = getRoundedStat(activity, DataDuration.type);
    const roundedDistance = getRoundedStat(activity, DataDistance.type);
    return [startMs, endMs ?? 'na', type, roundedDuration, roundedDistance].join('|');
}

function getTimeTypeIdentitySignature(activity: ActivityIdentityLike): string | null {
    const startMs = toTimestampMs(activity.startDate);
    if (startMs === null) {
        return null;
    }
    const endMs = toTimestampMs(activity.endDate);
    const type = normalizeIdentityType(activity.type);
    return [startMs, endMs ?? 'na', type].join('|');
}

function getStartIdentitySignature(activity: ActivityIdentityLike): string | null {
    const startMs = toTimestampMs(activity.startDate);
    if (startMs === null) {
        return null;
    }
    const type = normalizeIdentityType(activity.type);
    return [startMs, type].join('|');
}

function getSourceActivityBaseSignature(activity: ActivityIdentityLike): string {
    const startMs = toTimestampMs(activity.startDate);
    const endMs = toTimestampMs(activity.endDate);
    const type = normalizeIdentityType(activity.type);
    const roundedDuration = getRoundedStat(activity, DataDuration.type);
    const roundedDistance = getRoundedStat(activity, DataDistance.type);
    return [startMs ?? 'na', endMs ?? 'na', type, roundedDuration, roundedDistance].join('|');
}

function getSourceKeySortToken(activity: ActivityIdentityLike, index: number): string {
    const creatorName = normalizeText(activity.creator?.name).toLowerCase() || 'na';
    const timeTypeSignature = getTimeTypeIdentitySignature(activity) || 'na';
    return [timeTypeSignature, creatorName, index].join('|');
}

function buildSourceActivityKey(sourceContentHash: string, baseSignature: string, occurrence: number): string {
    const normalizedHash = normalizeText(sourceContentHash).toLowerCase();
    const normalizedBaseSignature = normalizeText(baseSignature);
    const normalizedOccurrence = Number.isFinite(occurrence) && occurrence >= 0
        ? Math.floor(occurrence)
        : 0;
    return `${normalizedHash}:${normalizedBaseSignature}:${normalizedOccurrence}`;
}

function isShaDerivedSourceActivityKey(sourceActivityKey: string): boolean {
    return /^[a-f0-9]{64}:/.test(normalizeText(sourceActivityKey).toLowerCase());
}

function stampSourceActivityKeysForActivities(activities: ActivityIdentityLike[], sourceContentHash: string): void {
    const normalizedHash = normalizeText(sourceContentHash).toLowerCase();
    if (!normalizedHash || !Array.isArray(activities) || activities.length === 0) {
        return;
    }

    const sortedEntries = activities
        .map((activity, index) => ({
            activity,
            index,
            baseSignature: getSourceActivityBaseSignature(activity),
            sortToken: getSourceKeySortToken(activity, index),
        }))
        .sort((a, b) => {
            const signatureCompare = a.baseSignature.localeCompare(b.baseSignature);
            if (signatureCompare !== 0) {
                return signatureCompare;
            }
            const tokenCompare = a.sortToken.localeCompare(b.sortToken);
            if (tokenCompare !== 0) {
                return tokenCompare;
            }
            return a.index - b.index;
        });

    const occurrenceBySignature = new Map<string, number>();
    sortedEntries.forEach(({ activity, baseSignature }) => {
        const occurrence = occurrenceBySignature.get(baseSignature) || 0;
        occurrenceBySignature.set(baseSignature, occurrence + 1);
        setActivitySourceActivityKey(
            activity,
            buildSourceActivityKey(normalizedHash, baseSignature, occurrence),
        );
    });
}

function assignUniqueMatchesBySignature(
    existingActivities: ActivityIdentityLike[],
    parsedActivities: ActivityIdentityLike[],
    assignments: Map<number, number>,
    usedExistingIndexes: Set<number>,
    signatureResolver: (activity: ActivityIdentityLike) => string | null,
): void {
    const existingBySignature = new Map<string, number[]>();
    existingActivities.forEach((activity, index) => {
        if (usedExistingIndexes.has(index)) {
            return;
        }
        const signature = signatureResolver(activity);
        if (!signature) {
            return;
        }
        const existingIndexes = existingBySignature.get(signature) || [];
        existingIndexes.push(index);
        existingBySignature.set(signature, existingIndexes);
    });

    const parsedBySignature = new Map<string, number[]>();
    parsedActivities.forEach((activity, index) => {
        if (assignments.has(index)) {
            return;
        }
        const signature = signatureResolver(activity);
        if (!signature) {
            return;
        }
        const parsedIndexes = parsedBySignature.get(signature) || [];
        parsedIndexes.push(index);
        parsedBySignature.set(signature, parsedIndexes);
    });

    parsedBySignature.forEach((parsedIndexes, signature) => {
        const existingIndexes = existingBySignature.get(signature) || [];
        if (parsedIndexes.length !== 1 || existingIndexes.length !== 1) {
            return;
        }
        const parsedIndex = parsedIndexes[0];
        const existingIndex = existingIndexes[0];
        assignments.set(parsedIndex, existingIndex);
        usedExistingIndexes.add(existingIndex);
    });
}

function resolveActivityEditAssignments(
    existingActivities: ActivityIdentityLike[],
    parsedActivities: ActivityIdentityLike[],
): ActivityEditCarryoverResult {
    const assignments = new Map<number, number>();
    const usedExistingIndexes = new Set<number>();

    assignUniqueMatchesBySignature(
        existingActivities,
        parsedActivities,
        assignments,
        usedExistingIndexes,
        getActivitySourceActivityKey,
    );
    assignUniqueMatchesBySignature(
        existingActivities,
        parsedActivities,
        assignments,
        usedExistingIndexes,
        getStrictIdentitySignature,
    );
    assignUniqueMatchesBySignature(
        existingActivities,
        parsedActivities,
        assignments,
        usedExistingIndexes,
        getTimeTypeIdentitySignature,
    );
    assignUniqueMatchesBySignature(
        existingActivities,
        parsedActivities,
        assignments,
        usedExistingIndexes,
        getStartIdentitySignature,
    );

    const unmatchedParsedIndexes = parsedActivities
        .map((_activity, index) => index)
        .filter(index => !assignments.has(index));
    const unmatchedExistingIndexes = existingActivities
        .map((_activity, index) => index)
        .filter(index => !usedExistingIndexes.has(index));

    if (unmatchedParsedIndexes.length === 1 && unmatchedExistingIndexes.length === 1) {
        assignments.set(unmatchedParsedIndexes[0], unmatchedExistingIndexes[0]);
        return {
            assignments,
            unmatchedParsedIndexes: [],
            unmatchedExistingIndexes: [],
        };
    }

    return {
        assignments,
        unmatchedParsedIndexes,
        unmatchedExistingIndexes,
    };
}

function toComparableExistingActivity(existingDoc: Pick<admin.firestore.QueryDocumentSnapshot, 'id' | 'data'>): ActivityIdentityLike {
    const raw = existingDoc.data() as Record<string, unknown> || {};
    const stats = raw.stats && typeof raw.stats === 'object'
        ? raw.stats as Record<string, unknown>
        : {};
    return {
        startDate: raw.startDate,
        endDate: raw.endDate,
        type: raw.type,
        creator: raw.creator as { name?: string } | undefined,
        sourceActivityKey: normalizeText(raw.sourceActivityKey) || undefined,
        getStat: (statType: string) => {
            const value = getStatValueFromJson(stats, statType);
            if (value === null) {
                return null;
            }
            return {
                getValue: () => value,
            };
        },
    };
}

function describeActivityIdentity(activity: ActivityIdentityLike, index: number): {
    index: number;
    sourceActivityKey: string | null;
    startMs: number | null;
    type: string;
} {
    return {
        index,
        sourceActivityKey: getActivitySourceActivityKey(activity),
        startMs: toTimestampMs(activity.startDate),
        type: normalizeIdentityType(activity.type),
    };
}

export function resolveActivityEditCarryover(
    parsedEvent: EventInterface,
    existingActivityDocs: Array<Pick<admin.firestore.QueryDocumentSnapshot, 'id' | 'data'>>,
): ActivityEditCarryoverResult {
    const activities = parsedEvent.getActivities();
    const existingComparableActivities = existingActivityDocs.map(toComparableExistingActivity);
    const assignmentResult = resolveActivityEditAssignments(existingComparableActivities, activities as ActivityIdentityLike[]);

    assignmentResult.assignments.forEach((existingIndex, parsedIndex) => {
        const activity = activities[parsedIndex] as ActivityIdentityLike | undefined;
        const existingActivity = existingComparableActivities[existingIndex];
        if (!activity || !existingActivity) {
            return;
        }

        const existingSourceActivityKey = getActivitySourceActivityKey(existingActivity);
        if (!getActivitySourceActivityKey(activity) && existingSourceActivityKey) {
            setActivitySourceActivityKey(activity, existingSourceActivityKey);
        }

        const existingCreatorName = `${existingActivity.creator?.name ?? ''}`.trim();
        if (!existingCreatorName) {
            return;
        }

        if (activity.creator) {
            activity.creator.name = existingCreatorName;
        }
    });

    return assignmentResult;
}

export async function assignReimportActivityIds(parsedEvent: EventInterface, eventID: string): Promise<void> {
    const activities = parsedEvent.getActivities();
    for (let index = 0; index < activities.length; index++) {
        const activity = activities[index] as ActivityIdentityLike;
        const sourceActivityKey = getActivitySourceActivityKey(activity);
        if (!sourceActivityKey || !isShaDerivedSourceActivityKey(sourceActivityKey)) {
            throw new Error(
                `[sports-lib-reparse] Missing or invalid SHA-derived sourceActivityKey for parsed activity at index ${index}`,
            );
        }
        setActivitySourceActivityKey(activity, sourceActivityKey);
        if (typeof activity.setID === 'function') {
            activity.setID(await generateActivityIDFromSourceKey(eventID, sourceActivityKey));
        }
    }
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

function extractPreservedMergeMetadata(existingEventDoc: FirestoreEventJSON | Record<string, unknown>): {
    isMerge?: boolean;
    mergeType?: MergeType;
} {
    const existingAny = existingEventDoc as Record<string, unknown>;
    const preserved: { isMerge?: boolean; mergeType?: MergeType } = {};

    if (Object.prototype.hasOwnProperty.call(existingAny, 'isMerge') && typeof existingAny.isMerge === 'boolean') {
        preserved.isMerge = existingAny.isMerge;
    }
    if (
        Object.prototype.hasOwnProperty.call(existingAny, 'mergeType')
        && typeof existingAny.mergeType === 'string'
        && MERGE_TYPE_VALUES.has(existingAny.mergeType)
    ) {
        preserved.mergeType = existingAny.mergeType as MergeType;
    }

    return preserved;
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

    const mergeMetadata = extractPreservedMergeMetadata(existingEventDoc);
    if (Object.keys(mergeMetadata).length > 0) {
        await admin.firestore().doc(`users/${uid}/events/${eventId}`).set(mergeMetadata, { merge: true });
    }

    const newActivityIDs = new Set<string>();
    parsedEvent.getActivities().forEach(activity => {
        if (activity.getID()) {
            newActivityIDs.add(activity.getID() as string);
        }
    });

    const staleActivitiesDeleted = await deleteStaleActivities(uid, existingActivityDocs, newActivityIDs);

    const processingMetaData: ProcessingMetaData = {
        sportsLibVersion: targetSportsLibVersion,
        sportsLibVersionCode: sportsLibVersionToCode(targetSportsLibVersion),
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
    // Keep deterministic ordering for diagnostics/tie-breaking without relying on a composite index.
    // We intentionally include docs missing startDate (legacy/malformed records),
    // then place them after dated docs.
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
        mode?: ReparseMode;
        targetSportsLibVersion?: string;
        eventData?: FirestoreEventJSON | Record<string, unknown>;
        activityDocs?: admin.firestore.QueryDocumentSnapshot[];
    },
): Promise<ReparseExecutionResult> {
    const mode = options?.mode || 'reimport';
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
    const activityEditCarryoverResult = resolveActivityEditCarryover(reparsedEvent, eventAndActivities.activityDocs);
    if (
        activityEditCarryoverResult.unmatchedParsedIndexes.length > 0
        || activityEditCarryoverResult.unmatchedExistingIndexes.length > 0
    ) {
        const parsedActivities = reparsedEvent.getActivities();
        const existingComparableActivities = eventAndActivities.activityDocs.map(toComparableExistingActivity);
        logger.warn('[sports-lib-reparse] Activity edit carryover skipped for unmatched identities', {
            eventID: eventId,
            parsedCount: parsedActivities.length,
            existingCount: eventAndActivities.activityDocs.length,
            assignedCount: activityEditCarryoverResult.assignments.size,
            unmatchedParsed: activityEditCarryoverResult.unmatchedParsedIndexes
                .map((index) => describeActivityIdentity(parsedActivities[index] as ActivityIdentityLike, index)),
            unmatchedExisting: activityEditCarryoverResult.unmatchedExistingIndexes
                .map((index) => describeActivityIdentity(existingComparableActivities[index], index)),
        });
    }
    await assignReimportActivityIds(reparsedEvent, eventId);
    if (mode === 'regenerate') {
        reparsedEvent.getActivities().forEach((activity) => {
            const activityAny = activity as any;
            if (
                typeof activityAny.getStats !== 'function'
                || typeof activityAny.clearStats !== 'function'
                || typeof activityAny.addStat !== 'function'
                || typeof activityAny.getStat !== 'function'
            ) {
                return;
            }

            const previousStats = new Map(activityAny.getStats());
            activityAny.clearStats();
            ActivityUtilities.generateMissingStreamsAndStatsForActivity(activity as any);
            previousStats.forEach((stat, type) => {
                if (!activityAny.getStat(type)) {
                    activityAny.addStat(stat);
                }
            });
        });
    }
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
