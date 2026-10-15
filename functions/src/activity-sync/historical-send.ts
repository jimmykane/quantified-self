import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { HistoricalSendRequest, HistoricalSendResponse } from '../../../shared/historical-activity-send';
import {
    ActivityDeliveryRouteId,
    ActivityDeliverySource,
    getHistoricalActivityRouteId,
    getActivityDeliveryRoute,
    HISTORICAL_MANUAL_ACTIVITY_ROUTES,
} from '../../../shared/activity-sync-routes';
import { getActivitySyncRouteAllowlistConfigError, isActivitySyncRouteUserAllowlisted } from './allowlist';
import { buildActivitySyncQueueItemId, enqueueActivitySyncQueueItem } from './queue';
import { canPromotePendingActivitySyncQueueItem } from './queue-promotion';
import { getActivitySyncMetadataDocId, setActivitySyncQueuedMetadata, setActivitySyncRequeuedMetadata } from './metadata';
import { getDestinationConnectionStatus } from './process-queue-item';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import {
    HISTORICAL_FIT_MAX_BYTES,
    HistoricalOriginalIneligibleError,
    HistoricalOriginalFile,
    inspectHistoricalManualOriginal,
    isStorageObjectMissing,
    isOwnerOriginalPath,
    MANUAL_UPLOAD_ORIGIN_DOC_ID,
    matchesLegacyManualUploadID,
    readHistoricalManualFit,
} from './historical-manual-original';

interface SelectedSource {
    source: ActivityDeliverySource;
    routeId: ActivityDeliveryRouteId;
}

const PAGE_SIZE = 50;
const SEND_CONCURRENCY = 5;
const PREVIEW_READ_BATCH_SIZE = 100;
type DocumentReader = (ref: admin.firestore.DocumentReference) => Promise<admin.firestore.DocumentSnapshot>;
const DESTINATIONS = Object.values(HISTORICAL_MANUAL_ACTIVITY_ROUTES).map(route => route.destinationServiceName);

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeOriginal(value: unknown): HistoricalOriginalFile | null {
    const data = asRecord(value);
    if (!data || typeof data.path !== 'string' || !data.path.trim()) return null;
    return {
        path: data.path.trim(),
        ...(typeof data.bucket === 'string' && data.bucket ? { bucket: data.bucket } : {}),
        ...(typeof data.generation === 'string' || typeof data.generation === 'number'
            ? { generation: `${data.generation}` } : {}),
        ...(typeof data.originalFilename === 'string' ? { originalFilename: data.originalFilename } : {}),
        ...(Number.isFinite(Number(data.startDate)) ? { startDate: Number(data.startDate) } : {}),
    };
}

function originalFiles(event: Record<string, unknown>): HistoricalOriginalFile[] {
    const files = Array.isArray(event.originalFiles)
        ? event.originalFiles.map(normalizeOriginal).filter((file): file is HistoricalOriginalFile => !!file)
        : [];
    if (files.length > 0) return files;
    const legacy = normalizeOriginal(event.originalFile);
    return legacy ? [legacy] : [];
}

function increment(target: Record<string, number>, key: string): void {
    target[key] = (target[key] || 0) + 1;
}

function queryFingerprint(userID: string, request: HistoricalSendRequest, sources: SelectedSource[]): string {
    return createHash('sha256').update(JSON.stringify([
        userID, request.destinationServiceName, sources.map(item => item.source).sort(), request.startDate, request.endDate,
    ])).digest('hex');
}

function validateRequest(userID: string, request: HistoricalSendRequest): {
    startMs: number; endMs: number; sources: SelectedSource[]; queryHash: string;
} {
    if (request?.version !== 2 || !['preview', 'send'].includes(request.action)
        || !DESTINATIONS.includes(request.destinationServiceName)) {
        throw new HttpsError('invalid-argument', 'Unsupported historical activity send request.');
    }
    const startMs = Date.parse(request.startDate);
    const endMs = Date.parse(request.endDate);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
        throw new HttpsError('invalid-argument', 'Choose a valid activity date range.');
    }
    if (!Array.isArray(request.sources) || request.sources.length === 0 || request.sources.length > 4
        || new Set(request.sources).size !== request.sources.length) {
        throw new HttpsError('invalid-argument', 'Select one or more distinct activity sources.');
    }
    const sources = request.sources.map(source => ({
        source,
        routeId: getHistoricalActivityRouteId(source, request.destinationServiceName),
    }));
    if (sources.some(item => !item.routeId)) {
        throw new HttpsError('invalid-argument', 'Unsupported activity source for this destination.');
    }
    const selected = sources as SelectedSource[];
    const queryHash = queryFingerprint(userID, request, selected);
    if (request.cursor && (
        request.cursor.queryHash !== queryHash
        || !Number.isFinite(request.cursor.lastStartDate)
        || request.cursor.lastStartDate < startMs
        || request.cursor.lastStartDate > endMs
        || typeof request.cursor.lastEventID !== 'string'
        || !request.cursor.lastEventID
    )) {
        throw new HttpsError('invalid-argument', 'Historical activity cursor does not match the request.');
    }
    return { startMs, endMs, sources: selected, queryHash };
}

