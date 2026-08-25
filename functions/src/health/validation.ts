import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_MAX_METRICS_PER_SOURCE_RECORD,
    HEALTH_MAX_SAMPLE_CHUNKS_PER_SOURCE_RECORD,
    HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK,
    HEALTH_MAX_WRITE_BYTES,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_SOURCE_RECORD_KINDS,
    HEALTH_SLEEP_REFERENCE_FIELDS,
    HEALTH_SLEEP_REFERENCE_METRIC_IDS,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
    HealthCoverage,
    HealthDeviceAttribution,
    HealthMetricEntry,
    HealthMetricGoal,
    HealthMetricId,
    HealthProvider,
    HealthQuality,
    HealthSourceRecordKind,
    HealthRecordingMethod,
    HealthScalar,
    HealthUnit,
    HealthValueOrigin,
    HealthValueType,
    getHealthMetricDefinition,
    isHealthMetricId,
    isHealthProvider,
} from '../../../shared/health';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_ACCOUNT_ID_LENGTH = 512;
const MAX_SOURCE_KEY_LENGTH = 512;
const MAX_LABEL_LENGTH = 128;
const MAX_NATIVE_VALUE_LENGTH = 512;
const MAX_QUALIFIERS = 16;
const MAX_SAMPLE_POINTS_PER_SOURCE_RECORD = HEALTH_MAX_SAMPLE_CHUNKS_PER_SOURCE_RECORD
    * HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK;
const RESERVED_QUALIFIER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class HealthWriteValidationError extends Error {
    public readonly name: string = 'HealthWriteValidationError';
    public readonly code = 'invalid_health_write';

    constructor(message: string) {
        super(message);
    }
}

export class HealthWriteSizeError extends HealthWriteValidationError {
    public readonly name = 'HealthWriteSizeError';
}

class HealthWriteUtf8Budget {
    private consumedBytes = 0;

    public addJsonValue(value: unknown): void {
        this.addSerializedValue(value, 0);
    }

    public addJsonCollectionValue(value: unknown, index: number): void {
        this.addSerializedValue(value, index > 0 ? 1 : 0);
    }

    private addSerializedValue(value: unknown, separatorBytes: number): void {
        let serialized: string | undefined;
        try {
            serialized = JSON.stringify(value);
        } catch {
            throw new HealthWriteSizeError(
                'Health source-record input could not be serialized for cumulative JSON UTF-8 validation.',
            );
        }
        if (typeof serialized !== 'string') {
            throw new HealthWriteSizeError(
                'Health source-record input could not be serialized for cumulative JSON UTF-8 validation.',
            );
        }
        const nextBytes = this.consumedBytes + separatorBytes + Buffer.byteLength(serialized, 'utf8');
        if (nextBytes > HEALTH_MAX_WRITE_BYTES) {
            throw new HealthWriteSizeError(
                'Health source-record input exceeds the cumulative JSON UTF-8 budget.',
            );
        }
        this.consumedBytes = nextBytes;
    }
}

export interface HealthSourceRevisionInput {
    order: number;
    token: string;
}

export interface HealthSampleSeriesInput {
    seriesKey: string;
    metricId: HealthMetricId;
    valueType: HealthValueType;
    aggregation: string;
    semanticVariant: string;
    origin: HealthValueOrigin;
    recordingMethod: HealthRecordingMethod;
    normalizationStatus: 'canonical' | 'native_only' | 'not_comparable';
    nativeMetric: string;
    nativeUnit?: string | null;
    canonicalUnit?: HealthUnit | null;
    offsetMs: number[];
    nativeValues: HealthScalar[];
    canonicalValues?: HealthScalar[] | null;
    qualityCodes?: string[] | null;
    coverage: HealthCoverage;
    device?: HealthDeviceAttribution | null;
}

