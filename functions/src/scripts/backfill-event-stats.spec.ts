import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const READ_TIME_MS = Date.parse('2026-05-06T10:00:00.000Z');
    const adminApps: unknown[] = [];
    const initializeApp = vi.fn();
    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const userDocs: any[] = [];
    const eventDocsByUid = new Map<string, any[]>();
    const markerDocsByUid = new Map<string, any[]>();
    const transactionGet = vi.fn();
    const transactionSet = vi.fn();
    const runTransaction = vi.fn();

    const makeUserRef = (uid: string) => ({
        path: `users/${uid}`,
        id: uid,
        get: vi.fn(async () => ({
            exists: userDocs.some(doc => doc.id === uid),
        })),
        collection: vi.fn((collectionId: string) => {
            if (collectionId === 'events') {
                return {
                    select: vi.fn().mockReturnThis(),
                    get: vi.fn(async () => ({
                        docs: eventDocsByUid.get(uid) || [],
                        readTime: {
                            toMillis: () => READ_TIME_MS,
                        },
                    })),
                };
            }
            if (collectionId === 'stats') {
                return {
                    doc: vi.fn(() => ({
                        path: `users/${uid}/stats/events`,
                    })),
                };
            }
            return {
                get: vi.fn(async () => ({ docs: [] })),
            };
        }),
    });

    const collection = vi.fn((collectionId: string) => {
        if (collectionId === 'eventStatsProcessedWrites') {
            const filters: Array<{ field: string; op: string; value: unknown }> = [];
            const markerQuery = {
                collectionId,
                filters,
                where: vi.fn((field: string, op: string, value: unknown) => {
                    filters.push({ field, op, value });
                    return markerQuery;
                }),
            };
            return markerQuery;
        }

        if (collectionId !== 'users') {
            return {};
        }

        let limitValue = 100;
        let startAfterValue: string | null = null;
        const query = {
            doc: vi.fn((uid: string) => makeUserRef(uid)),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn((value: number) => {
                limitValue = value;
                return query;
            }),
            startAfter: vi.fn((value: string) => {
                startAfterValue = value;
                return query;
            }),
            get: vi.fn(async () => {
                const startIndex = startAfterValue
                    ? userDocs.findIndex(doc => doc.id === startAfterValue) + 1
                    : 0;
                return { docs: userDocs.slice(startIndex, startIndex + limitValue) };
            }),
        };
        return query;
    });

    return {
        READ_TIME_MS,
        adminApps,
        initializeApp,
        serverTimestamp,
        userDocs,
        eventDocsByUid,
        markerDocsByUid,
        transactionGet,
        transactionSet,
        runTransaction,
        makeUserRef,
        collection,
    };
});

vi.mock('firebase-admin', () => {
    const firestore = Object.assign(vi.fn(() => ({
        collection: hoisted.collection,
        runTransaction: hoisted.runTransaction,
    })), {
        FieldPath: {
            documentId: vi.fn(() => '__name__'),
        },
        FieldValue: {
            serverTimestamp: hoisted.serverTimestamp,
        },
    });

    return {
        apps: hoisted.adminApps,
        initializeApp: hoisted.initializeApp,
        firestore,
    };
});

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

import {
    buildEventStatsCountsFromDocs,
    parseBackfillEventStatsOptions,
    runBackfillEventStats,
} from './backfill-event-stats';

function eventDoc(data: Record<string, unknown>): { data: () => Record<string, unknown> } {
    return { data: () => data };
}

