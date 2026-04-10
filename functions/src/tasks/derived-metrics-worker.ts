import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
    completeDerivedMetricsProcessing,
    failDerivedMetricsProcessing,
    fetchDerivedMetricsEventDocs,
    fetchRecoveryLookbackEventDocs,
    getDerivedRecoveryLookbackWindowSeconds,
    markDerivedMetricSnapshotsBuilding,
    markDerivedMetricSnapshotsFailed,
    startDerivedMetricsProcessing,
    writeDerivedMetricSnapshotsReady,
} from '../derived-metrics/derived-metrics.service';

interface DerivedMetricsTaskPayload {
    uid: string;
    generation: number;
}

export const processDerivedMetricsTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    memory: '512MiB',
    timeoutSeconds: 540,
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
}, async (request) => {
    const payload = request.data as DerivedMetricsTaskPayload;
    const uid = `${payload?.uid || ''}`.trim();
    const generation = Number(payload?.generation);

    if (!uid || !Number.isFinite(generation)) {
        logger.warn('[derived-metrics] Missing or invalid task payload.', {
            uid,
            generation: payload?.generation,
        });
        return;
    }

    const processingStart = Date.now();
    const startResult = await startDerivedMetricsProcessing(uid, Math.floor(generation));
    if (!startResult) {
        logger.info('[derived-metrics] Skipping task because coordinator generation no longer matches.', {
            uid,
            generation,
        });
        return;
    }

    const dirtyMetricKinds = startResult.dirtyMetricKinds;
    if (!dirtyMetricKinds.length) {
        logger.info('[derived-metrics] No dirty metric kinds to process.', {
            uid,
            generation,
        });
        return;
    }

    try {
        await markDerivedMetricSnapshotsBuilding(uid, dirtyMetricKinds);
        const needsFormDocs = dirtyMetricKinds.some((metricKind) => (
            metricKind === DERIVED_METRIC_KINDS.Form
            || metricKind === DERIVED_METRIC_KINDS.Acwr
            || metricKind === DERIVED_METRIC_KINDS.RampRate
            || metricKind === DERIVED_METRIC_KINDS.MonotonyStrain
            || metricKind === DERIVED_METRIC_KINDS.FreshnessForecast
            || metricKind === DERIVED_METRIC_KINDS.IntensityDistribution
            || metricKind === DERIVED_METRIC_KINDS.EfficiencyTrend
        ));
        const needsRecoveryNowDocs = dirtyMetricKinds.includes(DERIVED_METRIC_KINDS.RecoveryNow);
        const formDocs = needsFormDocs
            ? await fetchDerivedMetricsEventDocs(uid)
            : [];
        const recoveryNowDocs = needsRecoveryNowDocs
            // Recovery-now must always use bounded lookback docs, even when Form is processed in the same task.
            // Reusing full-history form docs inflates segment counts and breaks "recovery left now" semantics.
            ? await fetchRecoveryLookbackEventDocs(uid)
            : [];

        await writeDerivedMetricSnapshotsReady(uid, dirtyMetricKinds, {
            formDocs,
            recoveryNowDocs,
        });
        const completion = await completeDerivedMetricsProcessing(uid, Math.floor(generation));

        logger.info('[derived-metrics] Processed derived metrics task.', {
            uid,
            generation,
            dirtyMetricKinds,
            formEventDocsScanned: formDocs.length,
            recoveryEventDocsScanned: recoveryNowDocs.length,
            recoveryLookbackWindowSeconds: getDerivedRecoveryLookbackWindowSeconds(),
            requeued: completion.requeued,
            nextGeneration: completion.nextGeneration,
            durationMs: Date.now() - processingStart,
        });
    } catch (error) {
        logger.error('[derived-metrics] Failed to process derived metrics task.', {
            uid,
            generation,
            dirtyMetricKinds,
            error,
            durationMs: Date.now() - processingStart,
        });
        await markDerivedMetricSnapshotsFailed(uid, dirtyMetricKinds, error);
        await failDerivedMetricsProcessing(uid, Math.floor(generation), error, dirtyMetricKinds);
    }
});
