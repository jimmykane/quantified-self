import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { normalizeDerivedMetricKindsStrict } from '../../../shared/derived-metrics';
import { getDefaultDerivedMetricKindsForDashboard, markDerivedMetricsDirtyAndMaybeQueue } from '../derived-metrics/derived-metrics.service';

interface DerivedMetricsIngressTaskPayload {
    uid?: string;
    bucketStartEpochSec?: number;
    metricKinds?: unknown;
    incrementEventMutationVersion?: unknown;
}

export const processDerivedMetricsIngressTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    memory: '256MiB',
    timeoutSeconds: 120,
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
}, async (request) => {
    const payload = (request.data || {}) as DerivedMetricsIngressTaskPayload;
    const uid = `${payload.uid || ''}`.trim();
    if (!uid) {
        logger.warn('[derived-metrics-ingress] Missing uid in task payload.', {
            bucketStartEpochSec: payload.bucketStartEpochSec ?? null,
        });
        return;
    }

    const hasTargetedMetricKinds = payload.metricKinds !== undefined;
    const metricKinds = hasTargetedMetricKinds
        ? normalizeDerivedMetricKindsStrict(Array.isArray(payload.metricKinds) ? payload.metricKinds : [])
        : getDefaultDerivedMetricKindsForDashboard();
    if (!metricKinds.length) {
        logger.warn('[derived-metrics-ingress] Invalid targeted metric kinds in task payload.', {
            uid,
            bucketStartEpochSec: payload.bucketStartEpochSec ?? null,
        });
        return;
    }
    const incrementEventMutationVersion = payload.incrementEventMutationVersion !== false;
    const queueResult = await markDerivedMetricsDirtyAndMaybeQueue(uid, metricKinds, {
        incrementEventMutationVersion,
    });
    logger.info('[derived-metrics-ingress] Processed ingress task.', {
        uid,
        bucketStartEpochSec: payload.bucketStartEpochSec ?? null,
        queued: queueResult.queued,
        generation: queueResult.generation,
        accepted: queueResult.accepted,
        metricKinds: queueResult.metricKinds,
        incrementEventMutationVersion,
    });
});
