import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';
import { enqueueDerivedMetricsIngressTask } from '../shared/cloud-tasks';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';

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
    source: 'event' | 'activity' | 'sleep',
): string | null {
    const sourceId = source === 'event'
        ? event.params?.eventId
        : (source === 'activity' ? event.params?.activityId : event.params?.sleepSessionId);
    return `${sourceId || ''}`.trim() || null;
}

async function handleDerivedMetricsSourceWrite(
    event: Parameters<Parameters<typeof onDocumentWritten>[1]>[0],
    source: 'event' | 'activity' | 'sleep',
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
    const queued = sleepIngressOptions
        ? await enqueueDerivedMetricsIngressTask(uid, undefined, eventTimeMs ?? undefined, sleepIngressOptions)
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
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => handleDerivedMetricsSourceWrite(event, 'event'));

export const onDashboardDerivedMetricsActivityWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/activities/{activityId}',
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => handleDerivedMetricsSourceWrite(event, 'activity'));

export const onDashboardDerivedMetricsSleepWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/sleepSessions/{sleepSessionId}',
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => handleDerivedMetricsSourceWrite(event, 'sleep'));
