import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    HEALTH_MAX_RECORD_DOCUMENT_BYTES,
    HEALTH_MAX_SAMPLE_CHUNKS_PER_RECORD,
    HEALTH_MAX_SAMPLE_CHUNK_DOCUMENT_BYTES,
    HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK,
    HEALTH_MAX_WRITE_BYTES,
    HEALTH_PROVIDERS,
    HEALTH_RECORDS_COLLECTION_ID,
    HEALTH_SAMPLE_CHUNKS_COLLECTION_ID,
    HEALTH_SCHEMA_VERSION,
    HEALTH_SYNC_STATE_COLLECTION_ID,
    HEALTH_SYNC_STATUSES,
    HealthProvider,
    HealthSampleChunk,
    HealthSourceRecord,
    HealthSyncState,
    HealthSyncStatus,
    isHealthProvider,
} from '../../../shared/health';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { generateIDFromParts } from '../shared/id-generator';
import {
    HealthSourceRecordInput,
    HealthWriteValidationError,
    validateHealthSourceRecordInput,
} from './validation';

type HealthIdGenerator = (parts: string[]) => Promise<string>;
const OPAQUE_ID_PATTERN = /^[a-f0-9]{64}$/;

export interface HealthWriterDependencies {
    db?: admin.firestore.Firestore;
    generateId?: HealthIdGenerator;
}

export type HealthRecordWriteStatus = 'written' | 'unchanged' | 'stale' | 'skipped_deleted_user';

export interface HealthRecordWriteResult {
    id: string;
    status: HealthRecordWriteStatus;
    record: HealthSourceRecord | null;
    chunksWritten: number;
    chunksDeleted: number;
}

export class HealthRevisionConflictError extends Error {
    public readonly name = 'HealthRevisionConflictError';
    public readonly code = 'health_revision_conflict';

    constructor(public readonly recordId: string) {
        super(`Health record ${recordId} has conflicting content for the same provider revision order.`);
    }
}

export class HealthWriteSizeError extends HealthWriteValidationError {
    public readonly name = 'HealthWriteSizeError';

    constructor(message: string) {
        super(message);
    }
}

export interface BuiltHealthWrite {
    record: HealthSourceRecord;
    chunks: HealthSampleChunk[];
}

function cleanUndefined<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function stableComparableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stableComparableValue);
    }
    if (!value || typeof value !== 'object') {
        return value === undefined ? null : value;
    }
    const source = value as Record<string, unknown>;
    return Object.keys(source).sort().reduce<Record<string, unknown>>((result, key) => {
        if (source[key] !== undefined) {
            result[key] = stableComparableValue(source[key]);
        }
        return result;
    }, {});
}

function stableValueKey(value: unknown): string {
    return JSON.stringify(stableComparableValue(value));
}

function sortStableValues<T>(values: readonly T[]): T[] {
    return values
        .map((value, index) => ({ value, index, key: stableValueKey(value) }))
        .sort((left, right) => (
            left.key < right.key ? -1 : left.key > right.key ? 1 : left.index - right.index
        ))
        .map(item => item.value);
}

function canonicalizeInput(input: HealthSourceRecordInput): HealthSourceRecordInput {
    return {
        ...input,
        metrics: sortStableValues(input.metrics),
        sampleSeries: sortStableValues(input.sampleSeries),
    };
}

async function generateOpaqueId(generateId: HealthIdGenerator, parts: readonly string[]): Promise<string> {
    // One length-preserving JSON part avoids delimiter collisions inside the shared ID generator.
    const id = await generateId([JSON.stringify(parts)]);
    if (!OPAQUE_ID_PATTERN.test(id)) {
        throw new HealthWriteValidationError('Health ID generator returned an invalid opaque ID.');
    }
    return id;
}

function validateWriteContext(userID: string, nowMs: number): void {
    if (typeof userID !== 'string'
        || userID.trim().length === 0
        || userID !== userID.trim()
        || userID.includes('/')
        || userID.length > 128) {
        throw new HealthWriteValidationError('userID must be a safe bounded non-empty document ID.');
    }
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
        throw new HealthWriteValidationError('nowMs must be a non-negative safe integer.');
    }
}

