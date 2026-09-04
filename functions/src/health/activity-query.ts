import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import {
    DataVO2Max,
    DataWeight,
    ServiceNames,
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
const VO2_MAX_STATISTIC_FIELD = new FieldPath('stats', DataVO2Max.type);

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
        statisticField: VO2_MAX_STATISTIC_FIELD,
        statisticKey: DataVO2Max.type,
        selectedFields: Object.freeze([
            'startDate',
            'type',
            VO2_MAX_STATISTIC_FIELD,
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
    statisticField: string | FieldPath;
    statisticKey: string;
    selectedFields: readonly (string | FieldPath)[];
}

export interface ActivityHealthQueryPageDocument {
    id: string;
    data: Record<string, unknown>;
    cursor: unknown;
    trustedProviderMetadata?: ActivityHealthTrustedProviderMetadata;
}

export type ActivityHealthTrustedProviderMetadata =
    | {
        status: 'resolved';
        provider: HealthProvider;
        sourceAccountSeed: readonly string[];
    }
    | {
        status: 'ambiguous';
    };

export interface ActivityHealthProviderMetadataReadRequest {
    userID: string;
    documents: readonly ActivityHealthQueryPageDocument[];
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
    readProviderMetadata?: (
        request: ActivityHealthProviderMetadataReadRequest,
    ) => Promise<ReadonlyMap<string, ActivityHealthTrustedProviderMetadata>>;
    limits?: Partial<{
        pageSize: number;
        maxCandidates: number;
        maxProjectedOutputBytes: number;
    }>;
}

const EVENT_PROVIDER_METADATA = Object.freeze([
    { documentID: ServiceNames.GarminAPI, provider: HEALTH_PROVIDERS.GarminAPI },
    { documentID: ServiceNames.SuuntoApp, provider: HEALTH_PROVIDERS.SuuntoApp },
    { documentID: ServiceNames.COROSAPI, provider: HEALTH_PROVIDERS.COROSAPI },
    { documentID: ServiceNames.WahooAPI, provider: HEALTH_PROVIDERS.WahooAPI },
] satisfies readonly { documentID: string; provider: HealthProvider }[]);
const EVENT_PROVIDER_ACCOUNT_FIELDS = Object.freeze([
    'userID',
    'serviceUserID',
    'serviceUserName',
    'serviceOpenId',
]);
const EVENT_PROVIDER_METADATA_READ_BATCH_SIZE = 512;
const EVENT_PROVIDER_METADATA_FIELD_MASK = Object.freeze([
    'serviceName',
    ...EVENT_PROVIDER_ACCOUNT_FIELDS,
]);

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

function safeMetadataIdentifier(value: unknown): string {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return `${value}`;
    return safeString(value);
}

function providerFromValues(values: readonly string[]): HealthProvider | null {
    for (const value of values) {
        const normalized = value.toLowerCase();
        if (normalized.includes('garmin')) return HEALTH_PROVIDERS.GarminAPI;
        if (normalized.includes('suunto')) return HEALTH_PROVIDERS.SuuntoApp;
        if (normalized.includes('coros')) return HEALTH_PROVIDERS.COROSAPI;
        if (normalized.includes('wahoo')) return HEALTH_PROVIDERS.WahooAPI;
    }
    return null;
}

function explicitServiceValues(data: Record<string, unknown>): string[] {
    return [safeString(data.sourceServiceName), safeString(data.serviceName)].filter(Boolean);
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

function providerSource(document: ActivityHealthQueryPageDocument): {
    provider: HealthProvider;
    sourceAccountSeed: readonly string[];
} | null {
    const explicitProvider = providerFromValues(explicitServiceValues(document.data));
    if (explicitProvider) {
        return { provider: explicitProvider, sourceAccountSeed: sourceValues(document.data) };
    }

    if (document.trustedProviderMetadata?.status === 'resolved') {
        return {
            provider: document.trustedProviderMetadata.provider,
            sourceAccountSeed: document.trustedProviderMetadata.sourceAccountSeed,
        };
    }
    if (document.trustedProviderMetadata?.status === 'ambiguous') return null;

    const creator = isPlainObject(document.data.creator) ? document.data.creator : {};
    const creatorValues = [
        safeString(creator.manufacturer),
        safeString(creator.name),
        safeString(creator.serialNumber),
    ].filter(Boolean);
    const creatorProvider = providerFromValues(creatorValues);
    return creatorProvider
        ? { provider: creatorProvider, sourceAccountSeed: creatorValues }
        : null;
}

function providerMetadataSourceAccountSeed(
    provider: HealthProvider,
    data: Record<string, unknown>,
): readonly string[] {
    const accountValues = EVENT_PROVIDER_ACCOUNT_FIELDS
        .map(field => safeMetadataIdentifier(data[field]))
        .filter(Boolean);
    return ['event_provider_metadata', provider, ...accountValues];
}

export async function readTrustedEventProviderMetadata(
    db: admin.firestore.Firestore,
    request: ActivityHealthProviderMetadataReadRequest,
): Promise<ReadonlyMap<string, ActivityHealthTrustedProviderMetadata>> {
    const unresolvedDocuments = request.documents.filter(document => (
        providerFromValues(explicitServiceValues(document.data)) === null
    ));
    if (unresolvedDocuments.length === 0) return new Map();

    const candidates = unresolvedDocuments.flatMap(document => EVENT_PROVIDER_METADATA.map(metadata => ({
        eventID: document.id,
        metadata,
        ref: db
            .collection('users')
            .doc(request.userID)
            .collection('events')
            .doc(document.id)
            .collection('metaData')
            .doc(metadata.documentID),
    })));
    const snapshots: admin.firestore.DocumentSnapshot[] = [];
    for (let index = 0; index < candidates.length; index += EVENT_PROVIDER_METADATA_READ_BATCH_SIZE) {
        const refs = candidates
            .slice(index, index + EVENT_PROVIDER_METADATA_READ_BATCH_SIZE)
            .map(candidate => candidate.ref);
        snapshots.push(...await db.getAll(...refs, {
            fieldMask: [...EVENT_PROVIDER_METADATA_FIELD_MASK],
        }));
    }

    const matches = new Map<string, {
        provider: HealthProvider;
        sourceAccountSeed: readonly string[];
    }[]>();
    candidates.forEach((candidate, index) => {
        const snapshot = snapshots[index];
        if (!snapshot?.exists) return;
        const data = snapshot.data() || {};
        const declaredServiceName = safeString(data.serviceName);
        if (declaredServiceName && declaredServiceName !== candidate.metadata.documentID) return;
        const eventMatches = matches.get(candidate.eventID) || [];
        eventMatches.push({
            provider: candidate.metadata.provider,
            sourceAccountSeed: providerMetadataSourceAccountSeed(candidate.metadata.provider, data),
        });
        matches.set(candidate.eventID, eventMatches);
    });

    const result = new Map<string, ActivityHealthTrustedProviderMetadata>();
    matches.forEach((eventMatches, eventID) => {
        result.set(eventID, eventMatches.length === 1
            ? { status: 'resolved', ...eventMatches[0] }
            : { status: 'ambiguous' });
    });
    return result;
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

    const source = providerSource(document);
    if (!source) return null;
    const provider = source.provider;
    const sourceAccountKey = `workout_${digest(userID, provider, ...source.sourceAccountSeed)}`;
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
    const readProviderMetadata = dependencies.readProviderMetadata
        || (dependencies.readPage
            ? async () => new Map<string, ActivityHealthTrustedProviderMetadata>()
            : metadataRequest => readTrustedEventProviderMetadata(db, metadataRequest));
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
        const documentsWithinCandidateBudget = documents.slice(0, Math.max(0, maxCandidates - candidateCount));
        const providerMetadata = request.metricId === HEALTH_METRIC_IDS.BodyWeight
            ? await readProviderMetadata({ userID: uid, documents: documentsWithinCandidateBudget })
            : new Map<string, ActivityHealthTrustedProviderMetadata>();
        for (const rawDocument of documents) {
            if (candidateCount >= maxCandidates) {
                return buildResult(
                    observations,
                    false,
                    ACTIVITY_HEALTH_INCOMPLETE_REASONS.CandidateLimit,
                    candidateCount,
                );
            }
            const document = providerMetadata.has(rawDocument.id)
                ? { ...rawDocument, trustedProviderMetadata: providerMetadata.get(rawDocument.id) }
                : rawDocument;
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