export interface HealthSourceRecordInput {
    provider: HealthProvider;
    providerAccountId: string;
    sourceRecordType: string;
    sourceRecordKey: string;
    revision: HealthSourceRevisionInput;
    receivedAtMs: number;
    kind: HealthSourceRecordKind;
    calendarDate: string;
    startTimeMs: number;
    endTimeMs: number;
    timezoneOffsetSeconds?: number | null;
    metrics: HealthMetricEntry[];
    coverage: HealthCoverage;
    device?: HealthDeviceAttribution | null;
    sampleSeries: HealthSampleSeriesInput[];
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new HealthWriteValidationError(`${field} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function boundedString(value: unknown, field: string, maximum: number, allowEmpty = false): string {
    if (typeof value !== 'string') {
        throw new HealthWriteValidationError(`${field} must be a string.`);
    }
    if (value.length > maximum) {
        throw new HealthWriteValidationError(`${field} must be a bounded non-empty string.`);
    }
    const normalized = value.trim();
    if ((!allowEmpty && normalized.length === 0) || normalized.length > maximum) {
        throw new HealthWriteValidationError(`${field} must be a bounded non-empty string.`);
    }
    return normalized;
}

function nullableBoundedString(value: unknown, field: string, maximum: number): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return boundedString(value, field, maximum);
}

function safeDocumentId(value: unknown, field: string): string {
    const documentId = boundedString(value, field, 128);
    if (!SAFE_DOCUMENT_ID_PATTERN.test(documentId)) {
        throw new HealthWriteValidationError(`${field} must be a safe bounded document ID.`);
    }
    return documentId;
}

function finiteNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new HealthWriteValidationError(`${field} must be a finite number.`);
    }
    return value;
}

function safeInteger(value: unknown, field: string): number {
    const normalized = finiteNumber(value, field);
    if (!Number.isSafeInteger(normalized)) {
        throw new HealthWriteValidationError(`${field} must be a safe integer.`);
    }
    return normalized;
}

function nullableNonNegativeNumber(value: unknown, field: string): number | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    const normalized = finiteNumber(value, field);
    if (normalized < 0) {
        throw new HealthWriteValidationError(`${field} cannot be negative.`);
    }
    return normalized;
}

function nullableNonNegativeSafeInteger(value: unknown, field: string): number | null | undefined {
    if (value === undefined || value === null) {
        return value as null | undefined;
    }
    const normalized = safeInteger(value, field);
    if (normalized < 0) {
        throw new HealthWriteValidationError(`${field} cannot be negative.`);
    }
    return normalized;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new HealthWriteValidationError(`${field} is not supported.`);
    }
    return value as T;
}

function validateCalendarDate(value: unknown): string {
    const calendarDate = boundedString(value, 'calendarDate', 10);
    const timestamp = Date.parse(`${calendarDate}T00:00:00.000Z`);
    if (!ISO_DATE_PATTERN.test(calendarDate)
        || !Number.isFinite(timestamp)
        || new Date(timestamp).toISOString().slice(0, 10) !== calendarDate) {
        throw new HealthWriteValidationError('calendarDate must be a valid YYYY-MM-DD date.');
    }
    return calendarDate;
}

function validateScalar(value: unknown, valueType: HealthValueType, field: string): HealthScalar {
    if (valueType === HEALTH_VALUE_TYPES.Number) {
        return finiteNumber(value, field);
    }
    if (valueType === HEALTH_VALUE_TYPES.Boolean) {
        if (typeof value !== 'boolean') {
            throw new HealthWriteValidationError(`${field} must be a boolean.`);
        }
        return value;
    }
    return boundedString(value, field, MAX_NATIVE_VALUE_LENGTH);
}

function validateDevice(value: unknown, field: string): HealthDeviceAttribution | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    const input = objectValue(value, field);
    return {
        deviceKey: nullableBoundedString(input.deviceKey, `${field}.deviceKey`, MAX_LABEL_LENGTH),
        manufacturer: nullableBoundedString(input.manufacturer, `${field}.manufacturer`, MAX_LABEL_LENGTH),
        model: nullableBoundedString(input.model, `${field}.model`, MAX_LABEL_LENGTH),
        displayName: nullableBoundedString(input.displayName, `${field}.displayName`, MAX_LABEL_LENGTH),
    };
}

function validateQuality(value: unknown, field: string): HealthQuality {
    const input = objectValue(value, field);
    return {
        status: enumValue(input.status, Object.values(HEALTH_QUALITY_STATUSES), `${field}.status`),
        nativeCode: nullableBoundedString(input.nativeCode, `${field}.nativeCode`, MAX_LABEL_LENGTH),
    };
}

function validateCoverage(value: unknown, field: string): HealthCoverage {
    const input = objectValue(value, field);
    const coverage: HealthCoverage = {
        status: enumValue(input.status, Object.values(HEALTH_COVERAGE_STATUSES), `${field}.status`),
        expectedStartTimeMs: nullableNonNegativeSafeInteger(input.expectedStartTimeMs, `${field}.expectedStartTimeMs`),
        expectedEndTimeMs: nullableNonNegativeSafeInteger(input.expectedEndTimeMs, `${field}.expectedEndTimeMs`),
        observedDurationSeconds: nullableNonNegativeNumber(input.observedDurationSeconds, `${field}.observedDurationSeconds`),
        expectedDurationSeconds: nullableNonNegativeNumber(input.expectedDurationSeconds, `${field}.expectedDurationSeconds`),
        sampleCount: nullableNonNegativeSafeInteger(input.sampleCount, `${field}.sampleCount`),
        expectedSampleCount: nullableNonNegativeSafeInteger(input.expectedSampleCount, `${field}.expectedSampleCount`),
        expectedUpdateIntervalMs: nullableNonNegativeSafeInteger(input.expectedUpdateIntervalMs, `${field}.expectedUpdateIntervalMs`),
    };
    if (typeof coverage.expectedStartTimeMs === 'number'
        && typeof coverage.expectedEndTimeMs === 'number'
        && coverage.expectedEndTimeMs < coverage.expectedStartTimeMs) {
        throw new HealthWriteValidationError(`${field}.expectedEndTimeMs must be on or after expectedStartTimeMs.`);
    }
    return coverage;
}

function validateMetricIdentity(input: Record<string, unknown>, field: string): {
    metricId: HealthMetricId;
    valueType: HealthValueType;
    aggregation: string;
    semanticVariant: string;
    origin: HealthValueOrigin;
    recordingMethod: HealthRecordingMethod;
} {
    if (!isHealthMetricId(input.metricId)) {
        throw new HealthWriteValidationError(`${field}.metricId is not supported.`);
    }
    const definition = getHealthMetricDefinition(input.metricId);
    const valueType = enumValue(input.valueType, Object.values(HEALTH_VALUE_TYPES), `${field}.valueType`);
    if (valueType !== definition.valueType) {
        throw new HealthWriteValidationError(`${field}.valueType must match the metric catalog.`);
    }
    return {
        metricId: input.metricId,
        valueType,
        aggregation: boundedString(input.aggregation, `${field}.aggregation`, MAX_LABEL_LENGTH),
        semanticVariant: boundedString(input.semanticVariant, `${field}.semanticVariant`, MAX_LABEL_LENGTH),
        origin: enumValue(input.origin, Object.values(HEALTH_VALUE_ORIGINS), `${field}.origin`),
        recordingMethod: enumValue(input.recordingMethod, Object.values(HEALTH_RECORDING_METHODS), `${field}.recordingMethod`),
    };
}

function validateQualifiers(value: unknown, field: string): Record<string, string | number | boolean | null> | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    const input = objectValue(value, field);
    const entries = Object.entries(input);
    if (entries.length > MAX_QUALIFIERS) {
        throw new HealthWriteValidationError(`${field} contains too many qualifiers.`);
    }
    return entries.reduce<Record<string, string | number | boolean | null>>((result, [key, item]) => {
        const normalizedKey = boundedString(key, `${field} key`, MAX_LABEL_LENGTH);
        if (RESERVED_QUALIFIER_KEYS.has(normalizedKey)) {
            throw new HealthWriteValidationError(`${field} contains a reserved qualifier key.`);
        }
        if (Object.prototype.hasOwnProperty.call(result, normalizedKey)) {
            throw new HealthWriteValidationError(`${field} contains duplicate normalized qualifier keys.`);
        }
        if (item === null || typeof item === 'boolean') {
            result[normalizedKey] = item;
        } else if (typeof item === 'number') {
            result[normalizedKey] = finiteNumber(item, `${field}.${normalizedKey}`);
        } else {
            result[normalizedKey] = boundedString(item, `${field}.${normalizedKey}`, MAX_NATIVE_VALUE_LENGTH, true);
        }
        return result;
    }, {});
}

function validateGoal(
    value: unknown,
    metricId: HealthMetricId,
    valueType: HealthValueType,
    field: string,
): HealthMetricGoal | null | undefined {
    if (value === undefined || value === null) {
        return value as null | undefined;
    }
    const input = objectValue(value, field);
    let native: HealthMetricGoal['native'];
    if (input.native === null) {
        native = null;
    } else if (input.native !== undefined) {
        const nativeInput = objectValue(input.native, `${field}.native`);
        native = {
            metric: boundedString(nativeInput.metric, `${field}.native.metric`, MAX_LABEL_LENGTH),
            value: validateScalar(nativeInput.value, valueType, `${field}.native.value`),
            unit: nullableBoundedString(nativeInput.unit, `${field}.native.unit`, MAX_LABEL_LENGTH),
            qualifiers: validateQualifiers(nativeInput.qualifiers, `${field}.native.qualifiers`),
        };
    }
    let canonical: HealthMetricGoal['canonical'];
    if (input.canonical === null) {
        canonical = null;
    } else if (input.canonical !== undefined) {
        const canonicalInput = objectValue(input.canonical, `${field}.canonical`);
        const unit = enumValue(canonicalInput.unit, Object.values(HEALTH_UNITS), `${field}.canonical.unit`);
        if (unit !== getHealthMetricDefinition(metricId).canonicalUnit) {
            throw new HealthWriteValidationError(`${field}.canonical.unit must match the metric catalog.`);
        }
        canonical = {
            value: validateScalar(canonicalInput.value, valueType, `${field}.canonical.value`),
            unit,
        };
    }
    if (!native && !canonical) {
        throw new HealthWriteValidationError(`${field} must contain a native or canonical goal.`);
    }
    return { native, canonical };
}

function validateMetricEntry(value: unknown, index: number): HealthMetricEntry {
    const field = `metrics[${index}]`;
    const input = objectValue(value, field);
    const identity = validateMetricIdentity(input, field);
    const common = {
        ...identity,
        quality: validateQuality(input.quality, `${field}.quality`),
        coverage: input.coverage === undefined || input.coverage === null
            ? input.coverage as null | undefined
            : validateCoverage(input.coverage, `${field}.coverage`),
        device: validateDevice(input.device, `${field}.device`),
    };

    if (input.kind === 'sleep_reference') {
        const reference = objectValue(input.reference, `${field}.reference`);
        if (reference.domain !== 'sleep') {
            throw new HealthWriteValidationError(`${field}.reference.domain must be sleep.`);
        }
        const referenceField = enumValue(
            reference.field,
            Object.values(HEALTH_SLEEP_REFERENCE_FIELDS),
            `${field}.reference.field`,
        );
        if (!HEALTH_SLEEP_REFERENCE_METRIC_IDS[referenceField].includes(identity.metricId)) {
            throw new HealthWriteValidationError(`${field}.metricId does not match the referenced sleep field.`);
        }
        return {
            ...common,
            kind: 'sleep_reference',
            reference: {
                domain: 'sleep',
                documentId: safeDocumentId(reference.documentId, `${field}.reference.documentId`),
                field: referenceField,
            },
        };
    }

    if (input.kind !== 'value') {
        throw new HealthWriteValidationError(`${field}.kind is not supported.`);
    }
    const normalizationStatus = enumValue(
        input.normalizationStatus,
        Object.values(HEALTH_NORMALIZATION_STATUSES),
        `${field}.normalizationStatus`,
    );
    const nativeInput = objectValue(input.native, `${field}.native`);
    const native = {
        metric: boundedString(nativeInput.metric, `${field}.native.metric`, MAX_LABEL_LENGTH),
        value: validateScalar(nativeInput.value, identity.valueType, `${field}.native.value`),
        unit: nullableBoundedString(nativeInput.unit, `${field}.native.unit`, MAX_LABEL_LENGTH),
        qualifiers: validateQualifiers(nativeInput.qualifiers, `${field}.native.qualifiers`),
    };
    let canonical = null;
    if (input.canonical !== undefined && input.canonical !== null) {
        const canonicalInput = objectValue(input.canonical, `${field}.canonical`);
        const canonicalUnit = enumValue(canonicalInput.unit, Object.values(HEALTH_UNITS), `${field}.canonical.unit`);
        if (canonicalUnit !== getHealthMetricDefinition(identity.metricId).canonicalUnit) {
            throw new HealthWriteValidationError(`${field}.canonical.unit must match the metric catalog.`);
        }
        canonical = {
            value: validateScalar(canonicalInput.value, identity.valueType, `${field}.canonical.value`),
            unit: canonicalUnit,
        };
    }
    if (normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical && !canonical) {
        throw new HealthWriteValidationError(`${field}.canonical is required for canonical values.`);
    }
    if (normalizationStatus !== HEALTH_NORMALIZATION_STATUSES.Canonical && canonical) {
        throw new HealthWriteValidationError(`${field}.canonical must be omitted for non-canonical values.`);
    }

    return {
        ...common,
        kind: 'value',
        normalizationStatus,
        native,
        canonical,
        goal: validateGoal(input.goal, identity.metricId, identity.valueType, `${field}.goal`),
    };
}

function validateSampleSeries(
    value: unknown,
    index: number,
    sourceRecordDurationMs: number,
    writeBudget: HealthWriteUtf8Budget,
): HealthSampleSeriesInput {
    const field = `sampleSeries[${index}]`;
    const input = objectValue(value, field);
    const identity = validateMetricIdentity(input, field);
    const normalizationStatus = enumValue(
        input.normalizationStatus,
        Object.values(HEALTH_NORMALIZATION_STATUSES),
        `${field}.normalizationStatus`,
    );
    const canonicalUnit = input.canonicalUnit === undefined || input.canonicalUnit === null
        ? input.canonicalUnit as null | undefined
        : enumValue(input.canonicalUnit, Object.values(HEALTH_UNITS), `${field}.canonicalUnit`);
    if (normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical
        && canonicalUnit !== getHealthMetricDefinition(identity.metricId).canonicalUnit) {
        throw new HealthWriteValidationError(`${field}.canonicalUnit must match the metric catalog.`);
    }
    if (normalizationStatus !== HEALTH_NORMALIZATION_STATUSES.Canonical && canonicalUnit) {
        throw new HealthWriteValidationError(`${field}.canonicalUnit must be omitted for non-canonical samples.`);
    }
    if (!Array.isArray(input.offsetMs)
        || input.offsetMs.length === 0
        || input.offsetMs.length > MAX_SAMPLE_POINTS_PER_SOURCE_RECORD) {
        throw new HealthWriteValidationError(`${field}.offsetMs must contain a bounded set of sample offsets.`);
    }
    const pointCount = input.offsetMs.length;
    if (!Array.isArray(input.nativeValues) || input.nativeValues.length !== pointCount) {
        throw new HealthWriteValidationError(`${field}.nativeValues must align with offsetMs.`);
    }
    let canonicalValueInput: unknown[] | null | undefined;
    let canonicalValues: HealthScalar[] | null | undefined;
    if (input.canonicalValues === null) {
        canonicalValueInput = null;
        canonicalValues = null;
    } else if (input.canonicalValues !== undefined) {
        if (!Array.isArray(input.canonicalValues) || input.canonicalValues.length !== pointCount) {
            throw new HealthWriteValidationError(`${field}.canonicalValues must align with offsetMs.`);
        }
        canonicalValueInput = input.canonicalValues;
        canonicalValues = [];
    }
    if (normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical && !canonicalValueInput) {
        throw new HealthWriteValidationError(`${field}.canonicalValues are required for canonical samples.`);
    }
    if (normalizationStatus !== HEALTH_NORMALIZATION_STATUSES.Canonical && Array.isArray(canonicalValueInput)) {
        throw new HealthWriteValidationError(`${field}.canonicalValues must be omitted for non-canonical samples.`);
    }
    let qualityCodeInput: unknown[] | null | undefined;
    let qualityCodes: string[] | null | undefined;
    if (input.qualityCodes === null) {
        qualityCodeInput = null;
        qualityCodes = null;
    } else if (input.qualityCodes !== undefined) {
        if (!Array.isArray(input.qualityCodes) || input.qualityCodes.length !== pointCount) {
            throw new HealthWriteValidationError(`${field}.qualityCodes must align with offsetMs.`);
        }
        qualityCodeInput = input.qualityCodes;
        qualityCodes = [];
    }
    const coverage = validateCoverage(input.coverage, `${field}.coverage`);
    const common = {
        ...identity,
        seriesKey: boundedString(input.seriesKey, `${field}.seriesKey`, MAX_LABEL_LENGTH),
        normalizationStatus,
        nativeMetric: boundedString(input.nativeMetric, `${field}.nativeMetric`, MAX_LABEL_LENGTH),
        nativeUnit: nullableBoundedString(input.nativeUnit, `${field}.nativeUnit`, MAX_LABEL_LENGTH),
        canonicalUnit,
        coverage: { ...coverage, sampleCount: pointCount },
        device: validateDevice(input.device, `${field}.device`),
    };
    writeBudget.addJsonCollectionValue({
        ...common,
        offsetMs: [],
        nativeValues: [],
        canonicalValues,
        qualityCodes,
    }, index);

    const offsetMs: number[] = [];
    const nativeValues: HealthScalar[] = [];
    let previousOffsetMs = -1;
    for (let itemIndex = 0; itemIndex < pointCount; itemIndex += 1) {
        const offset = safeInteger(input.offsetMs[itemIndex], `${field}.offsetMs[${itemIndex}]`);
        if (offset < 0 || offset > sourceRecordDurationMs) {
            throw new HealthWriteValidationError(`${field}.offsetMs[${itemIndex}] is outside the source-record interval.`);
        }
        if (itemIndex > 0 && offset <= previousOffsetMs) {
            throw new HealthWriteValidationError(`${field}.offsetMs must be strictly increasing.`);
        }
        const rawNativeValue = input.nativeValues[itemIndex];
        const nativeValue = validateScalar(
            rawNativeValue,
            identity.valueType,
            `${field}.nativeValues[${itemIndex}]`,
        );
        const rawCanonicalValue = canonicalValueInput?.[itemIndex];
        const canonicalValue = canonicalValueInput
            ? validateScalar(
                rawCanonicalValue,
                identity.valueType,
                `${field}.canonicalValues[${itemIndex}]`,
            )
            : undefined;
        const rawQualityCode = qualityCodeInput?.[itemIndex];
        const qualityCode = qualityCodeInput
            ? boundedString(
                rawQualityCode,
                `${field}.qualityCodes[${itemIndex}]`,
                MAX_LABEL_LENGTH,
            )
            : undefined;

        writeBudget.addJsonCollectionValue(offset, itemIndex);
        writeBudget.addJsonCollectionValue(
            typeof rawNativeValue === 'string' ? rawNativeValue : nativeValue,
            itemIndex,
        );
        if (canonicalValueInput) {
            writeBudget.addJsonCollectionValue(
                typeof rawCanonicalValue === 'string' ? rawCanonicalValue : canonicalValue,
                itemIndex,
            );
        }
        if (qualityCodeInput) {
            writeBudget.addJsonCollectionValue(rawQualityCode, itemIndex);
        }

        previousOffsetMs = offset;
        offsetMs.push(offset);
        nativeValues.push(nativeValue);
        if (canonicalValueInput) {
            (canonicalValues as HealthScalar[]).push(canonicalValue as HealthScalar);
        }
        if (qualityCodeInput) {
            (qualityCodes as string[]).push(qualityCode as string);
        }
    }

    if (typeof coverage.sampleCount === 'number' && coverage.sampleCount !== pointCount) {
        throw new HealthWriteValidationError(`${field}.coverage.sampleCount must match the aligned sample arrays.`);
    }

    return {
        ...common,
        offsetMs,
        nativeValues,
        canonicalValues,
        qualityCodes,
    };
}

export function validateHealthSourceRecordInput(value: unknown): HealthSourceRecordInput {
    const input = objectValue(value, 'healthSourceRecord');
    if (!isHealthProvider(input.provider)) {
        throw new HealthWriteValidationError('provider is not supported.');
    }
    const startTimeMs = safeInteger(input.startTimeMs, 'startTimeMs');
    const endTimeMs = safeInteger(input.endTimeMs, 'endTimeMs');
    if (endTimeMs < startTimeMs) {
        throw new HealthWriteValidationError('endTimeMs must be on or after startTimeMs.');
    }
    if (!Array.isArray(input.metrics) || input.metrics.length > HEALTH_MAX_METRICS_PER_SOURCE_RECORD) {
        throw new HealthWriteValidationError(
            `metrics must contain at most ${HEALTH_MAX_METRICS_PER_SOURCE_RECORD} entries.`,
        );
    }
    const writeBudget = new HealthWriteUtf8Budget();
    const metrics: HealthMetricEntry[] = [];
    for (let index = 0; index < input.metrics.length; index += 1) {
        const metric = validateMetricEntry(input.metrics[index], index);
        writeBudget.addJsonCollectionValue(metric, index);
        metrics.push(metric);
    }
    const rawSampleSeries = input.sampleSeries === undefined ? [] : input.sampleSeries;
    if (!Array.isArray(rawSampleSeries)) {
        throw new HealthWriteValidationError('sampleSeries must be an array.');
    }
    if (rawSampleSeries.length > HEALTH_MAX_SAMPLE_CHUNKS_PER_SOURCE_RECORD) {
        throw new HealthWriteValidationError(
            `sampleSeries cannot contain more than ${HEALTH_MAX_SAMPLE_CHUNKS_PER_SOURCE_RECORD} series.`,
        );
    }
    const sampleSeries: HealthSampleSeriesInput[] = [];
    let sampleChunkCount = 0;
    for (let index = 0; index < rawSampleSeries.length; index += 1) {
        const validatedSeries = validateSampleSeries(
            rawSampleSeries[index],
            index,
            endTimeMs - startTimeMs,
            writeBudget,
        );
        sampleChunkCount += Math.ceil(validatedSeries.offsetMs.length / HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK);
        if (sampleChunkCount > HEALTH_MAX_SAMPLE_CHUNKS_PER_SOURCE_RECORD) {
            throw new HealthWriteValidationError(
                `sampleSeries exceeds the ${HEALTH_MAX_SAMPLE_CHUNKS_PER_SOURCE_RECORD}-chunk source-record limit.`,
            );
        }
        sampleSeries.push(validatedSeries);
    }
    const seriesKeys = new Set(sampleSeries.map(series => series.seriesKey));
    if (seriesKeys.size !== sampleSeries.length) {
        throw new HealthWriteValidationError('sampleSeries seriesKey values must be unique per source record.');
    }
    if (metrics.length === 0 && sampleSeries.length === 0) {
        throw new HealthWriteValidationError('A health source record must contain metrics or sampleSeries.');
    }
    const revision = objectValue(input.revision, 'revision');
    const revisionOrder = safeInteger(revision.order, 'revision.order');
    if (revisionOrder < 0) {
        throw new HealthWriteValidationError('revision.order cannot be negative.');
    }
    let timezoneOffsetSeconds: number | null | undefined;
    if (input.timezoneOffsetSeconds === null) {
        timezoneOffsetSeconds = null;
    } else if (input.timezoneOffsetSeconds !== undefined) {
        timezoneOffsetSeconds = safeInteger(input.timezoneOffsetSeconds, 'timezoneOffsetSeconds');
        if (Math.abs(timezoneOffsetSeconds) > 18 * 60 * 60) {
            throw new HealthWriteValidationError('timezoneOffsetSeconds is outside the supported range.');
        }
    }
    const providerAccountId = boundedString(input.providerAccountId, 'providerAccountId', MAX_ACCOUNT_ID_LENGTH);
    const sourceRecordKey = boundedString(input.sourceRecordKey, 'sourceRecordKey', MAX_SOURCE_KEY_LENGTH);
    const result: HealthSourceRecordInput = {
        provider: input.provider,
        providerAccountId,
        sourceRecordType: boundedString(input.sourceRecordType, 'sourceRecordType', MAX_LABEL_LENGTH),
        sourceRecordKey,
        revision: {
            order: revisionOrder,
            token: boundedString(revision.token, 'revision.token', MAX_SOURCE_KEY_LENGTH),
        },
        receivedAtMs: (() => {
            const receivedAtMs = safeInteger(input.receivedAtMs, 'receivedAtMs');
            if (receivedAtMs < 0) {
                throw new HealthWriteValidationError('receivedAtMs cannot be negative.');
            }
            return receivedAtMs;
        })(),
        kind: enumValue(input.kind, Object.values(HEALTH_SOURCE_RECORD_KINDS), 'kind'),
        calendarDate: validateCalendarDate(input.calendarDate),
        startTimeMs,
        endTimeMs,
        timezoneOffsetSeconds,
        metrics,
        coverage: validateCoverage(input.coverage, 'coverage'),
        device: validateDevice(input.device, 'device'),
        sampleSeries,
    };
    writeBudget.addJsonValue({
        ...result,
        metrics: [],
        sampleSeries: [],
    });
    return result;
}
