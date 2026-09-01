import * as admin from 'firebase-admin';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import {
    HEALTH_MAX_METRICS_PER_SOURCE_RECORD,
    HEALTH_MAX_SOURCE_RECORD_DOCUMENT_BYTES,
    HEALTH_SOURCE_RECORDS_COLLECTION_ID,
    type HealthMetricEntry,
} from '../../../shared/health';
import {
    SLEEP_SESSIONS_COLLECTION_ID,
    SLEEP_STAGES,
    type SleepSession,
} from '../../../shared/sleep';
import {
    decodeHealthMetricSportsLibData,
    decodeSleepSessionSportsLibData,
    encodeHealthMetricSportsLibData,
    encodeSleepSessionSportsLibData,
    SportsLibDataValidationError,
} from '../../../shared/sports-lib-health-data';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

const LOG_PREFIX = '[sports-lib-health-sleep-migration]';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 10;
const SAFE_USER_ID_PATTERN = /^[^/]{1,128}$/;
const HEALTH_FIELD_MASK = ['metrics'] as const;
const SLEEP_FIELD_MASK = [
    'durationSeconds',
    'inBedDurationSeconds',
    'stageDurationsSeconds',
    'score',
    'vitals',
    'sportsLibData',
] as const;
const SLEEP_VITAL_FIELDS: ReadonlySet<string> = new Set([
    'averageHeartRateBpm',
    'minimumHeartRateBpm',
    'restingHeartRateBpm',
    'averageHrvMs',
    'hrvSampleCount',
    'overnightHrvMs',
    'maxSpo2Percent',
    'averageRespirationBrpm',
]);
const SLEEP_STAGE_FIELDS: ReadonlySet<string> = new Set(Object.values(SLEEP_STAGES));
const HEALTH_CANONICAL_FIELDS: ReadonlySet<string> = new Set(['value', 'unit']);

export const SPORTS_LIB_DATA_MIGRATION_KINDS = {
    Health: 'health',
    Sleep: 'sleep',
} as const;

export type SportsLibDataMigrationKind = typeof SPORTS_LIB_DATA_MIGRATION_KINDS[
    keyof typeof SPORTS_LIB_DATA_MIGRATION_KINDS
];

export interface SportsLibDataMigrationOptions {
    execute: boolean;
    removeLegacyScalars: boolean;
    userID: string;
    kind: SportsLibDataMigrationKind;
    limit: number;
    concurrency: number;
    startAfter?: string;
}

export interface SportsLibDataMigrationSummary {
    dryRun: boolean;
    removeLegacyScalars: boolean;
    kind: SportsLibDataMigrationKind;
    concurrency: number;
    scanned: number;
    candidates: number;
    migrated: number;
    unchanged: number;
    skippedInvalid: number;
    skippedDeletedUser: number;
    skippedMissing: number;
    failed: number;
    nextStartAfter: string | null;
}

export type SportsLibDataMigrationDecision =
    | { status: 'update'; update: Record<string, unknown> }
    | { status: 'unchanged' }
    | { status: 'invalid' };

export type SportsLibDataMigrationWriteStatus =
    | 'migrated'
    | 'unchanged'
    | 'invalid'
    | 'skipped_deleted_user'
    | 'skipped_missing';

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function stableComparableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableComparableValue);
    if (!value || typeof value !== 'object') return value === undefined ? null : value;
    const source = value as Record<string, unknown>;
    return Object.keys(source).sort().reduce<Record<string, unknown>>((result, key) => {
        if (source[key] !== undefined) result[key] = stableComparableValue(source[key]);
        return result;
    }, {});
}

function stableValueKey(value: unknown): string {
    return JSON.stringify(stableComparableValue(value));
}

function isSafeDocumentId(value: string): boolean {
    return value.length > 0
        && value !== '.'
        && value !== '..'
        && !value.includes('/')
        && Buffer.byteLength(value, 'utf8') <= 1_500;
}

