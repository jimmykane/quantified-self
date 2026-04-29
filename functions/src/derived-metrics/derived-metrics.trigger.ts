import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';
import { enqueueDerivedMetricsIngressTask } from '../shared/cloud-tasks';

function resolveEventTimeMs(event: { time?: unknown }): number | null {
    const eventTimeIso = `${event?.time || ''}`.trim();
    if (!eventTimeIso) {
        return null;
    }
    const parsedTimeMs = Date.parse(eventTimeIso);
    return Number.isFinite(parsedTimeMs) ? parsedTimeMs : null;
}

export const onDashboardDerivedMetricsEventWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/events/{eventId}',
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, async (event) => {
    const uid = `${event.params?.uid || ''}`.trim();
    if (!uid) {
        return;
    }
    if (!isDerivedMetricsUidAllowed(uid)) {
        return;
    }

    // Any event document mutation can affect historical derived metrics.
    const beforeExists = !!event.data?.before?.exists;
    const afterExists = !!event.data?.after?.exists;
    if (!beforeExists && !afterExists) {
        return;
    }

    // Debounce mutation ingress by uid + short time bucket.
    // Deterministic Cloud Task naming ensures one pending ingress task per bucket.
    // The ingress helper schedules execution at bucket-close + short buffer.
    const eventTimeMs = resolveEventTimeMs(event);
    const queued = Number.isFinite(eventTimeMs)
        ? await enqueueDerivedMetricsIngressTask(uid, undefined, eventTimeMs as number)
        : await enqueueDerivedMetricsIngressTask(uid);

    logger.info('[derived-metrics] Event write enqueued derived metrics ingress', {
        uid,
        eventId: event.params?.eventId || null,
        beforeExists,
        afterExists,
        queued,
    });
});
