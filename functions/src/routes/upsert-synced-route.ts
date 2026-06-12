import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { AppRouteInterface, FirestoreRouteJSON, OriginalRouteFileMetaData } from '../../../shared/app-route.interface';
import { ROUTE_USAGE_LIMITS } from '../../../shared/limits';
import { RouteSourceMetadata } from '../../../shared/route-provenance';
import { buildFirestoreRoutePayload, OriginalRouteFile } from '../shared/route-writer';
import { hasBasicAccess, hasProAccess } from '../utils';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { createRouteProcessingMetadataPayload } from './route-processing';
import {
    buildRouteDocumentForWrite,
    getRouteSourceMetadataRef,
} from './route-persistence';

interface UpsertSyncedRouteParams {
    userID: string;
    routeID: string;
    routeFile: AppRouteInterface;
    sourceMetadata: RouteSourceMetadata;
    originalFile: OriginalRouteFile;
}

export interface UpsertSyncedRouteResult {
    status: 'created' | 'updated';
    routeID: string;
    routeCountAfterWrite: number;
}

export class SyncedRouteLimitExceededError extends Error {
    constructor(
        public readonly currentRouteCount: number,
        public readonly uploadLimit: number,
    ) {
        super(`Route upload limit reached at ${currentRouteCount}/${uploadLimit}.`);
        this.name = 'SyncedRouteLimitExceededError';
    }
}

export class SyncedRouteSkippedForDeletedUserError extends Error {
    constructor(public readonly userID: string) {
        super(`User ${userID} is missing or deletion is in progress.`);
        this.name = 'SyncedRouteSkippedForDeletedUserError';
    }
}

function normalizeRouteCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : null;
}

function getRouteQuotaCounterPath(userID: string): string {
    return `users/${userID}/metaData/routeQuota`;
}

async function resolveRouteUploadLimitForUser(userID: string): Promise<number | null> {
    if (await hasProAccess(userID)) {
        return null;
    }
    if (await hasBasicAccess(userID)) {
        return ROUTE_USAGE_LIMITS.basic;
    }
    return ROUTE_USAGE_LIMITS.free;
}

async function getRouteCountForUser(userID: string): Promise<number> {
    const countSnapshot = await admin.firestore()
        .collection('users')
        .doc(userID)
        .collection('routes')
        .count()
        .get();
    return countSnapshot.data().count;
}

function buildSyncedRouteOriginalFileMetadata(
    userID: string,
    routeID: string,
    originalFile: OriginalRouteFile,
    bucketName?: string,
): OriginalRouteFileMetaData {
    const fileId = randomUUID();
    const metadata: OriginalRouteFileMetaData = {
        path: `users/${userID}/routes/${routeID}/uploads/provider-sync/original-${fileId}.${originalFile.extension}`,
        startDate: originalFile.startDate,
        extension: originalFile.extension,
    };

    if (bucketName) {
        metadata.bucket = bucketName;
    }
    if (originalFile.originalFilename) {
        metadata.originalFilename = originalFile.originalFilename;
    }

    return metadata;
}

async function uploadSyncedRouteOriginalFile(
    userID: string,
    routeID: string,
    originalFile: OriginalRouteFile,
): Promise<OriginalRouteFileMetaData> {
    const bucket = admin.storage().bucket();
    const metadata = buildSyncedRouteOriginalFileMetadata(userID, routeID, originalFile, bucket.name);
    await bucket.file(metadata.path).save(originalFile.data as Buffer);
    return metadata;
}

async function deleteOriginalRouteFiles(
    originalFiles: OriginalRouteFileMetaData[],
): Promise<void> {
    await Promise.all(originalFiles.map(async (file) => {
        const filePath = `${file?.path || ''}`.trim();
        if (!filePath) {
            return;
        }
        try {
            const bucket = file.bucket
                ? admin.storage().bucket(file.bucket)
                : admin.storage().bucket();
            await bucket.file(filePath).delete({ ignoreNotFound: true });
        } catch (error) {
            logger.warn('[RouteSync] Failed to delete replaced original route file', {
                bucket: file.bucket,
                path: file.path,
                error,
            });
        }
    }));
}