function documentBytes(value: unknown): number {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') {
        throw new HealthWriteSizeError('Health document could not be serialized for bounded-size validation.');
    }
    return Buffer.byteLength(serialized, 'utf8');
}

export function assertHealthWriteSize(record: HealthSourceRecord, chunks: readonly HealthSampleChunk[]): void {
    const recordBytes = documentBytes(record);
    if (recordBytes > HEALTH_MAX_RECORD_DOCUMENT_BYTES) {
        throw new HealthWriteSizeError(`Health source record ${record.id} exceeds the bounded document size.`);
    }
    const chunkSizes = chunks.map(chunk => ({ chunk, bytes: documentBytes(chunk) }));
    const oversizedChunk = chunkSizes.find(item => item.bytes > HEALTH_MAX_SAMPLE_CHUNK_DOCUMENT_BYTES);
    if (oversizedChunk) {
        throw new HealthWriteSizeError(`Health sample chunk ${oversizedChunk.chunk.id} exceeds the bounded document size.`);
    }
    const totalBytes = recordBytes + chunkSizes.reduce((total, item) => total + item.bytes, 0);
    if (totalBytes > HEALTH_MAX_WRITE_BYTES) {
        throw new HealthWriteSizeError('Health record replacement exceeds the bounded transaction payload size.');
    }
}

function digestPayload(input: HealthSourceRecordInput): unknown {
    return stableComparableValue({
        provider: input.provider,
        sourceRecordType: input.sourceRecordType,
        sourceRecordKey: input.sourceRecordKey,
        kind: input.kind,
        calendarDate: input.calendarDate,
        startTimeMs: input.startTimeMs,
        endTimeMs: input.endTimeMs,
        timezoneOffsetSeconds: input.timezoneOffsetSeconds,
        metrics: input.metrics,
        coverage: input.coverage,
        device: input.device,
        sampleSeries: input.sampleSeries,
    });
}

