import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    ROUTE_DELIVERY_SYNC_ROUTES,
    RouteDeliverySyncRoute,
    RouteDeliverySyncRouteId,
} from '../../../shared/route-delivery-sync-routes';
import {
    getRouteDeliverySyncRouteAllowlistConfigError,
    isRouteDeliverySyncRouteUserAllowlisted,
} from './allowlist';
import { isRouteDeliverySyncRouteEnabledForUser } from './settings';
import { enqueueRouteDeliverySyncQueueItem } from './queue';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
export { buildRouteDeliverySourceRevisionKey } from './revision';

export interface EnqueueRouteDeliverySyncJobsForImportedRouteParams {
    userID: string;
    savedRouteID: string;
    sourceServiceName: ServiceNames;
    sourceProviderRouteId?: string;
    sourceProviderUserId?: string;
    sourceRevisionKey: string;
    manual?: boolean;
    routeIdFilter?: RouteDeliverySyncRouteId;
    respectRouteEnabled?: boolean;
}

export interface EnqueueRouteDeliverySyncJobsForImportedRouteResult {
    queued: number;
    skippedByReason: Record<string, number>;
}

function getRoutesForSource(
    sourceServiceName: ServiceNames,
    routeIdFilter?: RouteDeliverySyncRouteId,
): RouteDeliverySyncRoute[] {
    if (routeIdFilter) {
        const route = ROUTE_DELIVERY_SYNC_ROUTES[routeIdFilter];
        return route ? [route] : [];
    }

    return Object.values(ROUTE_DELIVERY_SYNC_ROUTES).filter((route) => route.sourceServiceName === sourceServiceName);
}

function incrementSkippedReason(
    skippedByReason: Record<string, number>,
    reason: string,
): void {
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
}

export async function enqueueRouteDeliverySyncJobsForImportedRoute(
    params: EnqueueRouteDeliverySyncJobsForImportedRouteParams,
): Promise<EnqueueRouteDeliverySyncJobsForImportedRouteResult> {
    const routes = getRoutesForSource(params.sourceServiceName, params.routeIdFilter);
    const skippedByReason: Record<string, number> = {};
    let queued = 0;
    const respectRouteEnabled = params.respectRouteEnabled !== false;

    if (routes.length > 0 && await shouldSkipQueueWorkForDeletedUser(
        params.userID,
        params.sourceServiceName,
        `${params.savedRouteID}:route-delivery-sync`,
        'before_route_delivery_sync_enqueue',
    )) {
        return {
            queued: 0,
            skippedByReason: {
                user_deleted_or_deleting: routes.length,
            },
        };
    }

    for (const route of routes) {
        const allowlistConfigError = getRouteDeliverySyncRouteAllowlistConfigError(route.id);
        if (allowlistConfigError) {
            incrementSkippedReason(skippedByReason, 'allowlist_misconfigured');
            continue;
        }

        if (!isRouteDeliverySyncRouteUserAllowlisted(route.id, params.userID)) {
            incrementSkippedReason(skippedByReason, 'user_not_allowlisted');
            continue;
        }

        if (respectRouteEnabled && !(await isRouteDeliverySyncRouteEnabledForUser(params.userID, route.id))) {
            incrementSkippedReason(skippedByReason, 'route_disabled');
            continue;
        }

        const queueResult = await enqueueRouteDeliverySyncQueueItem({
            routeId: route.id,
            sourceServiceName: route.sourceServiceName,
            destinationServiceName: route.destinationServiceName,
            userID: params.userID,
            savedRouteID: params.savedRouteID,
            sourceRevisionKey: params.sourceRevisionKey,
            sourceProviderRouteId: params.sourceProviderRouteId,
            sourceProviderUserId: params.sourceProviderUserId,
            manual: params.manual === true,
        });

        if (queueResult.enqueued || queueResult.redispatched === true) {
            queued += 1;
            continue;
        }

        incrementSkippedReason(skippedByReason, queueResult.reason || 'queue_not_enqueued');
    }

    return {
        queued,
        skippedByReason,
    };
}
