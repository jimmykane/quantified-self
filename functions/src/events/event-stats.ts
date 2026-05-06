import { createHash } from 'node:crypto';

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import {
    applyEventStatsDelta,
    classifyEventForStats,
    EVENT_STATS_COLLECTION_ID,
    EVENT_STATS_DOC_ID,
    EVENT_STATS_KIND,
    EVENT_STATS_PROCESSED_WRITES_COLLECTION,
    EVENT_STATS_SCHEMA_VERSION,
    hasExactEventStats,
    normalizeEventStatsCounts,
    type EventStatsClassification,
    type EventStatsDelta,
} from '../../../shared/event-stats';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';

function getSnapshotData(snapshot: unknown): Record<string, unknown> | null {
    if (!snapshot || (snapshot as { exists?: unknown }).exists !== true) {
        return null;
    }

    const data = (snapshot as { data?: unknown }).data;
    if (typeof data !== 'function') {
        return null;
    }

    const value = data.call(snapshot);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return value as Record<string, unknown>;
}

function buildProcessedWriteMarkerId(cloudEventId: string): string {
    return createHash('sha256').update(cloudEventId).digest('hex');
}

function buildProcessedWriteMarkerBase(uid: string, eventId: string, cloudEventId: string, eventTimeMs: number | null): Record<string, unknown> {
    return {
        uid,
        eventId,
        cloudEventId,
        eventTimeMs,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        expireAt: getExpireAtTimestamp(TTL_CONFIG.EVENT_STATS_PROCESSED_WRITES_IN_DAYS),
    };
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

    if (typeof value === 'string') {
        const time = Date.parse(value);
        return Number.isFinite(time) ? time : null;
    }

    if (typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        const time = (value as { toMillis: () => number }).toMillis();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
        const date = (value as { toDate: () => Date }).toDate();
        const time = date.getTime();
        return Number.isFinite(time) ? time : null;
    }

    return null;
}

function shouldSkipDeltaCoveredByBackfill(statsData: Record<string, unknown> | undefined, eventTimeMs: number | null): boolean {
    if (!hasExactEventStats(statsData) || eventTimeMs === null) {
        return false;
    }

    const cutoffMs = resolveTimestampMillis(statsData?.backfillCutoffAt);
    return cutoffMs !== null && eventTimeMs <= cutoffMs;
}

function addClassificationDelta(delta: EventStatsDelta, classification: EventStatsClassification, direction: 1 | -1): void {
    delta[classification] += direction;
}

export function calculateEventStatsDelta(
    beforeData: Record<string, unknown> | null,
    afterData: Record<string, unknown> | null,
): EventStatsDelta {
    const delta: EventStatsDelta = {
        total: 0,
        standard: 0,
        benchmark: 0,
    };

    if (!beforeData && !afterData) {
        return delta;
    }

    if (!beforeData && afterData) {
        delta.total = 1;
        addClassificationDelta(delta, classifyEventForStats(afterData), 1);
        return delta;
    }

    if (beforeData && !afterData) {
        delta.total = -1;
        addClassificationDelta(delta, classifyEventForStats(beforeData), -1);
        return delta;
    }

    if (beforeData && afterData) {
        const beforeClassification = classifyEventForStats(beforeData);
        const afterClassification = classifyEventForStats(afterData);
        if (beforeClassification !== afterClassification) {
            addClassificationDelta(delta, beforeClassification, -1);
            addClassificationDelta(delta, afterClassification, 1);
        }
    }

    return delta;
}

function hasDelta(delta: EventStatsDelta): boolean {
    return delta.total !== 0 || delta.standard !== 0 || delta.benchmark !== 0;
}

export { applyEventStatsDelta };

export const onEventStatsWrite = onDocumentWritten({
    document: 'users/{uid}/events/{eventId}',
    region: 'europe-west2',
    retry: true,
    maxInstances: 50,
    concurrency: 10,
}, async (event) => {
    const uid = `${event.params?.uid || ''}`.trim();
    const eventId = `${event.params?.eventId || ''}`.trim();
    const cloudEventId = `${event.id || ''}`.trim();
    const eventTimeMs = resolveTimestampMillis((event as { time?: unknown }).time);

    if (!uid || !eventId || !cloudEventId) {
        logger.warn('[event-stats] Skipping event stats write because identifiers are missing.', {
            uid,
            eventId,
            hasCloudEventId: !!cloudEventId,
        });
        return;
    }

    const beforeData = getSnapshotData(event.data?.before);
    const afterData = getSnapshotData(event.data?.after);
    const delta = calculateEventStatsDelta(beforeData, afterData);
    if (!hasDelta(delta)) {
        return;
    }

    const db = admin.firestore();
    const markerRef = db.collection(EVENT_STATS_PROCESSED_WRITES_COLLECTION)
        .doc(buildProcessedWriteMarkerId(cloudEventId));
    const userRef = db.collection('users').doc(uid);
    const statsRef = userRef.collection(EVENT_STATS_COLLECTION_ID).doc(EVENT_STATS_DOC_ID);

    await db.runTransaction(async (transaction) => {
        const markerSnapshot = await transaction.get(markerRef);
        if (markerSnapshot.exists) {
            return;
        }

        if (beforeData && !afterData) {
            const userSnapshot = await transaction.get(userRef);
            if (!userSnapshot.exists) {
                transaction.set(markerRef, {
                    ...buildProcessedWriteMarkerBase(uid, eventId, cloudEventId, eventTimeMs),
                    skippedReason: 'missing-user-root',
                });
                return;
            }
        }

        const statsSnapshot = await transaction.get(statsRef);
        const statsData = statsSnapshot.data() as Record<string, unknown> | undefined;
        if (shouldSkipDeltaCoveredByBackfill(statsData, eventTimeMs)) {
            transaction.set(markerRef, {
                ...buildProcessedWriteMarkerBase(uid, eventId, cloudEventId, eventTimeMs),
                delta,
                skippedReason: 'covered-by-backfill',
            });
            return;
        }

        const current = normalizeEventStatsCounts(statsData);
        const next = applyEventStatsDelta(current, delta);

        transaction.set(statsRef, {
            kind: EVENT_STATS_KIND,
            schemaVersion: EVENT_STATS_SCHEMA_VERSION,
            ...next,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        transaction.set(markerRef, {
            ...buildProcessedWriteMarkerBase(uid, eventId, cloudEventId, eventTimeMs),
            delta,
        });
    });
});
