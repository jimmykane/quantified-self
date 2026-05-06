import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    onDocumentWritten: vi.fn((_opts: unknown, handler: unknown) => handler),
    transactionGet: vi.fn(),
    transactionSet: vi.fn(),
    runTransaction: vi.fn(),
    collection: vi.fn(),
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    timestampFromDate: vi.fn((date: Date) => ({
        toDate: () => date,
        toMillis: () => date.getTime(),
    })),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: hoisted.onDocumentWritten,
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin', () => {
    const makeDocRef = (path: string): any => ({
        path,
        collection: vi.fn((collectionId: string) => ({
            doc: vi.fn((docId: string) => makeDocRef(`${path}/${collectionId}/${docId}`)),
        })),
    });

    const collection = vi.fn((collectionId: string) => ({
        doc: vi.fn((docId: string) => makeDocRef(`${collectionId}/${docId}`)),
    }));
    hoisted.collection = collection;

    return {
        initializeApp: vi.fn(),
        apps: [],
        firestore: Object.assign(vi.fn(() => ({
            collection,
            runTransaction: hoisted.runTransaction,
        })), {
            FieldValue: {
                serverTimestamp: hoisted.serverTimestamp,
            },
            Timestamp: {
                fromDate: hoisted.timestampFromDate,
            },
        }),
    };
});

import {
    applyEventStatsDelta,
    calculateEventStatsDelta,
    onEventStatsWrite,
} from './event-stats';

function makeSnapshot(data: Record<string, unknown> | null): { exists: boolean; data: () => Record<string, unknown> | null } {
    return {
        exists: data !== null,
        data: () => data,
    };
}

function makeWriteEvent(params: {
    uid?: string;
    eventId?: string;
    id?: string;
    time?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
}): any {
    return {
        id: params.id ?? 'cloud-event-1',
        time: params.time ?? '2026-05-06T10:00:00.000Z',
        params: {
            uid: params.uid ?? 'user-1',
            eventId: params.eventId ?? 'event-1',
        },
        data: {
            before: makeSnapshot(params.before ?? null),
            after: makeSnapshot(params.after ?? null),
        },
    };
}

