import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { HEALTH_METRIC_IDS } from '../../../shared/health';
import { isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';
import { enqueueDerivedMetricsIngressTask } from '../shared/cloud-tasks';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';

const DERIVED_METRICS_SOURCE_TRIGGER_MEMORY = '512MiB';

function resolveEventTimeMs(event: { time?: unknown }): number | null {
    const eventTimeIso = `${event?.time || ''}`.trim();
    if (!eventTimeIso) {
        return null;
    }
    const parsedTimeMs = Date.parse(eventTimeIso);
    return Number.isFinite(parsedTimeMs) ? parsedTimeMs : null;
}

function resolveDerivedMetricsSourceId(
    event: Parameters<Parameters<typeof onDocumentWritten>[1]>[0],
    source: 'event' | 'activity' | 'sleep' | 'health',
): string | null {
    const sourceId = source === 'event'
        ? event.params?.eventId
        : source === 'activity'
            ? event.params?.activityId
            : source === 'sleep'
                ? event.params?.sleepSessionId
                : event.params?.sourceRecordId;
    return `${sourceId || ''}`.trim() || null;
}

async function handleDerivedMetricsSourceWrite(
    event: Parameters<Parameters<typeof onDocumentWritten>[1]>[0],
    source: 'event' | 'activity' | 'sleep' | 'health',
): Promise<void> {
    const uid = `${event.params?.uid || ''}`.trim();
    if (!uid) {
        return;
    }
    if (!isDerivedMetricsUidAllowed(uid)) {
        return;
    }

    // Creates, updates, and deletes can all change the derived comparison.
    const beforeExists = !!event.data?.before?.exists;
    const afterExists = !!event.data?.after?.exists;
    if (!beforeExists && !afterExists) {
        return;
    }
    const sourceId = resolveDerivedMetricsSourceId(event, source);
    const deletionGuard = await getUserDeletionGuardState(admin.firestore(), uid);
    if (deletionGuard.shouldSkip) {
        logger.info('[derived-metrics] Skipping ingress enqueue because user deletion is in progress or user root is missing.', {
            uid,
            source,
            sourceId,
            userExists: deletionGuard.userExists,
            deletionInProgress: deletionGuard.deletionInProgress,
        });
        return;
    }

    // Debounce mutation ingress by uid + short time bucket.
    // Deterministic Cloud Task naming ensures one pending ingress task per bucket.
    // The ingress helper schedules execution at bucket-close + short buffer.
    const eventTimeMs = resolveEventTimeMs(event);
    const sleepIngressOptions = source === 'sleep'
        ? {
            taskScope: 'sleep',
            metricKinds: [
                DERIVED_METRIC_KINDS.TrainingBuildComparison,
                DERIVED_METRIC_KINDS.TrainingReadiness,
            ],
            incrementEventMutationVersion: false,
        } as const
        : undefined;
    const healthMetricIds = source === 'health'
        ? new Set([event.data?.before?.data(), event.data?.after?.data()].flatMap((data) => {
            const metricIds = (data as { metricIds?: unknown } | undefined)?.metricIds;
            return Array.isArray(metricIds) ? metricIds.filter(value => typeof value === 'string') : [];
        }))
        : null;
    const healthMetricKinds = healthMetricIds
        ? [
            ...(healthMetricIds.has(HEALTH_METRIC_IDS.BodyWeight) ? [DERIVED_METRIC_KINDS.BodyWeightTrend] : []),
            ...(healthMetricIds.has(HEALTH_METRIC_IDS.Vo2Max) ? [DERIVED_METRIC_KINDS.TrainingCapacity] : []),
        ]
        : [];
    if (source === 'health' && healthMetricKinds.length === 0) {
        return;
    }
    const targetedIngressOptions = sleepIngressOptions || (source === 'health'
        ? {
            taskScope: 'health',
            metricKinds: healthMetricKinds,
            incrementEventMutationVersion: false,
        } as const
        : undefined);
    const queued = targetedIngressOptions
        ? await enqueueDerivedMetricsIngressTask(uid, undefined, eventTimeMs ?? undefined, targetedIngressOptions)
        : (Number.isFinite(eventTimeMs)
            ? await enqueueDerivedMetricsIngressTask(uid, undefined, eventTimeMs as number)
            : await enqueueDerivedMetricsIngressTask(uid));

    logger.info('[derived-metrics] Source write enqueued derived metrics ingress', {
        uid,
        source,
        sourceId,
        beforeExists,
        afterExists,
        queued,
    });
}

export const onDashboardDerivedMetricsEventWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/events/{eventId}',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => handleDerivedMetricsSourceWrite(event, 'event'));

export const onDashboardDerivedMetricsActivityWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/activities/{activityId}',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => handleDerivedMetricsSourceWrite(event, 'activity'));

export const onDashboardDerivedMetricsSleepWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/sleepSessions/{sleepSessionId}',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => handleDerivedMetricsSourceWrite(event, 'sleep'));

export const onDashboardDerivedMetricsHealthWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/healthSourceRecords/{sourceRecordId}',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => handleDerivedMetricsSourceWrite(event, 'health'));
