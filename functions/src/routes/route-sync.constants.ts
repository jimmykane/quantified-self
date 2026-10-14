export const ROUTE_SYNC_QUEUE_COLLECTION_NAME = 'routeSyncQueue';

// The worker has a nine-minute timeout. A live task is confirmed before any
// replacement is admitted; stale issued markers are revisited every 15 minutes.
const HISTORY_DISPATCH_RECHECK_MS = 15 * 60_000;
export function isRouteHistoryDispatchDue(item: { processed?: unknown; dispatchedToCloudTask?: unknown }, nowMs = Date.now()): boolean {
    const marker = item.dispatchedToCloudTask;
    return item.processed === false && (marker == null || marker === false || marker === 0
        || typeof marker === 'number' && Number.isFinite(marker) && marker <= nowMs - HISTORY_DISPATCH_RECHECK_MS);
}
