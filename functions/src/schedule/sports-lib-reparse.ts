import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_CHECKPOINT_PATH,
    SPORTS_LIB_REPARSE_JOBS_COLLECTION,
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    SPORTS_LIB_REPARSE_STATUS_DOC_ID,
    SportsLibReparseCheckpoint,
    SportsLibReparseJob,
    buildSportsLibReparseJobId,
    extractSourceFiles,
    parseUidAndEventIdFromEventPath,
    resolveTargetSportsLibVersion,
    resolveTargetSportsLibVersionCode,
    sportsLibVersionToCode,
    shouldEventBeReparsed,
    writeReparseStatus,
} from '../reparse/sports-lib-reparse.service';
import { enqueueSportsLibReparseTask } from '../shared/cloud-tasks';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

const SPORTS_LIB_REPARSE_SCAN_CONCURRENCY = 25;
const SPORTS_LIB_REPARSE_ENQUEUE_SPREAD_SECONDS = 10 * 60;

function getCurrentSettings(): {
    enabled: boolean;
    scanLimit: number;
    enqueueLimit: number;
    uidAllowlist: Set<string> | null;
} {
    const constantUIDAllowlist = SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist
        && SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist.length > 0
        ? new Set(SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist)
        : null;
    return {
        enabled: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enabled,
        scanLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit,
        enqueueLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enqueueLimit,
        uidAllowlist: constantUIDAllowlist,
    };
}

function toSafeString(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    return `${value}`;
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return `${error}`;
}

function shouldSkipBecauseNoOriginalFilesForTarget(
    statusDocData: Record<string, unknown> | undefined,
    targetSportsLibVersion: string,
): boolean {
    if (!statusDocData) {
        return false;
    }
    return statusDocData.status === 'skipped'
        && statusDocData.reason === SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES
        && statusDocData.targetSportsLibVersion === targetSportsLibVersion;
}

function getProcessingVersionCode(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}

function isProcessingMetadataDocPath(path: string): boolean {
    return path.endsWith('/metaData/processing');
}

function calculateEnqueueDelaySeconds(
    enqueueSequence: number,
    enqueueLimit: number,
): number {
    if (enqueueSequence <= 0 || enqueueLimit <= 1) {
        return 1;
    }
    const denominator = Math.max(enqueueLimit - 1, 1);
    const scaled = Math.floor((enqueueSequence * SPORTS_LIB_REPARSE_ENQUEUE_SPREAD_SECONDS) / denominator);
    return Math.max(1, Math.min(SPORTS_LIB_REPARSE_ENQUEUE_SPREAD_SECONDS, scaled));
}

