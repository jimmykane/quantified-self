import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import {
    HEALTH_MAX_METRICS_PER_SOURCE_RECORD,
    HEALTH_MAX_SOURCE_RECORD_DOCUMENT_BYTES,
    HEALTH_SOURCE_RECORDS_COLLECTION_ID,
    type HealthMetricEntry,
} from '../../../shared/health';
import {
    SLEEP_SESSIONS_COLLECTION_ID,
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

export const SPORTS_LIB_DATA_MIGRATION_KINDS = {
    Health: 'health',
    Sleep: 'sleep',
} as const;

export type SportsLibDataMigrationKind = typeof SPORTS_LIB_DATA_MIGRATION_KINDS[
    keyof typeof SPORTS_LIB_DATA_MIGRATION_KINDS
];

export interface SportsLibDataMigrationOptions {
    execute: boolean;
    userID: string;
    kind: SportsLibDataMigrationKind;
    limit: number;
    startAfter?: string;
}

export interface SportsLibDataMigrationSummary {
    dryRun: boolean;
    kind: SportsLibDataMigrationKind;
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
    const knownValueArguments = new Set(['--uid', '--kind', '--limit', '--start-after']);
    const knownBooleanArguments = new Set(['--execute']);
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
    const startAfter = values.get('--start-after');
    if (startAfter !== undefined && !isSafeDocumentId(startAfter)) {
        throw new Error('--start-after must be a safe document ID cursor.');
    }
    return {
        execute: booleans.has('--execute'),
        userID,
        kind: kindValue,
        limit,
        startAfter,
    };
}

export function buildHealthSportsLibDataMigrationDecision(value: unknown): SportsLibDataMigrationDecision {
    const metrics = asRecord(value).metrics;
    if (!Array.isArray(metrics)
        || metrics.length === 0
        || metrics.length > HEALTH_MAX_METRICS_PER_SOURCE_RECORD
        || metrics.some(metric => !metric || typeof metric !== 'object' || Array.isArray(metric))) {
        return { status: 'invalid' };
    }
    try {
        const decoded = metrics.map(metric => decodeHealthMetricSportsLibData(metric as HealthMetricEntry));
        const encoded = decoded.map(encodeHealthMetricSportsLibData);
        if (stableValueKey(metrics) === stableValueKey(encoded)) return { status: 'unchanged' };
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

function migrationDecision(kind: SportsLibDataMigrationKind, value: unknown): SportsLibDataMigrationDecision {
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
        const decision = migrationDecision(kind, storedDocument);
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
        kind: options.kind,
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

    for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index];
        summary.scanned += 1;
        try {
            const initialDecision = migrationDecision(options.kind, document.data());
            if (initialDecision.status === 'invalid') {
                summary.skippedInvalid += 1;
                continue;
            }
            if (initialDecision.status === 'unchanged') {
                summary.unchanged += 1;
                continue;
            }
            summary.candidates += 1;
            if (!options.execute) continue;

            const status = await migrateSportsLibDataDocument(db, options.userID, document.ref, options.kind);
            if (status === 'migrated') summary.migrated += 1;
            if (status === 'unchanged') summary.unchanged += 1;
            if (status === 'invalid') summary.skippedInvalid += 1;
            if (status === 'skipped_deleted_user') summary.skippedDeletedUser += 1;
            if (status === 'skipped_missing') summary.skippedMissing += 1;
        } catch {
            summary.failed += 1;
            // Stop at the first retryable failure and return the cursor before
            // it. Advancing to the end of the page would permanently skip the
            // failed document when the operator resumes with nextStartAfter.
            summary.nextStartAfter = index > 0
                ? documents[index - 1].id
                : options.startAfter ?? null;
            logger.error(`${LOG_PREFIX} Failed to migrate one document.`, {
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