export async function buildHealthWrite(
    userID: string,
    value: unknown,
    nowMs = Date.now(),
    generateId: HealthIdGenerator = generateIDFromParts,
): Promise<BuiltHealthWrite> {
    validateWriteContext(userID, nowMs);
    const input = canonicalizeInput(validateHealthSourceRecordInput(value));
    const accountKey = await generateOpaqueId(generateId, [
        'health-account-v1',
        userID,
        input.provider,
        input.providerAccountId,
    ]);
    const id = await generateOpaqueId(generateId, [
        'health-record-v1',
        userID,
        input.provider,
        input.providerAccountId,
        input.sourceRecordType,
        input.sourceRecordKey,
    ]);
    const digest = await generateOpaqueId(generateId, [
        'health-record-content-v1',
        JSON.stringify(digestPayload(input)),
    ]);
    const revision = {
        order: input.revision.order,
        token: input.revision.token,
        digest,
    };

    const chunkGroups = await Promise.all(input.sampleSeries.map(async (series) => {
        const chunks: HealthSampleChunk[] = [];
        const chunkCount = Math.ceil(series.offsetMs.length / HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK);
        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
            const sliceStart = chunkIndex * HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK;
            const sliceEnd = Math.min(sliceStart + HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK, series.offsetMs.length);
            const firstOffsetMs = series.offsetMs[sliceStart];
            const offsetMs = series.offsetMs.slice(sliceStart, sliceEnd).map(offset => offset - firstOffsetMs);
            const chunkId = await generateOpaqueId(generateId, [
                'health-chunk-v1',
                id,
                series.seriesKey,
                String(chunkIndex),
            ]);
            chunks.push({
                schemaVersion: HEALTH_SCHEMA_VERSION,
                id: chunkId,
                userID,
                parentRecordId: id,
                provider: input.provider,
                accountKey,
                metricId: series.metricId,
                valueType: series.valueType,
                aggregation: series.aggregation,
                semanticVariant: series.semanticVariant,
                origin: series.origin,
                recordingMethod: series.recordingMethod,
                normalizationStatus: series.normalizationStatus,
                nativeMetric: series.nativeMetric,
                nativeUnit: series.nativeUnit,
                canonicalUnit: series.canonicalUnit,
                calendarDate: input.calendarDate,
                startTimeMs: input.startTimeMs + firstOffsetMs,
                endTimeMs: input.startTimeMs + firstOffsetMs + (offsetMs[offsetMs.length - 1] || 0),
                receivedAtMs: input.receivedAtMs,
                timezoneOffsetSeconds: input.timezoneOffsetSeconds,
                seriesKey: series.seriesKey,
                chunkIndex,
                offsetMs,
                nativeValues: series.nativeValues.slice(sliceStart, sliceEnd),
                canonicalValues: series.canonicalValues === null
                    ? null
                    : series.canonicalValues?.slice(sliceStart, sliceEnd),
                qualityCodes: series.qualityCodes === null
                    ? null
                    : series.qualityCodes?.slice(sliceStart, sliceEnd),
                coverage: series.coverage,
                device: series.device === undefined ? input.device : series.device,
                revision,
                createdAtMs: nowMs,
                updatedAtMs: nowMs,
            });
        }
        return chunks;
    }));
    const chunks = chunkGroups.flat();
    const metricIds = [...new Set([
        ...input.metrics.map(metric => metric.metricId),
        ...input.sampleSeries.map(series => series.metricId),
    ])].sort();
    const record: HealthSourceRecord = {
        schemaVersion: HEALTH_SCHEMA_VERSION,
        id,
        userID,
        kind: input.kind,
        source: {
            provider: input.provider,
            accountKey,
            sourceRecordType: input.sourceRecordType,
            sourceRecordKey: input.sourceRecordKey,
            revision,
            receivedAtMs: input.receivedAtMs,
        },
        calendarDate: input.calendarDate,
        startTimeMs: input.startTimeMs,
        endTimeMs: input.endTimeMs,
        timezoneOffsetSeconds: input.timezoneOffsetSeconds,
        metrics: input.metrics,
        metricIds,
        coverage: input.coverage,
        device: input.device,
        sampleChunkIds: chunks.map(chunk => chunk.id),
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
    };
    const result = cleanUndefined({ record, chunks });
    assertHealthWriteSize(result.record, result.chunks);
    return result;
}

function userHealthCollection(
    db: admin.firestore.Firestore,
    userID: string,
    collectionId: string,
): admin.firestore.CollectionReference {
    return db.collection('users').doc(userID).collection(collectionId);
}