export const scheduleSportsLibReparseScan = onSchedule({
    region: FUNCTIONS_MANIFEST.scheduleSportsLibReparseScan.region,
    schedule: 'every 10 minutes',
    timeoutSeconds: 300,
}, async (_event) => {
    const settings = getCurrentSettings();
    if (!settings.enabled) {
        logger.info('[sports-lib-reparse] Scheduler disabled (SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enabled=false).');
        return;
    }

    const db = admin.firestore();
    const targetSportsLibVersion = resolveTargetSportsLibVersion();
    const targetSportsLibVersionCode = resolveTargetSportsLibVersionCode();
    const checkpointRef = db.doc(SPORTS_LIB_REPARSE_CHECKPOINT_PATH);
    const checkpointSnapshot = await checkpointRef.get();
    const checkpointData = checkpointSnapshot.data() as SportsLibReparseCheckpoint | undefined;
    const cursorProcessingDocPath = checkpointData?.cursorProcessingDocPath || null;
    const cursorProcessingVersionCode = getProcessingVersionCode(checkpointData?.cursorProcessingVersionCode);

    await checkpointRef.set({
        lastPassStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
        lastScanCount: 0,
        lastEnqueuedCount: 0,
        targetSportsLibVersion,
    }, { merge: true });

    let scannedCount = 0;
    let enqueuedCount = 0;
    let enqueueAttemptSequence = 0;
    let enqueueReservationCount = 0;
    let lastProcessingDocPath: string | null = null;
    let lastProcessingVersionCode: number | null = null;
    const hasReachedEnqueueLimit = (): boolean => enqueuedCount >= settings.enqueueLimit;
    const hasAvailableEnqueueSlot = (): boolean => (enqueuedCount + enqueueReservationCount) < settings.enqueueLimit;
    const tryReserveEnqueueSlot = (): boolean => {
        if (!hasAvailableEnqueueSlot()) {
            return false;
        }
        enqueueReservationCount++;
        return true;
    };
    const releaseEnqueueSlot = (): void => {
        if (enqueueReservationCount > 0) {
            enqueueReservationCount--;
        }
    };

    const processEventData = async (
        eventRef: admin.firestore.DocumentReference,
        eventData: Record<string, unknown>,
        options?: { skipCandidateCheck?: boolean; reservedEnqueueSlot?: boolean },
    ): Promise<void> => {
        const parsed = parseUidAndEventIdFromEventPath(eventRef.path);
        if (!parsed) {
            if (options?.reservedEnqueueSlot === true) {
                releaseEnqueueSlot();
            }
            return;
        }
        const { uid, eventId } = parsed;

        let slotReserved = options?.reservedEnqueueSlot === true;
        if (!slotReserved) {
            slotReserved = tryReserveEnqueueSlot();
        }
        if (!slotReserved) {
            return;
        }

        try {
            if (!options?.skipCandidateCheck) {
                try {
                    const needsReparse = await shouldEventBeReparsed(eventRef, targetSportsLibVersion);
                    if (!needsReparse) {
                        return;
                    }
                } catch (error) {
                    logger.warn('[sports-lib-reparse] Invalid processing metadata; skipping event candidate.', {
                        eventPath: eventRef.path,
                        error: toErrorMessage(error),
                    });
                    return;
                }
            }

            const statusSnapshot = await eventRef.collection('metaData').doc(SPORTS_LIB_REPARSE_STATUS_DOC_ID).get();
            if (shouldSkipBecauseNoOriginalFilesForTarget(statusSnapshot.data() as Record<string, unknown> | undefined, targetSportsLibVersion)) {
                return;
            }

            const sourceFiles = extractSourceFiles(eventData);
            if (sourceFiles.length === 0) {
                await writeReparseStatus(uid, eventId, {
                    status: 'skipped',
                    reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
                    targetSportsLibVersion,
                    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                return;
            }

            const jobId = buildSportsLibReparseJobId(uid, eventId, targetSportsLibVersion);
            const jobRef = db.collection(SPORTS_LIB_REPARSE_JOBS_COLLECTION).doc(jobId);
            const existingJob = await jobRef.get();
            const existingStatus = toSafeString(existingJob.data()?.status);

            if (existingJob.exists && (existingStatus === 'pending' || existingStatus === 'processing' || existingStatus === 'completed')) {
                return;
            }

            const basePayload: SportsLibReparseJob = {
                uid,
                eventId,
                eventPath: eventRef.path,
                targetSportsLibVersion,
                status: 'pending',
                attemptCount: existingJob.data()?.attemptCount || 0,
                createdAt: existingJob.exists ? existingJob.data()?.createdAt : admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                enqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
                expireAt: getExpireAtTimestamp(TTL_CONFIG.SPORTS_LIB_REPARSE_JOBS_IN_DAYS),
            };

            await jobRef.set({
                ...basePayload,
                lastError: admin.firestore.FieldValue.delete(),
                processedAt: admin.firestore.FieldValue.delete(),
            }, { merge: true });

            try {
                const enqueueDelaySeconds = calculateEnqueueDelaySeconds(
                    enqueueAttemptSequence,
                    settings.enqueueLimit,
                );
                enqueueAttemptSequence++;
                const taskCreated = enqueueDelaySeconds > 1
                    ? await enqueueSportsLibReparseTask(jobId, enqueueDelaySeconds)
                    : await enqueueSportsLibReparseTask(jobId);
                if (taskCreated) {
                    enqueuedCount++;
                }
            } catch (error) {
                const errorMessage = toErrorMessage(error);
                await jobRef.set({
                    status: 'failed',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastError: errorMessage,
                    enqueuedAt: admin.firestore.FieldValue.delete(),
                }, { merge: true });
                throw error;
            }
        } finally {
            releaseEnqueueSlot();
        }
    };

    if (settings.uidAllowlist && settings.uidAllowlist.size > 0) {
        const overrideUIDs = Array.from(settings.uidAllowlist);
        const previousCursorByUID = checkpointData?.overrideCursorByUid || {};
        const nextCursorByUID: Record<string, string | null> = {};

        for (const uid of overrideUIDs) {
            const remainingScan = settings.scanLimit - scannedCount;
            const previousCursor = previousCursorByUID[uid] || null;

            if (hasReachedEnqueueLimit()) {
                nextCursorByUID[uid] = previousCursor;
                continue;
            }

            if (remainingScan <= 0) {
                nextCursorByUID[uid] = previousCursor;
                continue;
            }

            let userQuery = db.collection(`users/${uid}/events`)
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(remainingScan);

            if (previousCursor) {
                userQuery = userQuery.startAfter(previousCursor);
            }

            const userSnapshot = await userQuery.get();
            if (userSnapshot.empty) {
                nextCursorByUID[uid] = null;
                continue;
            }

            let lastProcessedDocId: string | null = null;
            for (const eventDoc of userSnapshot.docs) {
                if (hasReachedEnqueueLimit()) {
                    break;
                }
                scannedCount++;
                lastProcessedDocId = eventDoc.id;
                await processEventData(eventDoc.ref, eventDoc.data() as Record<string, unknown>);
            }

            if (hasReachedEnqueueLimit()) {
                nextCursorByUID[uid] = lastProcessedDocId || previousCursor;
            } else if (userSnapshot.size < remainingScan) {
                nextCursorByUID[uid] = null;
            } else {
                nextCursorByUID[uid] = lastProcessedDocId;
            }
        }

        const completedAllUIDPasses = Object.values(nextCursorByUID).every(cursor => !cursor);
        await checkpointRef.set({
            overrideCursorByUid: nextCursorByUID,
            lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
            lastScanCount: scannedCount,
            lastEnqueuedCount: enqueuedCount,
            targetSportsLibVersion,
            ...(completedAllUIDPasses ? { lastPassCompletedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
        }, { merge: true });

        logger.info('[sports-lib-reparse] Override scan complete', {
            scannedCount,
            enqueuedCount,
            overrideUIDsCount: overrideUIDs.length,
            nextCursorByUID,
        });
        return;
    }

    let query = db.collectionGroup('metaData')
        .where('sportsLibVersionCode', '<', targetSportsLibVersionCode)
        .orderBy('sportsLibVersionCode', 'asc')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(settings.scanLimit);

    if (cursorProcessingDocPath && cursorProcessingVersionCode !== null) {
        query = query.startAfter(cursorProcessingVersionCode, db.doc(cursorProcessingDocPath));
    }

    const processingSnapshot = await query.get();
    if (processingSnapshot.empty) {
        await checkpointRef.set({
            cursorProcessingDocPath: null,
            cursorProcessingVersionCode: null,
            lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
            lastPassCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastScanCount: 0,
            lastEnqueuedCount: 0,
            targetSportsLibVersion,
        }, { merge: true });
        logger.info('[sports-lib-reparse] No processing metadata candidates found for scan.');
        return;
    }

    let stoppedByEnqueueLimit = false;
    const inFlightProcessing = new Set<Promise<void>>();
    for (const processingDoc of processingSnapshot.docs) {
        while (inFlightProcessing.size >= SPORTS_LIB_REPARSE_SCAN_CONCURRENCY || !hasAvailableEnqueueSlot()) {
            if (inFlightProcessing.size === 0) {
                stoppedByEnqueueLimit = hasReachedEnqueueLimit();
                break;
            }
            await Promise.race(inFlightProcessing);
        }
        if (stoppedByEnqueueLimit) {
            break;
        }
        scannedCount++;
        const processingData = processingDoc.data() as Record<string, unknown>;
        const processingVersion = `${processingData.sportsLibVersion ?? ''}`;
        const processingVersionCode = getProcessingVersionCode(processingData.sportsLibVersionCode);

        // Persist cursor progression based on the sortable query tuple to avoid rescanning
        // full malformed pages (e.g. missing/invalid sportsLibVersion payload).
        if (processingVersionCode !== null) {
            lastProcessingDocPath = processingDoc.ref.path;
            lastProcessingVersionCode = processingVersionCode;
        }

        if (!isProcessingMetadataDocPath(processingDoc.ref.path)) {
            logger.warn('[sports-lib-reparse] Skipping non-processing metadata doc from candidate query.', {
                processingDocPath: processingDoc.ref.path,
            });
            continue;
        }

        if (!processingVersion || processingVersionCode === null) {
            logger.warn('[sports-lib-reparse] Invalid processing metadata; skipping doc.', {
                processingDocPath: processingDoc.ref.path,
                sportsLibVersion: processingData.sportsLibVersion,
                sportsLibVersionCode: processingData.sportsLibVersionCode,
            });
            continue;
        }

        let computedVersionCode: number;
        try {
            computedVersionCode = sportsLibVersionToCode(processingVersion);
        } catch (error) {
            logger.warn('[sports-lib-reparse] Invalid processing metadata; skipping doc.', {
                processingDocPath: processingDoc.ref.path,
                sportsLibVersion: processingVersion,
                sportsLibVersionCode: processingVersionCode,
                error: toErrorMessage(error),
            });
            continue;
        }
        if (computedVersionCode !== processingVersionCode) {
            logger.warn('[sports-lib-reparse] Mismatched processing metadata version/code; skipping doc.', {
                processingDocPath: processingDoc.ref.path,
                sportsLibVersion: processingVersion,
                sportsLibVersionCode: processingVersionCode,
                computedVersionCode,
            });
            continue;
        }

        const eventRef = processingDoc.ref.parent.parent;
        if (!eventRef) {
            logger.warn('[sports-lib-reparse] Could not resolve parent event from processing metadata path.', {
                processingDocPath: processingDoc.ref.path,
            });
            continue;
        }

        if (processingVersionCode >= targetSportsLibVersionCode) {
            continue;
        }

        if (!tryReserveEnqueueSlot()) {
            stoppedByEnqueueLimit = hasReachedEnqueueLimit();
            if (stoppedByEnqueueLimit) {
                break;
            }
            continue;
        }

        const processPromise = (async (): Promise<void> => {
            let reservationTransferred = false;
            try {
                const eventSnapshot = await eventRef.get();
                if (!eventSnapshot.exists) {
                    logger.warn('[sports-lib-reparse] Skipping stale processing metadata because parent event is missing.', {
                        processingDocPath: processingDoc.ref.path,
                        eventPath: eventRef.path,
                    });
                    return;
                }
                reservationTransferred = true;
                await processEventData(eventRef, eventSnapshot.data() as Record<string, unknown>, {
                    skipCandidateCheck: true,
                    reservedEnqueueSlot: true,
                });
            } finally {
                if (!reservationTransferred) {
                    releaseEnqueueSlot();
                }
            }
        })();
        inFlightProcessing.add(processPromise);
        processPromise.then(() => {
            inFlightProcessing.delete(processPromise);
        }, () => {
            inFlightProcessing.delete(processPromise);
        });
    }

    if (inFlightProcessing.size > 0) {
        await Promise.all(inFlightProcessing);
    }

    const passCompleted = !stoppedByEnqueueLimit && processingSnapshot.size < settings.scanLimit;
    const canPersistCursor = !passCompleted && lastProcessingDocPath && lastProcessingVersionCode !== null;
    await checkpointRef.set({
        cursorProcessingDocPath: canPersistCursor ? lastProcessingDocPath : null,
        cursorProcessingVersionCode: canPersistCursor ? lastProcessingVersionCode : null,
        ...(passCompleted ? { cursorEventPath: null } : {}),
        lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
        lastScanCount: scannedCount,
        lastEnqueuedCount: enqueuedCount,
        targetSportsLibVersion,
        ...(passCompleted ? { lastPassCompletedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    }, { merge: true });

    logger.info('[sports-lib-reparse] Scan complete', {
        scannedCount,
        enqueuedCount,
        nextCursorProcessingDocPath: passCompleted ? null : lastProcessingDocPath,
        nextCursorProcessingVersionCode: passCompleted ? null : lastProcessingVersionCode,
    });
});
