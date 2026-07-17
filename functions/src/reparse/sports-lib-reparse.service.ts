import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import semver from 'semver';
import {
    ActivityUtilities,
    DataDistance,
    DataDuration,
    EventInterface,
    EventUtilities,
} from '@sports-alliance/sports-lib';
import { FirestoreEventJSON, OriginalFileMetaData } from '../../../shared/app-event.interface';
import { FirestoreAdapter, LogAdapter, EventWriter } from '../shared/event-writer';
import { generateActivityIDFromSourceKey } from '../shared/id-generator';
import { EVENT_PROCESSING_ENTITY, ProcessingMetaData } from '../shared/processing-metadata.interface';
import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';
import {
    SPORTS_LIB_REPARSE_HEAVY_DURATION_THRESHOLD_MS,
    SPORTS_LIB_REPARSE_HEAVY_REASONS,
    SPORTS_LIB_REPARSE_PROCESSING_TIERS,
    SPORTS_LIB_REPARSE_TARGET_VERSION,
    SportsLibReparseHeavyReason,
    SportsLibReparseProcessingTier,
} from './sports-lib-reparse.config';
import {
    MAX_ACTIVITY_UPLOAD_BYTES,
    MAX_ACTIVITY_UPLOAD_BYTES_LABEL,
    MAX_ACTIVITY_DECOMPRESSED_BYTES,
    MAX_ACTIVITY_DECOMPRESSED_BYTES_LABEL,
} from '../shared/activity-processing-config';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { parseActivityFilePayload } from '../shared/activity-file-parser';
import { getEventTags, preserveEventTagsOnRewrite } from '../../../shared/event-tags';

export const SPORTS_LIB_REPARSE_CHECKPOINT_PATH = 'systemJobs/sportsLibReparse';
export const SPORTS_LIB_REPARSE_JOBS_COLLECTION = 'sportsLibReparseJobs';
export const SPORTS_LIB_REPARSE_STATUS_DOC_ID = 'reparseStatus';
export const SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES = 'NO_ORIGINAL_FILES';
export const SPORTS_LIB_PRIMARY_BUCKET = 'quantified-self-io';
const MERGE_TYPE_VALUES = new Set(['benchmark', 'multi']);
export {
    SPORTS_LIB_REPARSE_HEAVY_DURATION_THRESHOLD_MS,
    SPORTS_LIB_REPARSE_HEAVY_REASONS,
    SPORTS_LIB_REPARSE_PROCESSING_TIERS,
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    SPORTS_LIB_REPARSE_TARGET_VERSION,
} from './sports-lib-reparse.config';

export type SportsLibReparseJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'superseded';

export type SportsLibReparseVersionDisposition = 'match' | 'target_superseded' | 'runtime_behind';

const SPORTS_LIB_REPARSE_TERMINAL_ERROR_PATTERNS = [
    /^\[sports-lib-reparse\] Reparse target sports-lib version ".*" does not match runtime sports-lib version ".*"$/,
    /^Event .* was not found for user .*$/,
    /^Strict original-file reparse failed\. .*: No activities found in GPX; use importRoutesFromGPX for routes$/,
    /^Strict original-file reparse failed\. .*: Original file exceeds reparse size limit\./,
    /^Strict original-file reparse failed\. .*: \[sports-lib-reparse\] Reparse exceeded safe runtime budget /,
    /^\[sports-lib-reparse\] Reparse exceeded safe runtime budget /,
] as const;

export function isSportsLibReparseTerminalFailureMessage(errorMessage: string): boolean {
    return SPORTS_LIB_REPARSE_TERMINAL_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}

class ReparsePersistenceSkippedForDeletedUserError extends Error {
    readonly name = 'EventWriteSkippedForDeletedUserError';
    readonly code = 'user_deleted_or_deleting';

    constructor(
        readonly uid: string,
        readonly phase: string,
    ) {
        super(`Skipping sports-lib reparse persistence for user ${uid} during ${phase} because the user is missing or deletion is in progress.`);
    }
}

export function isReparsePersistenceSkippedForUserDeletionError(error: unknown): boolean {
    return error instanceof Error && error.name === 'EventWriteSkippedForDeletedUserError';
}

const REPARSE_TRANSACTION_MAX_ATTEMPTS = 3;
const REPARSE_TRANSACTION_RETRY_BASE_DELAY_MS = 100;

function getFirestoreErrorCode(error: unknown): unknown {
    const firestoreError = getNestedFirestoreError(error);
    return firestoreError && typeof firestoreError === 'object'
        ? (firestoreError as { code?: unknown }).code
        : undefined;
}

function getFirestoreErrorDetails(error: unknown): string | undefined {
    const firestoreError = getNestedFirestoreError(error);
    return firestoreError && typeof firestoreError === 'object'
        ? `${(firestoreError as { details?: unknown }).details || ''}`.trim() || undefined
        : undefined;
}

