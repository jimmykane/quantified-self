import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '../../../shared/app-route.interface';

import { generateIDFromParts } from '../utils';
import {
    increaseRetryCountForQueueItem,
    markQueueItemSkipped,
    moveToDeadLetterQueue,
    QueueResult,
    QUEUE_SKIPPED_REASONS,
    updateToProcessed,
} from '../queue-utils';
import { RouteSyncQueueItemInterface } from '../queue/queue-item.interface';
import {
    buildServiceRouteSourceMetadata,
} from './route-persistence';
import {
    assignRouteSegmentIDs,
    getRouteParsingFailureMessage,
    parseRoutePayload,
    RouteProcessingHttpStatusError,
} from './route-processing';
import { OriginalRouteFile } from '../shared/route-writer';
import { exportSuuntoRouteAsGPX } from '../suunto/routes';
import {
    SyncedRouteLimitExceededError,
    SyncedRouteProAccessRequiredError,
    SyncedRouteSkippedForDeletedUserError,
    upsertSyncedRoute,
} from './upsert-synced-route';
import { UserDeletionGuardReadError } from '../shared/user-deletion-guard';

async function buildSourceRouteID(
    sourceServiceName: ServiceNames,
    providerRouteId: string,
): Promise<string> {
    return generateIDFromParts(['route', sourceServiceName, providerRouteId]);
}

function normalizeNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sanitizeFileNamePart(value: string | null | undefined): string {
    const normalized = `${value || ''}`.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g, '-');
    return normalized.replace(/^-|-$/g, '') || 'route';
}

function buildProviderOriginalFilename(queueItem: RouteSyncQueueItemInterface): string {
    const baseName = sanitizeFileNamePart(queueItem.providerRouteName || queueItem.providerRouteId);
    return `${baseName}.gpx`;
}

function parseProviderErrorPayload(payload: string): { code?: number; message?: string } | null {
    const trimmedPayload = payload.trim();
    if (!trimmedPayload.startsWith('{')) {
        return null;
    }

    try {
        const parsedPayload = JSON.parse(trimmedPayload) as { code?: unknown; message?: unknown; error?: unknown };
        const code = typeof parsedPayload.code === 'number' ? parsedPayload.code : undefined;
        const message = typeof parsedPayload.message === 'string'
            ? parsedPayload.message
            : (typeof parsedPayload.error === 'string' ? parsedPayload.error : undefined);
        return code === undefined && !message ? null : { code, message };
    } catch {
        return null;
    }
}

function createSuuntoRouteExportProviderError(payload: string): Error | null {
    const providerError = parseProviderErrorPayload(payload);
    if (!providerError) {
        return null;
    }

    const code = providerError.code;
    const message = providerError.message || 'Unknown provider error';
    const error = new Error(`Suunto route export returned provider error${code ? ` ${code}` : ''}: ${message}`) as Error & { statusCode?: number; code?: string };
    if (typeof code === 'number') {
        error.statusCode = code;
    }
    if (code === 401) {
        error.code = 'unauthenticated';
    } else if (code === 403) {
        error.code = 'permission-denied';
    }
    return error;
}

async function parseSuuntoRouteGPX(queueItem: RouteSyncQueueItemInterface, gpxContent: string) {
    const providerError = createSuuntoRouteExportProviderError(gpxContent);
    if (providerError) {
        throw providerError;
    }

    try {
        const routeFile = await parseRoutePayload(Buffer.from(gpxContent, 'utf8'), 'gpx');
        if (!routeFile.hasRoutes()) {
            throw new RouteProcessingHttpStatusError(400, 'No routes were found in the Suunto GPX export.');
        }
        return routeFile;
    } catch (error) {
        if (error instanceof RouteProcessingHttpStatusError) {
            throw error;
        }
        throw new RouteProcessingHttpStatusError(400, getRouteParsingFailureMessage(error, 'gpx'));
    }
}

function isUserDeletionGuardReadError(error: unknown): error is UserDeletionGuardReadError {
    return error instanceof UserDeletionGuardReadError
        || (error instanceof Error && error.name === 'UserDeletionGuardReadError');
}

function getStatusCode(error: unknown): number | undefined {
    const directStatusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    if (typeof directStatusCode === 'number') {
        return directStatusCode;
    }

    const responseStatusCode = (error as { response?: { statusCode?: unknown } } | null)?.response?.statusCode;
    return typeof responseStatusCode === 'number' ? responseStatusCode : undefined;
}

