import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { ActivitySyncRouteId, getActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { enqueueActivitySyncJobsForImportedEvent } from './enqueue-imported-event';
import { OriginalFileMetaData } from '../../../shared/app-event.interface';
import { getActivitySyncMetadataDocId, setActivitySyncSkippedMetadata } from './metadata';
import * as logger from 'firebase-functions/logger';
import { getActivitySyncRouteAllowlistConfigError, isActivitySyncRouteUserAllowlisted } from './allowlist';

interface BackfillActivitySyncRouteRequest {
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    startDate: string;
    endDate: string;
}

interface BackfillActivitySyncRouteResponse {
    scanned: number;
    queued: number;
    skippedByReason: Record<string, number>;
    failedCount: number;
    failedEvents: BackfillFailedEvent[];
}

interface BackfillFailedEvent {
    eventID: string;
    reason: string;
    message: string;
}

interface BackfillEventProcessingResult {
    queued: number;
    skippedByReason: Record<string, number>;
    failedEvent?: BackfillFailedEvent;
}

const BACKFILL_PAGE_SIZE = 200;
const BACKFILL_CONCURRENCY = 10;
const BACKFILL_FAILED_EVENTS_RESPONSE_LIMIT = 100;
const BACKFILL_MAX_ERROR_MESSAGE_LENGTH = 300;

function mergeSkippedReasons(
    target: Record<string, number>,
    source: Record<string, number>,
): void {
    for (const [reason, count] of Object.entries(source)) {
        target[reason] = (target[reason] || 0) + Number(count || 0);
    }
}

function toDate(value: unknown): Date | null {
    const date = new Date(`${value || ''}`);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function extractOriginalFiles(eventData: Record<string, unknown>): OriginalFileMetaData[] {
    const files: OriginalFileMetaData[] = [];

    if (Array.isArray(eventData.originalFiles)) {
        for (const file of eventData.originalFiles) {
            const candidate = asRecord(file);
            if (candidate && typeof candidate.path === 'string' && candidate.path.trim().length > 0) {
                files.push(candidate as OriginalFileMetaData);
            }
        }
    }

    const originalFile = asRecord(eventData.originalFile);
    if (files.length === 0 && originalFile && typeof originalFile.path === 'string' && originalFile.path.trim().length > 0) {
        files.push(originalFile as OriginalFileMetaData);
    }

    return files;
}

function getSourceActivityID(sourceMetaData: Record<string, unknown>): string | undefined {
    const candidate = `${sourceMetaData.activityFileID || sourceMetaData.workoutID || sourceMetaData.summaryId || ''}`.trim();
    return candidate.length > 0 ? candidate : undefined;
}

function toFailedEventMessage(error: unknown): string {
    const errorRecord = asRecord(error);
    const rawMessage = `${errorRecord?.message || error || 'Unknown error'}`.trim() || 'Unknown error';
    return rawMessage.slice(0, BACKFILL_MAX_ERROR_MESSAGE_LENGTH);
}

async function processBackfillEvent(params: {
    routeId: ActivitySyncRouteId;
    routeMetadataDocId: string;
    userID: string;
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    eventSnapshot: admin.firestore.QueryDocumentSnapshot;
}): Promise<BackfillEventProcessingResult> {
    const {
        routeId,
        routeMetadataDocId,
        userID,
        sourceServiceName,
        destinationServiceName,
        eventSnapshot,
    } = params;
    const eventID = eventSnapshot.id;

    try {
        const sourceMetaSnapshot = await eventSnapshot.ref.collection('metaData').doc(sourceServiceName).get();
        if (!sourceMetaSnapshot.exists) {
            // Event was not imported from the selected source route, skip silently.
            return {
                queued: 0,
                skippedByReason: {},
            };
        }

        const existingRouteMetadataSnapshot = await eventSnapshot.ref.collection('metaData').doc(routeMetadataDocId).get();
        const existingRouteMetadata = asRecord(existingRouteMetadataSnapshot.data()) || undefined;
        if (existingRouteMetadata?.status === 'success') {
            return {
                queued: 0,
                skippedByReason: {
                    already_synced: 1,
                },
            };
        }

        const eventData = asRecord(eventSnapshot.data());
        if (!eventData) {
            return {
                queued: 0,
                skippedByReason: {
                    event_payload_invalid: 1,
                },
            };
        }

        const originalFiles = extractOriginalFiles(eventData);
        if (!originalFiles.length) {
            await setActivitySyncSkippedMetadata({
                routeId,
                userID,
                eventID,
                sourceServiceName,
                destinationServiceName,
                manual: true,
                skippedReason: 'missing_original_files',
                detail: 'No stored original files found for event.',
            });
            return {
                queued: 0,
                skippedByReason: {
                    missing_original_files: 1,
                },
            };
        }

        const sourceMetaData = asRecord(sourceMetaSnapshot.data()) || {};
        const enqueueResult = await enqueueActivitySyncJobsForImportedEvent({
            userID,
            eventID,
            sourceServiceName,
            sourceActivityID: getSourceActivityID(sourceMetaData),
            originalFiles,
            routeIdFilter: routeId,
            manual: true,
            respectRouteEnabled: true,
        });

        return {
            queued: enqueueResult.queued,
            skippedByReason: enqueueResult.skippedByReason,
        };
    } catch (error) {
        logger.error(`[ActivitySyncBackfill] Failed processing event ${eventID}`, error);
        return {
            queued: 0,
            skippedByReason: {},
            failedEvent: {
                eventID,
                reason: 'event_processing_failed',
                message: toFailedEventMessage(error),
            },
        };
    }
}

export const backfillActivitySyncRoute = onCall({
    region: FUNCTIONS_MANIFEST.backfillActivitySyncRoute.region,
    cors: ALLOWED_CORS_ORIGINS,
    timeoutSeconds: 540,
    memory: '1GiB',
}, async (request): Promise<BackfillActivitySyncRouteResponse> => {
    enforceAppCheck(request);

    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const userID = request.auth.uid;
    if (!(await hasProAccess(userID))) {
        logger.warn(`Blocking activity sync backfill for non-pro user ${userID}`);
        throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
    }

    const payload = request.data as BackfillActivitySyncRouteRequest;
    const sourceServiceName = payload?.sourceServiceName as ServiceNames;
    const destinationServiceName = payload?.destinationServiceName as ServiceNames;
    const routeId = getActivitySyncRouteId(sourceServiceName, destinationServiceName);

    if (!routeId) {
        throw new HttpsError('invalid-argument', 'Unsupported source/destination route.');
    }

    const allowlistConfigError = getActivitySyncRouteAllowlistConfigError(routeId);
    if (allowlistConfigError) {
        logger.error(`Blocking activity sync backfill due to allowlist misconfiguration for route ${routeId}`);
        throw new HttpsError('failed-precondition', allowlistConfigError);
    }

    if (!isActivitySyncRouteUserAllowlisted(routeId, userID)) {
        logger.warn(`Blocking activity sync backfill for non-allowlisted user ${userID} and route ${routeId}`);
        throw new HttpsError('permission-denied', 'Activity sync route is not available for this account.');
    }

    const startDate = toDate(payload?.startDate);
    const endDate = toDate(payload?.endDate);
    if (!startDate || !endDate) {
        throw new HttpsError('invalid-argument', 'startDate and endDate must be valid ISO dates.');
    }
    if (startDate > endDate) {
        throw new HttpsError('invalid-argument', 'startDate must be less than or equal to endDate.');
    }

    const skippedByReason: Record<string, number> = {};
    let queued = 0;
    let scanned = 0;
    const routeMetadataDocId = getActivitySyncMetadataDocId(routeId);
    const failedEvents: BackfillFailedEvent[] = [];
    let failedCount = 0;
    let pageCursor: admin.firestore.QueryDocumentSnapshot | undefined;

    while (true) {
        const pageSnapshot = await requestRawEventsForRangePage(userID, startDate, endDate, pageCursor);
        if (pageSnapshot.empty) {
            break;
        }

        scanned += pageSnapshot.docs.length;

        for (let index = 0; index < pageSnapshot.docs.length; index += BACKFILL_CONCURRENCY) {
            const chunk = pageSnapshot.docs.slice(index, index + BACKFILL_CONCURRENCY);
            const chunkResults = await Promise.all(chunk.map((eventSnapshot) => processBackfillEvent({
                routeId,
                routeMetadataDocId,
                userID,
                sourceServiceName,
                destinationServiceName,
                eventSnapshot,
            })));

            for (const chunkResult of chunkResults) {
                queued += chunkResult.queued;
                mergeSkippedReasons(skippedByReason, chunkResult.skippedByReason);
                if (chunkResult.failedEvent) {
                    failedCount += 1;
                    if (failedEvents.length < BACKFILL_FAILED_EVENTS_RESPONSE_LIMIT) {
                        failedEvents.push(chunkResult.failedEvent);
                    }
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
        failedEvents,
    };
});

async function requestRawEventsForRangePage(
    userID: string,
    startDate: Date,
    endDate: Date,
    pageCursor?: admin.firestore.QueryDocumentSnapshot,
) {
    let query = admin
        .firestore()
        .collection('users')
        .doc(userID)
        .collection('events')
        .where('startDate', '>=', startDate.getTime())
        .where('startDate', '<=', endDate.getTime())
        .orderBy('startDate', 'asc')
        .limit(BACKFILL_PAGE_SIZE);

    if (pageCursor) {
        query = query.startAfter(pageCursor);
    }

    return query.get();
}
