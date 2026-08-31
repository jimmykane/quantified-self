import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
} from '../../../shared/health';
import { SLEEP_STAGES } from '../../../shared/sleep';

const hoisted = vi.hoisted(() => ({
    deletionGuard: vi.fn(),
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardStateInTransaction: hoisted.deletionGuard,
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));

vi.mock('firebase-functions/logger', () => ({
    info: hoisted.loggerInfo,
    error: hoisted.loggerError,
}));

import {
    SPORTS_LIB_DATA_MIGRATION_KINDS,
    buildHealthSportsLibDataMigrationDecision,
    buildSleepSportsLibDataMigrationDecision,
    migrateSportsLibDataDocument,
    parseSportsLibDataMigrationOptions,
    runSportsLibDataMigration,
} from './sports-lib-data-migration';

function healthDocument() {
    return {
        metrics: [{
            kind: 'value',
            metricId: HEALTH_METRIC_IDS.Steps,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'total',
            semanticVariant: 'provider_daily_summary',
            origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
            recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
            quality: { status: HEALTH_QUALITY_STATUSES.Valid },
            coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
            native: { metric: 'steps', value: 10_000, unit: 'count' },
            canonical: { value: 10_000, unit: HEALTH_UNITS.Count },
        }],
    };
}

function sleepDocument() {
    return {
        durationSeconds: 28_800,
        inBedDurationSeconds: 30_000,
        stageDurationsSeconds: {
            [SLEEP_STAGES.Deep]: 4_000,
            [SLEEP_STAGES.Light]: 15_000,
            [SLEEP_STAGES.Rem]: 7_000,
            [SLEEP_STAGES.Awake]: 2_000,
        },
        score: { value: 91, qualifier: 'excellent' },
        vitals: { averageHrvMs: 60, averageHeartRateBpm: 52 },
    };
}

function fakeTransactionDatabase(snapshotData: unknown) {
    const update = vi.fn();
    const transaction = {
        get: vi.fn(async () => ({
            exists: snapshotData !== null,
            data: () => snapshotData,
        })),
        update,
    };
    const db = {
        runTransaction: vi.fn(async (runner: (value: typeof transaction) => unknown) => runner(transaction)),
    };
    return { db: db as unknown as admin.firestore.Firestore, transaction, update };
}

function fakeQueryDatabase(documentValues: readonly unknown[]) {
    const documents = documentValues.map((value, index) => ({
        id: `opaque-${index + 1}`,
        data: () => value,
        ref: { id: `opaque-${index + 1}` },
    }));
    const query = {
        orderBy: vi.fn(),
        limit: vi.fn(),
        startAfter: vi.fn(),
        select: vi.fn(),
        get: vi.fn(async () => ({ docs: documents })),
    };
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.startAfter.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const childCollection = vi.fn(() => query);
    const userDocument = { collection: childCollection };
    const usersCollection = { doc: vi.fn(() => userDocument) };
    const db = {
        collection: vi.fn(() => usersCollection),
        runTransaction: vi.fn(),
    };
    return {
        db: db as unknown as admin.firestore.Firestore,
        dbMock: db,
        childCollection,
        query,
    };
}

describe('Health and sleep Sports Lib data migration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.deletionGuard.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
    });

    it('parses a dry-run, user-scoped, bounded cursor and requires explicit execution', () => {
        expect(parseSportsLibDataMigrationOptions([
            '--uid', 'user-1',
            '--kind=sleep',
            '--limit', '25',
            '--concurrency', '8',
            '--start-after', 'opaque-document-id',
        ])).toEqual({
            execute: false,
            userID: 'user-1',
            kind: SPORTS_LIB_DATA_MIGRATION_KINDS.Sleep,
            limit: 25,
            concurrency: 8,
            startAfter: 'opaque-document-id',
        });
        expect(parseSportsLibDataMigrationOptions([
            '--execute', '--uid=user-1', '--kind=health',
        ])).toMatchObject({ execute: true, concurrency: 5 });
    });

    it.each([
        [],
        ['--uid', 'user-1'],
        ['--uid', 'user/1', '--kind', 'health'],
        ['--uid', 'user-1', '--kind', 'unknown'],
        ['--uid', 'user-1', '--kind', 'health', '--limit', '251'],
        ['--uid', 'user-1', '--kind', 'health', '--concurrency', '0'],
        ['--uid', 'user-1', '--kind', 'health', '--concurrency', '11'],
        ['--uid', 'user-1', '--kind', 'health', '--concurrency', '1.5'],
        ['--uid', 'user-1', '--kind', 'health', '--start-after', 'nested/path'],
        ['--uid', '--execute', '--kind', 'health'],
        ['--uid=user-1', '--kind', 'health', '--limit'],
        ['--uid=user-1', '--kind=health', '--start-after='],
        ['--uid=user-1', '--uid=user-1', '--kind=health'],
        ['--execute', '--execute', '--uid=user-1', '--kind=health'],
        ['--execute=true', '--uid', 'user-1', '--kind', 'health'],
        ['--uid', 'user-1', '--kind', 'health', '--unknown'],
    ])('rejects unsafe or unbounded migration arguments %#', argv => {
        expect(() => parseSportsLibDataMigrationOptions(argv)).toThrow();
    });

    it('builds an idempotent Health update without changing the legacy scalar', () => {
        const legacy = healthDocument();
        const first = buildHealthSportsLibDataMigrationDecision(legacy);
        expect(first).toMatchObject({
            status: 'update',
            update: {
                metrics: [{
                    canonical: { value: 10_000, unit: HEALTH_UNITS.Count },
                    sportsLibData: {
                        schemaVersion: 1,
                        metrics: { value: { Steps: 10_000 } },
                    },
                }],
            },
        });
        expect(first.status).toBe('update');
        if (first.status !== 'update') return;
        expect(buildHealthSportsLibDataMigrationDecision(first.update)).toEqual({ status: 'unchanged' });
    });

    it('treats a valid series-only Health record with no scalar metrics as unchanged', () => {
        expect(buildHealthSportsLibDataMigrationDecision({ metrics: [] })).toEqual({ status: 'unchanged' });
    });

    it('builds an idempotent sleep update while retaining all existing session fields', () => {
        const legacy = sleepDocument();
        const first = buildSleepSportsLibDataMigrationDecision(legacy);
        expect(first).toMatchObject({
            status: 'update',
            update: {
                sportsLibData: {
                    schemaVersion: 1,
                    metrics: {
                        duration: { 'Sleep Duration': 28_800 },
                        averageHrv: { 'Average Sleep HRV': 60 },
                    },
                },
            },
        });
        expect(first.status).toBe('update');
        if (first.status !== 'update') return;
        expect(buildSleepSportsLibDataMigrationDecision({
            ...legacy,
            ...first.update,
        })).toEqual({ status: 'unchanged' });
    });

    it('keeps dry runs bounded, cursor-resumable, and free of user IDs in logs', async () => {
        const fake = fakeQueryDatabase([healthDocument(), healthDocument(), healthDocument()]);

        const summary = await runSportsLibDataMigration([
            '--uid', 'private-user-id',
            '--kind', 'health',
            '--limit', '2',
            '--concurrency', '1',
            '--start-after', 'opaque-prior',
        ], { db: fake.db });

        expect(summary).toEqual({
            dryRun: true,
            kind: SPORTS_LIB_DATA_MIGRATION_KINDS.Health,
            concurrency: 1,
            scanned: 2,
            candidates: 2,
            migrated: 0,
            unchanged: 0,
            skippedInvalid: 0,
            skippedDeletedUser: 0,
            skippedMissing: 0,
            failed: 0,
            nextStartAfter: 'opaque-2',
        });
        expect(fake.query.limit).toHaveBeenCalledWith(3);
        expect(fake.query.startAfter).toHaveBeenCalledWith('opaque-prior');
        expect(fake.query.select).toHaveBeenCalledWith('metrics');
        expect(fake.dbMock.runTransaction).not.toHaveBeenCalled();
        expect(JSON.stringify(hoisted.loggerInfo.mock.calls)).not.toContain('private-user-id');
        expect(hoisted.loggerInfo).toHaveBeenCalledWith(
            expect.stringContaining('Dry run complete'),
            expect.objectContaining({ nextStartAfter: 'available' }),
        );
    });

    it('stops at a retryable failure and resumes before the failed document', async () => {
        const fake = fakeQueryDatabase([healthDocument(), healthDocument(), healthDocument()]);
        fake.dbMock.runTransaction
            .mockResolvedValueOnce('migrated')
            .mockRejectedValueOnce(new Error('transient'));

        const summary = await runSportsLibDataMigration([
            '--execute',
            '--uid', 'private-user-id',
            '--kind', 'health',
            '--limit', '2',
            '--start-after', 'opaque-prior',
        ], { db: fake.db });

        expect(summary).toMatchObject({
            scanned: 2,
            candidates: 2,
            migrated: 1,
            failed: 1,
            nextStartAfter: 'opaque-1',
        });
        expect(fake.dbMock.runTransaction).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(hoisted.loggerError.mock.calls)).not.toContain('private-user-id');
    });

    it('retains the incoming cursor when the first document fails', async () => {
        const fake = fakeQueryDatabase([healthDocument(), healthDocument()]);
        fake.dbMock.runTransaction.mockRejectedValueOnce(new Error('transient'));

        const summary = await runSportsLibDataMigration([
            '--execute',
            '--uid', 'private-user-id',
            '--kind', 'health',
            '--concurrency', '1',
            '--start-after', 'opaque-prior',
        ], { db: fake.db });

        expect(summary).toMatchObject({
            scanned: 1,
            candidates: 1,
            migrated: 0,
            failed: 1,
            nextStartAfter: 'opaque-prior',
        });
        expect(fake.dbMock.runTransaction).toHaveBeenCalledTimes(1);
    });

    it('runs guarded document transactions with bounded concurrency', async () => {
        const fake = fakeQueryDatabase(Array.from({ length: 7 }, () => healthDocument()));
        let active = 0;
        let maximumActive = 0;
        fake.dbMock.runTransaction.mockImplementation(async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            return 'migrated';
        });

        const summary = await runSportsLibDataMigration([
            '--execute',
            '--uid', 'private-user-id',
            '--kind', 'health',
            '--limit', '7',
            '--concurrency', '3',
        ], { db: fake.db });

        expect(summary).toMatchObject({
            scanned: 7,
            candidates: 7,
            migrated: 7,
            failed: 0,
        });
        expect(maximumActive).toBe(3);
        expect(fake.dbMock.runTransaction).toHaveBeenCalledTimes(7);
    });

    it('stops scheduling new batches and resumes before the earliest concurrent failure', async () => {
        const fake = fakeQueryDatabase(Array.from({ length: 6 }, () => healthDocument()));
        let transactionIndex = 0;
        fake.dbMock.runTransaction.mockImplementation(async () => {
            const currentIndex = transactionIndex;
            transactionIndex += 1;
            await new Promise(resolve => setTimeout(resolve, 5));
            if (currentIndex === 1) throw new Error('transient');
            return 'migrated';
        });

        const summary = await runSportsLibDataMigration([
            '--execute',
            '--uid', 'private-user-id',
            '--kind', 'health',
            '--limit', '6',
            '--concurrency', '2',
        ], { db: fake.db });

        expect(summary).toMatchObject({
            scanned: 2,
            candidates: 2,
            migrated: 1,
            failed: 1,
            nextStartAfter: 'opaque-1',
        });
        expect(fake.dbMock.runTransaction).toHaveBeenCalledTimes(2);
    });

    it('does not advance past an unexecuted candidate when later inspection fails', async () => {
        const fake = fakeQueryDatabase([]);
        fake.query.get.mockResolvedValue({
            docs: [{
                id: 'opaque-1',
                data: () => healthDocument(),
                ref: { id: 'opaque-1' },
            }, {
                id: 'opaque-2',
                data: () => {
                    throw new Error('inspection failed');
                },
                ref: { id: 'opaque-2' },
            }],
        });

        const summary = await runSportsLibDataMigration([
            '--execute',
            '--uid', 'private-user-id',
            '--kind', 'health',
            '--concurrency', '5',
            '--start-after', 'opaque-prior',
        ], { db: fake.db });

        expect(summary).toMatchObject({
            scanned: 2,
            candidates: 1,
            migrated: 0,
            failed: 1,
            nextStartAfter: 'opaque-prior',
        });
        expect(fake.dbMock.runTransaction).not.toHaveBeenCalled();
    });

    it('does not overwrite malformed canonical envelopes', () => {
        const health = healthDocument();
        (health.metrics[0] as Record<string, unknown>).sportsLibData = {
            schemaVersion: 1,
            metrics: { value: { steps: 10_000 } },
        };
        expect(buildHealthSportsLibDataMigrationDecision(health)).toEqual({ status: 'invalid' });
        expect(buildSleepSportsLibDataMigrationDecision({
            ...sleepDocument(),
            sportsLibData: {
                schemaVersion: 1,
                metrics: { duration: { 'Sleep Duration': Number.NaN } },
            },
        })).toEqual({ status: 'invalid' });
        expect(buildHealthSportsLibDataMigrationDecision({ metrics: [{}] })).toEqual({ status: 'invalid' });
        expect(buildHealthSportsLibDataMigrationDecision({ metrics: [null] })).toEqual({ status: 'invalid' });
    });

    it('rechecks deletion state in the write transaction and creates no descendant write', async () => {
        hoisted.deletionGuard.mockResolvedValue({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });
        const fake = fakeTransactionDatabase(healthDocument());

        await expect(migrateSportsLibDataDocument(
            fake.db,
            'user-1',
            {} as admin.firestore.DocumentReference,
            SPORTS_LIB_DATA_MIGRATION_KINDS.Health,
        )).resolves.toBe('skipped_deleted_user');
        expect(fake.transaction.get).not.toHaveBeenCalled();
        expect(fake.update).not.toHaveBeenCalled();
    });

    it('re-reads and updates only the canonical storage field inside the transaction', async () => {
        const fake = fakeTransactionDatabase(sleepDocument());
        const documentRef = {} as admin.firestore.DocumentReference;

        await expect(migrateSportsLibDataDocument(
            fake.db,
            'user-1',
            documentRef,
            SPORTS_LIB_DATA_MIGRATION_KINDS.Sleep,
        )).resolves.toBe('migrated');
        expect(fake.update).toHaveBeenCalledWith(documentRef, {
            sportsLibData: expect.objectContaining({ schemaVersion: 1 }),
        });
    });

    it('does not let a Health migration cross the source-record document bound', async () => {
        const fake = fakeTransactionDatabase({
            ...healthDocument(),
            retainedPadding: 'x'.repeat(256 * 1024),
        });

        await expect(migrateSportsLibDataDocument(
            fake.db,
            'user-1',
            {} as admin.firestore.DocumentReference,
            SPORTS_LIB_DATA_MIGRATION_KINDS.Health,
        )).resolves.toBe('invalid');
        expect(fake.update).not.toHaveBeenCalled();
    });
});