function getSourceSummary(routeDocument: FirestoreRouteJSON | null | undefined): Record<string, unknown> | null {
    return routeDocument?.sourceSummary && typeof routeDocument.sourceSummary === 'object' && !Array.isArray(routeDocument.sourceSummary)
        ? routeDocument.sourceSummary as unknown as Record<string, unknown>
        : null;
}

function isValidDate(date: Date): boolean {
    return Number.isFinite(date.getTime());
}

function hasTimestampToDate(value: unknown): value is { toDate: () => Date } {
    return typeof (value as { toDate?: unknown } | null)?.toDate === 'function';
}

function hasTimestampFields(value: unknown): value is { seconds: number; nanoseconds?: number } {
    return typeof (value as { seconds?: unknown } | null)?.seconds === 'number';
}

function toDate(value: unknown): Date | null {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value;
    }

    if (hasTimestampToDate(value)) {
        const date = value.toDate();
        return isValidDate(date) ? date : null;
    }

    if (hasTimestampFields(value)) {
        const seconds = value.seconds;
        const nanoseconds = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
        const date = new Date((seconds * 1000) + Math.trunc(nanoseconds / 1_000_000));
        return isValidDate(date) ? date : null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    return null;
}

function toTimestampMs(value: unknown): number | null {
    const date = toDate(value);
    return date ? date.getTime() : null;
}

async function getExistingRouteDocument(
    userID: string,
    routeID: string,
): Promise<FirestoreRouteJSON | null> {
    const routeSnapshot = await admin.firestore().doc(`users/${userID}/routes/${routeID}`).get();
    if (!routeSnapshot.exists) {
        return null;
    }

    return routeSnapshot.data() as FirestoreRouteJSON;
}

function hasMatchingProviderSource(
    existingRouteDocument: FirestoreRouteJSON | null,
    queueItem: RouteSyncQueueItemInterface,
): boolean {
    const sourceSummary = getSourceSummary(existingRouteDocument);
    if (normalizeNonEmptyString(sourceSummary?.sourceServiceName) !== queueItem.sourceServiceName
        || normalizeNonEmptyString(sourceSummary?.providerRouteId) !== queueItem.providerRouteId) {
        return false;
    }

    const currentProviderUserId = normalizeNonEmptyString(sourceSummary?.providerUserId);
    return !currentProviderUserId || currentProviderUserId === queueItem.providerUserId;
}

function shouldSkipUnchangedProviderRoute(
    existingRouteDocument: FirestoreRouteJSON | null,
    queueItem: RouteSyncQueueItemInterface,
): boolean {
    if (!hasMatchingProviderSource(existingRouteDocument, queueItem)) {
        return false;
    }

    const sourceSummary = getSourceSummary(existingRouteDocument);
    const existingModifiedAtMs = toTimestampMs(sourceSummary?.modifiedAt);
    const incomingModifiedAtMs = toTimestampMs(queueItem.providerRouteModifiedAt);
    if (existingModifiedAtMs === null || incomingModifiedAtMs === null || existingModifiedAtMs < incomingModifiedAtMs) {
        return false;
    }

    const incomingProviderRouteName = normalizeNonEmptyString(queueItem.providerRouteName);
    const existingProviderRouteName = normalizeNonEmptyString(sourceSummary?.providerRouteName);
    return !incomingProviderRouteName || incomingProviderRouteName === existingProviderRouteName;
}

function resolveImportedAt(
    existingRouteDocument: FirestoreRouteJSON | null,
    fallbackImportedAt: Date,
): Date {
    const sourceSummary = getSourceSummary(existingRouteDocument);
    return toDate(sourceSummary?.importedAt)
        || toDate(existingRouteDocument?.importedAt)
        || fallbackImportedAt;
}

function isProviderAuthRequiredError(error: unknown): boolean {
    const code = `${(error as { code?: unknown } | null)?.code || ''}`.trim().toLowerCase();
    return code === 'unauthenticated'
        || code === 'permission-denied'
        || code === 'functions/unauthenticated'
        || code === 'functions/permission-denied';
}

