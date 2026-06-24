import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '../../../shared/app-route.interface';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getRouteDeliverySyncRouteId } from '../../../shared/route-delivery-sync-routes';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import {
    enqueueRouteDeliverySyncJobsForImportedRoute,
} from './enqueue-imported-route';
import { buildRouteDeliverySourceRevisionKeyForRouteSource } from './revision';
import {
    getRouteDeliverySyncRouteAllowlistConfigError,
    isRouteDeliverySyncRouteUserAllowlisted,
} from './allowlist';
import { hasSuccessfulRouteDeliveryMetadataForRevision } from './delivery-metadata';

interface BackfillRouteDeliverySyncRouteRequest {
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
}

interface BackfillRouteDeliverySyncRouteResponse {
    scanned: number;
    queued: number;
    skippedByReason: Record<string, number>;
    failedCount: number;
    failedRoutes: BackfillFailedRoute[];
}

interface BackfillFailedRoute {
    routeID: string;
    reason: string;
    message: string;
}

interface BackfillRouteProcessingResult {
    queued: number;
    skippedByReason: Record<string, number>;
    failedRoute?: BackfillFailedRoute;
}

const BACKFILL_PAGE_SIZE = 200;
const BACKFILL_CONCURRENCY = 10;
const BACKFILL_FAILED_ROUTES_RESPONSE_LIMIT = 100;
const BACKFILL_MAX_ERROR_MESSAGE_LENGTH = 300;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeNonEmptyString(value: unknown): string | null {
    const normalized = `${value || ''}`.trim();
    return normalized.length > 0 ? normalized : null;
}

function getSourceSummary(routeDocument: FirestoreRouteJSON | null | undefined): Record<string, unknown> | null {
    return asRecord(routeDocument?.sourceSummary);
}

function hasOriginalRouteFile(routeDocument: FirestoreRouteJSON): boolean {
    if (Array.isArray(routeDocument.originalFiles) && routeDocument.originalFiles.some(file => !!normalizeNonEmptyString(file?.path))) {
        return true;
    }

    return !!normalizeNonEmptyString(routeDocument.originalFile?.path);
}

function mergeSkippedReasons(
    target: Record<string, number>,
    source: Record<string, number>,
): void {
    for (const [reason, count] of Object.entries(source)) {
        target[reason] = (target[reason] || 0) + Number(count || 0);
    }
}

function toFailedRouteMessage(error: unknown): string {
    const errorRecord = asRecord(error);
    const rawMessage = `${errorRecord?.message || error || 'Unknown error'}`.trim() || 'Unknown error';
    return rawMessage.slice(0, BACKFILL_MAX_ERROR_MESSAGE_LENGTH);
}

function incrementSkippedReason(
    skippedByReason: Record<string, number>,
    reason: string,
): void {
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
}

async function processBackfillRoute(params: {
    routeId: NonNullable<ReturnType<typeof getRouteDeliverySyncRouteId>>;
    userID: string;
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    routeSnapshot: admin.firestore.QueryDocumentSnapshot;
}): Promise<BackfillRouteProcessingResult> {
    const {
        routeId,
        userID,
        sourceServiceName,
        destinationServiceName,
        routeSnapshot,
    } = params;
    const savedRouteID = routeSnapshot.id;
    const skippedByReason: Record<string, number> = {};

    try {
        const routeDocument = routeSnapshot.data() as FirestoreRouteJSON;
        const sourceSummary = getSourceSummary(routeDocument);
        if (normalizeNonEmptyString(sourceSummary?.sourceServiceName) !== sourceServiceName) {
            return {
                queued: 0,
                skippedByReason,
            };
        }

        if (!hasOriginalRouteFile(routeDocument)) {
            incrementSkippedReason(skippedByReason, 'missing_original_files');
            return {
                queued: 0,
                skippedByReason,
            };
        }

        const sourceProviderRouteId = normalizeNonEmptyString(sourceSummary?.providerRouteId) || undefined;
        const sourceProviderUserId = normalizeNonEmptyString(sourceSummary?.providerUserId) || undefined;
        const sourceRevisionKey = buildRouteDeliverySourceRevisionKeyForRouteSource({
            sourceServiceName,
            sourceSummary,
            fallbackProviderRouteId: sourceProviderRouteId,
            routeImportedAt: routeDocument.importedAt,
            fallbackRouteID: savedRouteID,
        });

        if (await hasSuccessfulRouteDeliveryMetadataForRevision({
            routeRef: routeSnapshot.ref,
            routeId,
            destinationServiceName,
            sourceRevisionKey,
        })) {
            incrementSkippedReason(skippedByReason, 'already_synced');
            return {
                queued: 0,
                skippedByReason,
            };
        }

        const enqueueResult = await enqueueRouteDeliverySyncJobsForImportedRoute({
            userID,
            savedRouteID,
            sourceServiceName,
            sourceProviderRouteId,
            sourceProviderUserId,
            sourceRevisionKey,
            routeIdFilter: routeId,
            manual: true,
            respectRouteEnabled: false,
            skipExistingSuccessfulDeliveryCheck: true,
        });

        return {
            queued: enqueueResult.queued,
            skippedByReason: enqueueResult.skippedByReason,
        };
    } catch (error) {
        logger.error(`[RouteDeliverySyncBackfill] Failed processing route ${savedRouteID}`, error);
        return {
            queued: 0,
            skippedByReason,
            failedRoute: {
                routeID: savedRouteID,
                reason: 'route_processing_failed',
                message: toFailedRouteMessage(error),
            },
        };
    }
}

