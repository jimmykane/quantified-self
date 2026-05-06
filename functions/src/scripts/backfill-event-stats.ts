import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import {
    applyEventStatsDelta,
    classifyEventForStats,
    EVENT_STATS_COLLECTION_ID,
    EVENT_STATS_DOC_ID,
    EVENT_STATS_KIND,
    EVENT_STATS_PROCESSED_WRITES_COLLECTION,
    EVENT_STATS_SCHEMA_VERSION,
    normalizeEventStatsDelta,
    type EventStatsCounts,
    type EventStatsDelta,
} from '../../../shared/event-stats';

const DEFAULT_LIMIT = 100;
const PROGRESS_LOG_EVERY = 25;

interface BackfillEventStatsOptions {
    execute: boolean;
    uid?: string;
    limit: number;
    startAfter?: string;
}

export interface BackfillEventStatsSummary {
    dryRun: boolean;
    usersScanned: number;
    eventsScanned: number;
    statsWritten: number;
    failed: number;
    lastUserId: string | null;
}

function readArgValue(argv: string[], key: string): string | undefined {
    const equalsPrefix = `${key}=`;
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === key) {
            const nextToken = argv[i + 1];
            return nextToken && !nextToken.startsWith('--') ? nextToken : undefined;
        }
        if (token.startsWith(equalsPrefix)) {
            const value = token.slice(equalsPrefix.length).trim();
            return value || undefined;
        }
    }
    return undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

export function parseBackfillEventStatsOptions(argv: string[]): BackfillEventStatsOptions {
    return {
        execute: argv.includes('--execute'),
        uid: readArgValue(argv, '--uid'),
        limit: parsePositiveInt(readArgValue(argv, '--limit'), DEFAULT_LIMIT),
        startAfter: readArgValue(argv, '--start-after'),
    };
}

export function buildEventStatsCountsFromDocs(
    docs: Array<{ data: () => Record<string, unknown> | undefined }>,
): EventStatsCounts {
    const counts: EventStatsCounts = {
        total: 0,
        standard: 0,
        benchmark: 0,
    };

    docs.forEach((doc) => {
        const data = doc.data() || {};
        const classification = classifyEventForStats(data);
        counts.total += 1;
        counts[classification] += 1;
    });

    return counts;
}

function resolveTimestampMillis(value: unknown): number | null {
    if (!value) {
        return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }
    if (typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        const time = (value as { toMillis: () => number }).toMillis();
        return Number.isFinite(time) ? time : null;
    }
    return null;
}

function resolveSnapshotReadTime(snapshot: unknown): unknown {
    const readTime = (snapshot as { readTime?: unknown })?.readTime;
    return readTime || new Date();
}

function addEventStatsDelta(left: EventStatsDelta, right: EventStatsDelta): EventStatsDelta {
    return {
        total: left.total + right.total,
        standard: left.standard + right.standard,
        benchmark: left.benchmark + right.benchmark,
    };
}

async function getPostCutoffMarkerDelta(
    db: admin.firestore.Firestore,
    transaction: admin.firestore.Transaction,
    uid: string,
    cutoffMs: number,
): Promise<EventStatsDelta> {
    const markerQuery = db.collection(EVENT_STATS_PROCESSED_WRITES_COLLECTION)
        .where('uid', '==', uid)
        .where('eventTimeMs', '>', cutoffMs);
    const markerSnapshot = await transaction.get(markerQuery);
    return markerSnapshot.docs.reduce<EventStatsDelta>((acc, doc) => {
        const marker = doc.data() as Record<string, unknown>;
        const delta = normalizeEventStatsDelta(marker.delta as Record<string, unknown> | undefined);
        return addEventStatsDelta(acc, delta);
    }, { total: 0, standard: 0, benchmark: 0 });
}

async function getUserRefsToBackfill(options: BackfillEventStatsOptions): Promise<admin.firestore.DocumentReference[]> {
    const db = admin.firestore();
    if (options.uid) {
        const userRef = db.collection('users').doc(options.uid);
        const userSnapshot = await userRef.get();
        if (!userSnapshot.exists) {
            logger.warn('[event-stats-backfill] Skipping missing user root.', {
                uid: options.uid,
            });
            return [];
        }
        return [userRef];
    }

    let query = db.collection('users')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(options.limit);

    if (options.startAfter) {
        query = query.startAfter(options.startAfter);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => doc.ref);
}

export async function runBackfillEventStats(argv: string[]): Promise<BackfillEventStatsSummary> {
    const options = parseBackfillEventStatsOptions(argv);
    const summary: BackfillEventStatsSummary = {
        dryRun: !options.execute,
        usersScanned: 0,
        eventsScanned: 0,
        statsWritten: 0,
        failed: 0,
        lastUserId: null,
    };

    if (!admin.apps.length) {
        admin.initializeApp();
    }
    const db = admin.firestore();

    const userRefs = await getUserRefsToBackfill(options);
    logger.info('[event-stats-backfill] Starting backfill run.', {
        dryRun: summary.dryRun,
        users: userRefs.length,
        uid: options.uid || null,
        limit: options.limit,
        startAfter: options.startAfter || null,
    });

    for (const userRef of userRefs) {
        summary.usersScanned += 1;
        summary.lastUserId = userRef.id;
        try {
            const eventsSnapshot = await userRef.collection('events')
                .select('isMerge', 'mergeType')
                .get();
            const counts = buildEventStatsCountsFromDocs(eventsSnapshot.docs);
            const backfillCutoffAt = resolveSnapshotReadTime(eventsSnapshot);
            const backfillCutoffMs = resolveTimestampMillis(backfillCutoffAt);
            summary.eventsScanned += eventsSnapshot.docs.length;

            if (options.execute) {
                await db.runTransaction(async (transaction) => {
                    const postCutoffDelta = backfillCutoffMs === null
                        ? { total: 0, standard: 0, benchmark: 0 }
                        : await getPostCutoffMarkerDelta(db, transaction, userRef.id, backfillCutoffMs);
                    const reconciledCounts = applyEventStatsDelta(counts, postCutoffDelta);
                    transaction.set(userRef.collection(EVENT_STATS_COLLECTION_ID).doc(EVENT_STATS_DOC_ID), {
                        kind: EVENT_STATS_KIND,
                        schemaVersion: EVENT_STATS_SCHEMA_VERSION,
                        ...reconciledCounts,
                        backfillCutoffAt,
                        backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true });
                });
                summary.statsWritten += 1;
            }

            if (summary.usersScanned === 1 || summary.usersScanned % PROGRESS_LOG_EVERY === 0 || summary.usersScanned === userRefs.length) {
                logger.info('[event-stats-backfill] Progress.', {
                    usersScanned: summary.usersScanned,
                    usersTotal: userRefs.length,
                    eventsScanned: summary.eventsScanned,
                    statsWritten: summary.statsWritten,
                });
            }
        } catch (error) {
            summary.failed += 1;
            logger.error('[event-stats-backfill] Failed to backfill user stats.', {
                uid: userRef.id,
                error,
            });
        }
    }

    logger.info('[event-stats-backfill] Completed backfill run.', summary);
    return summary;
}

if (require.main === module) {
    runBackfillEventStats(process.argv.slice(2))
        .then(summary => {
            logger.info('[event-stats-backfill] Summary.', summary);
            process.exit(summary.failed > 0 ? 1 : 0);
        })
        .catch(error => {
            logger.error('[event-stats-backfill] Fatal error.', error);
            process.exit(1);
        });
}
