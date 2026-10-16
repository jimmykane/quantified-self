import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { hasDerivedMetricSourceChange, type DerivedMetricSource } from './derived-metrics-source-change';

const DERIVED_METRICS_SOURCE_TRIGGER_MEMORY = '512MiB';

async function dispatchSourceWrite(
    event: Parameters<Parameters<typeof onDocumentWritten>[1]>[0],
    source: DerivedMetricSource,
): Promise<void> {
    const uid = `${event.params?.uid || ''}`.trim();
    if (!uid) {
        return;
    }

    const before = event.data?.before?.data?.();
    const after = event.data?.after?.data?.();
    // Preparation only reserves the import. Owner edits made during it are projected below.
    if (source === 'training-load' && after?.sourceWritePending &&
        (!before || !hasDerivedMetricSourceChange(source, before, after)) && !Object.keys(after.controls ?? {}).length) return;
    // Creates, updates, and deletes can all change the derived comparison.
    const beforeExists = !!event.data?.before?.exists;
    const afterExists = !!event.data?.after?.exists;
    if (!beforeExists && !afterExists) {
        return;
    }
    if (beforeExists && afterExists && !hasDerivedMetricSourceChange(
        source, event.data?.before?.data?.(), event.data?.after?.data?.(),
    )) {
        return;
    }
    // No-op deliveries must not load Sports Lib, cache builders or Cloud Tasks.
    // Import failures propagate to the trigger's existing retry policy.
    const { handleDerivedMetricsSourceWrite } = await import('./derived-metrics-source-handler');
    await handleDerivedMetricsSourceWrite(event, source);
}

export const onDashboardDerivedMetricsEventWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/events/{eventId}',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => dispatchSourceWrite(event, 'event'));

export const onDashboardDerivedMetricsActivityWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/activities/{activityId}',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => dispatchSourceWrite(event, 'activity'));

export const onDashboardDerivedMetricsSleepWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/sleepSessions/{sleepSessionId}',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => dispatchSourceWrite(event, 'sleep'));

export const onDashboardDerivedMetricsHealthWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/healthSourceRecords/{sourceRecordId}',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => dispatchSourceWrite(event, 'health'));

export const onTrainingLoadMetadataWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/events/{eventId}/metaData/trainingLoad',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => dispatchSourceWrite(event, 'training-load'));
