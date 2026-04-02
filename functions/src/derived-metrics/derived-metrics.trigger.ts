import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getDefaultDerivedMetricKindsForDashboard, markDerivedMetricsDirtyAndMaybeQueue } from './derived-metrics.service';

export const onDashboardDerivedMetricsEventWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/events/{eventId}',
    maxInstances: 50,
}, async (event) => {
    const uid = `${event.params?.uid || ''}`.trim();
    if (!uid) {
        return;
    }

    // Any event document mutation can affect historical derived metrics.
    const beforeExists = !!event.data?.before?.exists;
    const afterExists = !!event.data?.after?.exists;
    if (!beforeExists && !afterExists) {
        return;
    }

    const metricKinds = getDefaultDerivedMetricKindsForDashboard();
    const queueResult = await markDerivedMetricsDirtyAndMaybeQueue(uid, metricKinds);

    logger.info('[derived-metrics] Event write marked dashboard derived metrics dirty', {
        uid,
        eventId: event.params?.eventId || null,
        beforeExists,
        afterExists,
        queued: queueResult.queued,
        generation: queueResult.generation,
        accepted: queueResult.accepted,
        metricKinds: queueResult.metricKinds,
    });
});
