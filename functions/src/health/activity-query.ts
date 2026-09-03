import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import {
    DataVO2Max,
    DataWeight,
} from '@sports-alliance/sports-lib';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import {
    ACTIVITY_HEALTH_INCOMPLETE_REASONS,
    ACTIVITY_HEALTH_SOURCE_KINDS,
    collapseConsecutiveWorkoutVo2Observations,
    isActivityHealthMetricId,
    type ActivityHealthMetricId,
    type ActivityHealthObservation,
    type ActivityHealthRangeRequest,
    type ActivityHealthRangeResult,
} from '../../../shared/activity-health';
import {
    HEALTH_METRIC_CATALOG,
    HEALTH_METRIC_IDS,
    HEALTH_PROVIDERS,
    type HealthProvider,
} from '../../../shared/health';
import { resolveTrainingDisciplineFromActivityType } from '../../../shared/training-disciplines';

export const ACTIVITY_HEALTH_QUERY_PAGE_SIZE = 128;
export const ACTIVITY_HEALTH_MAX_CANDIDATES = 2_048;
export const ACTIVITY_HEALTH_MAX_PROJECTED_OUTPUT_BYTES = 1024 * 1024;
export const ACTIVITY_HEALTH_MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const ACTIVITY_HEALTH_RESULT_ENVELOPE_RESERVE_BYTES = 512;

export const ACTIVITY_HEALTH_QUERY_PLANS = Object.freeze({
    [HEALTH_METRIC_IDS.BodyWeight]: Object.freeze({
        collectionId: 'events',
        timestampField: 'startDate',
        observationTimestampField: 'startDate',
        statisticField: `stats.${DataWeight.type}`,
        statisticKey: DataWeight.type,
        selectedFields: Object.freeze([
            'startDate',
            `stats.${DataWeight.type}`,
            'serviceName',
            'sourceServiceName',
            'creator.name',
            'creator.manufacturer',
            'creator.serialNumber',
        ]),
    }),
    [HEALTH_METRIC_IDS.Vo2Max]: Object.freeze({
        collectionId: 'activities',
        timestampField: 'startDate',
        observationTimestampField: 'startDate',
        statisticField: `stats.\`${DataVO2Max.type}\``,
        statisticKey: DataVO2Max.type,
        selectedFields: Object.freeze([
            'startDate',
            'type',
            `stats.\`${DataVO2Max.type}\``,
            'serviceName',
            'sourceServiceName',
            'creator.name',
            'creator.manufacturer',
            'creator.serialNumber',
        ]),
    }),
} satisfies Record<ActivityHealthMetricId, ActivityHealthQueryPlan>);

interface ActivityHealthQueryPlan {
    collectionId: 'events' | 'activities';
    timestampField: 'startDate';
    observationTimestampField: 'startDate';
    statisticField: string;
    statisticKey: string;
    selectedFields: readonly string[];
}

export interface ActivityHealthQueryPageDocument {
    id: string;
    data: Record<string, unknown>;
    cursor: unknown;
}

export interface ActivityHealthQueryPageRequest extends ActivityHealthQueryPlan {
    userID: string;
    startTimeMs: number;
    endTimeMs: number;
    cursor: unknown | null;
    fetchLimit: number;
}

export interface ActivityHealthQueryDependencies {
    db?: admin.firestore.Firestore;
    readPage?: (request: ActivityHealthQueryPageRequest) => Promise<ActivityHealthQueryPageDocument[]>;
    limits?: Partial<{
        pageSize: number;
        maxCandidates: number;
        maxProjectedOutputBytes: number;
    }>;
}

export class ActivityHealthQueryValidationError extends Error {
    public readonly name = 'ActivityHealthQueryValidationError';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function normalizeRequest(value: unknown): ActivityHealthRangeRequest {
    if (!isPlainObject(value)) {
        throw new ActivityHealthQueryValidationError('Health activity query must be an object.');
    }
    const keys = Object.keys(value).sort();
    const expectedKeys = ['endTimeMs', 'metricId', 'startTimeMs'];
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
        throw new ActivityHealthQueryValidationError('Health activity query has unknown or missing fields.');
    }
    if (!isActivityHealthMetricId(value.metricId)) {
        throw new ActivityHealthQueryValidationError('Unsupported Health activity metric.');
    }
    if (!Number.isSafeInteger(value.startTimeMs) || !Number.isSafeInteger(value.endTimeMs)) {
        throw new ActivityHealthQueryValidationError('Health activity timestamps must be integer milliseconds.');
    }
    const startTimeMs = value.startTimeMs as number;
    const endTimeMs = value.endTimeMs as number;
    if (startTimeMs < 0 || endTimeMs < startTimeMs) {
        throw new ActivityHealthQueryValidationError('Health activity timestamp range is invalid.');
    }
    if (endTimeMs - startTimeMs > ACTIVITY_HEALTH_MAX_RANGE_MS) {
        throw new ActivityHealthQueryValidationError('Health activity timestamp range is too large.');
    }
    return { metricId: value.metricId, startTimeMs, endTimeMs };
}

