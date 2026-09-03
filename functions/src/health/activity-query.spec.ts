import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();
    return {
        ...actual,
        DataVO2Max: actual.DataVO2Max,
        DataWeight: actual.DataWeight,
    };
});

import {
    ACTIVITY_HEALTH_INCOMPLETE_REASONS,
    ACTIVITY_HEALTH_SOURCE_KINDS,
} from '../../../shared/activity-health';
import {
    HEALTH_METRIC_IDS,
    HEALTH_PROVIDERS,
    HEALTH_UNITS,
} from '../../../shared/health';
import {
    ACTIVITY_HEALTH_MAX_CANDIDATES,
    ACTIVITY_HEALTH_MAX_PROJECTED_OUTPUT_BYTES,
    ACTIVITY_HEALTH_QUERY_PAGE_SIZE,
    ACTIVITY_HEALTH_QUERY_PLANS,
    ActivityHealthQueryValidationError,
    readActivityHealthRange,
    type ActivityHealthQueryPageDocument,
    type ActivityHealthQueryPageRequest,
} from './activity-query';

const START_MS = Date.UTC(2026, 0, 1);
const END_MS = Date.UTC(2026, 0, 31, 23, 59, 59, 999);

function query(metricId: 'body_weight' | 'vo2_max') {
    return { metricId, startTimeMs: START_MS, endTimeMs: END_MS };
}

function weightDocument(
    id: string,
    startDate: unknown = START_MS,
    value: unknown = 72.4,
    source = 'Garmin API',
): ActivityHealthQueryPageDocument {
    return {
        id,
        cursor: `cursor-${id}`,
        data: {
            startDate,
            stats: { Weight: value },
            sourceServiceName: source,
            creator: {
                name: 'private-device',
                serialNumber: 'private-serial',
            },
            activities: [
                { stats: { Weight: 72.4 } },
                { stats: { Weight: 72.4 } },
            ],
            name: 'Private workout name',
            location: 'Private location',
            userID: 'private-user',
        },
    };
}

function vo2Document(
    id: string,
    startDate: unknown,
    value: unknown,
    type = 'Running',
    source = 'Garmin API',
    eventStartDate: unknown = startDate,
    creatorName = 'private-device',
): ActivityHealthQueryPageDocument {
    return {
        id,
        cursor: `cursor-${id}`,
        data: {
            eventStartDate,
            startDate,
            type,
            stats: { 'VO2 Max': value },
            sourceServiceName: source,
            creator: { name: creatorName, serialNumber: 'private-serial' },
        },
    };
}

