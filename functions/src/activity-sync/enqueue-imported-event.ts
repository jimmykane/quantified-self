import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRoute, ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { isActivitySyncRouteBlockedByReconnectRequiredForUser, isActivitySyncRouteEnabledForUser } from './settings';
import { enqueueActivitySyncQueueItem } from './queue';
import { setActivitySyncQueuedMetadata, setActivitySyncRequeuedMetadata, setActivitySyncSkippedMetadata } from './metadata';
import { ActivitySyncOriginalFileMetadata } from '../queue/queue-item.interface';
import { getActivitySyncRouteAllowlistConfigError, isActivitySyncRouteUserAllowlisted } from './allowlist';

export interface EnqueueActivitySyncJobsForImportedEventParams {
    userID: string;
    eventID: string;
    sourceServiceName: ServiceNames;
    sourceActivityID?: string;
    originalFiles: EnqueueActivitySyncOriginalFileMetadata[];
    manual?: boolean;
    routeIdFilter?: ActivitySyncRouteId;
    respectRouteEnabled?: boolean;
}

export interface EnqueueActivitySyncJobsForImportedEventResult {
    queued: number;
    skippedByReason: Record<string, number>;
}

export interface EnqueueActivitySyncOriginalFileMetadata {
    path: string;
    bucket?: string;
    startDate?: unknown;
    originalFilename?: string;
}

function toFileExtension(path?: string): string {
    if (!path || typeof path !== 'string') {
        return '';
    }

    const lastDotIndex = path.lastIndexOf('.');
    if (lastDotIndex < 0 || lastDotIndex === path.length - 1) {
        return '';
    }

    return path.slice(lastDotIndex + 1).toLowerCase();
}

function toOriginalFileForQueue(sourceFile: EnqueueActivitySyncOriginalFileMetadata, extension: string): ActivitySyncOriginalFileMetadata {
    const startDateValue = sourceFile.startDate as unknown;
    const startDateEpochMs = startDateValue instanceof Date
        ? startDateValue.getTime()
        : Number.isFinite(Number(startDateValue))
            ? Number(startDateValue)
            : undefined;

    return {
        path: `${sourceFile.path || ''}`,
        bucket: sourceFile.bucket,
        startDate: startDateEpochMs,
        originalFilename: sourceFile.originalFilename,
        extension,
    };
}

function getRoutesForSource(
    sourceServiceName: ServiceNames,
    routeIdFilter?: ActivitySyncRouteId,
): ActivitySyncRoute[] {
    if (routeIdFilter) {
        const route = ACTIVITY_SYNC_ROUTES[routeIdFilter];
        return route ? [route] : [];
    }

    return Object.values(ACTIVITY_SYNC_ROUTES).filter((route) => route.sourceServiceName === sourceServiceName);
}

async function shouldEnqueueRoute(
    userID: string,
    routeId: ActivitySyncRouteId,
    respectRouteEnabled: boolean,
): Promise<boolean> {
    if (!respectRouteEnabled) {
        return true;
    }

    return isActivitySyncRouteEnabledForUser(userID, routeId);
}

function incrementSkippedReason(
    skippedByReason: Record<string, number>,
    reason: string,
): void {
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
}