async function defaultReadPage(
    db: admin.firestore.Firestore,
    request: ActivityHealthQueryPageRequest,
): Promise<ActivityHealthQueryPageDocument[]> {
    const collection = db.collection('users').doc(request.userID).collection(request.collectionId);
    let query: admin.firestore.Query = collection
        .where(request.timestampField, '>=', request.startTimeMs)
        .where(request.timestampField, '<=', request.endTimeMs)
        .where(request.statisticField, '>', 0)
        .orderBy(request.timestampField, 'asc')
        .orderBy(request.statisticField, 'asc')
        .orderBy(FieldPath.documentId(), 'asc')
        .select(...request.selectedFields);
    if (request.cursor) {
        query = query.startAfter(request.cursor as admin.firestore.QueryDocumentSnapshot);
    }
    const snapshot = await query.limit(request.fetchLimit).get();
    return snapshot.docs.map(documentSnapshot => ({
        id: documentSnapshot.id,
        data: documentSnapshot.data(),
        cursor: documentSnapshot,
    }));
}

function nestedValue(data: Record<string, unknown>, dottedPath: string): unknown {
    return dottedPath.split('.').reduce<unknown>((current, field) => (
        isPlainObject(current) ? current[field] : undefined
    ), data);
}

function finitePositiveMetricValue(metricId: ActivityHealthMetricId, rawValue: unknown): number | null {
    const candidate = isPlainObject(rawValue) ? rawValue.value : rawValue;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) return null;
    const data = metricId === HEALTH_METRIC_IDS.BodyWeight
        ? new DataWeight(candidate)
        : new DataVO2Max(candidate);
    return data.isValueTypeValid(candidate) ? data.getValue() : null;
}

function timestampMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    if (value instanceof Date) {
        const timeMs = value.getTime();
        return Number.isSafeInteger(timeMs) && timeMs >= 0 ? timeMs : null;
    }
    if (value instanceof Timestamp) return value.toMillis();
    if (isPlainObject(value) && typeof value.toMillis === 'function') {
        const timeMs = (value.toMillis as () => unknown)();
        return typeof timeMs === 'number' && Number.isSafeInteger(timeMs) && timeMs >= 0 ? timeMs : null;
    }
    if (isPlainObject(value)
        && Number.isSafeInteger(value.seconds)
        && Number.isSafeInteger(value.nanoseconds)) {
        const timeMs = Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds) / 1_000_000);
        return Number.isSafeInteger(timeMs) && timeMs >= 0 ? timeMs : null;
    }
    return null;
}

function safeString(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, 256) : '';
}

function sourceValues(data: Record<string, unknown>): string[] {
    const creator = isPlainObject(data.creator) ? data.creator : {};
    return [
        safeString(data.sourceServiceName),
        safeString(data.serviceName),
        safeString(creator.manufacturer),
        safeString(creator.name),
        safeString(creator.serialNumber),
    ].filter(Boolean);
}

function providerFromSource(data: Record<string, unknown>): HealthProvider | null {
    // Preserve provenance priority: a recognized source service is more
    // authoritative than a lower-priority device manufacturer or name.
    for (const value of sourceValues(data)) {
        const normalized = value.toLowerCase();
        if (normalized.includes('garmin')) return HEALTH_PROVIDERS.GarminAPI;
        if (normalized.includes('suunto')) return HEALTH_PROVIDERS.SuuntoApp;
        if (normalized.includes('coros')) return HEALTH_PROVIDERS.COROSAPI;
        if (normalized.includes('wahoo')) return HEALTH_PROVIDERS.WahooAPI;
    }
    return null;
}

function digest(...values: readonly string[]): string {
    // JSON preserves part boundaries even when a persisted source string
    // contains delimiter characters.
    return createHash('sha256').update(JSON.stringify(values)).digest('base64url').slice(0, 32);
}

