import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { SLEEP_PROVIDERS, SLEEP_SESSIONS_COLLECTION_ID } from '../../../shared/sleep';
import { COROSDailyHealthResult, mapCOROSDailyHealth } from '../coros/daily-health';
import { COROS_DAILY_MAX_HRV_POINTS } from '../coros/constants';
import {
    COROSDailyValidationError,
    getCOROSDailySleepStartTimeMs,
    normalizeCOROSHappenDay,
    parseCOROSDailyRecord,
} from '../coros/daily';
import {
    replaceHealthSourceRecord,
    type HealthSourceRecordWriteStatus,
} from '../health/writer';
import { getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';

const LOG_PREFIX = '[migrate-coros-sleep-to-health]';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const MIGRATION_FIELD_MASK = [
    'source',
    'sleepDate',
    'startTimeMs',
    'endTimeMs',
    'timezoneOffsetSeconds',
    'updatedAtMs',
    'createdAtMs',
    'vitals',
    'providerFields.coros',
    'hrvSamples',
] as const;
const SAFE_SLEEP_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_USER_ID_PATTERN = /^[^/\s]{1,128}$/;
const BOOLEAN_ARGUMENTS = new Set(['--execute', '--confirm-all-users']);
const VALUE_ARGUMENTS = ['--uid', '--limit', '--start-after'] as const;

export interface COROSSleepToHealthMigrationOptions {
    execute: boolean;
    confirmAllUsers: boolean;
    userID?: string;
    limit: number;
    startAfter?: string;
}

export interface COROSSleepToHealthMigrationSummary {
    dryRun: boolean;
    scanned: number;
    candidates: number;
    healthRecordsWritten: number;
    healthRecordsUnchanged: number;
    healthRecordsStale: number;
    sleepSessionsCleaned: number;
    skippedNotLegacy: number;
    skippedInvalid: number;
    skippedUserDeletion: number;
    skippedConcurrentChange: number;
    failed: number;
    nextStartAfter: string | null;
}

export interface COROSLegacyHealthMigrationCandidate {
    userID: string;
    sleepDocumentId: string;
    fingerprint: string;
    health: COROSDailyHealthResult;
}

type CleanupResult = 'cleaned' | 'skipped_user_deletion' | 'concurrent_change';

export function canCleanCOROSLegacySleepFieldsAfterHealthWrite(
    status: HealthSourceRecordWriteStatus,
): boolean {
    // A stale candidate proves only that a newer record exists; it does not
    // prove that record retained every legacy sample or aggregate being moved.
    // Delete the source fields only after this exact content was committed or
    // was already committed unchanged.
    return status === 'written' || status === 'unchanged';
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function safeInteger(value: unknown): number | null {
    if ((typeof value !== 'number' && typeof value !== 'string')
        || (typeof value === 'string' && value.trim().length === 0)) {
        return null;
    }
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function safeIsoDateTime(value: number): string | null {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function timezoneOffsetSeconds(value: unknown): number | null {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && Math.abs(value) <= 18 * 60 * 60
        ? value
        : null;
}

function boundedNumber(value: unknown): number | null {
    if ((typeof value !== 'number' && typeof value !== 'string')
        || (typeof value === 'string' && value.trim().length === 0)) {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function positiveNumber(value: unknown): number | null {
    const numeric = boundedNumber(value);
    return numeric !== null && numeric > 0 ? numeric : null;
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function assertKnownArguments(argv: string[]): void {
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (BOOLEAN_ARGUMENTS.has(argument)) continue;
        const valueArgument = VALUE_ARGUMENTS.find(key => (
            argument === key || argument.startsWith(`${key}=`)
        ));
        if (!valueArgument) throw new Error(`Unknown migration argument: ${argument}`);
        if (argument === valueArgument
            && argv[index + 1] !== undefined
            && !argv[index + 1].startsWith('--')) {
            index += 1;
        }
    }
}

function readArgValue(argv: string[], key: string): string | undefined {
    const prefix = `${key}=`;
    let result: string | undefined;
    for (let index = 0; index < argv.length; index += 1) {
        let matched = false;
        let candidate: string | undefined;
        if (argv[index] === key) {
            matched = true;
            candidate = argv[index + 1];
        } else if (argv[index].startsWith(prefix)) {
            matched = true;
            candidate = argv[index].slice(prefix.length);
        }
        if (!matched) continue;
        if (candidate === undefined || !candidate.trim() || candidate.startsWith('--')) {
            throw new Error(`${key} requires a non-empty value.`);
        }
        if (result !== undefined) throw new Error(`${key} cannot be repeated.`);
        result = candidate;
    }
    return result;
}

function parseLimit(value: string | undefined): number {
    if (!value) return DEFAULT_LIMIT;
    if (!/^\d+$/.test(value)) {
        throw new Error(`--limit must be an integer between 1 and ${MAX_LIMIT}.`);
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw new Error(`--limit must be an integer between 1 and ${MAX_LIMIT}.`);
    }
    return parsed;
}

function parseSleepDocumentPath(path: string): { userID: string; sleepDocumentId: string } | null {
    const match = /^users\/([^/]+)\/sleepSessions\/([^/]+)$/.exec(path);
    return match ? { userID: match[1], sleepDocumentId: match[2] } : null;
}

export function parseCOROSSleepToHealthMigrationOptions(
    argv: string[],
): COROSSleepToHealthMigrationOptions {
    assertKnownArguments(argv);
    const execute = argv.includes('--execute');
    const confirmAllUsers = argv.includes('--confirm-all-users');
    const userID = readArgValue(argv, '--uid')?.trim() || undefined;
    if (userID && (!SAFE_USER_ID_PATTERN.test(userID) || userID === '.' || userID === '..')) {
        throw new Error('--uid must be a safe bounded Firestore document ID.');
    }
    if (execute && !userID && !confirmAllUsers) {
        throw new Error('Global execution requires --confirm-all-users. Run the dry-run first.');
    }
    const startAfter = readArgValue(argv, '--start-after')?.trim() || undefined;
    if (startAfter) {
        const parsedPath = parseSleepDocumentPath(startAfter);
        const scopedCursorIsSafe = Boolean(userID) && (
            SAFE_SLEEP_DOCUMENT_ID_PATTERN.test(startAfter)
            || (parsedPath !== null
                && parsedPath.userID === userID
                && SAFE_SLEEP_DOCUMENT_ID_PATTERN.test(parsedPath.sleepDocumentId))
        );
        const globalCursorIsSafe = !userID
            && parsedPath !== null
            && SAFE_USER_ID_PATTERN.test(parsedPath.userID)
            && SAFE_SLEEP_DOCUMENT_ID_PATTERN.test(parsedPath.sleepDocumentId);
        if (!scopedCursorIsSafe && !globalCursorIsSafe) {
            throw new Error('--start-after must identify a safe Sleep document in the selected scope.');
        }
    }
    return {
        execute,
        confirmAllUsers,
        userID,
        limit: parseLimit(readArgValue(argv, '--limit')),
        startAfter,
    };
}

function legacyMovedPayload(data: Record<string, unknown>): Record<string, unknown> {
    const source = asRecord(data.source);
    const vitals = asRecord(data.vitals);
    const coros = asRecord(asRecord(data.providerFields).coros);
    return {
        provider: source.provider,
        providerUserId: source.providerUserId,
        sourceSessionKey: source.sourceSessionKey,
        sourceReceivedAtMs: source.receivedAtMs,
        sleepDate: data.sleepDate,
        startTimeMs: data.startTimeMs,
        endTimeMs: data.endTimeMs,
        timezoneOffsetSeconds: data.timezoneOffsetSeconds,
        updatedAtMs: data.updatedAtMs,
        createdAtMs: data.createdAtMs,
        vitals: {
            averageHeartRateBpm: vitals.averageHeartRateBpm,
            restingHeartRateBpm: vitals.restingHeartRateBpm,
            overnightHrvMs: vitals.overnightHrvMs,
        },
        movedProviderFields: {
            happenDay: coros.happenDay,
            step: coros.step,
            calorie: coros.calorie,
            rhr: coros.rhr,
            ppgHrv: coros.ppgHrv,
            sleepAvgHr: coros.sleepAvgHr,
        },
        hrvSamples: data.hrvSamples,
    };
}

function migrationFingerprint(data: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(legacyMovedPayload(data))).digest('hex');
}

function hasLegacyMovedData(data: Record<string, unknown>): boolean {
    const coros = asRecord(asRecord(data.providerFields).coros);
    const hasMovedProviderField = ['step', 'calorie', 'rhr', 'ppgHrv', 'sleepAvgHr']
        .some(field => coros[field] !== undefined && coros[field] !== null);
    return hasMovedProviderField || (Array.isArray(data.hrvSamples) && data.hrvSamples.length > 0);
}

function hasInvalidLegacyMovedProviderField(coros: Record<string, unknown>): boolean {
    const present = (field: string): boolean => (
        Object.prototype.hasOwnProperty.call(coros, field)
        && coros[field] !== null
        && coros[field] !== undefined
    );
    return (present('step') && safeInteger(coros.step) === null)
        || (present('calorie') && (
            boundedNumber(coros.calorie) === null
            || Number(coros.calorie) < 0
        ))
        || (present('rhr') && positiveNumber(coros.rhr) === null)
        || (present('ppgHrv') && positiveNumber(coros.ppgHrv) === null)
        || (present('sleepAvgHr') && positiveNumber(coros.sleepAvgHr) === null);
}

function legacyHrvList(data: Record<string, unknown>, sleepStartTimeMs: number): unknown[] | null {
    if (!Array.isArray(data.hrvSamples)) return [];
    if (data.hrvSamples.length > COROS_DAILY_MAX_HRV_POINTS) return null;
    return data.hrvSamples.flatMap(value => {
        const sample = asRecord(value);
        const hrv = boundedNumber(sample.value);
        const explicitTimestampMs = safeInteger(sample.timestampMs);
        const offsetSeconds = boundedNumber(sample.offsetSeconds);
        if ((explicitTimestampMs !== null && explicitTimestampMs % 1000 !== 0)
            || (explicitTimestampMs === null && offsetSeconds !== null && !Number.isSafeInteger(offsetSeconds))) {
            return [];
        }
        const timestampMs = explicitTimestampMs ?? (
            offsetSeconds !== null && offsetSeconds >= 0
                ? sleepStartTimeMs + Math.floor(offsetSeconds * 1000)
                : null
        );
        if (hrv === null || hrv <= 0 || timestampMs === null) return [];
        return [{ timestamp: Math.floor(timestampMs / 1000), hrv }];
    });
}

export function buildCOROSLegacyHealthMigrationCandidate(
    dataValue: unknown,
    userID: string,
    sleepDocumentId: string,
): COROSLegacyHealthMigrationCandidate | null {
    const data = asRecord(dataValue);
    const source = asRecord(data.source);
    if (source.provider !== SLEEP_PROVIDERS.COROSAPI
        || !hasLegacyMovedData(data)
        || !SAFE_SLEEP_DOCUMENT_ID_PATTERN.test(sleepDocumentId)) {
        return null;
    }

    const providerUserId = nonEmptyString(source.providerUserId);
    const sleepStartTimeMs = safeInteger(data.startTimeMs);
    const sleepEndTimeMs = safeInteger(data.endTimeMs);
    const sleepDate = nonEmptyString(data.sleepDate);
    const sleepStartTime = sleepStartTimeMs === null ? null : safeIsoDateTime(sleepStartTimeMs);
    const sleepEndTime = sleepEndTimeMs === null ? null : safeIsoDateTime(sleepEndTimeMs);
    if (!providerUserId
        || providerUserId.length > 512
        || sleepStartTimeMs === null
        || sleepEndTimeMs === null
        || !sleepStartTime
        || !sleepEndTime
        || sleepEndTimeMs <= sleepStartTimeMs
        || !sleepDate) {
        return null;
    }

    const coros = asRecord(asRecord(data.providerFields).coros);
    if (hasInvalidLegacyMovedProviderField(coros)) return null;
    const vitals = asRecord(data.vitals);
    const resolvedTimezoneOffsetSeconds = timezoneOffsetSeconds(data.timezoneOffsetSeconds);
    const receivedAtMs = safeInteger(source.receivedAtMs)
        ?? safeInteger(data.updatedAtMs)
        ?? safeInteger(data.createdAtMs)
        ?? sleepEndTimeMs;
    const hrvList = legacyHrvList(data, sleepStartTimeMs);
    if (hrvList === null) return null;
    const happenDay = normalizeCOROSHappenDay(coros.happenDay)?.happenDay
        ?? sleepDate.replace(/-/g, '');
    let parsed;
    try {
        parsed = parseCOROSDailyRecord({
            happenDay,
            sleepStartTime,
            sleepEndTime,
            timezoneOffsetSeconds: resolvedTimezoneOffsetSeconds,
            step: coros.step,
            calorie: coros.calorie,
            rhr: vitals.restingHeartRateBpm ?? coros.rhr,
            ppgHrv: vitals.overnightHrvMs ?? coros.ppgHrv,
            sleepAvgHr: vitals.averageHeartRateBpm ?? coros.sleepAvgHr,
            hrvList,
        });
    } catch (error) {
        if (error instanceof COROSDailyValidationError) return null;
        throw error;
    }
    if (!parsed.happenDay || getCOROSDailySleepStartTimeMs(parsed) === null) return null;
    const referencedVitalValues = [
        {
            providerValue: positiveNumber(coros.rhr),
            sleepValue: positiveNumber(vitals.restingHeartRateBpm),
            parsedValue: parsed.restingHeartRateBpm,
        },
        {
            providerValue: positiveNumber(coros.ppgHrv),
            sleepValue: positiveNumber(vitals.overnightHrvMs),
            parsedValue: parsed.overnightHrvMs,
        },
        {
            providerValue: positiveNumber(coros.sleepAvgHr),
            sleepValue: positiveNumber(vitals.averageHeartRateBpm),
            parsedValue: parsed.averageSleepHeartRateBpm,
        },
    ];
    if (referencedVitalValues.some(({ providerValue, sleepValue, parsedValue }) => (
        (providerValue !== null && providerValue !== sleepValue)
        || (parsedValue !== null && parsedValue !== sleepValue)
    ))) {
        // A Health sleep_reference must resolve to the exact value being moved.
        // Leave inconsistent legacy documents untouched for operator review.
        return null;
    }

    const health = mapCOROSDailyHealth(
        parsed,
        providerUserId,
        receivedAtMs,
        sleepDocumentId,
    );
    if (!health) return null;
    if (Array.isArray(data.hrvSamples) && data.hrvSamples.length > 0) {
        const migratedHrvPointCount = health.input.sampleSeries
            .find(series => series.nativeMetric === 'hrvList.hrv')
            ?.offsetMs.length ?? 0;
        // Never clean the legacy array unless every structurally recoverable
        // point reached the bounded Health series. Malformed or out-of-window
        // documents remain untouched for explicit operator review.
        if (hrvList.length !== data.hrvSamples.length
            || parsed.hrvPoints.length !== hrvList.length
            || migratedHrvPointCount !== hrvList.length) {
            return null;
        }
    }
    return {
        userID,
        sleepDocumentId,
        fingerprint: migrationFingerprint(data),
        health,
    };
}

async function getSleepDocuments(
    options: COROSSleepToHealthMigrationOptions,
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const db = admin.firestore();
    let query: admin.firestore.Query;
    if (options.userID) {
        query = db.collection('users').doc(options.userID)
            .collection(SLEEP_SESSIONS_COLLECTION_ID)
            .orderBy(admin.firestore.FieldPath.documentId());
        if (options.startAfter) {
            const parsed = parseSleepDocumentPath(options.startAfter);
            query = query.startAfter(parsed?.userID === options.userID
                ? parsed.sleepDocumentId
                : options.startAfter);
        }
    } else {
        query = db.collectionGroup(SLEEP_SESSIONS_COLLECTION_ID)
            .orderBy(admin.firestore.FieldPath.documentId());
        if (options.startAfter) query = query.startAfter(db.doc(options.startAfter));
    }
    return (await query.select(...MIGRATION_FIELD_MASK).limit(options.limit).get()).docs;
}

async function cleanLegacySleepFields(
    ref: admin.firestore.DocumentReference,
    candidate: COROSLegacyHealthMigrationCandidate,
): Promise<CleanupResult> {
    const db = admin.firestore();
    return db.runTransaction(async transaction => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(
                db,
                transaction,
                candidate.userID,
            );
        } catch (error) {
            throw new UserDeletionGuardReadError(candidate.userID, 'coros_sleep_health_migration_cleanup', error);
        }
        if (deletionGuard.shouldSkip) return 'skipped_user_deletion';

        const currentSnapshot = await transaction.get(ref);
        const currentData = currentSnapshot.exists
            ? currentSnapshot.data() as Record<string, unknown>
            : null;
        if (!currentData
            || migrationFingerprint(currentData) !== candidate.fingerprint
            || !hasLegacyMovedData(currentData)) {
            return 'concurrent_change';
        }

        const deleteField = admin.firestore.FieldValue.delete();
        const updates: Record<string, admin.firestore.FieldValue> = {};
        if (Object.prototype.hasOwnProperty.call(currentData, 'hrvSamples')) {
            updates.hrvSamples = deleteField;
        }
        const currentCoros = asRecord(asRecord(currentData.providerFields).coros);
        for (const field of ['step', 'calorie', 'rhr', 'ppgHrv', 'sleepAvgHr']) {
            if (Object.prototype.hasOwnProperty.call(currentCoros, field)) {
                updates[`providerFields.coros.${field}`] = deleteField;
            }
        }
        transaction.update(ref, updates);
        return 'cleaned';
    });
}

export async function runCOROSSleepToHealthMigration(
    argv: string[],
): Promise<COROSSleepToHealthMigrationSummary> {
    const options = parseCOROSSleepToHealthMigrationOptions(argv);
    if (!admin.apps.length) admin.initializeApp();
    const documents = await getSleepDocuments(options);
    const summary: COROSSleepToHealthMigrationSummary = {
        dryRun: !options.execute,
        scanned: 0,
        candidates: 0,
        healthRecordsWritten: 0,
        healthRecordsUnchanged: 0,
        healthRecordsStale: 0,
        sleepSessionsCleaned: 0,
        skippedNotLegacy: 0,
        skippedInvalid: 0,
        skippedUserDeletion: 0,
        skippedConcurrentChange: 0,
        failed: 0,
        nextStartAfter: documents.length > 0 ? documents[documents.length - 1].ref.path : null,
    };

    for (const document of documents) {
        summary.scanned += 1;
        const parsedPath = parseSleepDocumentPath(document.ref.path);
        if (!parsedPath || (options.userID && parsedPath.userID !== options.userID)) {
            summary.skippedInvalid += 1;
            continue;
        }
        const data = document.data() as Record<string, unknown>;
        if (!hasLegacyMovedData(data)) {
            summary.skippedNotLegacy += 1;
            continue;
        }
        const candidate = buildCOROSLegacyHealthMigrationCandidate(
            data,
            parsedPath.userID,
            parsedPath.sleepDocumentId,
        );
        if (!candidate) {
            summary.skippedInvalid += 1;
            continue;
        }
        summary.candidates += 1;
        if (!options.execute) continue;

        try {
            const healthWrite = await replaceHealthSourceRecord(candidate.userID, candidate.health.input);
            if (healthWrite.status === 'skipped_deleted_user') {
                summary.skippedUserDeletion += 1;
                continue;
            }
            if (healthWrite.status === 'written') summary.healthRecordsWritten += 1;
            if (healthWrite.status === 'unchanged') summary.healthRecordsUnchanged += 1;
            if (healthWrite.status === 'stale') summary.healthRecordsStale += 1;

            if (!canCleanCOROSLegacySleepFieldsAfterHealthWrite(healthWrite.status)) {
                continue;
            }

            const cleanup = await cleanLegacySleepFields(document.ref, candidate);
            if (cleanup === 'cleaned') summary.sleepSessionsCleaned += 1;
            if (cleanup === 'skipped_user_deletion') summary.skippedUserDeletion += 1;
            if (cleanup === 'concurrent_change') summary.skippedConcurrentChange += 1;
        } catch {
            summary.failed += 1;
            logger.error(`${LOG_PREFIX} Failed to migrate one legacy COROS Sleep session.`, {
                failure: 'legacy_sleep_migration_failed',
            });
        }
    }

    logger.info(`${LOG_PREFIX} ${options.execute ? 'Execution complete' : 'Dry run complete'}.`, {
        ...summary,
        // The exact cursor remains on the operator-owned stdout result below;
        // application logs need only indicate whether another page is available.
        nextStartAfter: summary.nextStartAfter ? 'available' : null,
    });
    return summary;
}

async function main(): Promise<void> {
    const summary = await runCOROSSleepToHealthMigration(process.argv.slice(2));
    process.stdout.write(`${LOG_PREFIX} Summary ${JSON.stringify(summary)}\n`);
    if (!summary.dryRun && summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(() => {
        process.exitCode = 1;
    });
}