export async function replaceHealthSourceRecord(
    userID: string,
    value: unknown,
    nowMs = Date.now(),
    dependencies: HealthWriterDependencies = {},
): Promise<HealthRecordWriteResult> {
    const db = dependencies.db || admin.firestore();
    const built = await buildHealthWrite(userID, value, nowMs, dependencies.generateId || generateIDFromParts);
    const recordRef = userHealthCollection(db, userID, HEALTH_RECORDS_COLLECTION_ID).doc(built.record.id);
    const chunkCollection = userHealthCollection(db, userID, HEALTH_SAMPLE_CHUNKS_COLLECTION_ID);

    const result = await db.runTransaction(async transaction => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID, nowMs);
        } catch (error) {
            throw new UserDeletionGuardReadError(userID, 'health_record_write', error);
        }
        if (deletionGuard.shouldSkip) {
            return {
                id: built.record.id,
                status: 'skipped_deleted_user' as const,
                record: null,
                chunksWritten: 0,
                chunksDeleted: 0,
            };
        }

        const snapshot = await transaction.get(recordRef);
        const existing = snapshot.exists ? snapshot.data() as HealthSourceRecord : null;
        if (existing && existing.source.revision.order > built.record.source.revision.order) {
            return {
                id: existing.id,
                status: 'stale' as const,
                record: existing,
                chunksWritten: 0,
                chunksDeleted: 0,
            };
        }
        if (existing && existing.source.revision.order === built.record.source.revision.order) {
            const unchanged = existing.source.revision.token === built.record.source.revision.token
                && existing.source.revision.digest === built.record.source.revision.digest;
            if (!unchanged) {
                throw new HealthRevisionConflictError(built.record.id);
            }
            return {
                id: existing.id,
                status: 'unchanged' as const,
                record: existing,
                chunksWritten: 0,
                chunksDeleted: 0,
            };
        }

        const existingChunkIds = existing?.sampleChunkIds || [];
        if (!Array.isArray(existingChunkIds)
            || existingChunkIds.length > HEALTH_MAX_SAMPLE_CHUNKS_PER_RECORD
            || new Set(existingChunkIds).size !== existingChunkIds.length
            || existingChunkIds.some(chunkId => typeof chunkId !== 'string' || !OPAQUE_ID_PATTERN.test(chunkId))) {
            throw new HealthWriteValidationError('Stored health record violates the bounded sample-chunk invariant.');
        }
        const incomingChunkIds = new Set(built.record.sampleChunkIds);
        const staleChunkIds = existingChunkIds.filter(chunkId => !incomingChunkIds.has(chunkId));
        for (const chunkId of staleChunkIds) {
            // Health sample chunks are permanent leaf documents by schema; descendants are forbidden by Rules.
            transaction.delete(chunkCollection.doc(chunkId));
        }
        for (const chunk of built.chunks) {
            transaction.set(chunkCollection.doc(chunk.id), chunk);
        }
        const record = {
            ...built.record,
            createdAtMs: existing?.createdAtMs ?? built.record.createdAtMs,
        };
        transaction.set(recordRef, record);
        return {
            id: record.id,
            status: 'written' as const,
            record,
            chunksWritten: built.chunks.length,
            chunksDeleted: staleChunkIds.length,
        };
    });

    logger.info('[HealthSync] Health record write completed.', {
        provider: built.record.source.provider,
        recordId: built.record.id,
        status: result.status,
        chunksWritten: result.chunksWritten,
        chunksDeleted: result.chunksDeleted,
    });
    return result;
}

export interface HealthSyncStateUpdate {
    status?: HealthSyncStatus;
    lastWebhookAtMs?: number | null;
    lastPollAtMs?: number | null;
    lastSyncedAtMs?: number | null;
    lastObservedAtMs?: number | null;
    lastErrorCode?: string | null;
}

function optionalSyncTime(value: unknown, field: string): number | null | undefined {
    if (value === undefined || value === null) {
        return value as null | undefined;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new HealthWriteValidationError(`${field} must be a non-negative safe integer or null.`);
    }
    return value;
}

function monotonicSyncTime(
    incoming: number | null | undefined,
    existing: unknown,
    staleUpdate: boolean,
): number | null | undefined {
    if (staleUpdate && incoming === null) {
        return undefined;
    }
    if (incoming === null || incoming === undefined) {
        return incoming;
    }
    return typeof existing === 'number' && Number.isSafeInteger(existing) && existing > incoming
        ? undefined
        : incoming;
}

