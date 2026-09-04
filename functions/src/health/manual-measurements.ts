import * as admin from 'firebase-admin';
import { DataVO2Max, DataWeight } from '@sports-alliance/sports-lib';
import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_PROVIDERS,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_SCHEMA_VERSION,
    HEALTH_SOURCE_RECORD_KINDS,
    HEALTH_SOURCE_RECORDS_COLLECTION_ID,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
    type HealthMetricValue,
    type HealthSourceRecord,
} from '../../../shared/health';
import {
    MANUAL_HEALTH_AGGREGATION,
    MANUAL_HEALTH_SOURCE_RECORD_TYPE,
    MANUAL_VO2_CONTEXTS,
    MANUAL_VO2_METHODS,
    MANUAL_WEIGHT_SEMANTIC_VARIANT,
    type DeleteManualHealthMeasurementRequest,
    type DeleteManualHealthMeasurementResponse,
    type ManualHealthMeasurementFields,
    type SaveManualHealthMeasurementRequest,
    type SaveManualHealthMeasurementResponse,
    isManualHealthMetricId,
    manualVo2SemanticVariant,
} from '../../../shared/manual-health';
import { encodeHealthMetricSportsLibData } from '../../../shared/sports-lib-health-data';
import { generateIDFromParts } from '../shared/id-generator';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import {
    assertHealthSourceRecordWriteSize,
    HealthSourceRecordRevisionConflictError,
    replaceHealthSourceRecord,
    type HealthWriterDependencies,
} from './writer';

const MANUAL_HEALTH_ACCOUNT_ID = 'quantified-self-manual';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID_PATTERN = /^[a-f0-9]{64}$/;
const EARLIEST_MANUAL_MEASUREMENT_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_TIMEZONE_OFFSET_SECONDS = 24 * 60 * 60;

export class ManualHealthValidationError extends Error {
    public readonly name = 'ManualHealthValidationError';
}

export class ManualHealthMeasurementNotFoundError extends Error {
    public readonly name = 'ManualHealthMeasurementNotFoundError';
}

export class ManualHealthRevisionConflictError extends Error {
    public readonly name = 'ManualHealthRevisionConflictError';
}

export class ManualHealthWriteBlockedError extends Error {
    public readonly name = 'ManualHealthWriteBlockedError';
}

export interface ManualHealthMutationDependencies extends HealthWriterDependencies {
    now?: () => number;
}

function plainObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ManualHealthValidationError(`${field} must be an object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new ManualHealthValidationError(`${field} must be a plain object.`);
    }
    return value as Record<string, unknown>;
}

function assertExactKeys(
    value: Record<string, unknown>,
    required: readonly string[],
    optional: readonly string[] = [],
): void {
    const permitted = new Set([...required, ...optional]);
    if (required.some(key => !Object.prototype.hasOwnProperty.call(value, key))
        || Object.keys(value).some(key => !permitted.has(key))) {
        throw new ManualHealthValidationError('Manual Health measurement has unknown or missing fields.');
    }
}

function safeInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new ManualHealthValidationError(`${field} must be a safe integer.`);
    }
    return value;
}

function positiveRevision(value: unknown): number {
    const revision = safeInteger(value, 'expectedRevisionOrder');
    if (revision < 1 || revision >= Number.MAX_SAFE_INTEGER) {
        throw new ManualHealthValidationError('expectedRevisionOrder is outside the supported range.');
    }
    return revision;
}

function enumString<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new ManualHealthValidationError(`${field} is not supported.`);
    }
    return value as T;
}

function validateMeasurementFields(
    raw: Record<string, unknown>,
    nowMs: number,
): ManualHealthMeasurementFields {
    if (!isManualHealthMetricId(raw.metricId)) {
        throw new ManualHealthValidationError('metricId is not supported for manual entry.');
    }
    if (typeof raw.canonicalValue !== 'number' || !Number.isFinite(raw.canonicalValue)) {
        throw new ManualHealthValidationError('canonicalValue must be a finite number.');
    }
    const canonicalValue = raw.canonicalValue;
    const data = raw.metricId === HEALTH_METRIC_IDS.BodyWeight
        ? new DataWeight(canonicalValue)
        : new DataVO2Max(canonicalValue);
    const maximum = raw.metricId === HEALTH_METRIC_IDS.BodyWeight ? 1_000 : 150;
    if (canonicalValue <= 0 || canonicalValue > maximum || !data.isValueTypeValid(canonicalValue)) {
        throw new ManualHealthValidationError('canonicalValue is outside the supported range.');
    }
    const observedAtMs = safeInteger(raw.observedAtMs, 'observedAtMs');
    if (observedAtMs < EARLIEST_MANUAL_MEASUREMENT_MS || observedAtMs > nowMs + MAX_FUTURE_SKEW_MS) {
        throw new ManualHealthValidationError('observedAtMs is outside the supported range.');
    }
    const timezoneOffsetSeconds = safeInteger(raw.timezoneOffsetSeconds, 'timezoneOffsetSeconds');
    if (Math.abs(timezoneOffsetSeconds) >= MAX_TIMEZONE_OFFSET_SECONDS) {
        throw new ManualHealthValidationError('timezoneOffsetSeconds is outside the supported range.');
    }
    if (raw.metricId === HEALTH_METRIC_IDS.BodyWeight) {
        if (raw.vo2Context !== undefined || raw.vo2Method !== undefined) {
            throw new ManualHealthValidationError('Weight measurements cannot include VO2 metadata.');
        }
        return {
            metricId: raw.metricId,
            canonicalValue,
            observedAtMs,
            timezoneOffsetSeconds,
        };
    }
    return {
        metricId: raw.metricId,
        canonicalValue,
        observedAtMs,
        timezoneOffsetSeconds,
        vo2Context: enumString(raw.vo2Context, MANUAL_VO2_CONTEXTS, 'vo2Context'),
        vo2Method: enumString(raw.vo2Method, MANUAL_VO2_METHODS, 'vo2Method'),
    };
}

export function validateSaveManualHealthMeasurementRequest(
    value: unknown,
    nowMs = Date.now(),
): SaveManualHealthMeasurementRequest {
    const raw = plainObject(value, 'Manual Health measurement');
    if (raw.mode === 'create') {
        assertExactKeys(
            raw,
            ['mode', 'clientMutationId', 'metricId', 'canonicalValue', 'observedAtMs', 'timezoneOffsetSeconds'],
            ['vo2Context', 'vo2Method'],
        );
        if (typeof raw.clientMutationId !== 'string' || !UUID_PATTERN.test(raw.clientMutationId)) {
            throw new ManualHealthValidationError('clientMutationId must be a UUID.');
        }
        return {
            mode: 'create',
            clientMutationId: raw.clientMutationId.toLowerCase(),
            ...validateMeasurementFields(raw, nowMs),
        };
    }
    if (raw.mode === 'update') {
        assertExactKeys(
            raw,
            ['mode', 'sourceRecordId', 'expectedRevisionOrder', 'metricId', 'canonicalValue', 'observedAtMs', 'timezoneOffsetSeconds'],
            ['vo2Context', 'vo2Method'],
        );
        if (typeof raw.sourceRecordId !== 'string' || !OPAQUE_ID_PATTERN.test(raw.sourceRecordId)) {
            throw new ManualHealthValidationError('sourceRecordId must be an opaque Health record ID.');
        }
        return {
            mode: 'update',
            sourceRecordId: raw.sourceRecordId,
            expectedRevisionOrder: positiveRevision(raw.expectedRevisionOrder),
            ...validateMeasurementFields(raw, nowMs),
        };
    }
    throw new ManualHealthValidationError('mode must be create or update.');
}

export function validateDeleteManualHealthMeasurementRequest(
    value: unknown,
): DeleteManualHealthMeasurementRequest {
    const raw = plainObject(value, 'Manual Health deletion');
    assertExactKeys(raw, ['sourceRecordId', 'expectedRevisionOrder']);
    if (typeof raw.sourceRecordId !== 'string' || !OPAQUE_ID_PATTERN.test(raw.sourceRecordId)) {
        throw new ManualHealthValidationError('sourceRecordId must be an opaque Health record ID.');
    }
    return {
        sourceRecordId: raw.sourceRecordId,
        expectedRevisionOrder: positiveRevision(raw.expectedRevisionOrder),
    };
}

function calendarDateAtOffset(observedAtMs: number, timezoneOffsetSeconds: number): string {
    return new Date(observedAtMs + timezoneOffsetSeconds * 1000).toISOString().slice(0, 10);
}

function buildManualMetric(fields: ManualHealthMeasurementFields): HealthMetricValue {
    const isWeight = fields.metricId === HEALTH_METRIC_IDS.BodyWeight;
    const unit = isWeight
        ? HEALTH_UNITS.Kilogram
        : HEALTH_UNITS.MillilitersPerKilogramPerMinute;
    const nativeMetric = isWeight ? DataWeight.type : DataVO2Max.type;
    const qualifiers = isWeight
        ? undefined
        : { context: fields.vo2Context!, method: fields.vo2Method! };
    return {
        kind: 'value',
        metricId: fields.metricId,
        valueType: HEALTH_VALUE_TYPES.Number,
        aggregation: MANUAL_HEALTH_AGGREGATION,
        semanticVariant: isWeight
            ? MANUAL_WEIGHT_SEMANTIC_VARIANT
            : manualVo2SemanticVariant(fields.vo2Context!, fields.vo2Method!),
        origin: HEALTH_VALUE_ORIGINS.Recorded,
        recordingMethod: HEALTH_RECORDING_METHODS.Manual,
        quality: { status: HEALTH_QUALITY_STATUSES.Valid },
        coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
        native: {
            metric: nativeMetric,
            value: fields.canonicalValue,
            unit,
            qualifiers,
        },
        canonical: { value: fields.canonicalValue, unit },
    };
}

function encodeManualMetricForFirestore(fields: ManualHealthMeasurementFields): HealthMetricValue {
    const encoded = encodeHealthMetricSportsLibData(buildManualMetric(fields));
    if (encoded.kind !== 'value') {
        throw new ManualHealthValidationError('Manual Health metric could not be encoded.');
    }
    const persisted = { ...encoded };
    delete persisted.canonical;
    return persisted;
}

function isEditableManualRecord(
    value: unknown,
    uid: string,
    sourceRecordId: string,
): value is HealthSourceRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as HealthSourceRecord;
    const metric = record.metrics?.[0];
    return record.schemaVersion === HEALTH_SCHEMA_VERSION
        && record.id === sourceRecordId
        && record.userID === uid
        && record.kind === HEALTH_SOURCE_RECORD_KINDS.PointMeasurement
        && record.source?.provider === HEALTH_PROVIDERS.QuantifiedSelf
        && record.source?.sourceRecordType === MANUAL_HEALTH_SOURCE_RECORD_TYPE
        && OPAQUE_ID_PATTERN.test(record.source?.accountKey || '')
        && OPAQUE_ID_PATTERN.test(record.source?.sourceRecordKey || '')
        && OPAQUE_ID_PATTERN.test(record.source?.revision?.token || '')
        && OPAQUE_ID_PATTERN.test(record.source?.revision?.digest || '')
        && Number.isSafeInteger(record.source?.revision?.order)
        && record.source.revision.order >= 1
        && Array.isArray(record.sampleChunkIds)
        && record.sampleChunkIds.length === 0
        && Array.isArray(record.metricIds)
        && record.metricIds.length === 1
        && Array.isArray(record.metrics)
        && record.metrics.length === 1
        && metric?.kind === 'value'
        && isManualHealthMetricId(metric.metricId)
        && record.metricIds[0] === metric.metricId
        && metric.aggregation === MANUAL_HEALTH_AGGREGATION
        && metric.origin === HEALTH_VALUE_ORIGINS.Recorded
        && metric.recordingMethod === HEALTH_RECORDING_METHODS.Manual;
}

async function updateManualMeasurement(
    uid: string,
    request: Extract<SaveManualHealthMeasurementRequest, { mode: 'update' }>,
    nowMs: number,
    dependencies: ManualHealthMutationDependencies,
): Promise<SaveManualHealthMeasurementResponse> {
    const db = dependencies.db || admin.firestore();
    const ref = db.collection('users').doc(uid)
        .collection(HEALTH_SOURCE_RECORDS_COLLECTION_ID).doc(request.sourceRecordId);
    return db.runTransaction(async transaction => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        } catch (error) {
            throw new UserDeletionGuardReadError(uid, 'manual_health_update', error);
        }
        if (deletionGuard.shouldSkip) throw new ManualHealthWriteBlockedError();
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new ManualHealthMeasurementNotFoundError();
        const existing = snapshot.data();
        if (!isEditableManualRecord(existing, uid, request.sourceRecordId)) {
            throw new ManualHealthMeasurementNotFoundError();
        }
        if (existing.source.revision.order !== request.expectedRevisionOrder) {
            throw new ManualHealthRevisionConflictError();
        }
        if (existing.metricIds[0] !== request.metricId) {
            throw new ManualHealthValidationError('A manual measurement cannot change metric type.');
        }
        const nextRevisionOrder = request.expectedRevisionOrder + 1;
        const revisionDigest = await generateIDFromParts([
            'manual-health-content-v1',
            request.sourceRecordId,
            String(nextRevisionOrder),
            JSON.stringify(request),
        ]);
        const revisionToken = await generateIDFromParts([
            'manual-health-revision-v1',
            request.sourceRecordId,
            String(nextRevisionOrder),
            revisionDigest,
        ]);
        const updated: HealthSourceRecord = {
            ...existing,
            calendarDate: calendarDateAtOffset(request.observedAtMs, request.timezoneOffsetSeconds),
            startTimeMs: request.observedAtMs,
            endTimeMs: request.observedAtMs,
            timezoneOffsetSeconds: request.timezoneOffsetSeconds,
            metrics: [encodeManualMetricForFirestore(request)],
            coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
            source: {
                ...existing.source,
                revision: {
                    order: nextRevisionOrder,
                    token: revisionToken,
                    digest: revisionDigest,
                },
                maxObservedRevisionOrder: nextRevisionOrder,
                receivedAtMs: nowMs,
            },
            updatedAtMs: nowMs,
        };
        assertHealthSourceRecordWriteSize(updated, []);
        transaction.set(ref, updated);
        return { sourceRecordId: request.sourceRecordId, revisionOrder: nextRevisionOrder };
    });
}

export async function saveManualHealthMeasurement(
    uid: string,
    value: unknown,
    dependencies: ManualHealthMutationDependencies = {},
): Promise<SaveManualHealthMeasurementResponse> {
    const nowMs = dependencies.now?.() ?? Date.now();
    const request = validateSaveManualHealthMeasurementRequest(value, nowMs);
    if (request.mode === 'update') {
        return updateManualMeasurement(uid, request, nowMs, dependencies);
    }
    let result;
    try {
        result = await replaceHealthSourceRecord(uid, {
            provider: HEALTH_PROVIDERS.QuantifiedSelf,
            providerAccountId: MANUAL_HEALTH_ACCOUNT_ID,
            sourceRecordType: MANUAL_HEALTH_SOURCE_RECORD_TYPE,
            sourceRecordKey: request.clientMutationId,
            revision: { order: 1, token: request.clientMutationId },
            // Keep idempotent retries byte-equivalent without trusting a client receipt timestamp.
            receivedAtMs: request.observedAtMs,
            kind: HEALTH_SOURCE_RECORD_KINDS.PointMeasurement,
            calendarDate: calendarDateAtOffset(request.observedAtMs, request.timezoneOffsetSeconds),
            startTimeMs: request.observedAtMs,
            endTimeMs: request.observedAtMs,
            timezoneOffsetSeconds: request.timezoneOffsetSeconds,
            metrics: [buildManualMetric(request)],
            coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
            sampleSeries: [],
        }, nowMs, dependencies);
    } catch (error) {
        // A reused mutation UUID with different content is a client-visible conflict,
        // not an opaque writer failure. Exact retries still resolve as unchanged.
        if (error instanceof HealthSourceRecordRevisionConflictError) {
            throw new ManualHealthRevisionConflictError();
        }
        throw error;
    }
    if (result.status === 'skipped_deleted_user' || result.status === 'skipped_lifecycle_guard') {
        throw new ManualHealthWriteBlockedError();
    }
    return { sourceRecordId: result.sourceRecordId, revisionOrder: 1 };
}

export async function deleteManualHealthMeasurement(
    uid: string,
    value: unknown,
    dependencies: ManualHealthMutationDependencies = {},
): Promise<DeleteManualHealthMeasurementResponse> {
    const request = validateDeleteManualHealthMeasurementRequest(value);
    const nowMs = dependencies.now?.() ?? Date.now();
    const db = dependencies.db || admin.firestore();
    const ref = db.collection('users').doc(uid)
        .collection(HEALTH_SOURCE_RECORDS_COLLECTION_ID).doc(request.sourceRecordId);
    return db.runTransaction(async transaction => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        } catch (error) {
            throw new UserDeletionGuardReadError(uid, 'manual_health_delete', error);
        }
        if (deletionGuard.shouldSkip) throw new ManualHealthWriteBlockedError();
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return { deleted: false };
        const existing = snapshot.data();
        if (!isEditableManualRecord(existing, uid, request.sourceRecordId)) {
            throw new ManualHealthMeasurementNotFoundError();
        }
        if (existing.source.revision.order !== request.expectedRevisionOrder) {
            throw new ManualHealthRevisionConflictError();
        }
        // Manual source records are permanent leaf documents and are accepted here only
        // when their validated sampleChunkIds array is empty.
        transaction.delete(ref);
        return { deleted: true };
    });
}
