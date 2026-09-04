import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    HEALTH_METRIC_IDS,
    HEALTH_PROVIDERS,
    HEALTH_RECORDING_METHODS,
    HEALTH_SOURCE_RECORDS_COLLECTION_ID,
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