export function parseSportsLibDataMigrationOptions(argv: readonly string[]): SportsLibDataMigrationOptions {
    const knownValueArguments = new Set(['--uid', '--kind', '--limit', '--concurrency', '--start-after']);
    const knownBooleanArguments = new Set(['--execute', '--remove-legacy-scalars']);
    const values = new Map<string, string>();
    const booleans = new Set<string>();
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const name = argument.split('=', 1)[0];
        if (knownBooleanArguments.has(name)) {
            if (argument !== name) throw new Error(`${name} does not accept a value.`);
            if (booleans.has(name)) throw new Error(`${name} may be specified only once.`);
            booleans.add(name);
            continue;
        }
        if (!knownValueArguments.has(name)) {
            throw new Error(`Unknown migration argument: ${name}`);
        }
        if (values.has(name)) throw new Error(`${name} may be specified only once.`);
        const inlineValue = argument.includes('=')
            ? argument.slice(argument.indexOf('=') + 1)
            : undefined;
        const nextValue = inlineValue === undefined ? argv[index + 1] : undefined;
        if (inlineValue === undefined && (nextValue === undefined || nextValue.startsWith('--'))) {
            throw new Error(`${name} requires a value.`);
        }
        const value = inlineValue ?? nextValue!;
        if (value.length === 0) throw new Error(`${name} requires a value.`);
        values.set(name, value);
        if (inlineValue === undefined) index += 1;
    }

    const userID = `${values.get('--uid') || ''}`;
    if (!SAFE_USER_ID_PATTERN.test(userID) || userID !== userID.trim()) {
        throw new Error('--uid must identify one safe user document.');
    }
    const kindValue = values.get('--kind');
    if (kindValue !== SPORTS_LIB_DATA_MIGRATION_KINDS.Health
        && kindValue !== SPORTS_LIB_DATA_MIGRATION_KINDS.Sleep) {
        throw new Error('--kind must be either health or sleep.');
    }
    const limitValue = values.get('--limit');
    const limit = limitValue === undefined ? DEFAULT_LIMIT : Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new Error(`--limit must be an integer from 1 to ${MAX_LIMIT}.`);
    }
    const concurrencyValue = values.get('--concurrency');
    const concurrency = concurrencyValue === undefined ? DEFAULT_CONCURRENCY : Number(concurrencyValue);
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
        throw new Error(`--concurrency must be an integer from 1 to ${MAX_CONCURRENCY}.`);
    }
    const startAfter = values.get('--start-after');
    if (startAfter !== undefined && !isSafeDocumentId(startAfter)) {
        throw new Error('--start-after must be a safe document ID cursor.');
    }
    return {
        execute: booleans.has('--execute'),
        removeLegacyScalars: booleans.has('--remove-legacy-scalars'),
        userID,
        kind: kindValue,
        limit,
        concurrency,
        startAfter,
    };
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, field);
}

