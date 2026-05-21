import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { ACTIVITY_SYNC_METADATA_DOC_PREFIX } from './constants';
import { getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';

export type ActivitySyncStatus = 'queued' | 'processing' | 'success' | 'skipped' | 'retrying' | 'failed';

export interface ActivitySyncMetadataError {
    code: string;
    message: string;
    normalizedMessage: string;
}

function normalizeErrorMessage(message: string): string {
    return `${message || ''}`
        .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '#')
        .replace(/[0-9a-fA-F]{24,}/g, '#')
        .replace(/\d+/g, '#');
}

function normalizeErrorCode(code: unknown): string {
    const codeString = `${code || ''}`.trim();
    return codeString.length > 0 ? codeString : 'unknown';
}

function normalizeErrorMessageText(message: unknown): string {
    const messageString = `${message || ''}`.trim();
    return messageString.length > 0 ? messageString : 'Unknown error';
}

interface ErrorLike {
    code?: unknown;
    statusCode?: unknown;
    message?: unknown;
    error?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
    if (!error || typeof error !== 'object') {
        return {};
    }

    return error as ErrorLike;
}

function nestedErrorMessage(error: unknown): unknown {
    if (!error || typeof error !== 'object') {
        return undefined;
    }

    return (error as { message?: unknown }).message;
}

export function toActivitySyncMetadataError(error: unknown): ActivitySyncMetadataError {
    const errorLike = asErrorLike(error);
    const code = normalizeErrorCode(errorLike.code || errorLike.statusCode);
    const message = normalizeErrorMessageText(errorLike.message || nestedErrorMessage(errorLike.error) || error);

    return {
        code,
        message,
        normalizedMessage: normalizeErrorMessage(message),
    };
}

export function getActivitySyncMetadataDocId(routeId: ActivitySyncRouteId): string {
    return `${ACTIVITY_SYNC_METADATA_DOC_PREFIX}${routeId}`;
}

function getActivitySyncMetadataRef(
    db: admin.firestore.Firestore,
    userID: string,
    eventID: string,
    routeId: ActivitySyncRouteId,
) {
    return db
        .collection('users')
        .doc(userID)
        .collection('events')
        .doc(eventID)
        .collection('metaData')
        .doc(getActivitySyncMetadataDocId(routeId));
}

async function setActivitySyncMetadata(
    params: BaseMetadataParams,
    status: ActivitySyncStatus,
    payload: Record<string, unknown>,
): Promise<void> {
    const db = admin.firestore();
    const ref = getActivitySyncMetadataRef(db, params.userID, params.eventID, params.routeId);

    await db.runTransaction(async (transaction) => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
        } catch (error) {
            throw new UserDeletionGuardReadError(params.userID, `activity_sync_metadata:${status}`, error);
        }

        if (deletionGuard.shouldSkip) {
            logger.warn(`[ActivitySyncMetadata] Skipping ${status} metadata for user ${params.userID}, event ${params.eventID}, route ${params.routeId} because the user is missing or deletion is in progress.`);
            return;
        }

        transaction.set(ref, payload, { merge: true });
    });
}

interface BaseMetadataParams {
    routeId: ActivitySyncRouteId;
    userID: string;
    eventID: string;
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    manual: boolean;
}

export async function setActivitySyncQueuedMetadata(params: BaseMetadataParams): Promise<void> {
    await setActivitySyncMetadata(params, 'queued', {
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'queued' satisfies ActivitySyncStatus,
        attempts: 0,
        queuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function setActivitySyncRequeuedMetadata(params: BaseMetadataParams): Promise<void> {
    await setActivitySyncMetadata(params, 'queued', {
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'queued' satisfies ActivitySyncStatus,
        queuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastError: FieldValue.delete(),
        skippedReason: FieldValue.delete(),
        detail: FieldValue.delete(),
    });
}

export async function setActivitySyncProcessingMetadata(params: BaseMetadataParams): Promise<void> {
    await setActivitySyncMetadata(params, 'processing', {
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'processing' satisfies ActivitySyncStatus,
        attempts: FieldValue.increment(1),
        lastAttemptAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });
}

interface SuccessMetadataParams extends BaseMetadataParams {
    destinationUploadID?: string;
    workoutKey?: string;
    infoCode?: string;
}

export async function setActivitySyncSuccessMetadata(params: SuccessMetadataParams): Promise<void> {
    await setActivitySyncMetadata(params, 'success', {
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'success' satisfies ActivitySyncStatus,
        destinationUploadID: params.destinationUploadID || null,
        workoutKey: params.workoutKey || null,
        infoCode: params.infoCode || null,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastError: FieldValue.delete(),
        skippedReason: FieldValue.delete(),
        detail: FieldValue.delete(),
    });
}

interface SkippedMetadataParams extends BaseMetadataParams {
    skippedReason: string;
    detail?: string;
}

export async function setActivitySyncSkippedMetadata(params: SkippedMetadataParams): Promise<void> {
    await setActivitySyncMetadata(params, 'skipped', {
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'skipped' satisfies ActivitySyncStatus,
        skippedReason: params.skippedReason,
        detail: params.detail || null,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastError: FieldValue.delete(),
    });
}

interface ErrorMetadataParams extends BaseMetadataParams {
    error: ActivitySyncMetadataError;
}

export async function setActivitySyncRetryingMetadata(params: ErrorMetadataParams): Promise<void> {
    await setActivitySyncMetadata(params, 'retrying', {
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'retrying' satisfies ActivitySyncStatus,
        lastError: params.error,
        updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function setActivitySyncFailedMetadata(params: ErrorMetadataParams): Promise<void> {
    await setActivitySyncMetadata(params, 'failed', {
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'failed' satisfies ActivitySyncStatus,
        lastError: params.error,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });
}