function validateSyncUpdate(provider: unknown, value: unknown): { provider: HealthProvider; update: HealthSyncStateUpdate } {
    if (!isHealthProvider(provider) || provider === HEALTH_PROVIDERS.QuantifiedSelf) {
        throw new HealthWriteValidationError('Health sync provider is not supported.');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new HealthWriteValidationError('Health sync update must be an object.');
    }
    const input = value as Record<string, unknown>;
    let status: HealthSyncStatus | undefined;
    if (input.status !== undefined) {
        if (typeof input.status !== 'string' || !Object.values(HEALTH_SYNC_STATUSES).includes(input.status as HealthSyncStatus)) {
            throw new HealthWriteValidationError('Health sync status is not supported.');
        }
        status = input.status as HealthSyncStatus;
    }
    let lastErrorCode: string | null | undefined;
    if (input.lastErrorCode === null) {
        lastErrorCode = null;
    } else if (input.lastErrorCode !== undefined) {
        if (typeof input.lastErrorCode !== 'string'
            || input.lastErrorCode.length === 0
            || input.lastErrorCode.length > 64
            || !/^[a-z0-9_.:-]+$/i.test(input.lastErrorCode)) {
            throw new HealthWriteValidationError('lastErrorCode must be an opaque bounded error code.');
        }
        lastErrorCode = input.lastErrorCode;
    }
    return {
        provider,
        update: {
            status,
            lastWebhookAtMs: optionalSyncTime(input.lastWebhookAtMs, 'lastWebhookAtMs'),
            lastPollAtMs: optionalSyncTime(input.lastPollAtMs, 'lastPollAtMs'),
            lastSyncedAtMs: optionalSyncTime(input.lastSyncedAtMs, 'lastSyncedAtMs'),
            lastObservedAtMs: optionalSyncTime(input.lastObservedAtMs, 'lastObservedAtMs'),
            lastErrorCode,
        },
    };
}

export async function updateHealthSyncState(
    userID: string,
    providerValue: unknown,
    updateValue: unknown,
    nowMs = Date.now(),
    dependencies: Pick<HealthWriterDependencies, 'db'> = {},
): Promise<boolean> {
    validateWriteContext(userID, nowMs);
    const { provider, update } = validateSyncUpdate(providerValue, updateValue);
    const db = dependencies.db || admin.firestore();
    const stateRef = userHealthCollection(db, userID, HEALTH_SYNC_STATE_COLLECTION_ID).doc(provider);
    const written = await db.runTransaction(async transaction => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID, nowMs);
        } catch (error) {
            throw new UserDeletionGuardReadError(userID, 'health_sync_state_write', error);
        }
        if (deletionGuard.shouldSkip) {
            return false;
        }
        const snapshot = await transaction.get(stateRef);
        const existing = snapshot.exists
            ? snapshot.data() as Partial<HealthSyncState>
            : null;
        const existingUpdatedAtMs = typeof existing?.updatedAtMs === 'number'
            && Number.isSafeInteger(existing.updatedAtMs)
            ? existing.updatedAtMs
            : null;
        const staleUpdate = existingUpdatedAtMs !== null && existingUpdatedAtMs > nowMs;
        const updatedAtMs = existingUpdatedAtMs === null
            ? nowMs
            : Math.max(existingUpdatedAtMs, nowMs);
        const state: Partial<HealthSyncState> & Pick<HealthSyncState, 'provider' | 'updatedAtMs'> = cleanUndefined({
            provider,
            ...update,
            status: staleUpdate
                ? undefined
                : update.status ?? (snapshot.exists ? undefined : HEALTH_SYNC_STATUSES.Ready),
            lastWebhookAtMs: monotonicSyncTime(update.lastWebhookAtMs, existing?.lastWebhookAtMs, staleUpdate),
            lastPollAtMs: monotonicSyncTime(update.lastPollAtMs, existing?.lastPollAtMs, staleUpdate),
            lastSyncedAtMs: monotonicSyncTime(update.lastSyncedAtMs, existing?.lastSyncedAtMs, staleUpdate),
            lastObservedAtMs: monotonicSyncTime(update.lastObservedAtMs, existing?.lastObservedAtMs, staleUpdate),
            lastErrorCode: staleUpdate ? undefined : update.lastErrorCode,
            updatedAtMs,
        });
        transaction.set(stateRef, state, { merge: true });
        return true;
    });
    logger.info('[HealthSync] Health sync state write completed.', { provider, written });
    return written;
}

/** Disconnecting a provider changes only sync state; imported health history is intentionally retained. */
export function markHealthProviderDisconnected(
    userID: string,
    provider: HealthProvider,
    nowMs = Date.now(),
    dependencies: Pick<HealthWriterDependencies, 'db'> = {},
): Promise<boolean> {
    return updateHealthSyncState(userID, provider, {
        status: HEALTH_SYNC_STATUSES.Disconnected,
        lastErrorCode: null,
    }, nowMs, dependencies);
}