function isPlainRecordOrNull(value: unknown): boolean {
    if (value === null) return true;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasOnlyFields(value: unknown, fields: ReadonlySet<string>): boolean {
    return isPlainRecordOrNull(value)
        && (value === null || Object.keys(asRecord(value)).every(field => fields.has(field)));
}

export function buildHealthSportsLibLegacyScalarCleanupDecision(
    value: unknown,
): SportsLibDataMigrationDecision {
    const metrics = asRecord(value).metrics;
    if (!Array.isArray(metrics)
        || metrics.length > HEALTH_MAX_METRICS_PER_SOURCE_RECORD
        || metrics.some(metric => !metric || typeof metric !== 'object' || Array.isArray(metric))) {
        return { status: 'invalid' };
    }
    if (metrics.length === 0) return { status: 'unchanged' };
    for (const metric of metrics) {
        const storedMetric = asRecord(metric);
        const goal = storedMetric.goal;
        if ((hasOwn(storedMetric, 'canonical')
                && !hasOnlyFields(storedMetric.canonical, HEALTH_CANONICAL_FIELDS))
            || (hasOwn(storedMetric, 'goal') && !isPlainRecordOrNull(goal))
            || (goal !== null
                && hasOwn(asRecord(goal), 'canonical')
                && !hasOnlyFields(asRecord(goal).canonical, HEALTH_CANONICAL_FIELDS))) {
            return { status: 'invalid' };
        }
    }
    try {
        const decoded = metrics.map(metric => decodeHealthMetricSportsLibData(metric as HealthMetricEntry));
        const encoded = decoded.map(encodeHealthMetricSportsLibData);
        const storedSportsLibData = metrics.map(metric => asRecord(metric).sportsLibData);
        const canonicalSportsLibData = encoded.map(metric => (
            metric.kind === 'value' ? metric.sportsLibData : undefined
        ));
        // Cleanup is destructive and must never substitute for the additive
        // migration. Every canonical value must already have an exact,
        // round-tripped Sports Lib envelope before its legacy copy is removed.
        if (stableValueKey(storedSportsLibData) !== stableValueKey(canonicalSportsLibData)) {
            return { status: 'invalid' };
        }
        const cleanedMetrics = metrics.map((metric, index) => {
            const storedMetric = { ...asRecord(metric) };
            const canonicalMetric = encoded[index];
            if (canonicalMetric.kind !== 'value' || !canonicalMetric.sportsLibData) {
                return storedMetric;
            }
            delete storedMetric.canonical;
            const storedGoal = storedMetric.goal;
            if (storedGoal && typeof storedGoal === 'object' && !Array.isArray(storedGoal)) {
                const goal = { ...storedGoal as Record<string, unknown> };
                delete goal.canonical;
                if (Object.keys(goal).length === 0) delete storedMetric.goal;
                else storedMetric.goal = goal;
            }
            return storedMetric;
        });
        return stableValueKey(metrics) === stableValueKey(cleanedMetrics)
            ? { status: 'unchanged' }
            : { status: 'update', update: { metrics: cleanedMetrics } };
    } catch (error) {
        if (error instanceof SportsLibDataValidationError) return { status: 'invalid' };
        throw error;
    }
}

export function buildSleepSportsLibLegacyScalarCleanupDecision(
    value: unknown,
): SportsLibDataMigrationDecision {
    const data = asRecord(value);
    if (!hasOwn(data, 'sportsLibData')
        || (hasOwn(data, 'score') && !isPlainRecordOrNull(data.score))
        || (hasOwn(data, 'vitals') && !isPlainRecordOrNull(data.vitals))
        || (hasOwn(data, 'stageDurationsSeconds') && !isPlainRecordOrNull(data.stageDurationsSeconds))) {
        return { status: 'invalid' };
    }
    const stageDurations = asRecord(data.stageDurationsSeconds);
    const vitals = asRecord(data.vitals);
    if (Object.keys(stageDurations).some(field => !SLEEP_STAGE_FIELDS.has(field))
        || Object.keys(vitals).some(field => !SLEEP_VITAL_FIELDS.has(field))) {
        return { status: 'invalid' };
    }
    try {
        const decoded = decodeSleepSessionSportsLibData(data as unknown as SleepSession);
        const encoded = encodeSleepSessionSportsLibData(decoded);
        if (stableValueKey(data.sportsLibData) !== stableValueKey(encoded.sportsLibData)) {
            return { status: 'invalid' };
        }
    } catch (error) {
        if (error instanceof SportsLibDataValidationError) return { status: 'invalid' };
        throw error;
    }

    const update: Record<string, unknown> = {};
    for (const field of [
        'durationSeconds',
        'inBedDurationSeconds',
        'stageDurationsSeconds',
        'vitals',
    ]) {
        if (hasOwn(data, field)) update[field] = FieldValue.delete();
    }
    if (hasOwn(data, 'score')) {
        const score = asRecord(data.score);
        if (data.score === null || Object.keys(score).every(field => field === 'value')) {
            update.score = FieldValue.delete();
        } else if (hasOwn(score, 'value')) {
            update['score.value'] = FieldValue.delete();
        }
    }
    return Object.keys(update).length === 0
        ? { status: 'unchanged' }
        : { status: 'update', update };
}

export function buildHealthSportsLibDataMigrationDecision(value: unknown): SportsLibDataMigrationDecision {
    const metrics = asRecord(value).metrics;
    if (!Array.isArray(metrics)
        || metrics.length > HEALTH_MAX_METRICS_PER_SOURCE_RECORD
        || metrics.some(metric => !metric || typeof metric !== 'object' || Array.isArray(metric))) {
        return { status: 'invalid' };
    }
    // Series-only Health source records intentionally persist no scalar
    // metrics. Their sample chunks contain no Sports Lib scalar envelope to
    // migrate, so they are already unchanged rather than malformed.
    if (metrics.length === 0) return { status: 'unchanged' };
    try {
        const decoded = metrics.map(metric => decodeHealthMetricSportsLibData(metric as HealthMetricEntry));
        const encoded = decoded.map(encodeHealthMetricSportsLibData);
        const storedSportsLibData = metrics.map(metric => asRecord(metric).sportsLibData);
        const canonicalSportsLibData = encoded.map(metric => (
            metric.kind === 'value' ? metric.sportsLibData : undefined
        ));
        // The migration remains safe to re-run after the writer cleanup has
        // removed duplicate canonical scalars. Only the derived Sports Lib
        // envelope determines whether a record still needs migration.
        if (stableValueKey(storedSportsLibData) === stableValueKey(canonicalSportsLibData)) {
            return { status: 'unchanged' };
        }
        return { status: 'update', update: { metrics: encoded } };
    } catch (error) {
        if (error instanceof SportsLibDataValidationError) return { status: 'invalid' };
        throw error;
    }
}

export function buildSleepSportsLibDataMigrationDecision(value: unknown): SportsLibDataMigrationDecision {
    const data = asRecord(value);
    try {
        const decoded = decodeSleepSessionSportsLibData(data as unknown as SleepSession);
        const encoded = encodeSleepSessionSportsLibData(decoded);
        if (stableValueKey(data.sportsLibData) === stableValueKey(encoded.sportsLibData)) {
            return { status: 'unchanged' };
        }
        return { status: 'update', update: { sportsLibData: encoded.sportsLibData } };
    } catch (error) {
        if (error instanceof SportsLibDataValidationError) return { status: 'invalid' };
        throw error;
    }
}

function migrationDecision(
    kind: SportsLibDataMigrationKind,
    value: unknown,
    removeLegacyScalars: boolean,
): SportsLibDataMigrationDecision {
    if (removeLegacyScalars) {
        return kind === SPORTS_LIB_DATA_MIGRATION_KINDS.Health
            ? buildHealthSportsLibLegacyScalarCleanupDecision(value)
            : buildSleepSportsLibLegacyScalarCleanupDecision(value);
    }
    return kind === SPORTS_LIB_DATA_MIGRATION_KINDS.Health
        ? buildHealthSportsLibDataMigrationDecision(value)
        : buildSleepSportsLibDataMigrationDecision(value);
}

function healthMigrationUpdateFitsDocumentBound(
    storedDocument: Record<string, unknown>,
    update: Record<string, unknown>,
): boolean {
    try {
        const serialized = JSON.stringify({ ...storedDocument, ...update });
        return typeof serialized === 'string'
            && Buffer.byteLength(serialized, 'utf8') <= HEALTH_MAX_SOURCE_RECORD_DOCUMENT_BYTES;
    } catch {
        return false;
    }
}

export async function migrateSportsLibDataDocument(
    db: admin.firestore.Firestore,
    userID: string,
    documentRef: admin.firestore.DocumentReference,
    kind: SportsLibDataMigrationKind,
    removeLegacyScalars = false,
): Promise<SportsLibDataMigrationWriteStatus> {
    return db.runTransaction(async transaction => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
        } catch (error) {
            throw new UserDeletionGuardReadError(userID, 'sports_lib_health_sleep_migration', error);
        }
        if (deletionGuard.shouldSkip) return 'skipped_deleted_user';

        const snapshot = await transaction.get(documentRef);
        if (!snapshot.exists) return 'skipped_missing';
        const storedDocument = snapshot.data() as Record<string, unknown>;
        const decision = migrationDecision(kind, storedDocument, removeLegacyScalars);
        if (decision.status !== 'update') return decision.status;
        if (kind === SPORTS_LIB_DATA_MIGRATION_KINDS.Health
            && !healthMigrationUpdateFitsDocumentBound(storedDocument, decision.update)) {
            return 'invalid';
        }
        transaction.update(documentRef, decision.update);
        return 'migrated';
    });
}