function projectDocument(
    userID: string,
    metricId: ActivityHealthMetricId,
    plan: ActivityHealthQueryPlan,
    document: ActivityHealthQueryPageDocument,
): ActivityHealthObservation | null {
    const observedAtMs = timestampMillis(
        document.data[plan.observationTimestampField] ?? document.data[plan.timestampField],
    );
    const value = finitePositiveMetricValue(metricId, nestedValue(document.data, `stats.${plan.statisticKey}`));
    if (observedAtMs === null || value === null) return null;

    const provider = providerFromSource(document.data);
    if (!provider) return null;
    const sourceSeed = sourceValues(document.data);
    const sourceAccountKey = `workout_${digest(userID, provider, ...sourceSeed)}`;
    const discipline = metricId === HEALTH_METRIC_IDS.Vo2Max
        ? resolveTrainingDisciplineFromActivityType(document.data.type) || 'other'
        : null;
    const semanticVariant = metricId === HEALTH_METRIC_IDS.BodyWeight
        ? ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutProfileContext
        : `${ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutImported}_${discipline}`;

    return {
        id: `workout_observation_${digest(userID, plan.collectionId, document.id, metricId)}`,
        metricId,
        observedAtMs,
        value,
        unit: HEALTH_METRIC_CATALOG[metricId].canonicalUnit,
        provider,
        sourceAccountKey,
        sourceKind: metricId === HEALTH_METRIC_IDS.BodyWeight
            ? ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutProfileContext
            : ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutImported,
        discipline,
        semanticVariant,
    };
}

function serializedUtf8Bytes(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function buildResult(
    observations: ActivityHealthObservation[],
    complete: boolean,
    incompleteReason: ActivityHealthRangeResult['incompleteReason'],
    candidateCount: number,
): ActivityHealthRangeResult {
    const projected = observations[0]?.metricId === HEALTH_METRIC_IDS.Vo2Max
        ? collapseConsecutiveWorkoutVo2Observations(observations)
        : observations;
    return {
        observations: projected,
        complete,
        incompleteReason,
        candidateCount,
        serializedBytes: serializedUtf8Bytes(projected),
    };
}

export async function readActivityHealthRange(
    userID: string,
    queryValue: unknown,
    dependencies: ActivityHealthQueryDependencies = {},
): Promise<ActivityHealthRangeResult> {
    const uid = `${userID || ''}`.trim();
    if (!uid) throw new ActivityHealthQueryValidationError('Authenticated user is required.');
    const request = normalizeRequest(queryValue);
    const plan = ACTIVITY_HEALTH_QUERY_PLANS[request.metricId];
    const db = dependencies.db || admin.firestore();
    const readPage = dependencies.readPage || (pageRequest => defaultReadPage(db, pageRequest));
    const pageSize = dependencies.limits?.pageSize || ACTIVITY_HEALTH_QUERY_PAGE_SIZE;
    const maxCandidates = dependencies.limits?.maxCandidates || ACTIVITY_HEALTH_MAX_CANDIDATES;
    const maxProjectedOutputBytes = dependencies.limits?.maxProjectedOutputBytes
        || ACTIVITY_HEALTH_MAX_PROJECTED_OUTPUT_BYTES;
    const observations: ActivityHealthObservation[] = [];
    let candidateCount = 0;
    let cursor: unknown | null = null;
    let observationBytes = 2;

    while (true) {
        const documents = await readPage({
            ...plan,
            userID: uid,
            startTimeMs: request.startTimeMs,
            endTimeMs: request.endTimeMs,
            cursor,
            fetchLimit: pageSize,
        });
        for (const document of documents) {
            if (candidateCount >= maxCandidates) {
                return buildResult(
                    observations,
                    false,
                    ACTIVITY_HEALTH_INCOMPLETE_REASONS.CandidateLimit,
                    candidateCount,
                );
            }
            candidateCount += 1;
            cursor = document.cursor;
            const observation = projectDocument(uid, request.metricId, plan, document);
            if (!observation
                || observation.observedAtMs < request.startTimeMs
                || observation.observedAtMs > request.endTimeMs) continue;
            const nextObservationBytes = serializedUtf8Bytes(observation) + (observations.length > 0 ? 1 : 0);
            if (observationBytes + nextObservationBytes + ACTIVITY_HEALTH_RESULT_ENVELOPE_RESERVE_BYTES
                > maxProjectedOutputBytes) {
                return buildResult(
                    observations,
                    false,
                    ACTIVITY_HEALTH_INCOMPLETE_REASONS.SerializedBytes,
                    candidateCount,
                );
            }
            observations.push(observation);
            observationBytes += nextObservationBytes;
        }

        if (documents.length < pageSize) {
            return buildResult(observations, true, null, candidateCount);
        }
        if (candidateCount >= maxCandidates || !cursor) {
            return buildResult(
                observations,
                false,
                ACTIVITY_HEALTH_INCOMPLETE_REASONS.CandidateLimit,
                candidateCount,
            );
        }
    }
}