export async function processRouteSyncQueueItem(
    queueItem: RouteSyncQueueItemInterface,
): Promise<QueueResult> {
    if (queueItem.sourceServiceName !== ServiceNames.SuuntoApp) {
        return moveToDeadLetterQueue(queueItem, new Error(`Route sync source ${queueItem.sourceServiceName} is not supported.`), undefined, 'UNSUPPORTED_ROUTE_SYNC_SOURCE');
    }

    const userID = `${queueItem.firebaseUserID || ''}`.trim();
    if (!userID) {
        return moveToDeadLetterQueue(queueItem, new Error('Route sync queue item is missing firebaseUserID.'), undefined, 'MISSING_FIREBASE_UID');
    }

    try {
        const routeID = await buildSourceRouteID(queueItem.sourceServiceName, queueItem.providerRouteId);
        const existingRouteDocument = await getExistingRouteDocument(userID, routeID);
        if (shouldSkipUnchangedProviderRoute(existingRouteDocument, queueItem)) {
            return markQueueItemSkipped(queueItem, undefined, 'provider_route_up_to_date', {
                resultRouteId: routeID,
                resultStatus: 'skipped',
                sourceRouteModifiedAt: queueItem.providerRouteModifiedAt || null,
            });
        }

        const gpxContent = await exportSuuntoRouteAsGPX(userID, queueItem.providerRouteId, {
            providerUserId: queueItem.providerUserId,
        });
        const routeFile = await parseSuuntoRouteGPX(queueItem, gpxContent);

        routeFile.setID(routeID);
        assignRouteSegmentIDs(routeFile, routeID);

        const importedAt = new Date();
        const originalFile: OriginalRouteFile = {
            data: Buffer.from(gpxContent, 'utf8'),
            extension: 'gpx',
            startDate: routeFile.createdAt || new Date(queueItem.providerRouteCreatedAt || Date.now()),
            originalFilename: buildProviderOriginalFilename(queueItem),
        };

        const sourceMetadata = buildServiceRouteSourceMetadata({
            sourceServiceName: queueItem.sourceServiceName,
            providerUserId: queueItem.providerUserId,
            providerRouteId: queueItem.providerRouteId,
            providerRouteName: queueItem.providerRouteName || routeFile.name || null,
            originalFilename: originalFile.originalFilename,
            importedAt: resolveImportedAt(existingRouteDocument, importedAt),
            modifiedAt: queueItem.providerRouteModifiedAt ? new Date(queueItem.providerRouteModifiedAt) : null,
        });

        await upsertSyncedRoute({
            userID,
            routeID,
            routeFile,
            sourceMetadata,
            originalFile,
        });

        return updateToProcessed(queueItem, undefined, {
            resultRouteId: routeID,
            resultStatus: 'success',
            sourceRouteModifiedAt: queueItem.providerRouteModifiedAt || null,
        });
    } catch (error) {
        if (error instanceof SyncedRouteLimitExceededError) {
            return markQueueItemSkipped(queueItem, undefined, 'route_limit_exceeded', {
                resultStatus: 'skipped',
                routeLimit: error.uploadLimit,
                routeCount: error.currentRouteCount,
            });
        }

        if (error instanceof SyncedRouteSkippedForDeletedUserError) {
            return markQueueItemSkipped(queueItem, undefined, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                resultStatus: 'skipped',
            });
        }

        if (error instanceof SyncedRouteProAccessRequiredError) {
            return markQueueItemSkipped(queueItem, undefined, 'route_sync_pro_required', {
                resultStatus: 'skipped',
            });
        }

        if (isUserDeletionGuardReadError(error)) {
            return increaseRetryCountForQueueItem(queueItem, error, 1);
        }

        if (isProviderAuthRequiredError(error)) {
            return markQueueItemSkipped(queueItem, undefined, 'provider_auth_required', {
                resultStatus: 'skipped',
            });
        }

        if (error instanceof RouteProcessingHttpStatusError) {
            return moveToDeadLetterQueue(queueItem, error, undefined, 'ROUTE_PARSE_FAILED');
        }

        if (getStatusCode(error) === 404) {
            return markQueueItemSkipped(queueItem, undefined, 'provider_route_not_found', {
                resultStatus: 'skipped',
            });
        }

        if (error instanceof Error) {
            return increaseRetryCountForQueueItem(queueItem, error, 1);
        }

        return increaseRetryCountForQueueItem(queueItem, new Error('Unknown route sync failure'), 1);
    }
}