describe('readActivityHealthRange', () => {
    it('uses the event Weight plan, exact owner range, field mask, and one event observation', async () => {
        const readPage = vi.fn(async () => [weightDocument('event-1')]);
        const result = await readActivityHealthRange('owner-user', query('body_weight'), { readPage });

        expect(readPage).toHaveBeenCalledWith({
            ...ACTIVITY_HEALTH_QUERY_PLANS.body_weight,
            userID: 'owner-user',
            startTimeMs: START_MS,
            endTimeMs: END_MS,
            cursor: null,
            fetchLimit: ACTIVITY_HEALTH_QUERY_PAGE_SIZE,
        });
        expect(ACTIVITY_HEALTH_QUERY_PLANS.body_weight).toMatchObject({
            collectionId: 'events',
            timestampField: 'startDate',
            statisticField: 'stats.Weight',
            statisticKey: 'Weight',
        });
        expect(result).toMatchObject({ complete: true, candidateCount: 1, incompleteReason: null });
        expect(result.observations).toHaveLength(1);
        expect(result.observations[0]).toMatchObject({
            metricId: HEALTH_METRIC_IDS.BodyWeight,
            observedAtMs: START_MS,
            value: 72.4,
            unit: HEALTH_UNITS.Kilogram,
            provider: HEALTH_PROVIDERS.GarminAPI,
            sourceKind: ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutProfileContext,
            discipline: null,
            semanticVariant: 'workout_profile_context',
        });
        expect(Object.keys(result.observations[0]).sort()).toEqual([
            'discipline',
            'id',
            'metricId',
            'observedAtMs',
            'provider',
            'semanticVariant',
            'sourceAccountKey',
            'sourceKind',
            'unit',
            'value',
        ]);
        expect(JSON.stringify(result)).not.toContain('event-1');
        expect(JSON.stringify(result)).not.toContain('private-');
        expect(JSON.stringify(result)).not.toContain('Private workout');
        expect(JSON.stringify(result)).not.toContain('owner-user');
    });

    it('uses individual activities for VO2 and preserves discipline instead of an event maximum', async () => {
        const documents = [
            vo2Document(
                'run',
                START_MS + 1_000,
                51,
                'Running',
                'Garmin API',
            ),
            vo2Document(
                'bike',
                START_MS + 2_000,
                48,
                'Cycling',
                'Garmin API',
            ),
        ];
        const result = await readActivityHealthRange('owner', query('vo2_max'), {
            readPage: async () => documents,
        });

        expect(ACTIVITY_HEALTH_QUERY_PLANS.vo2_max).toMatchObject({
            collectionId: 'activities',
            timestampField: 'startDate',
            observationTimestampField: 'startDate',
            statisticField: 'stats.`VO2 Max`',
            statisticKey: 'VO2 Max',
        });
        expect(result.observations.map(item => ({ value: item.value, discipline: item.discipline }))).toEqual([
            { value: 51, discipline: 'running' },
            { value: 48, discipline: 'cycling' },
        ]);
        expect(result.observations.map(item => item.observedAtMs)).toEqual([
            START_MS + 1_000,
            START_MS + 2_000,
        ]);
        expect(result.observations.every(item => item.semanticVariant.startsWith('workout_imported_'))).toBe(true);
    });

    it('keeps an in-window VO2 activity when its merged parent event starts outside the window', async () => {
        const childStartDate = START_MS + 5_000;
        const parentEventStartDate = START_MS - 60_000;
        const result = await readActivityHealthRange('owner', query('vo2_max'), {
            readPage: async () => [vo2Document(
                'in-window-child',
                childStartDate,
                52,
                'Running',
                'Garmin API',
                parentEventStartDate,
            )],
        });

        expect(result.observations).toHaveLength(1);
        expect(result.observations[0]).toMatchObject({
            observedAtMs: childStartDate,
            value: 52,
            discipline: 'running',
        });
        expect(ACTIVITY_HEALTH_QUERY_PLANS.vo2_max.selectedFields).not.toContain('eventStartDate');
    });

    it('accepts stored number, Date, Timestamp, and timestamp-like date representations', async () => {
        const timestampLike = { seconds: Math.floor((START_MS + 3_000) / 1000), nanoseconds: 0 };
        const dates = [
            START_MS,
            new Date(START_MS + 1_000),
            Timestamp.fromMillis(START_MS + 2_000),
            timestampLike,
        ];
        const result = await readActivityHealthRange('owner', query('body_weight'), {
            readPage: async () => dates.map((date, index) => weightDocument(`${index}`, date, 70 + index)),
        });
        expect(result.observations.map(item => item.observedAtMs)).toEqual([
            START_MS,
            START_MS + 1_000,
            START_MS + 2_000,
            START_MS + 3_000,
        ]);
    });

    it('does not project a child activity timestamp outside the selected Health window', async () => {
        const result = await readActivityHealthRange('owner', query('vo2_max'), {
            readPage: async () => [vo2Document(
                'outside-child',
                END_MS + 1,
                51,
                'Running',
                'Garmin API',
                END_MS,
            )],
        });

        expect(result).toMatchObject({ complete: true, candidateCount: 1, observations: [] });
    });

    it('pages with the last processed cursor and stops explicitly at the candidate cap', async () => {
        const readPage = vi.fn(async (request: ActivityHealthQueryPageRequest) => (
            request.cursor === null
                ? [weightDocument('1'), weightDocument('2')]
                : [weightDocument('3')]
        ));
        const result = await readActivityHealthRange('owner', query('body_weight'), {
            readPage,
            limits: { pageSize: 2, maxCandidates: 2 },
        });
        expect(result).toMatchObject({
            complete: false,
            candidateCount: 2,
            incompleteReason: ACTIVITY_HEALTH_INCOMPLETE_REASONS.CandidateLimit,
        });
        expect(result.observations).toHaveLength(2);
        expect(readPage).toHaveBeenCalledTimes(1);
    });

    it('walks exact 128-document internal pages without duplicating the cursor document', async () => {
        const readPage = vi.fn(async (request: ActivityHealthQueryPageRequest) => (
            request.cursor === null
                ? [weightDocument('1'), weightDocument('2')]
                : [weightDocument('3')]
        ));
        const result = await readActivityHealthRange('owner', query('body_weight'), {
            readPage,
            limits: { pageSize: 2 },
        });
        expect(result.complete).toBe(true);
        expect(result.candidateCount).toBe(3);
        expect(result.observations).toHaveLength(3);
        expect(readPage.mock.calls[1][0].cursor).toBe('cursor-2');
    });

    it('stops before the projected output byte budget and identifies the bound', async () => {
        const result = await readActivityHealthRange('owner', query('body_weight'), {
            readPage: async () => [weightDocument('1')],
            limits: { maxProjectedOutputBytes: 600 },
        });
        expect(result).toMatchObject({
            complete: false,
            incompleteReason: ACTIVITY_HEALTH_INCOMPLETE_REASONS.SerializedBytes,
            candidateCount: 1,
            observations: [],
        });
    });

    it('collapses only consecutive equal VO2 values within each account and discipline', async () => {
        const documents = [
            vo2Document('run-1', START_MS + 1_000, 50, 'Running'),
            vo2Document('run-2', START_MS + 2_000, 50, 'Running'),
            vo2Document('run-3', START_MS + 3_000, 51, 'Running'),
            vo2Document('run-4', START_MS + 4_000, 50, 'Running'),
            vo2Document('bike-1', START_MS + 2_500, 50, 'Cycling'),
            vo2Document(
                'other-account',
                START_MS + 3_500,
                51,
                'Running',
                'Garmin API',
                START_MS + 3_500,
                'second-private-device',
            ),
        ];
        const result = await readActivityHealthRange('owner', query('vo2_max'), {
            readPage: async () => documents,
        });
        expect(result.observations.map(item => [item.id, item.value, item.discipline])).toHaveLength(5);
        expect(result.observations.map(item => [item.observedAtMs, item.value, item.discipline])).toEqual([
            [START_MS + 2_000, 50, 'running'],
            [START_MS + 2_500, 50, 'cycling'],
            [START_MS + 3_000, 51, 'running'],
            [START_MS + 3_500, 51, 'running'],
            [START_MS + 4_000, 50, 'running'],
        ]);
        expect(new Set(result.observations
            .filter(item => item.discipline === 'running')
            .map(item => item.sourceAccountKey)).size).toBe(2);
    });

    it('drops unknown sources without returning raw source text or inventing provenance', async () => {
        const result = await readActivityHealthRange('owner', query('body_weight'), {
            readPage: async () => [weightDocument('unknown', START_MS, 70, 'Private importer')],
        });
        expect(result).toMatchObject({ complete: true, candidateCount: 1, observations: [] });
        expect(JSON.stringify(result)).not.toContain('Private importer');
    });

    it('prefers an authoritative source service over a different device brand', async () => {
        const document = weightDocument('source-priority', START_MS, 70, 'Suunto App');
        document.data.creator = {
            name: 'Garmin-compatible private device',
            manufacturer: 'Garmin',
            serialNumber: 'private-serial',
        };

        const result = await readActivityHealthRange('owner', query('body_weight'), {
            readPage: async () => [document],
        });

        expect(result.observations).toHaveLength(1);
        expect(result.observations[0].provider).toBe(HEALTH_PROVIDERS.SuuntoApp);
        expect(JSON.stringify(result)).not.toContain('private-serial');
    });

    it('drops missing, invalid, non-finite, and non-positive metric values', async () => {
        const values = [null, '72', Number.NaN, Number.POSITIVE_INFINITY, 0, -1, { value: 71 }];
        const result = await readActivityHealthRange('owner', query('body_weight'), {
            readPage: async () => values.map((value, index) => weightDocument(`${index}`, START_MS, value)),
        });
        expect(result.candidateCount).toBe(values.length);
        expect(result.observations.map(item => item.value)).toEqual([71]);
    });

    it('rejects unsupported metrics, unknown fields, invalid timestamps, and oversized ranges', async () => {
        const invalid = [
            { ...query('body_weight'), metricId: 'heart_rate' },
            { ...query('body_weight'), userID: 'another-user' },
            { ...query('body_weight'), startTimeMs: 1.5 },
            { ...query('body_weight'), startTimeMs: END_MS + 1 },
            { ...query('body_weight'), endTimeMs: START_MS + (367 * 24 * 60 * 60 * 1000) },
        ];
        for (const request of invalid) {
            await expect(readActivityHealthRange('owner', request, { readPage: vi.fn() }))
                .rejects.toBeInstanceOf(ActivityHealthQueryValidationError);
        }
    });

    it('keeps the published production bounds fixed', () => {
        expect(ACTIVITY_HEALTH_QUERY_PAGE_SIZE).toBe(128);
        expect(ACTIVITY_HEALTH_MAX_CANDIDATES).toBe(2_048);
        expect(ACTIVITY_HEALTH_MAX_PROJECTED_OUTPUT_BYTES).toBe(1024 * 1024);
    });
});