function isUserDeletionGuardReadError(error: unknown): boolean {
    return error instanceof Error && error.name === 'UserDeletionGuardReadError';
}

function getNestedFirestoreError(error: unknown): unknown {
    if (!isUserDeletionGuardReadError(error) || !error || typeof error !== 'object') {
        return error;
    }

    const errorRecord = error as { originalError?: unknown; cause?: unknown };
    return errorRecord.originalError ?? errorRecord.cause ?? error;
}

function getErrorSearchText(error: unknown): string {
    const nestedError = getNestedFirestoreError(error);
    return [
        toErrorMessage(error),
        nestedError === error ? undefined : toErrorMessage(nestedError),
        getFirestoreErrorDetails(nestedError),
    ]
        .filter(Boolean)
        .join(' ');
}

function isRetryableReparseTransactionError(error: unknown): boolean {
    if (isReparsePersistenceSkippedForUserDeletionError(error)) {
        return false;
    }

    const code = getFirestoreErrorCode(error);
    const normalizedCode = typeof code === 'string' ? code.toLowerCase() : code;
    if (normalizedCode === 3 || normalizedCode === '3' || normalizedCode === 'invalid_argument') {
        return /invalid transaction/i.test(getErrorSearchText(error));
    }

    return normalizedCode === 4
        || normalizedCode === '4'
        || normalizedCode === 'deadline_exceeded'
        || normalizedCode === 10
        || normalizedCode === '10'
        || normalizedCode === 'aborted'
        || normalizedCode === 14
        || normalizedCode === '14'
        || normalizedCode === 'unavailable';
}

async function waitForReparseTransactionRetry(attempt: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, REPARSE_TRANSACTION_RETRY_BASE_DELAY_MS * attempt));
}

async function runReparseFirestoreTransactionWithRetry<T>(
    uid: string,
    phase: string,
    operation: () => Promise<T>,
): Promise<T> {
    for (let attempt = 1; attempt <= REPARSE_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= REPARSE_TRANSACTION_MAX_ATTEMPTS || !isRetryableReparseTransactionError(error)) {
                throw error;
            }

            const retryDelayMs = REPARSE_TRANSACTION_RETRY_BASE_DELAY_MS * attempt;
            logger.warn('[sports-lib-reparse] Retrying Firestore transaction after retryable failure.', {
                uid,
                phase,
                attempt,
                maxAttempts: REPARSE_TRANSACTION_MAX_ATTEMPTS,
                retryDelayMs,
                code: getFirestoreErrorCode(error) ?? null,
                details: getFirestoreErrorDetails(error) ?? null,
                error: toErrorMessage(error),
            });
            await waitForReparseTransactionRetry(attempt);
        }
    }

    throw new Error('[sports-lib-reparse] Firestore transaction retry loop exited unexpectedly.');
}

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
    processingTier?: SportsLibReparseProcessingTier;
    heavyReason?: SportsLibReparseHeavyReason;
    eventDurationMs?: number;
    attemptCount: number;
    lastError?: string;
    terminalFailure?: boolean;
    terminalFailureAt?: unknown;
    supersededAt?: unknown;
    supersededBySportsLibVersion?: string;
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
    terminalFailure?: unknown;
    terminalFailureAt?: unknown;
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
    combinedSourceContentHash: string;
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