async function checkOriginal(
    userID: string,
    eventID: string,
    original: HistoricalOriginalFile,
): Promise<HistoricalOriginalFile | null> {
    if (!original.path.startsWith(`users/${userID}/events/${eventID}/`) || !original.path.endsWith('.fit')) return null;
    const file = original.bucket
        ? admin.storage().bucket(original.bucket).file(original.path)
        : admin.storage().bucket().file(original.path);
    try {
        const [metadata] = await file.getMetadata();
        const size = Number(metadata.size);
        const generation = `${metadata.generation || ''}`;
        if (!Number.isFinite(size) || size <= 0 || size > HISTORICAL_FIT_MAX_BYTES
            || !generation || (original.generation && generation !== original.generation)) return null;
        return { ...original, generation };
    } catch (error) {
        if (isStorageObjectMissing(error)) return null;
        throw error;
    }
}

export async function eligibleOriginal(params: {
    userID: string;
    eventID: string;
    event: Record<string, unknown>;
    source: ActivityDeliverySource;
    eventRef: admin.firestore.DocumentReference;
    action: 'preview' | 'send';
    readDocument: DocumentReader;
}): Promise<{ original?: HistoricalOriginalFile; reason?: string; sourceActivityID?: string }> {
    const { userID, eventID, event, source, eventRef, action, readDocument } = params;
    if (event.mergeType || event.isMerge === true || event.toolSource) return { reason: 'merged_or_derived_event' };
    const files = originalFiles(event);
    if (!files.length) return { reason: 'missing_original_files' };

    if (source === 'manualUpload') {
        if (files.length !== 1 || !isOwnerOriginalPath(userID, eventID, files[0].path)) {
            return { reason: 'not_manual_upload' };
        }
        const marker = await readDocument(eventRef.collection('metaData').doc(MANUAL_UPLOAD_ORIGIN_DOC_ID));
        const trustedMarker = marker.data()?.kind === 'manualUpload' && marker.data()?.version === 1;
        if (!trustedMarker && !/^[a-f0-9]{64}$/.test(eventID)) return { reason: 'not_manual_upload' };
        let generation: string;
        try {
            if (trustedMarker && action === 'preview') {
                generation = (await inspectHistoricalManualOriginal(userID, eventID, files[0])).generation;
            } else {
                const loaded = await readHistoricalManualFit(userID, eventID, files[0]);
                if (!trustedMarker && !matchesLegacyManualUploadID(userID, eventID, loaded.fit)) {
                    return { reason: 'not_manual_upload' };
                }
                generation = loaded.generation;
            }
        } catch (error) {
            if (error instanceof HistoricalOriginalIneligibleError) {
                return { reason: 'missing_invalid_or_oversized_original' };
            }
            throw error;
        }
        return { original: { ...files[0], generation } };
    }

    const sourceMeta = await readDocument(eventRef.collection('metaData').doc(source));
    if (!sourceMeta.exists) return { reason: 'not_imported_from_source' };
    const matching = files.find(file => file.path.endsWith('.fit'));
    if (!matching) return { reason: 'unsupported_original_file' };
    const original = await checkOriginal(userID, eventID, matching);
    if (!original) return { reason: 'missing_invalid_or_oversized_original' };
    const data = asRecord(sourceMeta.data()) || {};
    const sourceActivityID = `${data.activityFileID || data.workoutID || data.summaryId || ''}`.trim();
    return { original, ...(sourceActivityID ? { sourceActivityID } : {}) };
}

