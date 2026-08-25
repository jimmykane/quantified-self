import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_PROVIDERS,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_RECORD_KINDS,
    HEALTH_SYNC_STATUSES,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
    HealthSourceRecord,
} from '../../../shared/health';

const hoisted = vi.hoisted(() => ({
    deletionGuard: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardStateInTransaction: hoisted.deletionGuard,
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
        constructor(public readonly uid: string, public readonly phase: string, public readonly originalError: unknown) {
            super(`Deletion guard failed for ${uid} during ${phase}.`);
        }
    },
}));

import {
    HealthRevisionConflictError,
    buildHealthWrite,
    markHealthProviderDisconnected,
    replaceHealthSourceRecord,
    updateHealthSyncState,
} from './writer';

interface FakeDocumentReference {
    id: string;
    path: string;
    collection: (name: string) => FakeCollectionReference;
}

interface FakeCollectionReference {
    doc: (id: string) => FakeDocumentReference;
}

function fakeDatabase() {
    const stored = new Map<string, unknown>();
    const sets = vi.fn();
    const deletes = vi.fn();
    const document = (path: string): FakeDocumentReference => ({
        id: path.split('/').at(-1) || '',
        path,
        collection: (name: string) => collection(`${path}/${name}`),
    });
    const collection = (path: string): FakeCollectionReference => ({
        doc: (id: string) => document(`${path}/${id}`),
    });
    const transaction = {
        get: vi.fn(async (reference: FakeDocumentReference) => ({
            exists: stored.has(reference.path),
            data: () => stored.get(reference.path),
        })),
        set: sets,
        delete: deletes,
    };
    const db = {
        collection,
        runTransaction: vi.fn(async (runner: (value: typeof transaction) => unknown) => runner(transaction)),
    };
    return { db, stored, sets, deletes, transaction };
}

function fakeId(parts: string[]): Promise<string> {
    return Promise.resolve(createHash('sha256').update(JSON.stringify(parts)).digest('hex'));
}

function joiningHashId(parts: string[]): Promise<string> {
    return Promise.resolve(createHash('sha256').update(parts.join(':')).digest('hex'));
}

function validInput(pointCount = 2): Record<string, unknown> {
    const offsets = Array.from({ length: pointCount }, (_, index) => index * 1000);
    return {
        provider: HEALTH_PROVIDERS.GarminAPI,
        providerAccountId: 'secret-provider-account',
        sourceRecordType: 'daily-summary',
        sourceRecordKey: '2026-01-01',
        revision: { order: 1, token: 'revision-1' },
        receivedAtMs: Date.parse('2026-01-02T00:00:00.000Z'),
        kind: HEALTH_RECORD_KINDS.DailySummary,
        calendarDate: '2026-01-01',
        startTimeMs: Date.parse('2026-01-01T00:00:00.000Z'),
        endTimeMs: Date.parse('2026-01-02T00:00:00.000Z'),
        timezoneOffsetSeconds: 0,
        metrics: [{
            kind: 'value',
            metricId: HEALTH_METRIC_IDS.Steps,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'total',
            semanticVariant: 'provider_daily_summary',
            origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
            recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
            quality: { status: HEALTH_QUALITY_STATUSES.Valid },
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
            native: { metric: 'steps', value: 100, unit: 'count' },
            canonical: { value: 100, unit: HEALTH_UNITS.Count },
        }],
        coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
        sampleSeries: [{
            seriesKey: 'heart-rate',
            metricId: HEALTH_METRIC_IDS.HeartRate,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'sample',
            semanticVariant: 'device_sample',
            origin: HEALTH_VALUE_ORIGINS.Recorded,
            recordingMethod: HEALTH_RECORDING_METHODS.Device,
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
            nativeMetric: 'heartRate',
            nativeUnit: 'bpm',
            canonicalUnit: HEALTH_UNITS.BeatsPerMinute,
            offsetMs: offsets,
            nativeValues: offsets.map((_, index) => 60 + index),
            canonicalValues: offsets.map((_, index) => 60 + index),
            coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
        }],
    };
}

function recordPath(id: string): string {
    return `users/user-1/healthRecords/${id}`;
}

