import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { ACTIVITY_SYNC_METADATA_DOC_PREFIX } from './constants';

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

function getActivitySyncMetadataRef(userID: string, eventID: string, routeId: ActivitySyncRouteId) {
    return admin.firestore()
        .collection('users')
        .doc(userID)
        .collection('events')
        .doc(eventID)
        .collection('metaData')
        .doc(getActivitySyncMetadataDocId(routeId));
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
    const ref = getActivitySyncMetadataRef(params.userID, params.eventID, params.routeId);
    await ref.set({
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'queued' satisfies ActivitySyncStatus,
        attempts: 0,
        queuedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

export async function setActivitySyncRequeuedMetadata(params: BaseMetadataParams): Promise<void> {
    const ref = getActivitySyncMetadataRef(params.userID, params.eventID, params.routeId);
    await ref.set({
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'queued' satisfies ActivitySyncStatus,
        queuedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: admin.firestore.FieldValue.delete(),
        skippedReason: admin.firestore.FieldValue.delete(),
        detail: admin.firestore.FieldValue.delete(),
    }, { merge: true });
}

export async function setActivitySyncProcessingMetadata(params: BaseMetadataParams): Promise<void> {
    const ref = getActivitySyncMetadataRef(params.userID, params.eventID, params.routeId);
    await ref.set({
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'processing' satisfies ActivitySyncStatus,
        attempts: admin.firestore.FieldValue.increment(1),
        lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

interface SuccessMetadataParams extends BaseMetadataParams {
    destinationUploadID?: string;
    workoutKey?: string;
    infoCode?: string;
}

export async function setActivitySyncSuccessMetadata(params: SuccessMetadataParams): Promise<void> {
    const ref = getActivitySyncMetadataRef(params.userID, params.eventID, params.routeId);
    await ref.set({
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'success' satisfies ActivitySyncStatus,
        destinationUploadID: params.destinationUploadID || null,
        workoutKey: params.workoutKey || null,
        infoCode: params.infoCode || null,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: admin.firestore.FieldValue.delete(),
        skippedReason: admin.firestore.FieldValue.delete(),
        detail: admin.firestore.FieldValue.delete(),
    }, { merge: true });
}

interface SkippedMetadataParams extends BaseMetadataParams {
    skippedReason: string;
    detail?: string;
}

export async function setActivitySyncSkippedMetadata(params: SkippedMetadataParams): Promise<void> {
    const ref = getActivitySyncMetadataRef(params.userID, params.eventID, params.routeId);
    await ref.set({
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'skipped' satisfies ActivitySyncStatus,
        skippedReason: params.skippedReason,
        detail: params.detail || null,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: admin.firestore.FieldValue.delete(),
    }, { merge: true });
}

interface ErrorMetadataParams extends BaseMetadataParams {
    error: ActivitySyncMetadataError;
}

export async function setActivitySyncRetryingMetadata(params: ErrorMetadataParams): Promise<void> {
    const ref = getActivitySyncMetadataRef(params.userID, params.eventID, params.routeId);
    await ref.set({
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'retrying' satisfies ActivitySyncStatus,
        lastError: params.error,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

export async function setActivitySyncFailedMetadata(params: ErrorMetadataParams): Promise<void> {
    const ref = getActivitySyncMetadataRef(params.userID, params.eventID, params.routeId);
    await ref.set({
        routeId: params.routeId,
        sourceServiceName: params.sourceServiceName,
        destinationServiceName: params.destinationServiceName,
        manual: params.manual === true,
        status: 'failed' satisfies ActivitySyncStatus,
        lastError: params.error,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}
