import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { HEALTH_METRIC_IDS } from '../../../shared/health';
import { isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';
import { enqueueDerivedMetricsIngressTask } from '../shared/cloud-tasks';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { refreshTrainingLoadSummary, trainingLoadWriteTime } from '../training-load/training-load-cache';
import { hasDerivedMetricSourceChange } from './derived-metrics-source-change';

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
    source: 'event' | 'activity' | 'sleep' | 'health' | 'training-load',
): string | null {
    const sourceId = source === 'event' || source === 'training-load'
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
    source: 'event' | 'activity' | 'sleep' | 'health' | 'training-load',
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
    const sourceId = resolveDerivedMetricsSourceId(event, source);
    // Cache maintenance is independent of the derived-metrics rollout gate.
    // Always reread current metadata before invalidating, including redelivered older events.
    let cacheRefreshed = false;
    if (source === 'training-load' || (source === 'event' && !afterExists)) {
        await refreshTrainingLoadSummary(uid, sourceId!);
        cacheRefreshed = true;
    }
    if ((source === 'event' && afterExists) || source === 'activity') {
        const eventIds = new Set(source === 'event' ? [sourceId] : [after?.eventID, before?.eventID]);
        let coordinatedWrite = false;
        for (const eventId of eventIds) {
            if (typeof eventId !== 'string' || !eventId) continue;
            const metadata = (await admin.firestore().doc(`users/${uid}/events/${eventId}/metaData/trainingLoad`).get()).data();
            const key = source === 'event' ? 'event' : `activity:${sourceId}`;
            const time = trainingLoadWriteTime(event.data?.after?.updateTime);
            // The final metadata transaction owns import invalidation, even for delayed source deliveries.
            if (afterExists && (source === 'event' || eventId === after?.eventID) &&
                (metadata?.sourceWritePending || (time && metadata?.sourceWriteTimes?.[key] === time))) {
                coordinatedWrite = true;
                continue;
            }
            // Legacy controls resolve against live recorded children until their first reparse.
            // Their compact projection must follow ordinary source corrections/deletions too.
            if (metadata && !metadata.legs && Object.keys(metadata.controls ?? {}).length) {
                await refreshTrainingLoadSummary(uid, eventId);
                cacheRefreshed = true;
            }
        }
        // A moved leg still invalidates its old parent even if the destination import owns its own refresh.
        if (coordinatedWrite && !cacheRefreshed) return;
    }
    if (!isDerivedMetricsUidAllowed(uid)) return;

    // Debounce mutation ingress by uid + short time bucket.
    // Deterministic Cloud Task naming ensures one pending ingress task per bucket.
    // The ingress helper schedules execution at bucket-close + short buffer.
    // Refresh retries may finish after the original debounce bucket was consumed.
    // Use readiness time after cache maintenance so a delayed update cannot be lost.
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
            ...(healthMetricIds.has(HEALTH_METRIC_IDS.HeartRateVariability) ? [
                DERIVED_METRIC_KINDS.TrainingBuildComparison, DERIVED_METRIC_KINDS.TrainingReadiness,
            ] : []),
            ...(healthMetricIds.has(HEALTH_METRIC_IDS.Vo2Max) ? [DERIVED_METRIC_KINDS.TrainingCapacity] : []),
        ]
        : [];
    if (source === 'health' && healthMetricKinds.length === 0) {
        return;
    }
    const deletionGuard = await getUserDeletionGuardState(admin.firestore(), uid);
    if (deletionGuard.shouldSkip) {
        logger.info('[derived-metrics] Skipping ingress enqueue because user deletion is in progress or user root is missing.', {
            uid, source, sourceId,
            userExists: deletionGuard.userExists,
            deletionInProgress: deletionGuard.deletionInProgress,
        });
        return;
    }
    const completedSourceWrite = source === 'training-load' && after?.sourceRevision !== undefined &&
        after.sourceRevision !== before?.sourceRevision;
    const loadIngressOptions = source === 'training-load' && !completedSourceWrite ? {
        taskScope: 'training-load',
        metricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.Acwr, DERIVED_METRIC_KINDS.RampRate,
            DERIVED_METRIC_KINDS.MonotonyStrain, DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.FormPlus7d,
            DERIVED_METRIC_KINDS.FreshnessForecast, DERIVED_METRIC_KINDS.TrainingSummary,
            DERIVED_METRIC_KINDS.TrainingExplanation, DERIVED_METRIC_KINDS.TrainingBuildComparison,
            DERIVED_METRIC_KINDS.TrainingReadiness],
        incrementEventMutationVersion: true,
    } as const : undefined;
    const targetedIngressOptions = loadIngressOptions || sleepIngressOptions || (source === 'health'
        ? {
            // A deterministic task may coalesce only identical invalidation sets.
            // Otherwise a Weight write can suppress a same-bucket VO2 write (or vice versa).
            taskScope: `health-${healthMetricKinds.join('-')}`,
            metricKinds: healthMetricKinds,
            incrementEventMutationVersion: false,
        } as const
        : undefined);
    const eventTimeMs = cacheRefreshed ? Date.now() : resolveEventTimeMs(event);
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

export const onTrainingLoadMetadataWrite = onDocumentWritten({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    document: 'users/{uid}/events/{eventId}/metaData/trainingLoad',
    memory: DERIVED_METRICS_SOURCE_TRIGGER_MEMORY,
    maxInstances: 50,
    concurrency: 1,
    retry: true,
}, event => handleDerivedMetricsSourceWrite(event, 'training-load'));
