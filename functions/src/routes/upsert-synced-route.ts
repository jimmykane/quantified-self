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
import {
    releaseRejectedRouteOriginalCleanupReservation,
    requestRejectedRouteOriginalCleanup,
    reserveRejectedRouteOriginalCleanupInTransaction,
    type RejectedRouteOriginalCleanupReservation,
} from './rejected-original-cleanup';

interface UpsertSyncedRouteParams {
    userID: string;
    routeID: string;
    routeFile: AppRouteInterface;
    sourceMetadata: RouteSourceMetadata;
    originalFile: OriginalRouteFile;
    assertSourceAuthorizedInTransaction?: (
        db: admin.firestore.Firestore,
        transaction: admin.firestore.Transaction,
    ) => Promise<void>;
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

export class SyncedRouteProAccessRequiredError extends Error {
    constructor(public readonly userID: string) {
        super(`Route sync requires Pro access for user ${userID}.`);
        this.name = 'SyncedRouteProAccessRequiredError';
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

async function resolveRouteUploadLimitForUser(userID: string, hasProRouteSyncAccess: boolean): Promise<number | null> {
    if (hasProRouteSyncAccess) {
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
    metadata: OriginalRouteFileMetaData,
    originalFile: OriginalRouteFile,
): Promise<void> {
    const bucket = metadata.bucket
        ? admin.storage().bucket(metadata.bucket)
        : admin.storage().bucket();
    await bucket.file(metadata.path).save(originalFile.data as Buffer);
}

async function deleteOriginalRouteFiles(
    originalFiles: OriginalRouteFileMetaData[],
    maxAttempts = 1,
): Promise<OriginalRouteFileMetaData[]> {
    const results = await Promise.all(originalFiles.map(async (file) => {
        const filePath = `${file?.path || ''}`.trim();
        if (!filePath) {
            return null;
        }
        const attempts = Math.max(1, Math.min(Math.floor(maxAttempts), 3));
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const bucket = file.bucket
                    ? admin.storage().bucket(file.bucket)
                    : admin.storage().bucket();
                await bucket.file(filePath).delete({ ignoreNotFound: true });
                return null;
            } catch (error) {
                logger.warn('[RouteSync] Failed to delete original route file', {
                    bucket: file.bucket,
                    path: file.path,
                    attempt,
                    attempts,
                    error,
                });
            }
        }
        return file;
    }));
    return results.filter((file): file is OriginalRouteFileMetaData => file !== null);
}

function getExistingOriginalFiles(routeDocument?: FirestoreRouteJSON | null): OriginalRouteFileMetaData[] {
    if (Array.isArray(routeDocument?.originalFiles) && routeDocument.originalFiles.length > 0) {
        return routeDocument.originalFiles.filter(file => typeof file?.path === 'string' && file.path.trim().length > 0);
    }
    return routeDocument?.originalFile?.path ? [routeDocument.originalFile] : [];
}

async function assertSyncedRouteWriteAllowedInTransaction(
    params: UpsertSyncedRouteParams,
    db: admin.firestore.Firestore,
    transaction: admin.firestore.Transaction,
    phase: string,
): Promise<void> {
    let deletionGuard;
    try {
        deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    } catch (error) {
        throw new UserDeletionGuardReadError(params.userID, phase, error);
    }

    if (deletionGuard.shouldSkip) {
        throw new SyncedRouteSkippedForDeletedUserError(params.userID);
    }

    await params.assertSourceAuthorizedInTransaction?.(db, transaction);
}

export async function upsertSyncedRoute(
    params: UpsertSyncedRouteParams,
): Promise<UpsertSyncedRouteResult> {
    const hasProRouteSyncAccess = await hasProAccess(params.userID);
    if (!hasProRouteSyncAccess) {
        logger.warn(`[RouteSync] Skipping synced route upsert for non-pro user ${params.userID}`);
        throw new SyncedRouteProAccessRequiredError(params.userID);
    }

    const uploadLimit = await resolveRouteUploadLimitForUser(params.userID, hasProRouteSyncAccess);
    const storageBucket = admin.storage().bucket();
    const uploadedOriginalFile = buildSyncedRouteOriginalFileMetadata(
        params.userID,
        params.routeID,
        params.originalFile,
        storageBucket.name,
    );
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

    const cleanupReservation = await db.runTransaction(async (transaction): Promise<RejectedRouteOriginalCleanupReservation> => {
        await assertSyncedRouteWriteAllowedInTransaction(
            params,
            db,
            transaction,
            'route_sync_original_reservation',
        );
        return reserveRejectedRouteOriginalCleanupInTransaction({
            db,
            transaction,
            userID: params.userID,
            routeID: params.routeID,
            originalFile: uploadedOriginalFile,
        });
    });

    let existingOriginalFilesToDelete: OriginalRouteFileMetaData[] = [];
    let routeTransactionMayHaveCommitted = false;

    try {
        await uploadSyncedRouteOriginalFile(uploadedOriginalFile, params.originalFile);
        const result = await db.runTransaction(async (transaction): Promise<UpsertSyncedRouteResult> => {
            // Firestore may retry this callback. Reset on every attempt so a
            // callback rejection remains distinguishable from an ambiguous
            // transport failure after a complete write set was returned.
            routeTransactionMayHaveCommitted = false;
            await assertSyncedRouteWriteAllowedInTransaction(
                params,
                db,
                transaction,
                'route_sync_upsert',
            );

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

            const transactionResult: UpsertSyncedRouteResult = {
                status: existingRouteDocument ? 'updated' : 'created',
                routeID: params.routeID,
                routeCountAfterWrite,
            };
            routeTransactionMayHaveCommitted = true;
            return transactionResult;
        });

        try {
            await releaseRejectedRouteOriginalCleanupReservation(cleanupReservation);
        } catch (error) {
            logger.warn('[RouteSync] Failed to release committed route-original cleanup reservation; scheduled reconciliation will retry.', {
                cleanupID: cleanupReservation.cleanupID,
                error,
            });
        }

        if (existingOriginalFilesToDelete.length > 0) {
            await deleteOriginalRouteFiles(existingOriginalFilesToDelete);
        }

        return result;
    } catch (error) {
        if (routeTransactionMayHaveCommitted) {
            logger.warn('[RouteSync] Route transaction outcome is ambiguous; preserving the uploaded original and its reservation for delayed reconciliation.', {
                cleanupID: cleanupReservation.cleanupID,
            });
            throw error;
        }

        const cleanupFailures = await deleteOriginalRouteFiles([uploadedOriginalFile], 3);
        if (cleanupFailures.length === 0) {
            try {
                await releaseRejectedRouteOriginalCleanupReservation(cleanupReservation);
            } catch (releaseError) {
                logger.warn('[RouteSync] Failed to release cleaned route-original reservation; scheduled reconciliation will retry.', {
                    cleanupID: cleanupReservation.cleanupID,
                    error: releaseError,
                });
            }
        } else {
            try {
                await requestRejectedRouteOriginalCleanup(cleanupReservation);
            } catch (requestError) {
                logger.error('[RouteSync] Failed to accelerate rejected route-original cleanup; the pre-upload reservation remains scheduled.', {
                    cleanupID: cleanupReservation.cleanupID,
                    error: requestError,
                });
            }
        }
        throw error;
    }
}
