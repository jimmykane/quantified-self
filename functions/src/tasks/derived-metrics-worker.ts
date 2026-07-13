import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { DERIVED_METRIC_KINDS, DERIVED_METRIC_SCHEMA_VERSION } from '../../../shared/derived-metrics';
import {
    abandonDerivedMetricsProcessingAfterWriteBlock,
    areOnlyProjectionSensitiveMetricKinds,
    completeDerivedMetricsProcessing,
    failDerivedMetricsProcessing,
    fetchDerivedFormSnapshotSeed,
    fetchDerivedMetricsEventDocs,
    fetchRecoveryLookbackEventDocs,
    getDerivedRecoveryLookbackWindowSeconds,
    isDerivedMetricsUserWriteBlocked,
    markDerivedMetricSnapshotsBuilding,
    markDerivedMetricSnapshotsFailed,
    resolveDerivedMetricSourceRequirements,
    startDerivedMetricsProcessing,
    writeDerivedMetricSnapshotsReady,
} from '../derived-metrics/derived-metrics.service';

interface DerivedMetricsTaskPayload {
    uid: string;
    generation: number;
}

export const processDerivedMetricsTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    memory: '1GiB',
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
    const abandonAfterWriteBlock = (logContext: string) => abandonDerivedMetricsProcessingAfterWriteBlock(
        uid,
        Math.floor(generation),
        dirtyMetricKinds,
        logContext,
    );

    try {
        if (await isDerivedMetricsUserWriteBlocked(uid, 'task before snapshot building', { generation, dirtyMetricKinds })) {
            await abandonAfterWriteBlock('task before snapshot building');
            return;
        }
        await markDerivedMetricSnapshotsBuilding(uid, dirtyMetricKinds);
        const sourceRequirements = resolveDerivedMetricSourceRequirements(dirtyMetricKinds);
        const projectionOnlyKinds = areOnlyProjectionSensitiveMetricKinds(dirtyMetricKinds);
        let projectionFormSnapshotSeed: Awaited<ReturnType<typeof fetchDerivedFormSnapshotSeed>> = null;
        // Power Curve is refreshed daily for calendar windows, but unlike load-derived
        // projections it needs the source event stats rather than Form's daily-load seed.
        const canUseProjectionSeed = sourceRequirements.needsFormDocs
            && projectionOnlyKinds
            && !dirtyMetricKinds.includes(DERIVED_METRIC_KINDS.PowerCurve);
        if (canUseProjectionSeed) {
            const candidateProjectionSeed = await fetchDerivedFormSnapshotSeed(uid);
            const hasCompatibleSchema = Number.isFinite(candidateProjectionSeed?.schemaVersion)
                && (candidateProjectionSeed?.schemaVersion as number) >= DERIVED_METRIC_SCHEMA_VERSION;
            const hasCompatibleBuildMutationVersion = Number.isFinite(candidateProjectionSeed?.builtFromEventMutationVersion)
                && (candidateProjectionSeed?.builtFromEventMutationVersion as number) >= startResult.eventMutationVersion;
            if (
                candidateProjectionSeed
                && candidateProjectionSeed.status === 'ready'
                && hasCompatibleSchema
                && hasCompatibleBuildMutationVersion
            ) {
                projectionFormSnapshotSeed = candidateProjectionSeed;
            }
        }
        const formDocs = sourceRequirements.needsFormDocs
            ? (
                projectionFormSnapshotSeed
                    ? []
                    : await fetchDerivedMetricsEventDocs(uid)
            )
            : [];
        const recoveryNowDocs = sourceRequirements.needsRecoveryNowDocs
            // Recovery-now must always use bounded lookback docs, even when Form is processed in the same task.
            // Reusing full-history form docs inflates segment counts and breaks "recovery left now" semantics.
            ? await fetchRecoveryLookbackEventDocs(uid)
            : [];

        if (await isDerivedMetricsUserWriteBlocked(uid, 'task before snapshot ready write', { generation, dirtyMetricKinds })) {
            await abandonAfterWriteBlock('task before snapshot ready write');
            return;
        }
        await writeDerivedMetricSnapshotsReady(uid, dirtyMetricKinds, {
            formDocs,
            recoveryNowDocs,
        }, {
            builtFromEventMutationVersion: startResult.eventMutationVersion,
            formDailyLoads: projectionFormSnapshotSeed?.dailyLoads || [],
            formSourceEventCount: projectionFormSnapshotSeed?.sourceEventCount ?? null,
            formSourceDocCount: projectionFormSnapshotSeed?.sourceDocCount ?? null,
        });
        if (await isDerivedMetricsUserWriteBlocked(uid, 'task before processing completion', { generation, dirtyMetricKinds })) {
            await abandonAfterWriteBlock('task before processing completion');
            return;
        }
        const completion = await completeDerivedMetricsProcessing(uid, Math.floor(generation));

        logger.info('[derived-metrics] Processed derived metrics task.', {
            uid,
            generation,
            dirtyMetricKinds,
            builtFromEventMutationVersion: startResult.eventMutationVersion,
            formEventDocsScanned: formDocs.length,
            recoveryEventDocsScanned: recoveryNowDocs.length,
            usedProjectionFormSnapshotSeed: !!projectionFormSnapshotSeed,
            projectionFormSnapshotDailyLoadDays: projectionFormSnapshotSeed?.dailyLoads?.length || 0,
            recoveryLookbackWindowSeconds: getDerivedRecoveryLookbackWindowSeconds(),
            requeued: completion.requeued,
            nextGeneration: completion.nextGeneration,
            durationMs: Date.now() - processingStart,
        });
    } catch (error) {
        const processingError = error instanceof Error
            ? error
            : new Error(`${error ?? 'unknown_derived_metrics_processing_error'}`);
        logger.error('[derived-metrics] Failed to process derived metrics task.', {
            uid,
            generation,
            dirtyMetricKinds,
            builtFromEventMutationVersion: startResult.eventMutationVersion,
            error: processingError,
            durationMs: Date.now() - processingStart,
        });
        if (!await isDerivedMetricsUserWriteBlocked(uid, 'task before failure writes', { generation, dirtyMetricKinds })) {
            await markDerivedMetricSnapshotsFailed(uid, dirtyMetricKinds, processingError);
            await failDerivedMetricsProcessing(uid, Math.floor(generation), processingError, dirtyMetricKinds);
        } else {
            await abandonAfterWriteBlock('task before failure writes');
        }
        throw processingError;
    }
});
