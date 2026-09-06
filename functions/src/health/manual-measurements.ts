import * as admin from 'firebase-admin';
import {
    DataVO2Max, DataWeight, DataBodyFat, DataBloodPressureSystolic, DataBloodPressureDiastolic, DataPulseRate,
    DataMuscleMass, DataBodyWater, DataBoneMass, DataBloodOxygenSaturation,
} from '@sports-alliance/sports-lib';
import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_METRIC_CATALOG,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_PROVIDERS,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_SCHEMA_VERSION,
    HEALTH_SOURCE_RECORD_KINDS,
    HEALTH_SOURCE_RECORDS_COLLECTION_ID,
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
    MANUAL_POINT_SEMANTIC_VARIANT,
    MANUAL_HEALTH_VALUE_MAXIMUMS,
    manualHealthEntryMetric,
    type DeleteManualHealthMeasurementRequest,
    type DeleteManualHealthMeasurementResponse,
    type ManualHealthMeasurementFields,
    type ManualHealthMetricId,
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
    buildHealthSourceRecordId,
    HealthSourceRecordRevisionConflictError,
    replaceHealthSourceRecord,
    type HealthWriterDependencies,
} from './writer';

const MANUAL_HEALTH_ACCOUNT_ID = 'quantified-self-manual';
export const MANUAL_HEALTH_DELETIONS_COLLECTION_ID = 'manualHealthMeasurementDeletions';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID_PATTERN = /^[a-f0-9]{64}$/;
const EARLIEST_MANUAL_MEASUREMENT_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_TIMEZONE_OFFSET_SECONDS = 24 * 60 * 60;

const MANUAL_DATA_CLASSES = {
    [HEALTH_METRIC_IDS.BodyWeight]: DataWeight,
    [HEALTH_METRIC_IDS.Vo2Max]: DataVO2Max,
    [HEALTH_METRIC_IDS.BodyFat]: DataBodyFat,
    [HEALTH_METRIC_IDS.BloodPressureSystolic]: DataBloodPressureSystolic,
    [HEALTH_METRIC_IDS.BloodPressureDiastolic]: DataBloodPressureDiastolic,
    [HEALTH_METRIC_IDS.PulseRate]: DataPulseRate,
    [HEALTH_METRIC_IDS.MuscleMass]: DataMuscleMass,
    [HEALTH_METRIC_IDS.BodyWater]: DataBodyWater,
    [HEALTH_METRIC_IDS.BoneMass]: DataBoneMass,
    [HEALTH_METRIC_IDS.BloodOxygenSaturation]: DataBloodOxygenSaturation,
} as const;

