import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_MAX_SOURCE_RECORD_DOCUMENT_BYTES,
    HEALTH_MAX_SAMPLE_CHUNK_DOCUMENT_BYTES,
    HEALTH_MAX_WRITE_BYTES,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_PROVIDERS,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_SOURCE_RECORD_KINDS,
    HEALTH_SYNC_STATUSES,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
    HealthSampleChunk,
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
    HealthSourceRecordRevisionConflictError,
    HealthLifecycleGuardReadError,
    HealthWriteSizeError,
    assertHealthSourceRecordWriteSize,
    buildHealthSourceRecordWrite,
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
        kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
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

function sourceRecordPath(id: string): string {
    return `users/user-1/healthSourceRecords/${id}`;
}

function tokenCredential(accessToken: string, credentialGeneration: string | null = null) {
    return {
        accessToken,
        refreshToken: '',
        expiresAt: 0,
        dateCreated: 0,
        dateRefreshed: 0,
        credentialGeneration,
    };
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
        const built = await buildHealthSourceRecordWrite('user-1', validInput(1441), 10_000, fakeId);

        expect(built.chunks).toHaveLength(2);
        expect(built.chunks[0].offsetMs).toHaveLength(1440);
        expect(built.chunks[1].offsetMs).toEqual([0]);
        expect(built.chunks.map(chunk => chunk.coverage.sampleCount)).toEqual([1441, 1441]);
        expect(built.sourceRecord.sampleChunkIds).toEqual(built.chunks.map(chunk => chunk.id));
        expect(built.sourceRecord.metricIds).toEqual([HEALTH_METRIC_IDS.HeartRate, HEALTH_METRIC_IDS.Steps]);
        expect(JSON.stringify(built)).not.toContain('secret-provider-account');
        expect(built.sourceRecord.source.accountKey).toMatch(/^[a-f0-9]{64}$/);
    });

    it('persists an opaque source key when an adapter key contains the raw provider account ID', async () => {
        const input = validInput();
        input.providerAccountId = 'account-id';
        input.sourceRecordKey = 'account-id:daily:2026-01-01';
        (input.revision as Record<string, unknown>).token = 'account-id:revision:1';

        const built = await buildHealthSourceRecordWrite('user-1', input, 10_000, fakeId);

        expect(built.sourceRecord.source.sourceRecordKey).toMatch(/^[a-f0-9]{64}$/);
        expect(built.sourceRecord.source.sourceRecordKey).not.toBe(input.sourceRecordKey);
        expect(built.sourceRecord.source.revision.token).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(built)).not.toContain('account-id');
    });

    it('atomically writes a source record and all of its chunks', async () => {
        const fake = fakeDatabase();
        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result).toMatchObject({
            sourceRecordId: expect.stringMatching(/^[a-f0-9]{64}$/),
            status: 'written',
            chunksWritten: 1,
            chunksDeleted: 0,
        });
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
            buildHealthSourceRecordWrite('user-1', first, 10_000, joiningHashId),
            buildHealthSourceRecordWrite('user-1', second, 10_000, joiningHashId),
        ]);

        expect(firstBuilt.sourceRecord.id).not.toBe(secondBuilt.sourceRecord.id);
        expect(firstBuilt.sourceRecord.source.accountKey).not.toBe(secondBuilt.sourceRecord.source.accountKey);
    });

    it('canonicalizes unordered metric and series collections before digesting and storing', async () => {
        const first = validInput();
        const firstMetrics = first.metrics as Array<Record<string, unknown>>;
        firstMetrics.push({
            ...firstMetrics[0],
            semanticVariant: 'secondary_daily_summary',
            native: { metric: 'secondarySteps', value: 50, unit: 'count' },
            canonical: { value: 50, unit: HEALTH_UNITS.Count },
        });
        const firstSeries = first.sampleSeries as Array<Record<string, unknown>>;
        firstSeries.push({ ...firstSeries[0], seriesKey: 'heart-rate-secondary' });
        const second = JSON.parse(JSON.stringify(first)) as Record<string, unknown>;
        (second.metrics as unknown[]).reverse();
        (second.sampleSeries as unknown[]).reverse();

        const [firstBuilt, secondBuilt] = await Promise.all([
            buildHealthSourceRecordWrite('user-1', first, 10_000, fakeId),
            buildHealthSourceRecordWrite('user-1', second, 10_000, fakeId),
        ]);

        expect(secondBuilt).toEqual(firstBuilt);
    });

    it('rejects unsafe user document IDs before constructing Firestore paths', async () => {
        await expect(buildHealthSourceRecordWrite(' user-1 ', validInput(), 10_000, fakeId))
            .rejects.toThrow('safe bounded non-empty document ID');
        await expect(buildHealthSourceRecordWrite('users/other', validInput(), 10_000, fakeId))
            .rejects.toThrow('safe bounded non-empty document ID');
    });

    it('bounds one revision below half the Firestore transaction request limit', () => {
        expect(HEALTH_MAX_WRITE_BYTES).toBe(4 * 1024 * 1024);
        const sourceRecord = {
            id: 'source-record-id',
            padding: 'x'.repeat(100 * 1024),
        } as unknown as HealthSourceRecord;
        const padding = 'x'.repeat(800 * 1024);
        const chunks = Array.from({ length: 5 }, (_, index) => ({
            id: `chunk-${index}`,
            padding,
        })) as unknown as HealthSampleChunk[];

        expect(() => assertHealthSourceRecordWriteSize(sourceRecord, chunks)).toThrow(HealthWriteSizeError);
        expect(() => assertHealthSourceRecordWriteSize(sourceRecord, chunks)).toThrow('bounded transaction payload size');
    });

    it('uses separate bounded sizes for source records and sample chunks', () => {
        expect(HEALTH_MAX_SOURCE_RECORD_DOCUMENT_BYTES).toBe(256 * 1024);
        expect(HEALTH_MAX_SAMPLE_CHUNK_DOCUMENT_BYTES).toBe(900 * 1024);

        const oversizedRecord = {
            id: 'source-record-id',
            padding: 'x'.repeat(HEALTH_MAX_SOURCE_RECORD_DOCUMENT_BYTES),
        } as unknown as HealthSourceRecord;
        const smallRecord = { id: 'source-record-id' } as unknown as HealthSourceRecord;
        const oversizedChunk = {
            id: 'sample-chunk-id',
            padding: 'x'.repeat(HEALTH_MAX_SAMPLE_CHUNK_DOCUMENT_BYTES),
        } as unknown as HealthSampleChunk;

        expect(() => assertHealthSourceRecordWriteSize(oversizedRecord, []))
            .toThrow('source record source-record-id');
        expect(() => assertHealthSourceRecordWriteSize(smallRecord, [oversizedChunk]))
            .toThrow('sample chunk sample-chunk-id');
    });

    it('stops measuring chunks as soon as the cumulative write budget is exceeded', () => {
        const sourceRecord = {
            id: 'source-record-id',
            padding: 'x'.repeat(100 * 1024),
        } as unknown as HealthSourceRecord;
        const padding = 'x'.repeat(800 * 1024);
        const chunks = new Proxy(Array.from({ length: 6 }, (_, index) => ({
            id: `chunk-${index}`,
            padding,
        })) as unknown as HealthSampleChunk[], {
            get(target, property, receiver) {
                if (property === '5') {
                    throw new Error('size validator read beyond the cumulative write budget');
                }
                return Reflect.get(target, property, receiver);
            },
        });

        expect(() => assertHealthSourceRecordWriteSize(sourceRecord, chunks)).toThrow(HealthWriteSizeError);
        expect(() => assertHealthSourceRecordWriteSize(sourceRecord, chunks))
            .toThrow('bounded transaction payload size');
    });

    it('treats an identical provider revision as idempotent', async () => {
        const fake = fakeDatabase();
        const built = await buildHealthSourceRecordWrite('user-1', validInput(), 9_000, fakeId);
        fake.stored.set(sourceRecordPath(built.sourceRecord.id), built.sourceRecord);

        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result.status).toBe('unchanged');
        expect(fake.sets).not.toHaveBeenCalled();
        expect(fake.deletes).not.toHaveBeenCalled();
    });

    it('does not rewrite identical content received at a later provider revision order', async () => {
        const fake = fakeDatabase();
        const existingInput = validInput();
        const built = await buildHealthSourceRecordWrite('user-1', existingInput, 9_000, fakeId);
        fake.stored.set(sourceRecordPath(built.sourceRecord.id), built.sourceRecord);
        const repeatedInput = validInput();
        (repeatedInput.revision as Record<string, unknown>).order = 2;
        repeatedInput.receivedAtMs = Date.parse('2026-01-02T01:00:00.000Z');

        const result = await replaceHealthSourceRecord('user-1', repeatedInput, 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result.status).toBe('unchanged');
        expect(result.sourceRecord?.source.revision.order).toBe(1);
        expect(fake.sets).not.toHaveBeenCalled();
        expect(fake.deletes).not.toHaveBeenCalled();
    });

    it('ignores a stale lower provider revision', async () => {
        const fake = fakeDatabase();
        const built = await buildHealthSourceRecordWrite('user-1', validInput(), 9_000, fakeId);
        built.sourceRecord.source.revision.order = 2;
        fake.stored.set(sourceRecordPath(built.sourceRecord.id), built.sourceRecord);

        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result.status).toBe('stale');
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('rejects ambiguous content at the same provider revision order', async () => {
        const fake = fakeDatabase();
        const built = await buildHealthSourceRecordWrite('user-1', validInput(), 9_000, fakeId);
        built.sourceRecord.source.revision.digest = 'different-digest';
        fake.stored.set(sourceRecordPath(built.sourceRecord.id), built.sourceRecord);

        await expect(replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        })).rejects.toBeInstanceOf(HealthSourceRecordRevisionConflictError);
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('replaces higher revisions and document-deletes only stale leaf chunks', async () => {
        const fake = fakeDatabase();
        const input = validInput();
        const built = await buildHealthSourceRecordWrite('user-1', input, 9_000, fakeId);
        const staleChunkId = 'a'.repeat(64);
        built.sourceRecord.sampleChunkIds = [staleChunkId];
        fake.stored.set(sourceRecordPath(built.sourceRecord.id), built.sourceRecord);
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

    it('does not recreate source records when account deletion is active inside the transaction', async () => {
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

    it('fails closed when the account-deletion guard cannot be read', async () => {
        const fake = fakeDatabase();
        hoisted.deletionGuard.mockRejectedValueOnce(new Error('Firestore unavailable'));

        await expect(replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        })).rejects.toThrow('Deletion guard failed');
        expect(fake.transaction.get).not.toHaveBeenCalled();
        expect(fake.sets).not.toHaveBeenCalled();
        expect(fake.deletes).not.toHaveBeenCalled();
    });

    it('fails closed when a stored source record violates the leaf-chunk bound', async () => {
        const fake = fakeDatabase();
        const input = validInput();
        const built = await buildHealthSourceRecordWrite('user-1', input, 9_000, fakeId);
        built.sourceRecord.sampleChunkIds = Array.from({ length: 201 }, (_, index) => `old-${index}`);
        fake.stored.set(sourceRecordPath(built.sourceRecord.id), built.sourceRecord);
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
        const built = await buildHealthSourceRecordWrite('user-1', input, 9_000, fakeId);
        built.sourceRecord.sampleChunkIds = ['nested/path'];
        fake.stored.set(sourceRecordPath(built.sourceRecord.id), built.sourceRecord);
        (input.revision as Record<string, unknown>).order = 2;
        (input.revision as Record<string, unknown>).token = 'revision-2';

        await expect(replaceHealthSourceRecord('user-1', input, 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        })).rejects.toThrow('bounded sample-chunk invariant');
        expect(fake.deletes).not.toHaveBeenCalled();
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('preserves an explicit null sample device instead of inheriting source-record attribution', async () => {
        const input = validInput();
        input.device = { manufacturer: 'Garmin', model: 'Watch' };
        const sampleSeries = input.sampleSeries as Array<Record<string, unknown>>;
        sampleSeries[0].device = null;

        const built = await buildHealthSourceRecordWrite('user-1', input, 10_000, fakeId);

        expect(built.sourceRecord.device).toMatchObject({ manufacturer: 'Garmin', model: 'Watch' });
        expect(built.chunks[0].device).toBeNull();
    });

    it('preserves explicit null sample value and quality arrays', async () => {
        const input = validInput();
        const sampleSeries = input.sampleSeries as Array<Record<string, unknown>>;
        sampleSeries[0].normalizationStatus = HEALTH_NORMALIZATION_STATUSES.NativeOnly;
        sampleSeries[0].canonicalUnit = null;
        sampleSeries[0].canonicalValues = null;
        sampleSeries[0].qualityCodes = null;

        const built = await buildHealthSourceRecordWrite('user-1', input, 10_000, fakeId);

        expect(built.chunks[0].canonicalValues).toBeNull();
        expect(built.chunks[0].qualityCodes).toBeNull();
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

    it('does not recreate sync state while account deletion is active', async () => {
        const fake = fakeDatabase();
        hoisted.deletionGuard.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
        }, 10_000, { db: fake.db as never })).resolves.toBe(false);

        expect(fake.transaction.get).not.toHaveBeenCalled();
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('fails sync-state writes closed when the deletion guard cannot be read', async () => {
        const fake = fakeDatabase();
        hoisted.deletionGuard.mockRejectedValueOnce(new Error('Firestore unavailable'));

        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
        }, 10_000, { db: fake.db as never })).rejects.toThrow('Deletion guard failed');

        expect(fake.transaction.get).not.toHaveBeenCalled();
        expect(fake.sets).not.toHaveBeenCalled();
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

    it('does not let stale sync updates regress connection state or last-seen timestamps', async () => {
        const fake = fakeDatabase();
        fake.stored.set('users/user-1/healthSyncState/COROSAPI', {
            provider: HEALTH_PROVIDERS.COROSAPI,
            status: HEALTH_SYNC_STATUSES.Disconnected,
            lastPollAtMs: 12_000,
            lastObservedAtMs: 11_000,
            lastSyncedAtMs: 10_000,
            lastErrorCode: null,
            updatedAtMs: 13_000,
        });

        await updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Failed,
            lastPollAtMs: 10_000,
            lastObservedAtMs: 12_000,
            lastSyncedAtMs: null,
            lastErrorCode: 'stale_failure',
        }, 12_500, { db: fake.db as never });

        expect(fake.sets.mock.calls[0][1]).not.toHaveProperty('status');
        expect(fake.sets.mock.calls[0][1]).not.toHaveProperty('lastPollAtMs');
        expect(fake.sets.mock.calls[0][1]).not.toHaveProperty('lastSyncedAtMs');
        expect(fake.sets.mock.calls[0][1]).not.toHaveProperty('lastErrorCode');
        expect(fake.sets.mock.calls[0][1]).toMatchObject({
            lastObservedAtMs: 12_000,
            updatedAtMs: 13_000,
        });
    });

    it('applies an authoritative guarded lifecycle state without regressing sync timestamps', async () => {
        const fake = fakeDatabase();
        const serviceMetaRef = fake.db.collection('users')
            .doc('user-1')
            .collection('meta')
            .doc('corosAPI');
        fake.stored.set(serviceMetaRef.path, {
            connectionState: 'connected',
            connectionStateGeneration: 'current-generation',
        });
        fake.stored.set('users/user-1/healthSyncState/COROSAPI', {
            provider: HEALTH_PROVIDERS.COROSAPI,
            status: HEALTH_SYNC_STATUSES.Failed,
            lastPollAtMs: 12_000,
            lastObservedAtMs: 11_000,
            lastErrorCode: 'stale_failure',
            updatedAtMs: 13_000,
        });

        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
            lastPollAtMs: 10_000,
            lastErrorCode: null,
        }, 10_000, {
            db: fake.db as never,
            requiredDocumentFieldValues: {
                documentRef: serviceMetaRef as never,
                expectedFields: {
                    connectionState: 'connected',
                    connectionStateGeneration: 'current-generation',
                },
            },
            authoritativeLifecycleTransition: true,
        })).resolves.toBe(true);

        expect(fake.sets).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            status: HEALTH_SYNC_STATUSES.Ready,
            lastErrorCode: null,
            updatedAtMs: 13_000,
        }), { merge: true });
        expect(fake.sets.mock.calls[0][1]).not.toHaveProperty('lastPollAtMs');
    });

    it('rejects authoritative lifecycle state without a skip-capable guard', async () => {
        const fake = fakeDatabase();

        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
            lastErrorCode: null,
        }, 10_000, {
            db: fake.db as never,
            authoritativeLifecycleTransition: true,
        })).rejects.toThrow('requires a lifecycle guard');

        expect(fake.db.runTransaction).not.toHaveBeenCalled();
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('rejects token-credential guards without a document reference', async () => {
        const fake = fakeDatabase();

        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
        }, 10_000, {
            db: fake.db as never,
            requiredExistingTokenCredential: tokenCredential('captured-token'),
        })).rejects.toThrow('requires a document reference');

        expect(fake.db.runTransaction).not.toHaveBeenCalled();
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('retains imported source records when a provider is disconnected', async () => {
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

    it('ignores a delayed disconnect state transition after the provider token root is recreated', async () => {
        const fake = fakeDatabase();
        const tokenRootRef = fake.db.collection('corosAPIAccessTokens').doc('user-1');
        fake.stored.set(tokenRootRef.path, { reconnected: true });

        const written = await markHealthProviderDisconnected(
            'user-1',
            HEALTH_PROVIDERS.COROSAPI,
            10_000,
            {
                db: fake.db as never,
                requiredMissingDocumentRef: tokenRootRef as never,
            },
        );

        expect(written).toBe(false);
        expect(fake.transaction.get).toHaveBeenCalledWith(tokenRootRef);
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('writes the guarded disconnect state while the provider token root remains absent', async () => {
        const fake = fakeDatabase();
        const tokenRootRef = fake.db.collection('corosAPIAccessTokens').doc('user-1');

        const written = await markHealthProviderDisconnected(
            'user-1',
            HEALTH_PROVIDERS.COROSAPI,
            10_000,
            {
                db: fake.db as never,
                requiredMissingDocumentRef: tokenRootRef as never,
            },
        );

        expect(written).toBe(true);
        expect(fake.transaction.get).toHaveBeenCalledWith(tokenRootRef);
        expect(fake.sets).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            status: HEALTH_SYNC_STATUSES.Disconnected,
        }), { merge: true });
    });

    it('atomically preserves reconnect-required when a missing token root has that current service state', async () => {
        const fake = fakeDatabase();
        const tokenRootRef = fake.db.collection('corosAPIAccessTokens').doc('user-1');
        const serviceMetaRef = fake.db.collection('users').doc('user-1').collection('meta').doc('corosAPI');
        fake.stored.set(serviceMetaRef.path, { connectionState: 'reconnect_required' });
        const dependencies = {
            db: fake.db as never,
            requiredMissingDocumentRef: tokenRootRef as never,
            updateWhenDocumentFieldEquals: {
                documentRef: serviceMetaRef as never,
                field: 'connectionState',
                expectedValue: 'reconnect_required',
                updateValue: {
                    status: HEALTH_SYNC_STATUSES.ReconnectRequired,
                    lastErrorCode: 'provider_auth_reconnect_required',
                },
            },
        };

        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Disconnected,
            lastErrorCode: null,
        }, 10_000, dependencies)).resolves.toBe(true);
        expect(fake.sets).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({
            status: HEALTH_SYNC_STATUSES.ReconnectRequired,
            lastErrorCode: 'provider_auth_reconnect_required',
        }), { merge: true });

        fake.stored.set(serviceMetaRef.path, { connectionState: 'connected' });
        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Disconnected,
            lastErrorCode: null,
        }, 11_000, dependencies)).resolves.toBe(true);
        expect(fake.sets).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({
            status: HEALTH_SYNC_STATUSES.Disconnected,
            lastErrorCode: null,
        }), { merge: true });
    });

    it('skips a source replacement after its provider token disappears', async () => {
        const fake = fakeDatabase();
        const tokenRef = fake.db.collection('corosAPIAccessTokens')
            .doc('user-1')
            .collection('tokens')
            .doc('account-1');

        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
            requiredExistingDocumentRef: tokenRef as never,
        });

        expect(result.status).toBe('skipped_lifecycle_guard');
        expect(fake.transaction.get).toHaveBeenCalledWith(tokenRef);
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('skips a source replacement after the provider token credential changes', async () => {
        const fake = fakeDatabase();
        const tokenRef = fake.db.collection('corosAPIAccessTokens')
            .doc('user-1')
            .collection('tokens')
            .doc('account-1');
        fake.stored.set(tokenRef.path, {
            openId: 'account-1',
            accessToken: 'replacement-token',
        });

        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
            requiredExistingDocumentRef: tokenRef as never,
            requiredExistingTokenCredential: tokenCredential('captured-token'),
        });

        expect(result.status).toBe('skipped_lifecycle_guard');
        expect(fake.transaction.get).toHaveBeenCalledWith(tokenRef);
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('skips a source replacement after the COROS connection generation changes', async () => {
        const fake = fakeDatabase();
        const tokenRef = fake.db.collection('corosAPIAccessTokens')
            .doc('user-1')
            .collection('tokens')
            .doc('account-1');
        const serviceMetaRef = fake.db.collection('users')
            .doc('user-1')
            .collection('meta')
            .doc('corosAPI');
        fake.stored.set(tokenRef.path, { openId: 'account-1' });
        fake.stored.set(serviceMetaRef.path, {
            providerUserId: 'account-2',
            connectionState: 'connected',
            connectionStateGeneration: 'new-generation',
        });

        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
            requiredExistingDocumentRef: tokenRef as never,
            requiredDocumentFieldValues: {
                documentRef: serviceMetaRef as never,
                expectedFields: {
                    providerUserId: 'account-1',
                    connectionState: 'connected',
                    connectionStateGeneration: 'old-generation',
                },
            },
        });

        expect(result.status).toBe('skipped_lifecycle_guard');
        expect(fake.transaction.get).toHaveBeenCalledWith(tokenRef);
        expect(fake.transaction.get).toHaveBeenCalledWith(serviceMetaRef);
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('skips a source replacement after the COROS token root is deleted', async () => {
        const fake = fakeDatabase();
        const tokenRootRef = fake.db.collection('corosAPIAccessTokens').doc('user-1');
        const tokenRef = tokenRootRef.collection('tokens').doc('account-1');
        const serviceMetaRef = fake.db.collection('users')
            .doc('user-1')
            .collection('meta')
            .doc('corosAPI');
        fake.stored.set(tokenRef.path, {
            accessToken: 'captured-token',
            tokenCredentialGeneration: 'captured-generation',
        });
        fake.stored.set(serviceMetaRef.path, {
            providerUserId: 'account-1',
            connectionState: 'connected',
            connectionStateGeneration: 'connection-generation-1',
        });

        const result = await replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
            requiredExistingDocumentRef: tokenRef as never,
            requiredExistingTokenCredential: tokenCredential('captured-token', 'captured-generation'),
            requiredDocumentFieldValues: {
                documentRef: serviceMetaRef as never,
                expectedFields: {
                    providerUserId: 'account-1',
                    connectionState: 'connected',
                    connectionStateGeneration: 'connection-generation-1',
                },
            },
            additionalRequiredDocumentFieldValues: [{
                documentRef: tokenRootRef as never,
                expectedFields: {
                    activeOAuthCredentialGeneration: 'captured-generation',
                },
            }],
        });

        expect(result.status).toBe('skipped_lifecycle_guard');
        expect(fake.transaction.get).toHaveBeenCalledWith(tokenRootRef);
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('redacts provider token paths when a lifecycle guard read fails', async () => {
        const fake = fakeDatabase();
        const privateAccountId = 'private-provider-account';
        const tokenRef = fake.db.collection('corosAPIAccessTokens')
            .doc('user-1')
            .collection('tokens')
            .doc(privateAccountId);
        fake.transaction.get.mockRejectedValueOnce(new Error(`Read failed for ${tokenRef.path}`));

        const write = replaceHealthSourceRecord('user-1', validInput(), 10_000, {
            db: fake.db as never,
            generateId: fakeId,
            requiredExistingDocumentRef: tokenRef as never,
        });

        await expect(write).rejects.toBeInstanceOf(HealthLifecycleGuardReadError);
        await expect(write).rejects.not.toThrow(privateAccountId);
        await expect(write).rejects.toThrow('Health lifecycle guard could not be read.');
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('writes guarded ready state only while its provider token still exists', async () => {
        const fake = fakeDatabase();
        const tokenRef = fake.db.collection('corosAPIAccessTokens')
            .doc('user-1')
            .collection('tokens')
            .doc('account-1');

        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
        }, 10_000, {
            db: fake.db as never,
            requiredExistingDocumentRef: tokenRef as never,
        })).resolves.toBe(false);
        expect(fake.sets).not.toHaveBeenCalled();

        fake.stored.set(tokenRef.path, {
            accessToken: 'captured-token',
            tokenCredentialGeneration: 'replacement-generation',
        });
        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
        }, 11_000, {
            db: fake.db as never,
            requiredExistingDocumentRef: tokenRef as never,
            requiredExistingTokenCredential: tokenCredential('captured-token', 'captured-generation'),
        })).resolves.toBe(false);
        expect(fake.sets).not.toHaveBeenCalled();

        fake.stored.set(tokenRef.path, {
            accessToken: 'captured-token',
            tokenCredentialGeneration: 'captured-generation',
        });
        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
        }, 12_000, {
            db: fake.db as never,
            requiredExistingDocumentRef: tokenRef as never,
            requiredExistingTokenCredential: tokenCredential('captured-token', 'captured-generation'),
        })).resolves.toBe(true);
        expect(fake.sets).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            status: HEALTH_SYNC_STATUSES.Ready,
        }), { merge: true });
    });

    it('does not write ready state after the COROS token root is deleted', async () => {
        const fake = fakeDatabase();
        const tokenRootRef = fake.db.collection('corosAPIAccessTokens').doc('user-1');
        const tokenRef = tokenRootRef.collection('tokens').doc('account-1');
        fake.stored.set(tokenRef.path, {
            accessToken: 'captured-token',
            tokenCredentialGeneration: 'captured-generation',
        });

        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
        }, 10_000, {
            db: fake.db as never,
            requiredExistingDocumentRef: tokenRef as never,
            requiredExistingTokenCredential: tokenCredential('captured-token', 'captured-generation'),
            additionalRequiredDocumentFieldValues: [{
                documentRef: tokenRootRef as never,
                expectedFields: {
                    activeOAuthCredentialGeneration: 'captured-generation',
                },
            }],
        })).resolves.toBe(false);

        expect(fake.transaction.get).toHaveBeenCalledWith(tokenRootRef);
        expect(fake.sets).not.toHaveBeenCalled();
    });

    it('writes lifecycle state only for the exact current connection generation', async () => {
        const fake = fakeDatabase();
        const serviceMetaRef = fake.db.collection('users')
            .doc('user-1')
            .collection('meta')
            .doc('corosAPI');
        fake.stored.set(serviceMetaRef.path, {
            connectionState: 'connected',
            connectionStateGeneration: 'new-generation',
        });

        const dependencies = {
            db: fake.db as never,
            requiredDocumentFieldValues: {
                documentRef: serviceMetaRef as never,
                expectedFields: {
                    connectionState: 'connected',
                    connectionStateGeneration: 'old-generation',
                },
            },
        };
        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
        }, 10_000, dependencies)).resolves.toBe(false);
        expect(fake.sets).not.toHaveBeenCalled();

        dependencies.requiredDocumentFieldValues.expectedFields.connectionStateGeneration = 'new-generation';
        await expect(updateHealthSyncState('user-1', HEALTH_PROVIDERS.COROSAPI, {
            status: HEALTH_SYNC_STATUSES.Ready,
        }, 10_000, dependencies)).resolves.toBe(true);
        expect(fake.sets).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            status: HEALTH_SYNC_STATUSES.Ready,
        }), { merge: true });
    });

    it('preserves the existing source-record creation time during replacement', async () => {
        const fake = fakeDatabase();
        const input = validInput();
        const built = await buildHealthSourceRecordWrite('user-1', input, 9_000, fakeId);
        const existing: HealthSourceRecord = { ...built.sourceRecord, createdAtMs: 0 };
        fake.stored.set(sourceRecordPath(existing.id), existing);
        (input.revision as Record<string, unknown>).order = 2;
        (input.revision as Record<string, unknown>).token = 'revision-2';

        const result = await replaceHealthSourceRecord('user-1', input, 10_000, {
            db: fake.db as never,
            generateId: fakeId,
        });

        expect(result.sourceRecord?.createdAtMs).toBe(0);
    });
});