async function documentsToInspect(
    db: admin.firestore.Firestore,
    options: SportsLibDataMigrationOptions,
): Promise<{ documents: admin.firestore.QueryDocumentSnapshot[]; hasMore: boolean }> {
    const collectionId = options.kind === SPORTS_LIB_DATA_MIGRATION_KINDS.Health
        ? HEALTH_SOURCE_RECORDS_COLLECTION_ID
        : SLEEP_SESSIONS_COLLECTION_ID;
    let query = db.collection('users').doc(options.userID)
        .collection(collectionId)
        .orderBy(FieldPath.documentId())
        .limit(options.limit + 1);
    if (options.startAfter) query = query.startAfter(options.startAfter);
    const fieldMask = options.kind === SPORTS_LIB_DATA_MIGRATION_KINDS.Health
        ? HEALTH_FIELD_MASK
        : SLEEP_FIELD_MASK;
    const snapshot = await query.select(...fieldMask).get();
    return {
        documents: snapshot.docs.slice(0, options.limit),
        hasMore: snapshot.docs.length > options.limit,
    };
}

export async function runSportsLibDataMigration(
    argv: readonly string[],
    dependencies: { db?: admin.firestore.Firestore } = {},
): Promise<SportsLibDataMigrationSummary> {
    const options = parseSportsLibDataMigrationOptions(argv);
    if (!dependencies.db && !admin.apps.length) admin.initializeApp();
    const db = dependencies.db || admin.firestore();
    const { documents, hasMore } = await documentsToInspect(db, options);
    const summary: SportsLibDataMigrationSummary = {
        dryRun: !options.execute,
        removeLegacyScalars: options.removeLegacyScalars,
        kind: options.kind,
        concurrency: options.concurrency,
        scanned: 0,
        candidates: 0,
        migrated: 0,
        unchanged: 0,
        skippedInvalid: 0,
        skippedDeletedUser: 0,
        skippedMissing: 0,
        failed: 0,
        nextStartAfter: hasMore && documents.length > 0 ? documents[documents.length - 1].id : null,
    };

    let nextDocumentIndex = 0;
    while (nextDocumentIndex < documents.length) {
        const candidates: Array<{
            document: admin.firestore.QueryDocumentSnapshot;
            index: number;
        }> = [];
        let decisionFailureIndex: number | null = null;

        while (nextDocumentIndex < documents.length && candidates.length < options.concurrency) {
            const index = nextDocumentIndex;
            const document = documents[index];
            nextDocumentIndex += 1;
            summary.scanned += 1;
            try {
                const initialDecision = migrationDecision(
                    options.kind,
                    document.data(),
                    options.removeLegacyScalars,
                );
                if (initialDecision.status === 'invalid') {
                    summary.skippedInvalid += 1;
                    continue;
                }
                if (initialDecision.status === 'unchanged') {
                    summary.unchanged += 1;
                    continue;
                }
                summary.candidates += 1;
                candidates.push({ document, index });
            } catch {
                summary.failed += 1;
                decisionFailureIndex = index;
                break;
            }
        }

        if (decisionFailureIndex !== null) {
            const earliestUnexecutedIndex = candidates[0]?.index ?? decisionFailureIndex;
            summary.nextStartAfter = earliestUnexecutedIndex > 0
                ? documents[earliestUnexecutedIndex - 1].id
                : options.startAfter ?? null;
            logger.error(`${LOG_PREFIX} Failed to inspect one document.`, {
                kind: options.kind,
                failure: 'sports_lib_data_migration_failed',
            });
            break;
        }
        if (!options.execute || candidates.length === 0) continue;

        const outcomes = await Promise.all(candidates.map(async candidate => {
            try {
                const status = await migrateSportsLibDataDocument(
                    db,
                    options.userID,
                    candidate.document.ref,
                    options.kind,
                    options.removeLegacyScalars,
                );
                return { ...candidate, status };
            } catch {
                return { ...candidate, status: null };
            }
        }));
        let earliestFailureIndex: number | null = null;
        for (const outcome of outcomes) {
            if (outcome.status === null) {
                summary.failed += 1;
                earliestFailureIndex = earliestFailureIndex === null
                    ? outcome.index
                    : Math.min(earliestFailureIndex, outcome.index);
                continue;
            }
            if (outcome.status === 'migrated') summary.migrated += 1;
            if (outcome.status === 'unchanged') summary.unchanged += 1;
            if (outcome.status === 'invalid') summary.skippedInvalid += 1;
            if (outcome.status === 'skipped_deleted_user') summary.skippedDeletedUser += 1;
            if (outcome.status === 'skipped_missing') summary.skippedMissing += 1;
        }
        if (earliestFailureIndex !== null) {
            // A later transaction in this bounded batch may already have
            // succeeded. Resume before the earliest failure so rerunning the
            // page safely rechecks every possibly affected document.
            summary.nextStartAfter = earliestFailureIndex > 0
                ? documents[earliestFailureIndex - 1].id
                : options.startAfter ?? null;
            logger.error(`${LOG_PREFIX} Failed to migrate one or more documents.`, {
                kind: options.kind,
                failure: 'sports_lib_data_migration_failed',
            });
            break;
        }
    }

    logger.info(`${LOG_PREFIX} ${options.execute ? 'Execution' : 'Dry run'} complete.`, {
        ...summary,
        nextStartAfter: summary.nextStartAfter ? 'available' : null,
    });
    return summary;
}
