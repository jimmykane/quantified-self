import { isDeepStrictEqual } from 'node:util';
import type { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { HEALTH_METRIC_IDS } from '../../../shared/health';
import { isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { trainingLoadSourceFingerprint, trainingLoadWriteTime } from '../training-load/training-load-source-fingerprint';
import { hasDerivedMetricsHealthSource, hasGarminSleepHeartRateSource, type DerivedMetricSource } from './derived-metrics-source-change';

async function refreshTrainingLoadSummary(uid: string, eventId: string): Promise<void> {
    const cache = await import('../training-load/training-load-cache');
    await cache.refreshTrainingLoadSummary(uid, eventId);
}

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
    source: DerivedMetricSource,
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

export async function handleDerivedMetricsSourceWrite(
    event: Parameters<Parameters<typeof onDocumentWritten>[1]>[0],
    source: DerivedMetricSource,
): Promise<void> {
    const uid = `${event.params?.uid || ''}`.trim();
    const before = event.data?.before?.data?.();
    const after = event.data?.after?.data?.();
    const beforeExists = !!event.data?.before?.exists;
    const afterExists = !!event.data?.after?.exists;
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
            // Parsed totals must also stop using candidates for changed/deleted/moved legs.
            // Names and device labels do not affect this guard or require extra leg reads.
            const parsedLegChanged = source === 'activity' && metadata?.legs && (!beforeExists || !afterExists ||
                before?.eventID !== after?.eventID ||
                trainingLoadSourceFingerprint(before ?? {}) !== trainingLoadSourceFingerprint(after ?? {}));
            // Legacy controls resolve against live recorded children until their first reparse.
            if (metadata && (parsedLegChanged || (!metadata.legs && Object.keys(metadata.controls ?? {}).length))) {
                await refreshTrainingLoadSummary(uid, eventId);
                cacheRefreshed = true;
            }
        }
        // A moved leg still invalidates its old parent even if the destination import owns its own refresh.
        if (coordinatedWrite && !cacheRefreshed) return;
    }
    if (!isDerivedMetricsUidAllowed(uid)) return;

    const healthMetricIds = source === 'health'
        ? new Set([before, after].flatMap((data) => {
            const metricIds = (data as { metricIds?: unknown } | undefined)?.metricIds;
            return Array.isArray(metricIds) ? metricIds.filter(value => typeof value === 'string') : [];
        }))
        : null;
    if (source === 'health' && !hasDerivedMetricsHealthSource(before, after)) return;
    const { DERIVED_METRIC_KINDS } = await import('../../../shared/derived-metrics');

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
    const healthMetricKinds = healthMetricIds
        ? [
            ...(healthMetricIds.has(HEALTH_METRIC_IDS.BodyWeight) ? [DERIVED_METRIC_KINDS.BodyWeightTrend] : []),
            ...(healthMetricIds.has(HEALTH_METRIC_IDS.HeartRateVariability) ? [
                DERIVED_METRIC_KINDS.TrainingBuildComparison, DERIVED_METRIC_KINDS.TrainingReadiness,
            ] : []),
            ...(!healthMetricIds.has(HEALTH_METRIC_IDS.HeartRateVariability)
                && [before, after].some(hasGarminSleepHeartRateSource)
                ? [DERIVED_METRIC_KINDS.TrainingReadiness] : []),
            ...(healthMetricIds.has(HEALTH_METRIC_IDS.Vo2Max) ? [DERIVED_METRIC_KINDS.TrainingCapacity] : []),
        ]
        : [];
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
    // Import preparation/finalization also writes metadata. Only actual owner-control
    // changes get priority; candidate refreshes must keep bulk reparse batching.
    const loadControlsChanged = source === 'training-load' && !completedSourceWrite && (
        !isDeepStrictEqual(before?.controls ?? {}, after?.controls ?? {})
        || (before?.excluded === true) !== (after?.excluded === true)
        || (before?.resetUnmatched === true) !== (after?.resetUnmatched === true)
    );
    const loadIngressOptions = source === 'training-load' && !completedSourceWrite ? {
        taskScope: 'training-load',
        ...(loadControlsChanged ? { immediate: true } : {}),
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
    const { enqueueDerivedMetricsIngressTask } = await import('../shared/cloud-tasks');
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