function validatedValue(value: unknown, metricId: keyof typeof MANUAL_DATA_CLASSES): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0
        || value > MANUAL_HEALTH_VALUE_MAXIMUMS[metricId]
        || !new MANUAL_DATA_CLASSES[metricId](value).isValueTypeValid(value)) {
        throw new ManualHealthValidationError('Measurement value is outside the supported range.');
    }
    return value;
}

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
    const canonicalValue = validatedValue(raw.canonicalValue, raw.metricId);
    const observedAtMs = safeInteger(raw.observedAtMs, 'observedAtMs');
    if (observedAtMs < EARLIEST_MANUAL_MEASUREMENT_MS || observedAtMs > nowMs + MAX_FUTURE_SKEW_MS) {
        throw new ManualHealthValidationError('observedAtMs is outside the supported range.');
    }
    const timezoneOffsetSeconds = safeInteger(raw.timezoneOffsetSeconds, 'timezoneOffsetSeconds');
    if (Math.abs(timezoneOffsetSeconds) >= MAX_TIMEZONE_OFFSET_SECONDS) {
        throw new ManualHealthValidationError('timezoneOffsetSeconds is outside the supported range.');
    }
    if (raw.metricId !== HEALTH_METRIC_IDS.BloodPressureSystolic
        && (Object.prototype.hasOwnProperty.call(raw, 'diastolicValue') || Object.prototype.hasOwnProperty.call(raw, 'pulseValue'))) {
        throw new ManualHealthValidationError('Only blood pressure can include paired readings.');
    }
    if (raw.metricId !== HEALTH_METRIC_IDS.Vo2Max) {
        if (raw.vo2Context !== undefined || raw.vo2Method !== undefined) {
            throw new ManualHealthValidationError('Only VO2 measurements can include VO2 metadata.');
        }
        return {
            metricId: raw.metricId,
            canonicalValue,
            observedAtMs,
            timezoneOffsetSeconds,
            ...(raw.metricId === HEALTH_METRIC_IDS.BloodPressureSystolic ? {
                diastolicValue: validatedValue(raw.diastolicValue, HEALTH_METRIC_IDS.BloodPressureDiastolic),
                ...(Object.prototype.hasOwnProperty.call(raw, 'pulseValue') ? {
                    pulseValue: validatedValue(raw.pulseValue, HEALTH_METRIC_IDS.PulseRate),
                } : {}),
            } : {}),
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
            ['vo2Context', 'vo2Method', 'diastolicValue', 'pulseValue'],
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
            ['vo2Context', 'vo2Method', 'diastolicValue', 'pulseValue'],
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

function buildManualMetric(
    fields: ManualHealthMeasurementFields,
    metricId: keyof typeof MANUAL_DATA_CLASSES = fields.metricId,
    value = fields.canonicalValue,
): HealthMetricValue {
    const isVo2 = metricId === HEALTH_METRIC_IDS.Vo2Max;
    // Storage units follow the canonical catalog; UI units still come from Sports Lib.
    const unit = HEALTH_METRIC_CATALOG[metricId].canonicalUnit;
    const nativeMetric = MANUAL_DATA_CLASSES[metricId].type;
    const qualifiers = isVo2 ? { context: fields.vo2Context!, method: fields.vo2Method! } : undefined;
    return {
        kind: 'value',
        metricId,
        valueType: HEALTH_VALUE_TYPES.Number,
        aggregation: MANUAL_HEALTH_AGGREGATION,
        semanticVariant: isVo2 ? manualVo2SemanticVariant(fields.vo2Context!, fields.vo2Method!)
            : MANUAL_POINT_SEMANTIC_VARIANT,
        origin: HEALTH_VALUE_ORIGINS.Recorded,
        recordingMethod: HEALTH_RECORDING_METHODS.Manual,
        quality: { status: HEALTH_QUALITY_STATUSES.Valid },
        coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
        native: {
            metric: nativeMetric,
            value,
            unit,
            qualifiers,
        },
        canonical: { value, unit },
    };
}

function buildManualMetrics(fields: ManualHealthMeasurementFields): HealthMetricValue[] {
    const metrics = [buildManualMetric(fields)];
    if (fields.metricId === HEALTH_METRIC_IDS.BloodPressureSystolic) {
        metrics.push(buildManualMetric(fields, HEALTH_METRIC_IDS.BloodPressureDiastolic, fields.diastolicValue!));
        if (fields.pulseValue !== undefined) metrics.push(buildManualMetric(fields, HEALTH_METRIC_IDS.PulseRate, fields.pulseValue));
    }
    return metrics;
}

function encodeManualMetricForFirestore(metric: HealthMetricValue): HealthMetricValue {
    const encoded = encodeHealthMetricSportsLibData(metric);
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
        && Array.isArray(record.metrics)
        && manualRecordEntryMetric(record) !== null
        && record.metricIds.length === record.metrics.length
        && record.metrics.every(metric => record.metricIds.includes(metric.metricId)
            && metric.kind === 'value'
            && metric.aggregation === MANUAL_HEALTH_AGGREGATION
            && metric.origin === HEALTH_VALUE_ORIGINS.Recorded
            && metric.recordingMethod === HEALTH_RECORDING_METHODS.Manual);
}

function manualRecordEntryMetric(record: HealthSourceRecord): ManualHealthMetricId | null {
    const ids = record.metrics.map(metric => metric.metricId);
    if (new Set(ids).size !== ids.length) return null;
    if (ids.length === 1 && isManualHealthMetricId(ids[0])
        && ids[0] !== HEALTH_METRIC_IDS.BloodPressureSystolic) return ids[0];
    if ((ids.length === 2 || ids.length === 3)
        && ids.includes(HEALTH_METRIC_IDS.BloodPressureSystolic)
        && ids.includes(HEALTH_METRIC_IDS.BloodPressureDiastolic)
        && ids.every(id => manualHealthEntryMetric(id) === HEALTH_METRIC_IDS.BloodPressureSystolic)) {
        return HEALTH_METRIC_IDS.BloodPressureSystolic;
    }
    return null;
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
        if (manualRecordEntryMetric(existing) !== request.metricId) {
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
            metricIds: buildManualMetrics(request).map(metric => metric.metricId).sort(),
            metrics: buildManualMetrics(request).map(encodeManualMetricForFirestore),
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
    const db = dependencies.db || admin.firestore();
    const source = {
        provider: HEALTH_PROVIDERS.QuantifiedSelf,
        providerAccountId: MANUAL_HEALTH_ACCOUNT_ID,
        sourceRecordType: MANUAL_HEALTH_SOURCE_RECORD_TYPE,
        sourceRecordKey: request.clientMutationId,
    };
    const sourceRecordId = await buildHealthSourceRecordId(uid, source, dependencies.generateId);
    const deletionMarkerRef = db.collection('users').doc(uid)
        .collection(MANUAL_HEALTH_DELETIONS_COLLECTION_ID).doc(sourceRecordId);
    let result;
    try {
        result = await replaceHealthSourceRecord(uid, {
            ...source,
            revision: { order: 1, token: request.clientMutationId },
            // Keep idempotent retries byte-equivalent without trusting a client receipt timestamp.
            receivedAtMs: request.observedAtMs,
            kind: HEALTH_SOURCE_RECORD_KINDS.PointMeasurement,
            calendarDate: calendarDateAtOffset(request.observedAtMs, request.timezoneOffsetSeconds),
            startTimeMs: request.observedAtMs,
            endTimeMs: request.observedAtMs,
            timezoneOffsetSeconds: request.timezoneOffsetSeconds,
            metrics: buildManualMetrics(request),
            coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
            sampleSeries: [],
        }, nowMs, { ...dependencies, db, requiredMissingDocumentRef: deletionMarkerRef });
    } catch (error) {
        // A reused mutation UUID with different content is a client-visible conflict,
        // not an opaque writer failure. Exact retries still resolve as unchanged.
        if (error instanceof HealthSourceRecordRevisionConflictError) {
            throw new ManualHealthRevisionConflictError();
        }
        throw error;
    }
    if (result.status === 'skipped_lifecycle_guard') {
        throw new ManualHealthMeasurementNotFoundError();
    }
    if (result.status === 'skipped_deleted_user') {
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
        // Persist only the terminal outcome, atomically with deletion. The opaque
        // marker has no measurement data or TTL and follows recursive user cleanup.
        transaction.set(db.collection('users').doc(uid)
            .collection(MANUAL_HEALTH_DELETIONS_COLLECTION_ID).doc(request.sourceRecordId), { deleted: true });
        // Manual source records are permanent leaf documents and are accepted here only
        // when their validated sampleChunkIds array is empty.
        transaction.delete(ref);
        return { deleted: true };
    });
}