describe('backfill-event-stats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.adminApps.length = 0;
        hoisted.userDocs.length = 0;
        hoisted.eventDocsByUid.clear();
        hoisted.markerDocsByUid.clear();
        hoisted.transactionGet.mockImplementation(async (query: any) => {
            if (query?.collectionId === 'eventStatsProcessedWrites') {
                const uidFilter = query.filters.find((filter: any) => filter.field === 'uid');
                const eventTimeFilter = query.filters.find((filter: any) => filter.field === 'eventTimeMs');
                const uid = `${uidFilter?.value || ''}`;
                const cutoffMs = Number(eventTimeFilter?.value ?? Number.POSITIVE_INFINITY);
                const docs = (hoisted.markerDocsByUid.get(uid) || [])
                    .filter(doc => Number(doc.data().eventTimeMs) > cutoffMs);
                return { docs };
            }
            return { docs: [] };
        });
        hoisted.runTransaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback({
            get: hoisted.transactionGet,
            set: hoisted.transactionSet,
        }));
    });

    it('parses dry-run options with bounded defaults', () => {
        expect(parseBackfillEventStatsOptions([])).toEqual({
            execute: false,
            uid: undefined,
            limit: 100,
            startAfter: undefined,
        });
        expect(parseBackfillEventStatsOptions([
            '--execute',
            '--uid=user-1',
            '--limit',
            '25',
            '--start-after=user-0',
        ])).toEqual({
            execute: true,
            uid: 'user-1',
            limit: 25,
            startAfter: 'user-0',
        });
        expect(parseBackfillEventStatsOptions(['--uid', '--execute', '--start-after='])).toEqual({
            execute: true,
            uid: undefined,
            limit: 100,
            startAfter: undefined,
        });
    });

    it('counts multi merges as standard and benchmark merges as benchmark', () => {
        expect(buildEventStatsCountsFromDocs([
            eventDoc({}),
            eventDoc({ mergeType: 'multi', isMerge: false }),
            eventDoc({ mergeType: 'benchmark', isMerge: false }),
            eventDoc({ isMerge: true }),
        ])).toEqual({
            total: 4,
            standard: 2,
            benchmark: 2,
        });
    });

    it('dry-runs without writing stats docs', async () => {
        hoisted.userDocs.push(
            { id: 'user-1', ref: hoisted.makeUserRef('user-1') },
            { id: 'user-2', ref: hoisted.makeUserRef('user-2') },
        );
        hoisted.eventDocsByUid.set('user-1', [eventDoc({ mergeType: 'multi' })]);
        hoisted.eventDocsByUid.set('user-2', [eventDoc({ mergeType: 'benchmark' })]);

        const summary = await runBackfillEventStats([]);

        expect(summary).toMatchObject({
            dryRun: true,
            usersScanned: 2,
            eventsScanned: 2,
            statsWritten: 0,
            failed: 0,
            lastUserId: 'user-2',
        });
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });

    it('writes exact event stats when executed', async () => {
        hoisted.userDocs.push({ id: 'user-1', ref: hoisted.makeUserRef('user-1') });
        hoisted.eventDocsByUid.set('user-1', [
            eventDoc({ mergeType: 'multi' }),
            eventDoc({ isMerge: true }),
        ]);

        const summary = await runBackfillEventStats(['--execute', '--uid=user-1']);

        expect(summary).toMatchObject({
            dryRun: false,
            usersScanned: 1,
            eventsScanned: 2,
            statsWritten: 1,
            failed: 0,
            lastUserId: 'user-1',
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'users/user-1/stats/events' }),
            {
                kind: 'events',
                schemaVersion: 1,
                total: 2,
                standard: 1,
                benchmark: 1,
                backfillCutoffAt: {
                    toMillis: expect.any(Function),
                },
                backfilledAt: 'SERVER_TIMESTAMP',
                updatedAt: 'SERVER_TIMESTAMP',
            },
            { merge: true },
        );
    });

    it('reconciles trigger markers processed after the event scan cutoff', async () => {
        hoisted.userDocs.push({ id: 'user-1', ref: hoisted.makeUserRef('user-1') });
        hoisted.eventDocsByUid.set('user-1', [
            eventDoc({ mergeType: 'multi' }),
        ]);
        hoisted.markerDocsByUid.set('user-1', [
            { data: () => ({ eventTimeMs: hoisted.READ_TIME_MS - 1, delta: { total: 1, standard: 1, benchmark: 0 } }) },
            { data: () => ({ eventTimeMs: hoisted.READ_TIME_MS + 1, delta: { total: 1, standard: 0, benchmark: 1 } }) },
        ]);

        await runBackfillEventStats(['--execute', '--uid=user-1']);

        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'users/user-1/stats/events' }),
            expect.objectContaining({
                total: 2,
                standard: 1,
                benchmark: 1,
            }),
            { merge: true },
        );
    });

    it('does not create stats for a missing direct user root', async () => {
        const summary = await runBackfillEventStats(['--execute', '--uid=missing-user']);

        expect(summary).toMatchObject({
            dryRun: false,
            usersScanned: 0,
            eventsScanned: 0,
            statsWritten: 0,
            failed: 0,
            lastUserId: null,
        });
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });
});