interface ReparseRuntimeBudget {
    deadlineMs?: number;
    uid?: string;
    eventId?: string;
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

export interface SportsLibReparseRoutingDecision {
    processingTier: SportsLibReparseProcessingTier;
    heavyReason?: SportsLibReparseHeavyReason;
    eventDurationMs: number | null;
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return `${error}`;
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

function isGzip(path: string): boolean {
    return path.toLowerCase().endsWith('.gz');
}

function maybeDecompressOriginalFile(path: string, rawBytes: Buffer): Buffer {
    if (rawBytes.byteLength > MAX_ACTIVITY_UPLOAD_BYTES) {
        throw new Error(
            `Original file exceeds reparse size limit. Maximum raw source size is ${MAX_ACTIVITY_UPLOAD_BYTES_LABEL}; `
            + `${path} is ${rawBytes.byteLength} bytes.`,
        );
    }

    if (!isGzip(path)) {
        return rawBytes;
    }

    try {
        return gunzipSync(rawBytes, { maxOutputLength: MAX_ACTIVITY_DECOMPRESSED_BYTES });
    } catch (error) {
        if ((error as { code?: unknown } | undefined)?.code === 'ERR_BUFFER_TOO_LARGE') {
            throw new Error(
                `Original file is too large after decompression. Maximum decompressed size is ${MAX_ACTIVITY_DECOMPRESSED_BYTES_LABEL}.`,
            );
        }
        throw error;
    }
}

export function getSportsLibReparseEventDurationMs(eventData: FirestoreEventJSON | Record<string, unknown>): number | null {
    const eventAny = eventData as { startDate?: unknown; endDate?: unknown };
    const startMs = toDateOrUndefined(eventAny.startDate)?.getTime();
    const endMs = toDateOrUndefined(eventAny.endDate)?.getTime();

    if (typeof startMs !== 'number' || typeof endMs !== 'number') {
        return null;
    }

    const durationMs = endMs - startMs;
    return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
}

export function isSportsLibReparseDurationHeavy(eventDurationMs: number | null | undefined): boolean {
    return typeof eventDurationMs === 'number'
        && Number.isFinite(eventDurationMs)
        && eventDurationMs >= SPORTS_LIB_REPARSE_HEAVY_DURATION_THRESHOLD_MS;
}

export function resolveSportsLibReparseRoutingDecision(
    eventData: FirestoreEventJSON | Record<string, unknown>,
): SportsLibReparseRoutingDecision {
    const eventDurationMs = getSportsLibReparseEventDurationMs(eventData);
    const isHeavy = isSportsLibReparseDurationHeavy(eventDurationMs);
    return {
        processingTier: isHeavy
            ? SPORTS_LIB_REPARSE_PROCESSING_TIERS.Heavy
            : SPORTS_LIB_REPARSE_PROCESSING_TIERS.Normal,
        ...(isHeavy ? { heavyReason: SPORTS_LIB_REPARSE_HEAVY_REASONS.Duration } : {}),
        eventDurationMs,
    };
}

function normalizeBucketName(bucketName?: string): string | null {
    if (!bucketName) {
        return null;
    }
    const normalized = bucketName.trim();
    return normalized.length > 0 ? normalized : null;
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

    try {
        const defaultBucketName = admin.storage().bucket().name;
        pushBucketCandidate(candidates, defaultBucketName);
    } catch (_error) {
        // Ignore and continue with explicit metadata bucket candidates.
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

export function resolveRuntimeSportsLibVersion(): string {
    return SPORTS_LIB_VERSION;
}

export function classifySportsLibReparseVersionDisposition(
    targetSportsLibVersion: string,
    runtimeSportsLibVersion: string = SPORTS_LIB_VERSION,
): SportsLibReparseVersionDisposition {
    const normalizedTargetVersion = semver.valid(targetSportsLibVersion);
    if (!normalizedTargetVersion) {
        throw new Error(`[sports-lib-reparse] Invalid target sports-lib version "${targetSportsLibVersion}"`);
    }

    const normalizedRuntimeVersion = semver.valid(runtimeSportsLibVersion);
    if (!normalizedRuntimeVersion) {
        throw new Error(`[sports-lib-reparse] Invalid runtime sports-lib version "${runtimeSportsLibVersion}"`);
    }

    if (normalizedTargetVersion === normalizedRuntimeVersion) {
        return 'match';
    }

    return semver.lt(normalizedTargetVersion, normalizedRuntimeVersion)
        ? 'target_superseded'
        : 'runtime_behind';
}

export function assertSportsLibRuntimeVersionMatchesTarget(
    targetSportsLibVersion: string,
    runtimeSportsLibVersion: string = SPORTS_LIB_VERSION,
): void {
    const normalizedTargetVersion = semver.valid(targetSportsLibVersion);
    if (!normalizedTargetVersion) {
        throw new Error(`[sports-lib-reparse] Invalid target sports-lib version "${targetSportsLibVersion}"`);
    }

    const normalizedRuntimeVersion = semver.valid(runtimeSportsLibVersion);
    if (!normalizedRuntimeVersion) {
        throw new Error(`[sports-lib-reparse] Invalid runtime sports-lib version "${runtimeSportsLibVersion}"`);
    }

    if (classifySportsLibReparseVersionDisposition(normalizedTargetVersion, normalizedRuntimeVersion) !== 'match') {
        throw new Error(
            `[sports-lib-reparse] Reparse target sports-lib version "${normalizedTargetVersion}" `
            + `does not match runtime sports-lib version "${normalizedRuntimeVersion}"`,
        );
    }
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

function assertReparseRuntimeBudget(budget: ReparseRuntimeBudget | undefined, stage: string): void {
    const deadlineMs = budget?.deadlineMs;
    if (!deadlineMs || Date.now() < deadlineMs) {
        return;
    }

    throw new Error(
        `[sports-lib-reparse] Reparse exceeded safe runtime budget before ${stage}`
        + `${budget?.uid ? ` for user ${budget.uid}` : ''}`
        + `${budget?.eventId ? ` event ${budget.eventId}` : ''}.`,
    );
}

export async function parseFromOriginalFilesStrict(
    sourceFiles: SourceFileMeta[],
    runtimeBudget?: ReparseRuntimeBudget,
): Promise<ParseFromSourceResult> {
    const parsedEvents: EventInterface[] = [];
    const failedFiles: { path: string; reason: string }[] = [];
    const resolvedSourceBuckets: ResolvedSourceBucketInfo[] = [];
    const sourceContentHashes: string[] = [];

    for (const sourceFile of sourceFiles) {
        try {
            assertReparseRuntimeBudget(runtimeBudget, `download_source_file:${sourceFile.path}`);
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
            const fileBytes = maybeDecompressOriginalFile(sourceFile.path, rawBytes);
            const sourceContentHash = createHash('sha256').update(fileBytes).digest('hex');
            sourceContentHashes.push(sourceContentHash);
            assertReparseRuntimeBudget(runtimeBudget, `parse_source_file:${sourceFile.path}`);
            const parsedEvent = await parseActivityFilePayload(fileBytes, sourceFile.path);
            assertReparseRuntimeBudget(runtimeBudget, `finish_parse_source_file:${sourceFile.path}`);

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
    stampSourceActivityKeysForActivities(finalEvent.getActivities() as ActivityIdentityLike[], combinedSourceContentHash, {
        strictAmbiguity: false,
    });

    return {
        finalEvent,
        parsedEvents,
        sourceFilesCount: sourceFiles.length,
        resolvedSourceBuckets,
        combinedSourceContentHash,
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
    if (Array.isArray(existingAny.tags) || Array.isArray(existingAny.benchmarkReviewTags)) {
        parsedAny.tags = getEventTags(existingAny);
    }
}

type ActivityIdentityLike = {
    getID?: () => string | null | undefined;
    setID?: (id: string) => unknown;
    toJSON?: () => unknown;
    startDate?: unknown;
    endDate?: unknown;
    type?: unknown;
    creator?: { name?: string };
    getStat?: (statType: string) => { getValue?: () => unknown } | null;
    sourceActivityKey?: string;
    fingerprintPayload?: unknown;
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

function buildSourceActivityKey(sourceContentHash: string, sourceActivityFingerprint: string, occurrence: number): string {
    const normalizedHash = normalizeText(sourceContentHash).toLowerCase();
    const normalizedFingerprint = normalizeText(sourceActivityFingerprint).toLowerCase();
    const normalizedOccurrence = Number.isFinite(occurrence) && occurrence >= 0
        ? Math.floor(occurrence)
        : 0;
    return `${normalizedHash}:${normalizedFingerprint}:${normalizedOccurrence}`;
}

function isShaDerivedSourceActivityKey(sourceActivityKey: string): boolean {
    return /^([a-f0-9]{64}):([a-f0-9]{64}):([0-9]+)$/.test(normalizeText(sourceActivityKey).toLowerCase());
}

function toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function resolveRawActivityFingerprintPayload(activity: ActivityIdentityLike): Record<string, unknown> | null {
    const explicitPayload = toRecord(activity.fingerprintPayload);
    if (explicitPayload) {
        return explicitPayload;
    }
    if (typeof activity.toJSON === 'function') {
        try {
            const serialized = activity.toJSON();
            return toRecord(serialized);
        } catch (_error) {
            return null;
        }
    }
    return null;
}

function getActivityFingerprintStats(
    activity: ActivityIdentityLike,
    rawPayload: Record<string, unknown> | null,
): Record<string, string> {
    const statsEntries = new Map<string, string>();
    const rawStats = rawPayload ? toRecord(rawPayload.stats) : null;
    if (rawStats) {
        Object.keys(rawStats).sort().forEach((statType) => {
            const value = getStatValueFromJson(rawStats, statType);
            if (value === null) {
                return;
            }
            statsEntries.set(statType, `${Math.round(value)}`);
        });
    }

    const roundedDuration = getRoundedStat(activity, DataDuration.type);
    if (roundedDuration !== 'na') {
        statsEntries.set(DataDuration.type, roundedDuration);
    }
    const roundedDistance = getRoundedStat(activity, DataDistance.type);
    if (roundedDistance !== 'na') {
        statsEntries.set(DataDistance.type, roundedDistance);
    }

    return Object.fromEntries([...statsEntries.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

type SourceActivityFingerprintDescriptor = {
    primary: string;
    secondary: string;
};

function getSourceActivityFingerprintDescriptor(activity: ActivityIdentityLike): SourceActivityFingerprintDescriptor {
    const rawPayload = resolveRawActivityFingerprintPayload(activity);
    const startMs = toTimestampMs(rawPayload?.startDate ?? activity.startDate);
    const endMs = toTimestampMs(rawPayload?.endDate ?? activity.endDate);
    const type = normalizeIdentityType(rawPayload?.type ?? activity.type);
    const creatorRecord = toRecord(rawPayload?.creator);
    const creatorName = normalizeText(creatorRecord?.name ?? activity.creator?.name).toLowerCase() || 'na';
    const stats = getActivityFingerprintStats(activity, rawPayload);

    const primaryPayload = {
        startMs: startMs ?? 'na',
        endMs: endMs ?? 'na',
        type,
        stats,
    };
    const secondaryPayload = {
        ...primaryPayload,
        creatorName,
    };

    return {
        primary: createHash('sha256').update(JSON.stringify(primaryPayload)).digest('hex'),
        secondary: createHash('sha256').update(JSON.stringify(secondaryPayload)).digest('hex'),
    };
}

function addUniqueMapValue(map: Map<string, string[]>, key: string, value: string): void {
    const current = map.get(key) || [];
    if (!current.includes(value)) {
        current.push(value);
        current.sort();
        map.set(key, current);
    }
}

function parseFingerprintOccurrenceFromKey(
    sourceActivityKey: string,
    sourceContentHash: string,
    sourceActivityFingerprint: string,
): number | null {
    const match = normalizeText(sourceActivityKey).toLowerCase().match(/^([a-f0-9]{64}):([a-f0-9]{64}):([0-9]+)$/);
    if (!match) {
        return null;
    }
    if (match[1] !== sourceContentHash || match[2] !== sourceActivityFingerprint) {
        return null;
    }
    const occurrence = Number(match[3]);
    return Number.isFinite(occurrence) ? occurrence : null;
}

function getNextOccurrenceForFingerprint(
    reservedKeys: Iterable<string>,
    sourceContentHash: string,
    sourceActivityFingerprint: string,
): number {
    const usedOccurrences = new Set<number>();
    for (const key of reservedKeys) {
        const occurrence = parseFingerprintOccurrenceFromKey(key, sourceContentHash, sourceActivityFingerprint);
        if (occurrence !== null) {
            usedOccurrences.add(occurrence);
        }
    }
    let candidate = 0;
    while (usedOccurrences.has(candidate)) {
        candidate++;
    }
    return candidate;
}

type SourceActivityKeyStampOptions = {
    existingActivities?: ActivityIdentityLike[];
    strictAmbiguity?: boolean;
};

function stampSourceActivityKeysForActivities(
    activities: ActivityIdentityLike[],
    sourceContentHash: string,
    options: SourceActivityKeyStampOptions = {},
): void {
    const normalizedHash = normalizeText(sourceContentHash).toLowerCase();
    if (!normalizedHash || !Array.isArray(activities) || activities.length === 0) {
        return;
    }
    const strictAmbiguity = options.strictAmbiguity ?? true;

    const parsedEntries = activities.map((activity, index) => ({
        activity,
        index,
        ...getSourceActivityFingerprintDescriptor(activity),
    }));

    const existingEntries = (options.existingActivities || []).map((activity) => ({
        activity,
        ...getSourceActivityFingerprintDescriptor(activity),
    }));
    const existingKeysByFingerprint = new Map<string, string[]>();
    const existingKeysByPrimary = new Map<string, string[]>();
    existingEntries.forEach((entry) => {
        const sourceActivityKey = getActivitySourceActivityKey(entry.activity);
        if (!sourceActivityKey || !isShaDerivedSourceActivityKey(sourceActivityKey)) {
            return;
        }
        addUniqueMapValue(existingKeysByPrimary, entry.primary, sourceActivityKey);
        addUniqueMapValue(existingKeysByFingerprint, `${entry.primary}|${entry.secondary}`, sourceActivityKey);
    });

    const parsedByPrimary = new Map<string, Array<typeof parsedEntries[number]>>();
    parsedEntries.forEach((entry) => {
        const group = parsedByPrimary.get(entry.primary) || [];
        group.push(entry);
        parsedByPrimary.set(entry.primary, group);
    });

    Array.from(parsedByPrimary.keys()).sort().forEach((primaryFingerprint) => {
        const primaryGroup = parsedByPrimary.get(primaryFingerprint) || [];
        const usedKeys = new Set<string>();
        for (const entry of primaryGroup) {
            const sourceActivityKey = getActivitySourceActivityKey(entry.activity);
            if (!sourceActivityKey || !isShaDerivedSourceActivityKey(sourceActivityKey)) {
                continue;
            }
            if (usedKeys.has(sourceActivityKey)) {
                if (strictAmbiguity) {
                    throw new Error(
                        `[sports-lib-reparse] Duplicate sourceActivityKey detected for fingerprint ${primaryFingerprint}`,
                    );
                }
                continue;
            }
            usedKeys.add(sourceActivityKey);
        }

        const parsedBySecondary = new Map<string, Array<typeof primaryGroup[number]>>();
        primaryGroup.forEach((entry) => {
            const group = parsedBySecondary.get(entry.secondary) || [];
            group.push(entry);
            parsedBySecondary.set(entry.secondary, group);
        });

        Array.from(parsedBySecondary.keys()).sort().forEach((secondaryFingerprint) => {
            const secondaryGroup = parsedBySecondary.get(secondaryFingerprint) || [];
            const missingEntries = secondaryGroup.filter((entry) => {
                const key = getActivitySourceActivityKey(entry.activity);
                return !key || !isShaDerivedSourceActivityKey(key);
            });
            if (missingEntries.length === 0) {
                return;
            }

            const existingBucketKeys = (existingKeysByFingerprint.get(`${primaryFingerprint}|${secondaryFingerprint}`) || [])
                .filter(key => !usedKeys.has(key));

            if (missingEntries.length > 1) {
                if (strictAmbiguity) {
                    throw new Error(
                        `[sports-lib-reparse] Ambiguous sourceActivityKey stamping for fingerprint ${primaryFingerprint} (${missingEntries.length} indistinguishable activities)`,
                    );
                }
                return;
            }

            const entry = missingEntries[0];
            let resolvedKey = existingBucketKeys[0];
            if (!resolvedKey) {
                const reservedKeys = new Set<string>([
                    ...Array.from(usedKeys),
                    ...(existingKeysByPrimary.get(primaryFingerprint) || []),
                ]);
                const occurrence = getNextOccurrenceForFingerprint(
                    reservedKeys,
                    normalizedHash,
                    primaryFingerprint,
                );
                resolvedKey = buildSourceActivityKey(normalizedHash, primaryFingerprint, occurrence);
            }
            setActivitySourceActivityKey(entry.activity, resolvedKey);
            usedKeys.add(resolvedKey);
        });
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
        fingerprintPayload: raw,
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

export interface AssignReimportActivityIdsOptions {
    combinedSourceContentHash: string;
    existingActivities?: ActivityIdentityLike[];
}

export async function assignReimportActivityIds(
    parsedEvent: EventInterface,
    eventID: string,
    options: AssignReimportActivityIdsOptions,
): Promise<void> {
    const normalizedCombinedSourceContentHash = normalizeText(options.combinedSourceContentHash).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedCombinedSourceContentHash)) {
        throw new Error('[sports-lib-reparse] Missing or invalid combinedSourceContentHash for activity ID assignment');
    }

    const activities = parsedEvent.getActivities() as ActivityIdentityLike[];
    stampSourceActivityKeysForActivities(activities, normalizedCombinedSourceContentHash, {
        existingActivities: options.existingActivities || [],
        strictAmbiguity: true,
    });

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

async function assertReparsePersistenceUserActiveInTransaction(
    db: admin.firestore.Firestore,
    transaction: admin.firestore.Transaction,
    uid: string,
    phase: string,
): Promise<void> {
    let deletionGuard;
    try {
        deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
    } catch (error) {
        throw new UserDeletionGuardReadError(uid, phase, error);
    }

    if (!deletionGuard.shouldSkip) {
        return;
    }

    logger.warn('[sports-lib-reparse] Skipping persistence because user is missing or deletion is in progress.', {
        uid,
        phase,
        userExists: deletionGuard.userExists,
        deletionInProgress: deletionGuard.deletionInProgress,
    });
    throw new ReparsePersistenceSkippedForDeletedUserError(uid, phase);
}

async function setReparseDocIfUserActive(
    uid: string,
    phase: string,
    docRef: admin.firestore.DocumentReference,
    data: unknown,
    options?: admin.firestore.SetOptions,
    transformExistingData?: (
        incomingData: admin.firestore.DocumentData,
        existingData: admin.firestore.DocumentData | null,
    ) => admin.firestore.DocumentData,
): Promise<void> {
    const db = admin.firestore();
    await runReparseFirestoreTransactionWithRetry(uid, phase, async () => db.runTransaction(async (transaction) => {
        await assertReparsePersistenceUserActiveInTransaction(db, transaction, uid, phase);
        const incomingData = data as admin.firestore.DocumentData;
        let resolvedData = incomingData;
        if (transformExistingData) {
            const existingSnapshot = await transaction.get(docRef);
            resolvedData = transformExistingData(
                incomingData,
                existingSnapshot.exists ? existingSnapshot.data() || null : null,
            );
        }
        transaction.set(docRef, resolvedData, options as admin.firestore.SetOptions);
    }));
}

function getFirestoreAdapter(uid: string): FirestoreAdapter {
    return {
        setDoc: async (path: string[], data: unknown) => {
            const documentPath = path.join('/');
            const isEventDocument = path.length === 4 && path[0] === 'users' && path[2] === 'events';
            await setReparseDocIfUserActive(
                uid,
                `sports_lib_reparse_writer:${documentPath}`,
                admin.firestore().doc(documentPath),
                data,
                undefined,
                isEventDocument ? preserveEventTagsOnRewrite : undefined,
            );
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
        const phase = 'sports_lib_reparse_delete_stale_activities';
        await runReparseFirestoreTransactionWithRetry(uid, phase, async () => db.runTransaction(async (transaction) => {
            await assertReparsePersistenceUserActiveInTransaction(
                db,
                transaction,
                uid,
                phase,
            );
            chunk.forEach(activityID => {
                transaction.delete(db.doc(`users/${uid}/activities/${activityID}`));
            });
        }));
        deleted += chunk.length;
    }

    return deleted;
}

async function runReparsePersistencePhase<T>(
    uid: string,
    eventId: string,
    phase: string,
    startedContext: Record<string, unknown>,
    operation: () => Promise<T>,
    completedContext?: (result: T) => Record<string, unknown>,
): Promise<T> {
    const startedAt = Date.now();
    logger.info('[sports-lib-reparse] Persistence phase started.', {
        uid,
        eventId,
        phase,
        ...startedContext,
    });

    try {
        const result = await operation();
        logger.info('[sports-lib-reparse] Persistence phase completed.', {
            uid,
            eventId,
            phase,
            durationMs: Date.now() - startedAt,
            ...(completedContext ? completedContext(result) : {}),
        });
        return result;
    } catch (error) {
        logger.error('[sports-lib-reparse] Persistence phase failed.', {
            uid,
            eventId,
            phase,
            durationMs: Date.now() - startedAt,
            error: toErrorMessage(error),
        });
        throw error;
    }
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

    const writer = new EventWriter(getFirestoreAdapter(uid), undefined, undefined, getWriterLogAdapter());
    await runReparsePersistencePhase(
        uid,
        eventId,
        'write_all_event_data',
        {
            existingActivityCount: existingActivityDocs.length,
        },
        () => writer.writeAllEventData(uid, parsedEvent as any),
    );

    const mergeMetadata = extractPreservedMergeMetadata(existingEventDoc);
    if (Object.keys(mergeMetadata).length > 0) {
        await runReparsePersistencePhase(
            uid,
            eventId,
            'merge_metadata',
            {
                fields: Object.keys(mergeMetadata),
            },
            () => setReparseDocIfUserActive(
                uid,
                'sports_lib_reparse_merge_metadata',
                admin.firestore().doc(`users/${uid}/events/${eventId}`),
                mergeMetadata,
                { merge: true },
            ),
        );
    }

    const newActivityIDs = new Set<string>();
    parsedEvent.getActivities().forEach(activity => {
        if (activity.getID()) {
            newActivityIDs.add(activity.getID() as string);
        }
    });

    const staleActivityCandidateCount = existingActivityDocs
        .filter(activityDoc => !newActivityIDs.has(activityDoc.id))
        .length;
    const staleActivitiesDeleted = await runReparsePersistencePhase(
        uid,
        eventId,
        'delete_stale_activities',
        {
            existingActivityCount: existingActivityDocs.length,
            newActivityCount: newActivityIDs.size,
            staleActivityCandidateCount,
        },
        () => deleteStaleActivities(uid, existingActivityDocs, newActivityIDs),
        deletedCount => ({ staleActivitiesDeleted: deletedCount }),
    );

    const processingMetaData: ProcessingMetaData = {
        processingEntity: EVENT_PROCESSING_ENTITY,
        sportsLibVersion: targetSportsLibVersion,
        sportsLibVersionCode: sportsLibVersionToCode(targetSportsLibVersion),
        processedAt: FieldValue.serverTimestamp(),
    };
    await runReparsePersistencePhase(
        uid,
        eventId,
        'processing_metadata',
        {
            targetSportsLibVersion,
        },
        () => setReparseDocIfUserActive(
            uid,
            'sports_lib_reparse_processing_metadata',
            admin.firestore().doc(`users/${uid}/events/${eventId}/metaData/processing`),
            processingMetaData,
            { merge: true },
        ),
    );

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
    await setReparseDocIfUserActive(
        uid,
        'sports_lib_reparse_status',
        statusRef,
        payload,
        { merge: true },
    );
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
        beforePersist?: () => Promise<void>;
        deadlineMs?: number;
    },
): Promise<ReparseExecutionResult> {
    const startedAtMs = Date.now();
    let stage = 'validate_target_version';
    const mode = options?.mode || 'reimport';
    const targetSportsLibVersion = options?.targetSportsLibVersion || resolveTargetSportsLibVersion();
    try {
        assertSportsLibRuntimeVersionMatchesTarget(targetSportsLibVersion);

        stage = 'load_event_and_activities';
        const loadEventAndActivitiesStartedAtMs = Date.now();
        const eventAndActivities = options?.eventData && options?.activityDocs
            ? {
                eventData: options.eventData,
                activityDocs: options.activityDocs,
            }
            : await getEventAndActivitiesForReparse(uid, eventId);
        const loadEventAndActivitiesDurationMs = Date.now() - loadEventAndActivitiesStartedAtMs;
        assertReparseRuntimeBudget({ deadlineMs: options?.deadlineMs, uid, eventId }, 'extract_source_files');

        stage = 'extract_source_files';
        const sourceFiles = extractSourceFiles(eventAndActivities.eventData);
        if (sourceFiles.length === 0) {
            const totalDurationMs = Date.now() - startedAtMs;
            logger.info('[sports-lib-reparse] Reparse timing', {
                uid,
                eventId,
                mode,
                status: 'skipped',
                reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
                targetSportsLibVersion,
                sourceFilesCount: 0,
                parsedActivitiesCount: 0,
                staleActivitiesDeleted: 0,
                loadEventAndActivitiesDurationMs,
                parseFromSourcesDurationMs: 0,
                transformDurationMs: 0,
                persistDurationMs: 0,
                totalDurationMs,
            });
            return {
                status: 'skipped',
                reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
                sourceFilesCount: 0,
                parsedActivitiesCount: 0,
                staleActivitiesDeleted: 0,
            };
        }

        stage = 'parse_source_files';
        const parseFromSourcesStartedAtMs = Date.now();
        const parseResult = await parseFromOriginalFilesStrict(sourceFiles, {
            deadlineMs: options?.deadlineMs,
            uid,
            eventId,
        });
        const parseFromSourcesDurationMs = Date.now() - parseFromSourcesStartedAtMs;
        assertReparseRuntimeBudget({ deadlineMs: options?.deadlineMs, uid, eventId }, 'transform_event');

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

        stage = 'transform_event';
        const transformStartedAtMs = Date.now();
        const reparsedEvent = parseResult.finalEvent;
        reparsedEvent.setID(eventId);
        applyPreservedFields(reparsedEvent, autoHealResult.eventData);
        const existingComparableActivities = eventAndActivities.activityDocs.map(toComparableExistingActivity);
        const activityEditCarryoverResult = resolveActivityEditCarryover(reparsedEvent, eventAndActivities.activityDocs);
        if (
            activityEditCarryoverResult.unmatchedParsedIndexes.length > 0
            || activityEditCarryoverResult.unmatchedExistingIndexes.length > 0
        ) {
            const parsedActivities = reparsedEvent.getActivities();
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
        await assignReimportActivityIds(reparsedEvent, eventId, {
            combinedSourceContentHash: parseResult.combinedSourceContentHash,
            existingActivities: existingComparableActivities,
        });
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
        const transformDurationMs = Date.now() - transformStartedAtMs;
        assertReparseRuntimeBudget({ deadlineMs: options?.deadlineMs, uid, eventId }, 'before_persist');

        if (options?.beforePersist) {
            stage = 'before_persist_guard';
            await options.beforePersist();
        }
        assertReparseRuntimeBudget({ deadlineMs: options?.deadlineMs, uid, eventId }, 'persist_reparsed_event');
        stage = 'persist_reparsed_event';
        const persistStartedAtMs = Date.now();
        const persistResult = await persistReparsedEvent(
            uid,
            eventId,
            reparsedEvent,
            autoHealResult.eventData,
            eventAndActivities.activityDocs,
            targetSportsLibVersion,
        );
        const persistDurationMs = Date.now() - persistStartedAtMs;
        const totalDurationMs = Date.now() - startedAtMs;

        logger.info('[sports-lib-reparse] Reparse timing', {
            uid,
            eventId,
            mode,
            status: 'completed',
            targetSportsLibVersion,
            sourceFilesCount: parseResult.sourceFilesCount,
            parsedActivitiesCount: reparsedEvent.getActivities().length,
            staleActivitiesDeleted: persistResult.staleActivitiesDeleted,
            loadEventAndActivitiesDurationMs,
            parseFromSourcesDurationMs,
            transformDurationMs,
            persistDurationMs,
            totalDurationMs,
        });

        return {
            status: 'completed',
            sourceFilesCount: parseResult.sourceFilesCount,
            parsedActivitiesCount: reparsedEvent.getActivities().length,
            staleActivitiesDeleted: persistResult.staleActivitiesDeleted,
        };
    } catch (error) {
        logger.error('[sports-lib-reparse] Reparse failed', {
            uid,
            eventId,
            mode,
            targetSportsLibVersion,
            stage,
            durationMs: Date.now() - startedAtMs,
            error: toErrorMessage(error),
        });
        throw error;
    }
}