describe('default Firestore query construction', () => {
    function fakeFirestore() {
        const calls = {
            userID: '',
            collectionId: '',
            where: [] as unknown[][],
            orderBy: [] as unknown[][],
            select: [] as unknown[],
            limit: 0,
        };
        const chain = {
            collection: vi.fn((collectionId: string) => {
                if (!calls.collectionId) calls.collectionId = collectionId;
                else calls.collectionId = collectionId;
                return chain;
            }),
            doc: vi.fn((userID: string) => {
                calls.userID = userID;
                return chain;
            }),
            where: vi.fn((...args: unknown[]) => {
                calls.where.push(args);
                return chain;
            }),
            orderBy: vi.fn((...args: unknown[]) => {
                calls.orderBy.push(args);
                return chain;
            }),
            select: vi.fn((...args: unknown[]) => {
                calls.select = args;
                return chain;
            }),
            startAfter: vi.fn(() => chain),
            limit: vi.fn((value: number) => {
                calls.limit = value;
                return chain;
            }),
            get: vi.fn(async () => ({ docs: [] })),
        };
        return { db: chain, calls };
    }

    it('queries numeric event startDate and only the Weight projection', async () => {
        const { db, calls } = fakeFirestore();
        await readActivityHealthRange('owner', query('body_weight'), { db: db as never });
        expect(calls.userID).toBe('owner');
        expect(calls.collectionId).toBe('events');
        expect(calls.where.slice(0, 2)).toEqual([
            ['startDate', '>=', START_MS],
            ['startDate', '<=', END_MS],
        ]);
        expect(calls.where[2]).toEqual(['stats.Weight', '>', 0]);
        expect(calls.select).toEqual(ACTIVITY_HEALTH_QUERY_PLANS.body_weight.selectedFields);
    });

    it('queries numeric child activity startDate and only the VO2 projection', async () => {
        const { db, calls } = fakeFirestore();
        await readActivityHealthRange('owner', query('vo2_max'), { db: db as never });
        expect(calls.collectionId).toBe('activities');
        expect(calls.where.slice(0, 2)).toEqual([
            ['startDate', '>=', START_MS],
            ['startDate', '<=', END_MS],
        ]);
        expect(calls.where[2]).toEqual(['stats.`VO2 Max`', '>', 0]);
        expect(calls.select).toEqual(ACTIVITY_HEALTH_QUERY_PLANS.vo2_max.selectedFields);
        expect(calls.select).not.toContain('eventStartDate');
    });
});