describe('event stats trigger', () => {
    beforeEach(() => {
        vi.useRealTimers();
        hoisted.transactionGet.mockReset();
        hoisted.transactionSet.mockReset();
        hoisted.runTransaction.mockReset();
        hoisted.serverTimestamp.mockClear();
        hoisted.timestampFromDate.mockClear();
        hoisted.transactionGet.mockImplementation(async (ref: { path: string }) => {
            if (ref.path.startsWith('eventStatsProcessedWrites/')) {
                return { exists: false, data: () => undefined };
            }
            if (ref.path === 'users/user-1') {
                return { exists: true, data: () => ({}) };
            }
            if (ref.path === 'users/user-1/stats/events') {
                return {
                    exists: true,
                    data: () => ({ total: 3, standard: 2, benchmark: 1 }),
                };
            }
            return { exists: false, data: () => undefined };
        });
        hoisted.runTransaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback({
            get: hoisted.transactionGet,
            set: hoisted.transactionSet,
        }));
    });

    it('configures a retry-safe event stats trigger', () => {
        expect(hoisted.onDocumentWritten).toHaveBeenCalledWith(
            expect.objectContaining({
                document: 'users/{uid}/events/{eventId}',
                retry: true,
            }),
            expect.any(Function),
        );
    });

    it('calculates standard and benchmark deltas', () => {
        expect(calculateEventStatsDelta(null, { mergeType: 'multi' })).toEqual({
            total: 1,
            standard: 1,
            benchmark: 0,
        });
        expect(calculateEventStatsDelta(null, { mergeType: 'benchmark' })).toEqual({
            total: 1,
            standard: 0,
            benchmark: 1,
        });
        expect(calculateEventStatsDelta({ mergeType: 'benchmark' }, null)).toEqual({
            total: -1,
            standard: 0,
            benchmark: -1,
        });
        expect(calculateEventStatsDelta({ mergeType: 'benchmark' }, { mergeType: 'multi' })).toEqual({
            total: 0,
            standard: 1,
            benchmark: -1,
        });
    });

    it('clamps applied deltas at zero', () => {
        expect(applyEventStatsDelta(
            { total: 0, standard: 0, benchmark: 0 },
            { total: -1, standard: -1, benchmark: 0 },
        )).toEqual({ total: 0, standard: 0, benchmark: 0 });
    });

    it('increments stats for a standard create', async () => {
        await (onEventStatsWrite as any)(makeWriteEvent({
            after: { mergeType: 'multi' },
        }));

        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'users/user-1/stats/events' }),
            expect.objectContaining({
                kind: 'events',
                total: 4,
                standard: 3,
                benchmark: 1,
                schemaVersion: 1,
            }),
            { merge: true },
        );
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: expect.stringMatching(/^eventStatsProcessedWrites\//) }),
            expect.objectContaining({
                uid: 'user-1',
                eventId: 'event-1',
                cloudEventId: 'cloud-event-1',
                eventTimeMs: Date.parse('2026-05-06T10:00:00.000Z'),
                delta: { total: 1, standard: 1, benchmark: 0 },
                processedAt: 'SERVER_TIMESTAMP',
                expireAt: expect.objectContaining({
                    toMillis: expect.any(Function),
                }),
            }),
        );
        expect(hoisted.timestampFromDate).toHaveBeenCalledWith(expect.any(Date));
    });

    it('moves counts when classification changes on update', async () => {
        await (onEventStatsWrite as any)(makeWriteEvent({
            before: { mergeType: 'benchmark' },
            after: { mergeType: 'multi' },
        }));

        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'users/user-1/stats/events' }),
            expect.objectContaining({
                total: 3,
                standard: 3,
                benchmark: 0,
            }),
            { merge: true },
        );
    });

    it('does not write markers for updates that do not change stats', async () => {
        await (onEventStatsWrite as any)(makeWriteEvent({
            before: { mergeType: 'multi', name: 'Morning ride' },
            after: { mergeType: 'multi', name: 'Morning ride edited' },
        }));

        expect(hoisted.runTransaction).not.toHaveBeenCalled();
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });

    it('does not apply a stats delta twice for the same CloudEvent id', async () => {
        hoisted.transactionGet.mockImplementation(async (ref: { path: string }) => {
            if (ref.path.startsWith('eventStatsProcessedWrites/')) {
                return { exists: true, data: () => ({}) };
            }
            return { exists: false, data: () => undefined };
        });

        await (onEventStatsWrite as any)(makeWriteEvent({
            after: { mergeType: 'benchmark' },
        }));

        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });

    it('skips delete counter updates when the user root is missing', async () => {
        hoisted.transactionGet.mockImplementation(async (ref: { path: string }) => {
            if (ref.path.startsWith('eventStatsProcessedWrites/')) {
                return { exists: false, data: () => undefined };
            }
            if (ref.path === 'users/user-1') {
                return { exists: false, data: () => undefined };
            }
            return { exists: false, data: () => undefined };
        });

        await (onEventStatsWrite as any)(makeWriteEvent({
            before: { mergeType: 'benchmark' },
            after: null,
        }));

        expect(hoisted.transactionSet).toHaveBeenCalledTimes(1);
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: expect.stringMatching(/^eventStatsProcessedWrites\//) }),
            expect.objectContaining({
                skippedReason: 'missing-user-root',
                eventTimeMs: Date.parse('2026-05-06T10:00:00.000Z'),
                expireAt: expect.objectContaining({
                    toMillis: expect.any(Function),
                }),
            }),
        );
    });

    it('skips delayed pre-cutoff trigger deltas after exact backfill', async () => {
        hoisted.transactionGet.mockImplementation(async (ref: { path: string }) => {
            if (ref.path.startsWith('eventStatsProcessedWrites/')) {
                return { exists: false, data: () => undefined };
            }
            if (ref.path === 'users/user-1/stats/events') {
                return {
                    exists: true,
                    data: () => ({
                        kind: 'events',
                        schemaVersion: 1,
                        total: 10,
                        standard: 9,
                        benchmark: 1,
                        backfilledAt: { toMillis: () => Date.parse('2026-05-06T10:05:00.000Z') },
                        backfillCutoffAt: { toMillis: () => Date.parse('2026-05-06T10:03:00.000Z') },
                    }),
                };
            }
            return { exists: false, data: () => undefined };
        });

        await (onEventStatsWrite as any)(makeWriteEvent({
            time: '2026-05-06T10:02:00.000Z',
            after: { mergeType: 'multi' },
        }));

        expect(hoisted.transactionSet).toHaveBeenCalledTimes(1);
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: expect.stringMatching(/^eventStatsProcessedWrites\//) }),
            expect.objectContaining({
                skippedReason: 'covered-by-backfill',
                delta: { total: 1, standard: 1, benchmark: 0 },
                eventTimeMs: Date.parse('2026-05-06T10:02:00.000Z'),
            }),
        );
    });
});