async function processSource(params: {
    userID: string;
    eventSnapshot: admin.firestore.QueryDocumentSnapshot;
    selected: SelectedSource;
    action: 'preview' | 'send';
    readDocument: DocumentReader;
}): Promise<{ eligible: boolean; queued: boolean; reason?: string }> {
    const { userID, eventSnapshot, selected, action, readDocument } = params;
    const eventID = eventSnapshot.id;
    const event = asRecord(eventSnapshot.data());
    if (!event) return { eligible: false, queued: false, reason: 'invalid_event' };
    const metadataRef = eventSnapshot.ref.collection('metaData').doc(getActivitySyncMetadataDocId(selected.routeId));
    const metadata = await readDocument(metadataRef);
    if (metadata.data()?.status === 'success') return { eligible: false, queued: false, reason: 'already_sent' };
    const queueID = await buildActivitySyncQueueItemId(selected.routeId, userID, eventID);
    const existingQueue = await readDocument(admin.firestore().collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).doc(queueID));
    const queueReason = queueSkipReason(existingQueue, userID, eventID, selected);
    if (queueReason) return { eligible: false, queued: false, reason: queueReason };
    const result = await eligibleOriginal({ userID, eventID, event, source: selected.source, eventRef: eventSnapshot.ref, action, readDocument });
    if (!result.original) return { eligible: false, queued: false, reason: result.reason || 'unsupported_original_file' };
    if (action === 'preview') return { eligible: true, queued: false };

    const queued = await enqueueActivitySyncQueueItem({
        routeId: selected.routeId,
        sourceServiceName: selected.source,
        destinationServiceName: getDestinationForRoute(selected.routeId),
        userID,
        eventID,
        sourceActivityID: result.sourceActivityID,
        originalFile: {
            ...result.original,
            extension: result.original.path.endsWith('.fit.gz') ? 'fit.gz' : 'fit',
        },
        manual: true,
        deliveryMode: 'historical',
    });
    if (!queued.enqueued && !queued.redispatched) {
        return { eligible: false, queued: false, reason: queued.reason || 'queue_not_enqueued' };
    }
    const metadataParams = {
        routeId: selected.routeId, userID, eventID,
        sourceServiceName: selected.source,
        destinationServiceName: getDestinationForRoute(selected.routeId),
        manual: true,
        requireEventExists: true,
    };
    try {
        if (queued.redispatched) await setActivitySyncRequeuedMetadata(metadataParams);
        else await setActivitySyncQueuedMetadata(metadataParams);
    } catch {
        // Queue admission is already durable. The worker can write its own
        // processing state, and retrying this page remains idempotent.
        logger.error('[HistoricalActivitySend] Queue admission metadata write failed.', { routeId: selected.routeId });
    }
    return { eligible: true, queued: true };
}

function queueSkipReason(
    existingQueue: admin.firestore.DocumentSnapshot,
    userID: string,
    eventID: string,
    selected: SelectedSource,
): string | null {
    const existingQueueData = existingQueue.data();
    if (existingQueue.exists && existingQueueData?.processed !== true
        && (!canPromotePendingActivitySyncQueueItem(existingQueueData || {})
            || existingQueueData?.routeId !== selected.routeId
            || existingQueueData?.userID !== userID
            || existingQueueData?.eventID !== eventID
            || existingQueueData?.sourceServiceName !== selected.source
            || existingQueueData?.destinationServiceName !== getDestinationForRoute(selected.routeId))) {
        return 'already_queued';
    }
    if (existingQueue.data()?.resultStatus === 'manual_reconciliation_required') {
        return 'manual_reconciliation_required';
    }
    if (existingQueue.data()?.resultStatus === 'success') {
        return 'already_sent';
    }
    return null;
}

function getDestinationForRoute(routeId: ActivityDeliveryRouteId): ServiceNames {
    const route = getActivityDeliveryRoute(routeId);
    if (!route) throw new Error('Unsupported historical activity route.');
    return route.destinationServiceName;
}