export async function enqueueActivitySyncJobsForImportedEvent(
    params: EnqueueActivitySyncJobsForImportedEventParams,
): Promise<EnqueueActivitySyncJobsForImportedEventResult> {
    const routes = getRoutesForSource(params.sourceServiceName, params.routeIdFilter);
    const skippedByReason: Record<string, number> = {};
    let queued = 0;
    const respectRouteEnabled = params.respectRouteEnabled !== false;
    const originalFiles = Array.isArray(params.originalFiles) ? params.originalFiles : [];

    for (const route of routes) {
        const allowlistConfigError = getActivitySyncRouteAllowlistConfigError(route.id);
        if (allowlistConfigError) {
            incrementSkippedReason(skippedByReason, 'allowlist_misconfigured');
            await setActivitySyncSkippedMetadata({
                routeId: route.id,
                userID: params.userID,
                eventID: params.eventID,
                sourceServiceName: route.sourceServiceName,
                destinationServiceName: route.destinationServiceName,
                manual: params.manual === true,
                skippedReason: 'allowlist_misconfigured',
                detail: allowlistConfigError,
            });
            continue;
        }

        if (!isActivitySyncRouteUserAllowlisted(route.id, params.userID)) {
            incrementSkippedReason(skippedByReason, 'user_not_allowlisted');
            await setActivitySyncSkippedMetadata({
                routeId: route.id,
                userID: params.userID,
                eventID: params.eventID,
                sourceServiceName: route.sourceServiceName,
                destinationServiceName: route.destinationServiceName,
                manual: params.manual === true,
                skippedReason: 'user_not_allowlisted',
                detail: 'User is not allowlisted for this activity sync route.',
            });
            continue;
        }

        if (await isActivitySyncRouteBlockedByReconnectRequiredForUser(params.userID, route.id)) {
            incrementSkippedReason(skippedByReason, 'service_reconnect_required');
            await setActivitySyncSkippedMetadata({
                routeId: route.id,
                userID: params.userID,
                eventID: params.eventID,
                sourceServiceName: route.sourceServiceName,
                destinationServiceName: route.destinationServiceName,
                manual: params.manual === true,
                skippedReason: 'service_reconnect_required',
                detail: 'A service in this activity sync route requires reconnect.',
            });
            continue;
        }

        const shouldEnqueue = await shouldEnqueueRoute(params.userID, route.id, respectRouteEnabled);
        if (!shouldEnqueue) {
            incrementSkippedReason(skippedByReason, 'route_disabled');
            await setActivitySyncSkippedMetadata({
                routeId: route.id,
                userID: params.userID,
                eventID: params.eventID,
                sourceServiceName: route.sourceServiceName,
                destinationServiceName: route.destinationServiceName,
                manual: params.manual === true,
                skippedReason: 'route_disabled',
                detail: 'Route is disabled in user settings.',
            });
            continue;
        }

        const matchingFile = originalFiles.find((file) => route.supportedFileExtensions.includes(toFileExtension(file.path)));
        if (!matchingFile) {
            incrementSkippedReason(skippedByReason, 'unsupported_original_file');
            await setActivitySyncSkippedMetadata({
                routeId: route.id,
                userID: params.userID,
                eventID: params.eventID,
                sourceServiceName: route.sourceServiceName,
                destinationServiceName: route.destinationServiceName,
                manual: params.manual === true,
                skippedReason: 'unsupported_original_file',
                detail: 'No supported original file found for route.',
            });
            continue;
        }

        const extension = toFileExtension(matchingFile.path);
        const queueResult = await enqueueActivitySyncQueueItem({
            routeId: route.id,
            sourceServiceName: route.sourceServiceName,
            destinationServiceName: route.destinationServiceName,
            userID: params.userID,
            eventID: params.eventID,
            sourceActivityID: params.sourceActivityID,
            originalFile: toOriginalFileForQueue(matchingFile, extension),
            manual: params.manual === true,
        });

        if (queueResult.enqueued || queueResult.redispatched === true) {
            queued += 1;
            if (queueResult.redispatched === true) {
                await setActivitySyncRequeuedMetadata({
                    routeId: route.id,
                    userID: params.userID,
                    eventID: params.eventID,
                    sourceServiceName: route.sourceServiceName,
                    destinationServiceName: route.destinationServiceName,
                    manual: params.manual === true,
                });
            } else {
                await setActivitySyncQueuedMetadata({
                    routeId: route.id,
                    userID: params.userID,
                    eventID: params.eventID,
                    sourceServiceName: route.sourceServiceName,
                    destinationServiceName: route.destinationServiceName,
                    manual: params.manual === true,
                });
            }
            continue;
        }

        incrementSkippedReason(skippedByReason, queueResult.reason || 'queue_not_enqueued');
    }

    return {
        queued,
        skippedByReason,
    };
}
