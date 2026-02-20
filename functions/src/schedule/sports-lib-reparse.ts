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
    hasPaidOrGraceAccess,
    parseUidAndEventIdFromEventPath,
    resolveTargetSportsLibVersion,
    shouldEventBeReparsed,
    writeReparseStatus,
} from '../reparse/sports-lib-reparse.service';
import { enqueueSportsLibReparseTask } from '../shared/cloud-tasks';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

function getCurrentSettings(): {
    enabled: boolean;
    scanLimit: number;
    enqueueLimit: number;
    uidAllowlist: Set<string> | null;
    includeFreeUsers: boolean;
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
        includeFreeUsers: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.includeFreeUsers,
    };
}

function toSafeString(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    return `${value}`;
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

export const scheduleSportsLibReparseScan = onSchedule({
    region: FUNCTIONS_MANIFEST.scheduleSportsLibReparseScan.region,
    schedule: 'every 1 hours',
}, async (_event) => {
    const settings = getCurrentSettings();
    if (!settings.enabled) {
        logger.info('[sports-lib-reparse] Scheduler disabled (SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enabled=false).');
        return;
    }

    const db = admin.firestore();
    const targetSportsLibVersion = resolveTargetSportsLibVersion();
    const checkpointRef = db.doc(SPORTS_LIB_REPARSE_CHECKPOINT_PATH);
    const checkpointSnapshot = await checkpointRef.get();
    const checkpointData = checkpointSnapshot.data() as SportsLibReparseCheckpoint | undefined;
    const cursorEventPath = checkpointData?.cursorEventPath || null;

    await checkpointRef.set({
        lastPassStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        targetSportsLibVersion,
    }, { merge: true });

    const eligibilityCache = new Map<string, Promise<boolean>>();
    let scannedCount = 0;
    let enqueuedCount = 0;
    let lastEventPath: string | null = null;

    const processEventDoc = async (eventDoc: admin.firestore.QueryDocumentSnapshot): Promise<void> => {
        const parsed = parseUidAndEventIdFromEventPath(eventDoc.ref.path);
        if (!parsed) {
            return;
        }
        const { uid, eventId } = parsed;

        if (enqueuedCount >= settings.enqueueLimit) {
            return;
        }

        const needsReparse = await shouldEventBeReparsed(eventDoc.ref, targetSportsLibVersion);
        if (!needsReparse) {
            return;
        }

        const statusSnapshot = await eventDoc.ref.collection('metaData').doc(SPORTS_LIB_REPARSE_STATUS_DOC_ID).get();
        if (shouldSkipBecauseNoOriginalFilesForTarget(statusSnapshot.data() as Record<string, unknown> | undefined, targetSportsLibVersion)) {
            return;
        }

        if (!settings.includeFreeUsers) {
            let accessPromise = eligibilityCache.get(uid);
            if (!accessPromise) {
                accessPromise = hasPaidOrGraceAccess(uid);
                eligibilityCache.set(uid, accessPromise);
            }
            const hasAccess = await accessPromise;
            if (!hasAccess) {
                return;
            }
        }

        const sourceFiles = extractSourceFiles(eventDoc.data() as Record<string, unknown>);
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
            eventPath: eventDoc.ref.path,
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

        await enqueueSportsLibReparseTask(jobId);
        enqueuedCount++;
    };

    if (settings.uidAllowlist && settings.uidAllowlist.size > 0) {
        const overrideUIDs = Array.from(settings.uidAllowlist);
        const previousCursorByUID = checkpointData?.overrideCursorByUid || {};
        const nextCursorByUID: Record<string, string | null> = {};

        for (const uid of overrideUIDs) {
            const remainingScan = settings.scanLimit - scannedCount;
            const previousCursor = previousCursorByUID[uid] || null;

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
                scannedCount++;
                lastEventPath = eventDoc.ref.path;
                lastProcessedDocId = eventDoc.id;
                await processEventDoc(eventDoc);
            }

            if (userSnapshot.size < remainingScan) {
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

    let query = db.collectionGroup('events')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(settings.scanLimit);

    if (cursorEventPath) {
        query = query.startAfter(db.doc(cursorEventPath));
    }

    const eventsSnapshot = await query.get();
    if (eventsSnapshot.empty) {
        await checkpointRef.set({
            cursorEventPath: null,
            lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
            lastPassCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastScanCount: 0,
            lastEnqueuedCount: 0,
            targetSportsLibVersion,
        }, { merge: true });
        logger.info('[sports-lib-reparse] No events found for scan.');
        return;
    }

    for (const eventDoc of eventsSnapshot.docs) {
        scannedCount++;
        lastEventPath = eventDoc.ref.path;
        await processEventDoc(eventDoc);
    }

    const passCompleted = eventsSnapshot.size < settings.scanLimit;
    await checkpointRef.set({
        cursorEventPath: passCompleted ? null : lastEventPath,
        lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
        lastScanCount: scannedCount,
        lastEnqueuedCount: enqueuedCount,
        targetSportsLibVersion,
        ...(passCompleted ? { lastPassCompletedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    }, { merge: true });

    logger.info('[sports-lib-reparse] Scan complete', {
        scannedCount,
        enqueuedCount,
        nextCursor: passCompleted ? null : lastEventPath,
    });
});
