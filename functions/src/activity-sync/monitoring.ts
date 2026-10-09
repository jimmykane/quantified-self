import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getActivityDeliveryRoute, type ActivityDeliveryRouteId, type ActivityDeliverySource } from '../../../shared/activity-sync-routes';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from './constants';

export type ActivityDeliveryOutcome = 'delivered' | 'skipped' | 'dead_lettered' | 'manual_reconciliation' | 'provider_pending' | 'retry' | 'expected_contention';
export type ActivityDeliveryAttempt = 'acknowledged' | 'already_processed' | 'already_failed' | 'cleanup_removed' | 'stale' | 'deferred' | 'provider_pending' | 'manual_reconciliation' | 'dead_lettered' | 'retry' | 'failed' | 'expected_contention';
const PROVIDERS = new Map<unknown, string>([[ServiceNames.GarminAPI, 'garmin'], [ServiceNames.SuuntoApp, 'suunto'], [ServiceNames.WahooAPI, 'wahoo'], [ServiceNames.COROSAPI, 'coros'], ['manualUpload', 'manualUpload']]);

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Derive fixed labels from the actual allowlisted route, not arbitrary queued provider strings. */
export function activityDeliveryFields(value: unknown) {
    const item = record(value);
    const route = typeof item.routeId === 'string' ? getActivityDeliveryRoute(item.routeId as ActivityDeliveryRouteId) : null;
    const valid = route && PROVIDERS.has(route.sourceServiceName) && PROVIDERS.has(route.destinationServiceName)
        && route.sourceServiceName === item.sourceServiceName && route.destinationServiceName === item.destinationServiceName;
    return {
        source: valid ? PROVIDERS.get(route.sourceServiceName)! : 'unknown',
        destination: valid ? PROVIDERS.get(route.destinationServiceName)! : 'unknown',
        mode: valid && (route.sourceServiceName as ActivityDeliverySource) === 'manualUpload' && item.deliveryMode !== 'historical' ? 'unknown'
            : item.deliveryMode === 'historical' ? 'historical'
            : item.deliveryMode == null || item.deliveryMode === 'automatic' ? 'automatic' : 'unknown',
    };
}

function emit(item: unknown, event: string, fields: Record<string, string | number | boolean>): void {
    // Best-effort observations are non-authorizing; a logging failure must never replay delivery.
    try { logger.info('[ActivityDelivery]', { telemetryVersion: 1, ...activityDeliveryFields(item), event, ...fields }); } catch { /* best effort */ }
}

export function recordActivityDeliveryCommit(item: unknown, outcome: ActivityDeliveryOutcome): void {
    if (record(record(record(item).ref).parent).id !== ACTIVITY_SYNC_QUEUE_COLLECTION_NAME) return;
    emit(item, 'committed', { outcome });
}

export function recordActivityDeliveryCompletion(item: unknown, additionalData?: Record<string, unknown>): void {
    if (additionalData?.resultStatus === 'success') recordActivityDeliveryCommit(item, 'delivered');
    else if (additionalData?.resultStatus === 'skipped') recordActivityDeliveryCommit(item, 'skipped');
}

export function activityDeliveryFailureOutcome(error: unknown): 'failed' | 'expected_contention' {
    return error instanceof Error && ['ProviderOperationStillInFlightError', 'TokenRefreshInProgressError', 'TokenRefreshSupersededError'].includes(error.name)
        ? 'expected_contention' : 'failed';
}

export function recordActivityDeliveryAttempt(item: unknown, outcome: ActivityDeliveryAttempt, durationMs: number): void {
    emit(item, 'worker_attempt', { outcome, durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0 });
}

export function recordActivityDeliveryDispatch(outcome: 'completed' | 'failed'): void {
    emit(null, 'dispatch_run', { outcome });
}

export function recordActivityDeliverySample(destination: string, fields?: Record<string, number | boolean>): void {
    // The caller selects only the three fixed supported destination categories.
    if (!['suunto', 'wahoo', 'coros'].includes(destination)) return;
    try { logger.info('[ActivityDelivery]', { telemetryVersion: 1, source: 'all', destination, mode: 'all',
        event: fields ? 'queue_sample' : 'queue_sample_unavailable', ...fields }); } catch { /* best effort */ }
}