function getExistingOriginalFiles(routeDocument?: FirestoreRouteJSON | null): OriginalRouteFileMetaData[] {
    if (Array.isArray(routeDocument?.originalFiles) && routeDocument.originalFiles.length > 0) {
        return routeDocument.originalFiles.filter(file => typeof file?.path === 'string' && file.path.trim().length > 0);
    }
    return routeDocument?.originalFile?.path ? [routeDocument.originalFile] : [];
}

export async function upsertSyncedRoute(
    params: UpsertSyncedRouteParams,
): Promise<UpsertSyncedRouteResult> {
    const uploadLimit = await resolveRouteUploadLimitForUser(params.userID);
    const uploadedOriginalFile = await uploadSyncedRouteOriginalFile(params.userID, params.routeID, params.originalFile);
    const parsedPayload = buildFirestoreRoutePayload(params.userID, params.routeFile);
    const db = admin.firestore();
    const routeRef = db.doc(`users/${params.userID}/routes/${params.routeID}`);
    const processingRef = db.doc(`users/${params.userID}/routes/${params.routeID}/metaData/processing`);
    const sourceRef = getRouteSourceMetadataRef(db, params.userID, params.routeID);
    const counterRef = db.doc(getRouteQuotaCounterPath(params.userID));
    const initialRouteCount = uploadLimit === null ? null : await getRouteCountForUser(params.userID);
    const routePayloadForWrite = {
        parsedPayload,
        uploadedOriginalFile,
    };

    let existingOriginalFilesToDelete: OriginalRouteFileMetaData[] = [];

    try {
        const result = await db.runTransaction(async (transaction): Promise<UpsertSyncedRouteResult> => {
            let deletionGuard;
            try {
                deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
            } catch (error) {
                throw new UserDeletionGuardReadError(params.userID, 'route_sync_upsert', error);
            }

            if (deletionGuard.shouldSkip) {
                throw new SyncedRouteSkippedForDeletedUserError(params.userID);
            }

            const [routeSnapshot, counterSnapshot] = await Promise.all([
                transaction.get(routeRef),
                transaction.get(counterRef),
            ]);
            const existingRouteDocument = routeSnapshot.exists
                ? routeSnapshot.data() as FirestoreRouteJSON
                : null;

            if (!existingRouteDocument && uploadLimit !== null) {
                const counterRouteCount = normalizeRouteCount(counterSnapshot.data()?.routeCount);
                const currentRouteCount = counterRouteCount ?? initialRouteCount ?? 0;
                if (currentRouteCount >= uploadLimit) {
                    throw new SyncedRouteLimitExceededError(currentRouteCount, uploadLimit);
                }
            }

            existingOriginalFilesToDelete = getExistingOriginalFiles(existingRouteDocument)
                .filter(file => file.path !== uploadedOriginalFile.path);

            const finalPayload = buildRouteDocumentForWrite({
                routeId: params.routeID,
                userID: params.userID,
                parsedPayload: routePayloadForWrite.parsedPayload,
                existingRouteDocument,
                originalFiles: [routePayloadForWrite.uploadedOriginalFile],
                sourceMetadata: params.sourceMetadata,
            });

            transaction.set(routeRef, finalPayload);
            transaction.set(processingRef, createRouteProcessingMetadataPayload(), { merge: true });
            transaction.set(sourceRef, params.sourceMetadata, { merge: true });

            let routeCountAfterWrite = normalizeRouteCount(counterSnapshot.data()?.routeCount)
                ?? initialRouteCount
                ?? 0;

            if (!existingRouteDocument) {
                routeCountAfterWrite += 1;
                const serverTimestamp = FieldValue.serverTimestamp();
                transaction.set(counterRef, {
                    routeCount: routeCountAfterWrite,
                    updatedAt: serverTimestamp,
                    initializedAt: counterSnapshot.exists ? undefined : serverTimestamp,
                }, { merge: true });
            }

            return {
                status: existingRouteDocument ? 'updated' : 'created',
                routeID: params.routeID,
                routeCountAfterWrite,
            };
        });

        if (existingOriginalFilesToDelete.length > 0) {
            await deleteOriginalRouteFiles(existingOriginalFilesToDelete);
        }

        return result;
    } catch (error) {
        await deleteOriginalRouteFiles([uploadedOriginalFile]);
        throw error;
    }
}
