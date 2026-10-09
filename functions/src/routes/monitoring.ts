import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ROUTE_DELIVERY_SYNC_ROUTES, type RouteDeliverySyncRouteId } from '../../../shared/route-delivery-sync-routes';
import { ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME } from '../route-delivery-sync/constants';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from './route-sync.constants';

export type RouteQueueLane = 'import' | 'delivery';
export type RouteQueueOutcome = 'success' | 'skipped' | 'dead_lettered' | 'manual_reconciliation' | 'retry' | 'expected_contention';
export type RouteQueueAttempt = 'acknowledged' | 'already_processed' | 'already_failed' | 'cleanup_removed' | 'deferred' | 'manual_reconciliation' | 'dead_lettered' | 'retry' | 'failed' | 'expected_contention';
const PROVIDERS = new Map<unknown, string>([[ServiceNames.SuuntoApp, 'suunto'], [ServiceNames.GarminAPI, 'garmin'], [ServiceNames.WahooAPI, 'wahoo'], [ServiceNames.COROSAPI, 'coros']]);

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function routeQueueLane(item: unknown): RouteQueueLane | null {
    const collection = record(record(record(item).ref).parent).id;
    return collection === ROUTE_SYNC_QUEUE_COLLECTION_NAME ? 'import'
        : collection === ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME ? 'delivery' : null;
}

/** Only fixed categories derived from the registered route; never copy queued strings. */
export function routeQueueFields(lane: RouteQueueLane, value: unknown) {
    const item = record(value);
    const route = typeof item.routeId === 'string' && Object.prototype.hasOwnProperty.call(ROUTE_DELIVERY_SYNC_ROUTES, item.routeId)
        ? ROUTE_DELIVERY_SYNC_ROUTES[item.routeId as RouteDeliverySyncRouteId] : null;
    const valid = lane === 'import' ? item.sourceServiceName === ServiceNames.SuuntoApp
        : !!route && route.sourceServiceName === ServiceNames.SuuntoApp && route.sourceServiceName === item.sourceServiceName
            && route.destinationServiceName === item.destinationServiceName && PROVIDERS.has(route.destinationServiceName);
    return {
        lane,
        source: valid ? 'suunto' : 'unknown',
        destination: valid ? lane === 'import' ? 'qs' : PROVIDERS.get(route!.destinationServiceName)! : 'unknown',
        mode: item.manual === true ? 'manual' : item.manual == null || item.manual === false ? 'automatic' : 'unknown',
    };
}

function emit(lane: RouteQueueLane, item: unknown, event: string, fields: Record<string, string | number>): void {
    // Observations cannot authorize work, and logger failure cannot replay a provider side effect.
    try { logger.info('[RouteQueue]', { telemetryVersion: 1, ...routeQueueFields(lane, item), event, ...fields }); } catch { /* best effort */ }
}

export function recordRouteQueueCommit(item: unknown, outcome: RouteQueueOutcome): void {
    const lane = routeQueueLane(item);
    if (lane) emit(lane, item, 'committed', { outcome });
}

export function recordRouteQueueCompletion(item: unknown, data?: Record<string, unknown>): void {
    if (data?.resultStatus === 'success') recordRouteQueueCommit(item, 'success');
    else if (data?.resultStatus === 'skipped') recordRouteQueueCommit(item, 'skipped');
}

export function routeQueueFailureOutcome(error: unknown): 'failed' | 'expected_contention' {
    return error instanceof Error && ['ProviderOperationStillInFlightError', 'TokenRefreshInProgressError', 'TokenRefreshSupersededError'].includes(error.name)
        ? 'expected_contention' : 'failed';
}

export function recordRouteQueueRetry(item: unknown, error: unknown): void {
    recordRouteQueueCommit(item, routeQueueFailureOutcome(error) === 'expected_contention' ? 'expected_contention' : 'retry');
}

export function recordRouteQueueAttempt(lane: RouteQueueLane, item: unknown, outcome: RouteQueueAttempt, durationMs: number): void {
    emit(lane, item, 'worker_attempt', { outcome, durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0 });
}

export function recordRouteQueueDispatch(lane: RouteQueueLane, outcome: 'completed' | 'failed'): void {
    emit(lane, null, 'dispatch_run', { outcome });
}

/** Preserve the original result/error; deduplicated tasks and lifecycle skips are not failures. */
export async function observeRouteDispatch<T>(lane: RouteQueueLane, item: unknown,
    phase: 'guard' | 'enqueue' | 'marker', operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
        recordRouteDispatchFailure(lane, item, 'immediate', phase);
        throw error;
    }
}

export function recordRouteDispatchFailure(lane: RouteQueueLane, item: unknown,
    mode: 'immediate' | 'reconciliation', phase: 'guard' | 'enqueue' | 'marker' | 'cleanup'): void {
    emit(lane, item, 'dispatch_failure', { dispatchMode: mode, phase });
}

export interface RouteQueueSample {
    sampled: number;
    excludedSample: number;
    unknownSample: number;
    truncated: boolean;
    dueSample?: number;
    ageLowerBoundMs?: number;
}

export function recordRouteQueueSample(lane: RouteQueueLane, destination: 'qs' | 'garmin' | 'wahoo' | 'coros', sample?: RouteQueueSample): void {
    try {
        logger.info('[RouteQueue]', { telemetryVersion: 1, lane, source: 'suunto', destination,
            event: sample ? 'queue_sample' : 'queue_sample_unavailable', ...(sample || {}) });
    } catch { /* Observations must never change queue behavior. */ }
}

export function recordRouteOriginalCleanup(outcome: 'deleted' | 'stale_discarded' | 'malformed_discarded' | 'failed' | 'backoff_failed', phase: 'validate' | 'route_read' | 'storage_delete' | 'intent_delete' | 'backoff'): void {
    // Cleanup diagnostics deliberately have no path, bucket, route/user ID, geometry, or error text.
    try { logger.info('[RouteQueue]', { telemetryVersion: 1, lane: 'cleanup', event: 'original_cleanup', outcome, phase }); } catch { /* best effort */ }
}
