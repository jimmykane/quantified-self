import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_CHECKPOINT_PATH,
    SPORTS_LIB_REPARSE_JOBS_COLLECTION,
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

const DEFAULT_SCAN_LIMIT = 200;
const DEFAULT_ENQUEUE_LIMIT = 100;

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback;
    }
    return value.trim().toLowerCase() === 'true';
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function getCurrentSettings(): {
    enabled: boolean;
    scanLimit: number;
    enqueueLimit: number;
} {
    return {
        enabled: parseBooleanEnv(process.env.SPORTS_LIB_REPARSE_ENABLED, false),
        scanLimit: parsePositiveIntEnv(process.env.SPORTS_LIB_REPARSE_SCAN_LIMIT, DEFAULT_SCAN_LIMIT),
        enqueueLimit: parsePositiveIntEnv(process.env.SPORTS_LIB_REPARSE_ENQUEUE_LIMIT, DEFAULT_ENQUEUE_LIMIT),
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
    region: 'europe-west2',
    schedule: 'every 1 hours',
}, async (_event) => {
    const settings = getCurrentSettings();
    if (!settings.enabled) {
        logger.info('[sports-lib-reparse] Scheduler disabled (SPORTS_LIB_REPARSE_ENABLED=false).');
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

    const eligibilityCache = new Map<string, Promise<boolean>>();
    let scannedCount = 0;
    let enqueuedCount = 0;
    let lastEventPath: string | null = null;

    for (const eventDoc of eventsSnapshot.docs) {
        scannedCount++;
        lastEventPath = eventDoc.ref.path;

        if (enqueuedCount >= settings.enqueueLimit) {
            continue;
        }

        const parsed = parseUidAndEventIdFromEventPath(eventDoc.ref.path);
        if (!parsed) {
            continue;
        }
        const { uid, eventId } = parsed;

        const needsReparse = await shouldEventBeReparsed(eventDoc.ref, targetSportsLibVersion);
        if (!needsReparse) {
            continue;
        }

        const statusSnapshot = await eventDoc.ref.collection('metaData').doc(SPORTS_LIB_REPARSE_STATUS_DOC_ID).get();
        if (shouldSkipBecauseNoOriginalFilesForTarget(statusSnapshot.data() as Record<string, unknown> | undefined, targetSportsLibVersion)) {
            continue;
        }

        let accessPromise = eligibilityCache.get(uid);
        if (!accessPromise) {
            accessPromise = hasPaidOrGraceAccess(uid);
            eligibilityCache.set(uid, accessPromise);
        }
        const hasAccess = await accessPromise;
        if (!hasAccess) {
            continue;
        }

        const sourceFiles = extractSourceFiles(eventDoc.data() as Record<string, unknown>);
        if (sourceFiles.length === 0) {
            await writeReparseStatus(uid, eventId, {
                status: 'skipped',
                reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
                targetSportsLibVersion,
                checkedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            continue;
        }

        const jobId = buildSportsLibReparseJobId(uid, eventId, targetSportsLibVersion);
        const jobRef = db.collection(SPORTS_LIB_REPARSE_JOBS_COLLECTION).doc(jobId);
        const existingJob = await jobRef.get();
        const existingStatus = toSafeString(existingJob.data()?.status);

        if (existingJob.exists && (existingStatus === 'pending' || existingStatus === 'processing' || existingStatus === 'completed')) {
            continue;
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