async function processRoutePageWithConcurrency(
    routeSnapshots: admin.firestore.QueryDocumentSnapshot[],
    processor: (routeSnapshot: admin.firestore.QueryDocumentSnapshot) => Promise<BackfillRouteProcessingResult>,
): Promise<BackfillRouteProcessingResult[]> {
    const results: BackfillRouteProcessingResult[] = [];
    for (let index = 0; index < routeSnapshots.length; index += BACKFILL_CONCURRENCY) {
        const chunk = routeSnapshots.slice(index, index + BACKFILL_CONCURRENCY);
        results.push(...await Promise.all(chunk.map(routeSnapshot => processor(routeSnapshot))));
    }
    return results;
}

export const backfillRouteDeliverySyncRoute = onCall({
    region: FUNCTIONS_MANIFEST.backfillRouteDeliverySyncRoute.region,
    cors: ALLOWED_CORS_ORIGINS,
    timeoutSeconds: 540,
    memory: '1GiB',
}, async (request): Promise<BackfillRouteDeliverySyncRouteResponse> => {
    enforceAppCheck(request);

    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const userID = request.auth.uid;
    if (!(await hasProAccess(userID))) {
        logger.warn(`Blocking route delivery sync backfill for non-pro user ${userID}`);
        throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
    }

    const payload = request.data as BackfillRouteDeliverySyncRouteRequest;
    const sourceServiceName = payload?.sourceServiceName as ServiceNames;
    const destinationServiceName = payload?.destinationServiceName as ServiceNames;
    const routeId = getRouteDeliverySyncRouteId(sourceServiceName, destinationServiceName);

    if (!routeId) {
        throw new HttpsError('invalid-argument', 'Unsupported source/destination route.');
    }

    const allowlistConfigError = getRouteDeliverySyncRouteAllowlistConfigError(routeId);
    if (allowlistConfigError) {
        logger.error(`Blocking route delivery sync backfill due to allowlist misconfiguration for route ${routeId}`);
        throw new HttpsError('failed-precondition', allowlistConfigError);
    }

    if (!isRouteDeliverySyncRouteUserAllowlisted(routeId, userID)) {
        logger.warn(`Blocking route delivery sync backfill for non-allowlisted user ${userID} and route ${routeId}`);
        throw new HttpsError('permission-denied', 'Route delivery sync route is not available for this account.');
    }

    const skippedByReason: Record<string, number> = {};
    const failedRoutes: BackfillFailedRoute[] = [];
    let scanned = 0;
    let queued = 0;
    let failedCount = 0;
    let pageCursor: admin.firestore.QueryDocumentSnapshot | undefined;

    while (true) {
        let query = admin.firestore()
            .collection('users')
            .doc(userID)
            .collection('routes')
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(BACKFILL_PAGE_SIZE);

        if (pageCursor) {
            query = query.startAfter(pageCursor);
        }

        const pageSnapshot = await query.get();
        if (pageSnapshot.empty) {
            break;
        }

        scanned += pageSnapshot.size;
        const pageResults = await processRoutePageWithConcurrency(
            pageSnapshot.docs,
            routeSnapshot => processBackfillRoute({
                routeId,
                userID,
                sourceServiceName,
                destinationServiceName,
                routeSnapshot,
            }),
        );

        for (const result of pageResults) {
            queued += result.queued;
            mergeSkippedReasons(skippedByReason, result.skippedByReason);
            if (result.failedRoute) {
                failedCount += 1;
                if (failedRoutes.length < BACKFILL_FAILED_ROUTES_RESPONSE_LIMIT) {
                    failedRoutes.push(result.failedRoute);
                }
            }
        }

        if (pageSnapshot.docs.length < BACKFILL_PAGE_SIZE) {
            break;
        }
        pageCursor = pageSnapshot.docs[pageSnapshot.docs.length - 1];
    }

    return {
        scanned,
        queued,
        skippedByReason,
        failedCount,
        failedRoutes,
    };
});