/** Invocation-local snapshots only. Send always re-reads current state before queue admission. */
async function previewDocumentReader(
    userID: string,
    tasks: { eventSnapshot: admin.firestore.QueryDocumentSnapshot; selected: SelectedSource }[],
): Promise<DocumentReader> {
    const db = admin.firestore();
    const snapshots = new Map<string, admin.firestore.DocumentSnapshot>();
    const readDocument: DocumentReader = async ref => {
        const snapshot = snapshots.get(ref.path);
        if (!snapshot) throw new Error('Historical preview snapshot unavailable.');
        return snapshot;
    };
    const readBatches = async (references: admin.firestore.DocumentReference[]): Promise<void> => {
        const refs = [...new Map(references.map(ref => [ref.path, ref])).values()];
        // At most 600 exact documents for 50 events / four sources, 100 per RPC and two RPCs in flight.
        for (let offset = 0; offset < refs.length; offset += PREVIEW_READ_BATCH_SIZE * 2) {
            await Promise.all([offset, offset + PREVIEW_READ_BATCH_SIZE].map(async start => {
                const batch = refs.slice(start, start + PREVIEW_READ_BATCH_SIZE);
                if (!batch.length) return;
                for (const snapshot of await db.getAll(...batch)) snapshots.set(snapshot.ref.path, snapshot);
            }));
        }
    };
    const metadataRefs = tasks.map(({ eventSnapshot, selected }) =>
        eventSnapshot.ref.collection('metaData').doc(getActivitySyncMetadataDocId(selected.routeId)));
    await readBatches(metadataRefs);
    const pending = [];
    for (const task of tasks) {
        const metadata = task.eventSnapshot.ref.collection('metaData').doc(getActivitySyncMetadataDocId(task.selected.routeId));
        if ((await readDocument(metadata)).data()?.status === 'success') continue;
        const queueID = await buildActivitySyncQueueItemId(task.selected.routeId, userID, task.eventSnapshot.id);
        pending.push({ ...task, queueRef: db.collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).doc(queueID) });
    }
    await readBatches(pending.map(task => task.queueRef));
    const sourceRefs = [];
    for (const task of pending) {
        if (queueSkipReason(await readDocument(task.queueRef), userID, task.eventSnapshot.id, task.selected)) continue;
        const event = asRecord(task.eventSnapshot.data());
        if (!event || event.mergeType || event.isMerge === true || event.toolSource || !originalFiles(event).length) continue;
        sourceRefs.push(task.eventSnapshot.ref.collection('metaData').doc(
            task.selected.source === 'manualUpload' ? MANUAL_UPLOAD_ORIGIN_DOC_ID : task.selected.source));
    }
    await readBatches(sourceRefs);
    return readDocument;
}

export async function runHistoricalSendPage(userID: string, request: HistoricalSendRequest): Promise<HistoricalSendResponse> {
    const startedAt = Date.now();
    const { startMs, endMs, sources, queryHash } = validateRequest(userID, request);
    for (const selected of sources) {
        const error = getActivitySyncRouteAllowlistConfigError(selected.routeId);
        if (error) throw new HttpsError('failed-precondition', error);
        if (!isActivitySyncRouteUserAllowlisted(selected.routeId, userID)) {
            throw new HttpsError('permission-denied', 'Activity sending is not available for this account.');
        }
    }
    const connection = await getDestinationConnectionStatus(userID, request.destinationServiceName);
    if (connection !== 'connected') {
        throw new HttpsError('failed-precondition', `Destination is ${connection.replace(/_/g, ' ')}.`);
    }
    let query = admin.firestore().collection('users').doc(userID).collection('events')
        .where('startDate', '>=', startMs)
        .where('startDate', '<=', endMs)
        .orderBy('startDate', 'asc')
        .orderBy(FieldPath.documentId())
        .limit(PAGE_SIZE);
    if (request.cursor) query = query.startAfter(request.cursor.lastStartDate, request.cursor.lastEventID);
    const page = await query.get();
    const response: HistoricalSendResponse = {
        scanned: page.size,
        eligibleBySource: {}, skippedBySource: {}, queued: 0, skippedByReason: {}, failedCount: 0, nextCursor: null,
    };
    const tasks = page.docs.flatMap(eventSnapshot => sources.map(selected => ({ eventSnapshot, selected })));
    const readDocument: DocumentReader = request.action === 'preview'
        ? await previewDocumentReader(userID, tasks) : ref => ref.get();
    for (let index = 0; index < tasks.length; index += SEND_CONCURRENCY) {
        const results = await Promise.all(tasks.slice(index, index + SEND_CONCURRENCY).map(async task => {
            try {
                return { source: task.selected.source, result: await processSource({
                    userID, eventSnapshot: task.eventSnapshot, selected: task.selected, action: request.action, readDocument,
                }) };
            } catch {
                return { source: task.selected.source, result: { eligible: false, queued: false, reason: 'processing_failed' } };
            }
        }));
        for (const { source, result } of results) {
            if (result.eligible) increment(response.eligibleBySource, source);
            if (result.queued) response.queued += 1;
            if (result.reason) {
                increment(response.skippedBySource, source);
                increment(response.skippedByReason, result.reason);
            }
            if (result.reason === 'processing_failed') response.failedCount += 1;
        }
    }
    if (page.size === PAGE_SIZE) {
        const last = page.docs[page.docs.length - 1];
        response.nextCursor = { lastStartDate: Number(last.data().startDate), lastEventID: last.id, queryHash };
    }
    if (request.action === 'preview') {
        try {
            logger.info('[HistoricalActivitySend] Preview page checked.', {
                destination: request.destinationServiceName, sourceCount: sources.length,
                scanned: response.scanned, failedCount: response.failedCount,
                hasNextPage: !!response.nextCursor, elapsedMs: Date.now() - startedAt,
            });
        } catch { /* Diagnostic logging must not fail an otherwise completed read-only page. */ }
    }
    return response;
}
