import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataMuscleMass, DataBodyWater, DataBoneMass, DataBloodOxygenSaturation } from '@sports-alliance/sports-lib';
import { MANUAL_HEALTH_VALUE_MAXIMUMS } from '../../../shared/manual-health';
import { decodeHealthSourceRecordSportsLibData } from '../../../shared/sports-lib-health-data';
import {
    HEALTH_METRIC_IDS,
    HEALTH_PROVIDERS,
    HEALTH_RECORDING_METHODS,
    HEALTH_SOURCE_RECORDS_COLLECTION_ID,
    HEALTH_UNITS,
    type HealthSourceRecord,
} from '../../../shared/health';

const hoisted = vi.hoisted(() => ({
    deletionGuard: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardStateInTransaction: hoisted.deletionGuard,
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));

import {
    deleteManualHealthMeasurement,
    ManualHealthMeasurementNotFoundError,
    ManualHealthRevisionConflictError,
    ManualHealthValidationError,
    ManualHealthWriteBlockedError,
    MANUAL_HEALTH_DELETIONS_COLLECTION_ID,
    saveManualHealthMeasurement,
    validateDeleteManualHealthMeasurementRequest,
    validateSaveManualHealthMeasurementRequest,
} from './manual-measurements';

interface FakeRef {
    path: string;
    id: string;
    collection: (id: string) => FakeCollection;
}

interface FakeCollection {
    doc: (id: string) => FakeRef;
}

function fakeDatabase() {
    const stored = new Map<string, unknown>();
    const collection = (path: string): FakeCollection => ({
        doc: (id: string) => document(`${path}/${id}`),
    });
    const document = (path: string): FakeRef => ({
        path,
        id: path.split('/').at(-1) || '',
        collection: (id: string) => collection(`${path}/${id}`),
    });
    const transaction = {
        get: vi.fn(async (ref: FakeRef) => ({
            exists: stored.has(ref.path),
            data: () => stored.get(ref.path),
        })),
        set: vi.fn((ref: FakeRef, value: unknown) => stored.set(ref.path, value)),
        update: vi.fn((ref: FakeRef, fields: Record<string, unknown>) => {
            const current = stored.get(ref.path) as Record<string, unknown>;
            stored.set(ref.path, { ...current, ...fields });
        }),
        delete: vi.fn((ref: FakeRef) => stored.delete(ref.path)),
    };
    const db = {
        collection,
        runTransaction: vi.fn(async (runner: (tx: typeof transaction) => unknown) => runner(transaction)),
    };
    return { db, stored, transaction };
}

const UID = 'owner';
const OBSERVED_AT_MS = Date.UTC(2026, 5, 1, 8, 30);
const MUTATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const ADDITIONAL_SCALAR_MEASUREMENTS = [
    { metricId: HEALTH_METRIC_IDS.MuscleMass, value: 52.4, dataClass: DataMuscleMass, unit: HEALTH_UNITS.Kilogram },
    { metricId: HEALTH_METRIC_IDS.BodyWater, value: 57.8, dataClass: DataBodyWater, unit: HEALTH_UNITS.Percent },
    { metricId: HEALTH_METRIC_IDS.BoneMass, value: 3.1, dataClass: DataBoneMass, unit: HEALTH_UNITS.Kilogram },
    { metricId: HEALTH_METRIC_IDS.BloodOxygenSaturation, value: 98, dataClass: DataBloodOxygenSaturation, unit: HEALTH_UNITS.Percent },
] as const;

function createWeightRequest() {
    return {
        mode: 'create' as const,
        clientMutationId: MUTATION_ID,
        metricId: HEALTH_METRIC_IDS.BodyWeight,
        canonicalValue: 72.4,
        observedAtMs: OBSERVED_AT_MS,
        timezoneOffsetSeconds: 3 * 60 * 60,
    };
}

function sourceRecordPath(sourceRecordId: string): string {
    return `users/${UID}/${HEALTH_SOURCE_RECORDS_COLLECTION_ID}/${sourceRecordId}`;
}

describe('manual Health measurement mutations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.deletionGuard.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
    });

    it('strictly validates canonical Weight and VO2 requests', () => {
        expect(validateSaveManualHealthMeasurementRequest(createWeightRequest(), OBSERVED_AT_MS + 1_000))
            .toEqual(createWeightRequest());
        expect(validateSaveManualHealthMeasurementRequest({
            mode: 'create',
            clientMutationId: MUTATION_ID,
            metricId: HEALTH_METRIC_IDS.Vo2Max,
            canonicalValue: 51.2,
            observedAtMs: OBSERVED_AT_MS,
            timezoneOffsetSeconds: 10_800,
            vo2Context: 'running',
            vo2Method: 'lab_test',
        }, OBSERVED_AT_MS + 1_000)).toMatchObject({
            metricId: HEALTH_METRIC_IDS.Vo2Max,
            vo2Context: 'running',
            vo2Method: 'lab_test',
        });
        expect(() => validateSaveManualHealthMeasurementRequest({
            ...createWeightRequest(),
            uid: 'someone-else',
        }, OBSERVED_AT_MS + 1_000)).toThrow(ManualHealthValidationError);
        expect(() => validateSaveManualHealthMeasurementRequest({
            ...createWeightRequest(),
            canonicalValue: 0,
        }, OBSERVED_AT_MS + 1_000)).toThrow(ManualHealthValidationError);
        expect(() => validateSaveManualHealthMeasurementRequest({
            ...createWeightRequest(),
            vo2Context: 'running',
        }, OBSERVED_AT_MS + 1_000)).toThrow(ManualHealthValidationError);
        expect(() => validateSaveManualHealthMeasurementRequest(
            Object.assign(Object.create({ mode: 'create' }), createWeightRequest()),
            OBSERVED_AT_MS + 1_000,
        )).toThrow(ManualHealthValidationError);
        expect(() => validateSaveManualHealthMeasurementRequest({
            mode: 'update',
            sourceRecordId: 'a'.repeat(64),
            expectedRevisionOrder: Number.MAX_SAFE_INTEGER,
            metricId: HEALTH_METRIC_IDS.BodyWeight,
            canonicalValue: 72.4,
            observedAtMs: OBSERVED_AT_MS,
            timezoneOffsetSeconds: 10_800,
        }, OBSERVED_AT_MS + 1_000)).toThrow(ManualHealthValidationError);
    });

    it.each([
        { metricId: HEALTH_METRIC_IDS.BodyFat, canonicalValue: 0 },
        { metricId: HEALTH_METRIC_IDS.BodyFat, canonicalValue: 101 },
        { metricId: HEALTH_METRIC_IDS.BodyFat, canonicalValue: 20, pulseValue: 65 },
        { metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, canonicalValue: 120 },
        { metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, canonicalValue: 120, diastolicValue: '80' },
        { metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, canonicalValue: 120, diastolicValue: 80, pulseValue: null },
        { metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, canonicalValue: 401, diastolicValue: 80 },
        { metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, canonicalValue: 120, diastolicValue: 0 },
        { metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, canonicalValue: 120, diastolicValue: 80, pulseValue: 401 },
        { metricId: HEALTH_METRIC_IDS.PulseRate, canonicalValue: 65 },
    ])('rejects invalid or unpaired manual input: %j', fields => {
        expect(() => validateSaveManualHealthMeasurementRequest({ ...createWeightRequest(), ...fields }, OBSERVED_AT_MS))
            .toThrow(ManualHealthValidationError);
    });

    it('stores body fat using its canonical Sports Lib class and manual provenance', async () => {
        const fake = fakeDatabase();
        const result = await saveManualHealthMeasurement(UID, {
            ...createWeightRequest(), metricId: HEALTH_METRIC_IDS.BodyFat, canonicalValue: 22.5,
        }, { db: fake.db as never, now: () => OBSERVED_AT_MS });
        expect(fake.stored.get(sourceRecordPath(result.sourceRecordId))).toMatchObject({
            metricIds: [HEALTH_METRIC_IDS.BodyFat],
            metrics: [{ sportsLibData: { metrics: { value: { 'Body Fat': 22.5 } } }, recordingMethod: 'manual' }],
        });
    });

    it.each(ADDITIONAL_SCALAR_MEASUREMENTS)('creates, edits and deletes canonical manual $metricId', async ({ metricId, value, dataClass, unit }) => {
        const fake = fakeDatabase();
        const dependencies = { db: fake.db as never, now: () => OBSERVED_AT_MS };
        const request = { ...createWeightRequest(), metricId, canonicalValue: value };
        const created = await saveManualHealthMeasurement(UID, request, dependencies);
        expect(await saveManualHealthMeasurement(UID, request, dependencies)).toEqual(created);
        const record = () => fake.stored.get(sourceRecordPath(created.sourceRecordId)) as HealthSourceRecord;
        expect(record()).toMatchObject({
            metricIds: [metricId], sampleChunkIds: [],
            source: { provider: HEALTH_PROVIDERS.QuantifiedSelf, sourceRecordType: 'manual_measurement' },
            metrics: [{ metricId, origin: 'recorded', recordingMethod: 'manual', aggregation: 'measurement', semanticVariant: 'point',
                native: { unit }, sportsLibData: { metrics: { value: { [dataClass.type]: value } } } }],
        });
        expect(record().metrics[0]).not.toHaveProperty('canonical');
        expect(decodeHealthSourceRecordSportsLibData(record()).metrics[0]).toMatchObject({ canonical: { value, unit } });
        const { clientMutationId, ...fields } = request;
        expect(JSON.stringify(record())).not.toContain(clientMutationId);
        const update = { ...fields, mode: 'update', sourceRecordId: created.sourceRecordId, expectedRevisionOrder: 1,
            canonicalValue: value + 0.1 };
        await saveManualHealthMeasurement(UID, update, dependencies);
        expect(record().metrics[0]).toMatchObject({ sportsLibData: { metrics: { value: { [dataClass.type]: value + 0.1 } } } });
        await expect(saveManualHealthMeasurement(UID, update, dependencies)).rejects.toBeInstanceOf(ManualHealthRevisionConflictError);
        await deleteManualHealthMeasurement(UID, { sourceRecordId: created.sourceRecordId, expectedRevisionOrder: 2 }, dependencies);
        expect(record()).toBeUndefined();
        await expect(saveManualHealthMeasurement(UID, request, dependencies)).rejects.toBeInstanceOf(ManualHealthMeasurementNotFoundError);
    });

    it.each(ADDITIONAL_SCALAR_MEASUREMENTS)('validates $metricId bounds and rejects unrelated measurement metadata', ({ metricId, value }) => {
        const request = { ...createWeightRequest(), metricId, canonicalValue: value };
        const maximum = MANUAL_HEALTH_VALUE_MAXIMUMS[metricId];
        for (const canonicalValue of [undefined, null, '5', 0, -1, NaN, Infinity, maximum + 0.1]) {
            expect(() => validateSaveManualHealthMeasurementRequest({ ...request, canonicalValue }, OBSERVED_AT_MS))
                .toThrow(ManualHealthValidationError);
        }
        expect(validateSaveManualHealthMeasurementRequest({ ...request, canonicalValue: maximum }, OBSERVED_AT_MS))
            .toMatchObject({ metricId, canonicalValue: maximum });
        for (const extra of [{ diastolicValue: 80 }, { pulseValue: 65 }, { vo2Context: 'general' }, { vo2Method: 'lab_test' }]) {
            expect(() => validateSaveManualHealthMeasurementRequest({ ...request, ...extra }, OBSERVED_AT_MS))
                .toThrow(ManualHealthValidationError);
        }
    });

    it('atomically creates, revises and deletes paired blood pressure including optional pulse', async () => {
        const fake = fakeDatabase();
        const dependencies = { db: fake.db as never, now: () => OBSERVED_AT_MS };
        const request = { ...createWeightRequest(), metricId: HEALTH_METRIC_IDS.BloodPressureSystolic,
            canonicalValue: 120, diastolicValue: 80, pulseValue: 65 };
        const first = await saveManualHealthMeasurement(UID, request, dependencies);
        expect(await saveManualHealthMeasurement(UID, request, dependencies)).toEqual(first);
        const record = () => fake.stored.get(sourceRecordPath(first.sourceRecordId)) as HealthSourceRecord;
        expect(record().metricIds).toEqual(['blood_pressure_diastolic', 'blood_pressure_systolic', 'pulse_rate']);
        expect(record().metrics.map(metric => metric.kind === 'value' && metric.native.value).sort()).toEqual([120, 65, 80]);
        expect(record().metrics.every(metric => metric.recordingMethod === 'manual' && !('canonical' in metric))).toBe(true);
        // Removing pulse is an intentional grouped edit, including index membership.
        const update = { mode: 'update', sourceRecordId: first.sourceRecordId, expectedRevisionOrder: 1,
            metricId: request.metricId, canonicalValue: 118, diastolicValue: 78,
            observedAtMs: OBSERVED_AT_MS, timezoneOffsetSeconds: 10_800 };
        await saveManualHealthMeasurement(UID, update, dependencies);
        expect(record().metricIds).toEqual(['blood_pressure_diastolic', 'blood_pressure_systolic']);
        expect(record().metrics).toHaveLength(2);
        await expect(saveManualHealthMeasurement(UID, update, dependencies)).rejects.toBeInstanceOf(ManualHealthRevisionConflictError);
        await expect(saveManualHealthMeasurement(UID, { ...update, expectedRevisionOrder: 2,
            metricId: HEALTH_METRIC_IDS.BodyFat, diastolicValue: undefined }, dependencies)).rejects.toBeInstanceOf(ManualHealthValidationError);
        await deleteManualHealthMeasurement(UID, { sourceRecordId: first.sourceRecordId, expectedRevisionOrder: 2 }, dependencies);
        expect(record()).toBeUndefined();
        await expect(saveManualHealthMeasurement(UID, request, dependencies)).rejects.toBeInstanceOf(ManualHealthMeasurementNotFoundError);
    });

    it('creates an idempotent opaque manual record without retaining the client mutation ID', async () => {
        const fake = fakeDatabase();
        const dependencies = {
            db: fake.db as never,
            now: () => OBSERVED_AT_MS + 10_000,
        };

        const first = await saveManualHealthMeasurement(UID, createWeightRequest(), dependencies);
        const second = await saveManualHealthMeasurement(UID, createWeightRequest(), {
            ...dependencies,
            now: () => OBSERVED_AT_MS + 20_000,
        });

        expect(second).toEqual(first);
        expect(first.sourceRecordId).toMatch(/^[a-f0-9]{64}$/);
        const stored = fake.stored.get(sourceRecordPath(first.sourceRecordId)) as HealthSourceRecord;
        expect(stored).toMatchObject({
            userID: UID,
            calendarDate: '2026-06-01',
            source: {
                provider: HEALTH_PROVIDERS.QuantifiedSelf,
                revision: { order: 1 },
            },
            metrics: [{
                metricId: HEALTH_METRIC_IDS.BodyWeight,
                recordingMethod: HEALTH_RECORDING_METHODS.Manual,
                sportsLibData: { metrics: { value: { Weight: 72.4 } } },
            }],
        });
        expect(stored.metrics[0]).not.toHaveProperty('canonical');
        expect(JSON.stringify(stored)).not.toContain(MUTATION_ID);
        expect(fake.transaction.set).toHaveBeenCalledTimes(1);
    });

    it('reports a reused create mutation ID with different content as a revision conflict', async () => {
        const fake = fakeDatabase();
        const dependencies = {
            db: fake.db as never,
            now: () => OBSERVED_AT_MS + 10_000,
        };

        await saveManualHealthMeasurement(UID, createWeightRequest(), dependencies);
        await expect(saveManualHealthMeasurement(UID, {
            ...createWeightRequest(),
            canonicalValue: 73.1,
        }, dependencies)).rejects.toBeInstanceOf(ManualHealthRevisionConflictError);

        expect(fake.transaction.set).toHaveBeenCalledTimes(1);
    });

    it('updates only an owner-scoped manual record under a matching revision fence', async () => {
        const fake = fakeDatabase();
        const created = await saveManualHealthMeasurement(UID, createWeightRequest(), {
            db: fake.db as never,
            now: () => OBSERVED_AT_MS + 10_000,
        });

        const updated = await saveManualHealthMeasurement(UID, {
            mode: 'update',
            sourceRecordId: created.sourceRecordId,
            expectedRevisionOrder: 1,
            metricId: HEALTH_METRIC_IDS.BodyWeight,
            canonicalValue: 71.8,
            observedAtMs: OBSERVED_AT_MS + 86_400_000,
            timezoneOffsetSeconds: 10_800,
        }, {
            db: fake.db as never,
            now: () => OBSERVED_AT_MS + 86_410_000,
        });

        expect(updated).toEqual({ sourceRecordId: created.sourceRecordId, revisionOrder: 2 });
        const stored = fake.stored.get(sourceRecordPath(created.sourceRecordId)) as HealthSourceRecord;
        expect(stored.startTimeMs).toBe(OBSERVED_AT_MS + 86_400_000);
        expect(stored.source.revision.order).toBe(2);
        expect(stored.source.revision.token).toMatch(/^[a-f0-9]{64}$/);
        expect(stored.metrics[0]).toMatchObject({
            sportsLibData: { metrics: { value: { Weight: 71.8 } } },
        });

        await expect(saveManualHealthMeasurement(UID, {
            mode: 'update',
            sourceRecordId: created.sourceRecordId,
            expectedRevisionOrder: 1,
            metricId: HEALTH_METRIC_IDS.BodyWeight,
            canonicalValue: 70,
            observedAtMs: OBSERVED_AT_MS,
            timezoneOffsetSeconds: 10_800,
        }, { db: fake.db as never, now: () => OBSERVED_AT_MS + 90_000_000 }))
            .rejects.toBeInstanceOf(ManualHealthRevisionConflictError);
    });

    it('does not allow a non-manual provider record to be edited through the callable boundary', async () => {
        const fake = fakeDatabase();
        const sourceRecordId = 'a'.repeat(64);
        fake.stored.set(sourceRecordPath(sourceRecordId), {
            id: sourceRecordId,
            userID: UID,
            source: { provider: HEALTH_PROVIDERS.GarminAPI },
        });

        await expect(saveManualHealthMeasurement(UID, {
            mode: 'update',
            sourceRecordId,
            expectedRevisionOrder: 1,
            metricId: HEALTH_METRIC_IDS.BodyWeight,
            canonicalValue: 70,
            observedAtMs: OBSERVED_AT_MS,
            timezoneOffsetSeconds: 0,
        }, { db: fake.db as never, now: () => OBSERVED_AT_MS + 1_000 }))
            .rejects.toBeInstanceOf(ManualHealthMeasurementNotFoundError);
    });

    it('deletes a validated leaf under a revision fence and treats a missing retry as complete', async () => {
        const fake = fakeDatabase();
        const created = await saveManualHealthMeasurement(UID, createWeightRequest(), {
            db: fake.db as never,
            now: () => OBSERVED_AT_MS + 1_000,
        });
        const request = {
            sourceRecordId: created.sourceRecordId,
            expectedRevisionOrder: created.revisionOrder,
        };

        await expect(deleteManualHealthMeasurement(UID, request, {
            db: fake.db as never,
            now: () => OBSERVED_AT_MS + 2_000,
        })).resolves.toEqual({ deleted: true });
        await expect(deleteManualHealthMeasurement(UID, request, {
            db: fake.db as never,
            now: () => OBSERVED_AT_MS + 3_000,
        })).resolves.toEqual({ deleted: false });
        expect(fake.stored.has(sourceRecordPath(created.sourceRecordId))).toBe(false);
    });

    it('blocks writes once account deletion begins', async () => {
        const fake = fakeDatabase();
        hoisted.deletionGuard.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });
        await expect(saveManualHealthMeasurement(UID, createWeightRequest(), {
            db: fake.db as never,
            now: () => OBSERVED_AT_MS + 1_000,
        })).rejects.toBeInstanceOf(ManualHealthWriteBlockedError);
        expect(fake.transaction.set).not.toHaveBeenCalled();
    });

    it.each(['exact', 'uppercase', 'changed-value', 'changed-metric'])('does not resurrect a deleted measurement on a %s create retry', async variant => {
        const fake = fakeDatabase();
        const dependencies = { db: fake.db as never, now: () => OBSERVED_AT_MS + 10_000 };
        const request = createWeightRequest();
        const created = await saveManualHealthMeasurement(UID, request, dependencies);
        await deleteManualHealthMeasurement(UID, {
            sourceRecordId: created.sourceRecordId,
            expectedRevisionOrder: 1,
        }, dependencies);
        const replay = variant === 'uppercase' ? { ...request, clientMutationId: MUTATION_ID.toUpperCase() }
            : variant === 'changed-value' ? { ...request, canonicalValue: 71 }
                : variant === 'changed-metric' ? {
                    ...request, metricId: HEALTH_METRIC_IDS.Vo2Max, canonicalValue: 50,
                    vo2Context: 'running', vo2Method: 'lab_test',
                } : request;

        await expect(saveManualHealthMeasurement(UID, replay, dependencies))
            .rejects.toBeInstanceOf(ManualHealthMeasurementNotFoundError);
        expect(fake.stored.has(sourceRecordPath(created.sourceRecordId))).toBe(false);
        expect([...fake.stored.entries()]).toEqual([[
            `users/${UID}/${MANUAL_HEALTH_DELETIONS_COLLECTION_ID}/${created.sourceRecordId}`,
            { deleted: true },
        ]]);
        // Another owner may independently use the same UUID; it is not a global marker.
        await expect(saveManualHealthMeasurement('other-owner', request, dependencies)).resolves.toBeDefined();
        // A new intentional measurement remains possible for the original owner.
        await expect(saveManualHealthMeasurement(UID, {
            ...request, clientMutationId: '223e4567-e89b-42d3-a456-426614174000',
        }, dependencies)).resolves.toBeDefined();
    });

    it('does not create deletion markers for missing records or stale revisions', async () => {
        const fake = fakeDatabase();
        const dependencies = { db: fake.db as never, now: () => OBSERVED_AT_MS + 1_000 };
        await expect(deleteManualHealthMeasurement(UID, {
            sourceRecordId: 'a'.repeat(64), expectedRevisionOrder: 1,
        }, dependencies)).resolves.toEqual({ deleted: false });
        expect(fake.stored.size).toBe(0);
        const created = await saveManualHealthMeasurement(UID, createWeightRequest(), dependencies);
        await expect(deleteManualHealthMeasurement(UID, {
            sourceRecordId: created.sourceRecordId, expectedRevisionOrder: 2,
        }, dependencies)).rejects.toBeInstanceOf(ManualHealthRevisionConflictError);
        expect(fake.stored.size).toBe(1);
    });

    it('keeps deletion terminal after an edit and rejects malformed marker contents', async () => {
        const fake = fakeDatabase();
        const dependencies = { db: fake.db as never, now: () => OBSERVED_AT_MS + 10_000 };
        const request = createWeightRequest();
        const created = await saveManualHealthMeasurement(UID, request, dependencies);
        const updated = await saveManualHealthMeasurement(UID, {
            mode: 'update', sourceRecordId: created.sourceRecordId, expectedRevisionOrder: 1,
            metricId: request.metricId, canonicalValue: 71,
            observedAtMs: request.observedAtMs, timezoneOffsetSeconds: request.timezoneOffsetSeconds,
        }, dependencies);
        await deleteManualHealthMeasurement(UID, {
            sourceRecordId: updated.sourceRecordId, expectedRevisionOrder: updated.revisionOrder,
        }, dependencies);
        const markerPath = `users/${UID}/${MANUAL_HEALTH_DELETIONS_COLLECTION_ID}/${created.sourceRecordId}`;
        fake.stored.set(markerPath, { deleted: false });
        await expect(saveManualHealthMeasurement(UID, request, dependencies))
            .rejects.toBeInstanceOf(ManualHealthMeasurementNotFoundError);
        expect(fake.stored.has(sourceRecordPath(created.sourceRecordId))).toBe(false);
        expect(fake.transaction.get).toHaveBeenCalledWith(expect.objectContaining({ path: markerPath }));
    });

    it('rechecks account deletion inside update and delete transactions', async () => {
        const fake = fakeDatabase();
        const created = await saveManualHealthMeasurement(UID, createWeightRequest(), {
            db: fake.db as never,
            now: () => OBSERVED_AT_MS + 1_000,
        });
        hoisted.deletionGuard.mockResolvedValue({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        await expect(saveManualHealthMeasurement(UID, {
            mode: 'update',
            sourceRecordId: created.sourceRecordId,
            expectedRevisionOrder: 1,
            metricId: HEALTH_METRIC_IDS.BodyWeight,
            canonicalValue: 71,
            observedAtMs: OBSERVED_AT_MS,
            timezoneOffsetSeconds: 10_800,
        }, { db: fake.db as never, now: () => OBSERVED_AT_MS + 2_000 }))
            .rejects.toBeInstanceOf(ManualHealthWriteBlockedError);
        await expect(deleteManualHealthMeasurement(UID, {
            sourceRecordId: created.sourceRecordId,
            expectedRevisionOrder: 1,
        }, { db: fake.db as never, now: () => OBSERVED_AT_MS + 3_000 }))
            .rejects.toBeInstanceOf(ManualHealthWriteBlockedError);

        expect(fake.stored.has(sourceRecordPath(created.sourceRecordId))).toBe(true);
        expect(fake.stored.size).toBe(1); // No marker was written after account deletion began.
    });

    it('validates deletes without accepting caller ownership fields', () => {
        expect(validateDeleteManualHealthMeasurementRequest({
            sourceRecordId: 'b'.repeat(64),
            expectedRevisionOrder: 2,
        })).toEqual({ sourceRecordId: 'b'.repeat(64), expectedRevisionOrder: 2 });
        expect(() => validateDeleteManualHealthMeasurementRequest({
            sourceRecordId: 'b'.repeat(64),
            expectedRevisionOrder: 2,
            uid: 'other',
        })).toThrow(ManualHealthValidationError);
    });
});