describe('health writer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.deletionGuard.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
    });

    it('builds deterministic bounded chunks without persisting the raw provider account ID', async () => {
        const built = await buildHealthWrite('user-1', validInput(1441), 10_000, fakeId);

        expect(built.chunks).toHaveLength(2);
        expect(built.chunks[0].offsetMs).toHaveLength(1440);
        expect(built.chunks[1].offsetMs).toEqual([0]);
        expect(built.record.sampleChunkIds).toEqual(built.chunks.map(chunk => chunk.id));
        expect(built.record.metricIds).toEqual([HEALTH_METRIC_IDS.Steps, HEALTH_METRIC_IDS.HeartRate]);
        expect(JSON.stringify(built)).not.toContain('secret-provider-account');
        expect(built.record.source.accountKey).toMatch(/^[a-f0-9]{64}$/);
    });

    it('atomically writes a record and all of its chunks', async () => {
        const fake = fakeDatabase();
        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result).toMatchObject({ status: 'written', chunksWritten: 1, chunksDeleted: 0 });
        expect(fake.sets).toHaveBeenCalledTimes(2);
        expect(fake.deletes).not.toHaveBeenCalled();
        expect(hoisted.deletionGuard).toHaveBeenCalledOnce();
    });

    it('length-encodes ID inputs so delimiter-bearing provider fields cannot collide', async () => {
        const first = validInput();
        first.providerAccountId = 'account:daily';
        first.sourceRecordType = 'summary';
        const second = validInput();
        second.providerAccountId = 'account';
        second.sourceRecordType = 'daily:summary';

        const [firstBuilt, secondBuilt] = await Promise.all([
            buildHealthWrite('user-1', first, 10_000, joiningHashId),
            buildHealthWrite('user-1', second, 10_000, joiningHashId),
        ]);

        expect(firstBuilt.record.id).not.toBe(secondBuilt.record.id);
        expect(firstBuilt.record.source.accountKey).not.toBe(secondBuilt.record.source.accountKey);
    });

    it('treats an identical provider revision as idempotent', async () => {
        const fake = fakeDatabase();
        const built = await buildHealthWrite('user-1', validInput(), 9_000, fakeId);
        fake.stored.set(recordPath(built.record.id), built.record);

        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result.status).toBe('unchanged');
        expect(fake.sets).not.toHaveBeenCalled();
        expect(fake.deletes).not.toHaveBeenCalled();
    });

    it('ignores a stale lower provider revision', async () => {
        const fake = fakeDatabase();
        const built = await buildHealthWrite('user-1', validInput(), 9_000, fakeId);
        built.record.source.revision.order = 2;
        fake.stored.set(recordPath(built.record.id), built.record);

        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result.status).toBe('stale');
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('rejects ambiguous content at the same provider revision order', async () => {
        const fake = fakeDatabase();
        const built = await buildHealthWrite('user-1', validInput(), 9_000, fakeId);
        built.record.source.revision.digest = 'different-digest';
        fake.stored.set(recordPath(built.record.id), built.record);

        await expect(replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        })).rejects.toBeInstanceOf(HealthRevisionConflictError);
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('replaces higher revisions and document-deletes only stale leaf chunks', async () => {
        const fake = fakeDatabase();
        const input = validInput();
        const built = await buildHealthWrite('user-1', input, 9_000, fakeId);
        const staleChunkId = 'a'.repeat(64);
        built.record.sampleChunkIds = [staleChunkId];
        fake.stored.set(recordPath(built.record.id), built.record);
        (input.revision as Record<string, unknown>).order = 2;
        (input.revision as Record<string, unknown>).token = 'revision-2';

        const result = await replaceHealthSourceRecord('user-1', input, 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result).toMatchObject({ status: 'written', chunksDeleted: 1 });
        expect(fake.deletes).toHaveBeenCalledOnce();
        expect(fake.deletes.mock.calls[0][0].path).toContain(`/healthSampleChunks/${staleChunkId}`);
    });

    it('does not recreate records when account deletion is active inside the transaction', async () => {
        const fake = fakeDatabase();
        hoisted.deletionGuard.mockResolvedValue({ userExists: true, deletionInProgress: true, shouldSkip: true });

        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result.status).toBe('skipped_deleted_user');
        expect(fake.transaction.get).not.toHaveBeenCalled();
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('fails closed when a stored record violates the leaf-chunk bound', async () => {
        const fake = fakeDatabase();
        const input = validInput();
        const built = await buildHealthWrite('user-1', input, 9_000, fakeId);
        built.record.sampleChunkIds = Array.from({ length: 201 }, (_, index) => `old-${index}`);
        fake.stored.set(recordPath(built.record.id), built.record);
        (input.revision as Record<string, unknown>).order = 2;
        (input.revision as Record<string, unknown>).token = 'revision-2';

        await expect(replaceHealthSourceRecord('user-1', input, 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        })).rejects.toThrow('bounded sample-chunk invariant');
        expect(fake.deletes).not.toHaveBeenCalled();
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('fails closed before deleting a malformed stored chunk path', async () => {
        const fake = fakeDatabase();
        const input = validInput();
        const built = await buildHealthWrite('user-1', input, 9_000, fakeId);
        built.record.sampleChunkIds = ['nested/path'];
        fake.stored.set(recordPath(built.record.id), built.record);
        (input.revision as Record<string, unknown>).order = 2;
        (input.revision as Record<string, unknown>).token = 'revision-2';

        await expect(replaceHealthSourceRecord('user-1', input, 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        })).rejects.toThrow('bounded sample-chunk invariant');
        expect(fake.deletes).not.toHaveBeenCalled();
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('preserves an explicit null sample device instead of inheriting record attribution', async () => {
        const input = validInput();
        input.device = { manufacturer: 'Garmin', model: 'Watch' };
        const sampleSeries = input.sampleSeries as Array<Record<string, unknown>>;
        sampleSeries[0].device = null;

        const built = await buildHealthWrite('user-1', input, 10_000, fakeId);

        expect(built.record.device).toMatchObject({ manufacturer: 'Garmin', model: 'Watch' });
        expect(built.chunks[0].device).toBeNull();
    });

    it('writes only opaque sync error codes', async () => {
        const fake = fakeDatabase();
        await updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Failed,
            lastErrorCode: 'provider_rate_limited',
        }, 10_000, { db: fake.db as never });

        expect(fake.sets).toHaveBeenCalledWith(expect.objectContaining({
            path: 'users/user-1/healthSyncState/COROSAPI',
        }), expect.objectContaining({
            status: HEALTH_SYNC_STATUSES.Failed,
            lastErrorCode: 'provider_rate_limited',
        }), { merge: true });

        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            lastErrorCode: 'raw response with user data',
        }, 10_000, { db: fake.db as never })).rejects.toThrow('opaque bounded error code');
    });

    it('defaults new sync state to ready while preserving an existing status on partial updates', async () => {
        const fresh = fakeDatabase();
        await updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            lastPollAtMs: 9_000,
        }, 10_000, { db: fresh.db as never });
        expect(fresh.sets.mock.calls[0][1]).toMatchObject({
            status: HEALTH_SYNC_STATUSES.Ready,
            lastPollAtMs: 9_000,
        });

        const existing = fakeDatabase();
        existing.stored.set('users/user-1/healthSyncState/COROSAPI', {
            provider: HEALTH_PROVIDERS.COROSAPI,
            status: HEALTH_SYNC_STATUSES.Disconnected,
        });
        await updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            lastPollAtMs: 9_000,
        }, 10_000, { db: existing.db as never });
        expect(existing.sets.mock.calls[0][1]).toMatchObject({ lastPollAtMs: 9_000 });
        expect(existing.sets.mock.calls[0][1]).not.toHaveProperty('status');
    });

    it('retains imported records when a provider is disconnected', async () => {
        const fake = fakeDatabase();
        const written = await markHealthProviderDisconnected(
            'user-1',
            HEALTH_PROVIDERS.SuuntoApp,
            10_000,
            { db: fake.db as never },
        );

        expect(written).toBe(true);
        expect(fake.sets).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            status: HEALTH_SYNC_STATUSES.Disconnected,
        }), { merge: true });
        expect(fake.deletes).not.toHaveBeenCalled();
    });

    it('preserves the existing record creation time during replacement', async () => {
        const fake = fakeDatabase();
        const input = validInput();
        const built = await buildHealthWrite('user-1', input, 9_000, fakeId);
        const existing: HealthSourceRecord = { ...built.record, createdAtMs: 0 };
        fake.stored.set(recordPath(existing.id), existing);
        (input.revision as Record<string, unknown>).order = 2;
        (input.revision as Record<string, unknown>).token = 'revision-2';

        const result = await replaceHealthSourceRecord('user-1', input, 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result.record?.createdAtMs).toBe(0);
    });
});
