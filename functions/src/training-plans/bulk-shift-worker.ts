import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID } from '../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import {
    BULK_SHIFT_LEASE_MS,
    BULK_SHIFT_LOCK_ID,
    StagedShiftApprovalLostError,
    abortUnapprovedMcpShift,
    readBulkShiftLock,
    stageLargeTrainingPlanShiftForUser,
} from './staged-shift';
import {
    BULK_RESTORE_LEASE_MS,
    BULK_RESTORE_LOCK_ID,
    readBulkRestoreLock,
    stageLargeTrainingPlanRestoreForUser,
} from './staged-restore';

const MAX_RETRY_MS = 60 * 60 * 1000;
const SCAN_PAGE_SIZE = 25;
const MAX_SCAN = 100;

function ownerFromLockPath(path: string): string | null {
    const segments = path.split('/');
    return segments.length === 6 && segments[0] === 'users' && segments[2] === 'trainingPlanState'
        && segments[3] === 'current' && segments[4] === TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID
        && (segments[5] === BULK_SHIFT_LOCK_ID || segments[5] === BULK_RESTORE_LOCK_ID)
        ? segments[1] : null;
}

/** A timed-out callable leaves the old schedule visible; a later invocation finishes its staged revision. */
export async function processTrainingBulkShift(
    db: admin.firestore.Firestore,
    ref: admin.firestore.DocumentReference,
    nowMs: number,
): Promise<boolean> {
    const uid = ownerFromLockPath(ref.path);
    if (!uid) return false;
    const claimed = await db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) return null;
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return null;
        const lock = ref.id === BULK_RESTORE_LOCK_ID
            ? readBulkRestoreLock(snapshot.data()) : readBulkShiftLock(snapshot.data());
        if (lock.nextAttemptAtMs > nowMs) return null;
        const attempt = lock.attempts + 1;
        transaction.update(ref, { attempts: attempt, nextAttemptAtMs: nowMs
            + (ref.id === BULK_RESTORE_LOCK_ID ? BULK_RESTORE_LEASE_MS : BULK_SHIFT_LEASE_MS) });
        return { lock, attempt };
    });
    if (!claimed) return false;
    try {
        if (claimed.lock.kind === 'restore-plan') {
            await stageLargeTrainingPlanRestoreForUser(uid, claimed.lock.request, { db, nowMs });
        } else {
            await stageLargeTrainingPlanShiftForUser(uid, claimed.lock.request, { db, nowMs });
        }
        return true;
    } catch (error) {
        if (error instanceof StagedShiftApprovalLostError
            && await abortUnapprovedMcpShift(db, uid, ref, nowMs)) {
            logger.warn('[TrainingBulkShift]', { event: 'revoked_mcp_shift_cancelled' });
            return false;
        }
        const retryMs = Math.min(MAX_RETRY_MS, 60_000 * 2 ** Math.min(claimed.attempt, 6));
        await db.runTransaction(async transaction => {
            if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) return;
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) return;
            const current = ref.id === BULK_RESTORE_LOCK_ID
                ? readBulkRestoreLock(snapshot.data()) : readBulkShiftLock(snapshot.data());
            const currentId = current.kind === 'restore-plan' ? current.request.mutationId : current.mutationId;
            const claimedId = claimed.lock.kind === 'restore-plan'
                ? claimed.lock.request.mutationId : claimed.lock.mutationId;
            if (currentId === claimedId && current.attempts === claimed.attempt) {
                transaction.update(ref, { nextAttemptAtMs: nowMs + retryMs });
            }
        });
        throw error;
    }
}

/** Bound each scheduled run to one large shift; ordinary cleanup retains its own scan budget. */
export async function reconcileTrainingBulkShifts(
    db: admin.firestore.Firestore,
    nowMs = Date.now(),
): Promise<{ scanned: number; completed: number; failed: number }> {
    const due = db.collectionGroup(TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID)
        .where('nextAttemptAtMs', '<=', nowMs).orderBy('nextAttemptAtMs');
    let cursor: admin.firestore.QueryDocumentSnapshot | null = null;
    let scanned = 0;
    let failed = 0;
    while (scanned < MAX_SCAN) {
        const page = await (cursor ? due.startAfter(cursor) : due)
            .limit(Math.min(SCAN_PAGE_SIZE, MAX_SCAN - scanned)).get();
        if (page.empty) break;
        for (const snapshot of page.docs) {
            scanned += 1;
            try {
                if (await processTrainingBulkShift(db, snapshot.ref, nowMs)) {
                    return { scanned, completed: 1, failed };
                }
            } catch (error) {
                failed += 1;
                const uid = ownerFromLockPath(snapshot.ref.path);
                if (uid) {
                    try {
                        await db.runTransaction(async transaction => {
                            if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) return;
                            const current = await transaction.get(snapshot.ref);
                            if (current.exists && typeof current.data()?.nextAttemptAtMs === 'number'
                                && current.data()!.nextAttemptAtMs <= nowMs) {
                                transaction.update(snapshot.ref, { nextAttemptAtMs: nowMs + MAX_RETRY_MS });
                            }
                        });
                    } catch {
                        // Preserve the record for operator investigation if even deferral fails.
                    }
                }
                logger.warn('[TrainingBulkShift]', {
                    event: 'resume_failed', errorName: error instanceof Error ? error.name : 'UnknownError',
                });
            }
        }
        cursor = page.docs[page.docs.length - 1];
        if (page.size < SCAN_PAGE_SIZE) break;
    }
    return { scanned, completed: 0, failed };
}

export const reconcileTrainingBulkShift = onSchedule({
    schedule: 'every 5 minutes',
    timeZone: 'UTC',
    region: FUNCTIONS_MANIFEST.reconcileTrainingBulkShift.region,
    memory: '512MiB',
    timeoutSeconds: 300,
}, async () => {
    try {
        const result = await reconcileTrainingBulkShifts(admin.firestore());
        if (result.scanned > 0) logger.info('[TrainingBulkShift]', result);
    } catch (error) {
        logger.warn('[TrainingBulkShift]', {
            event: 'scan_failed', errorName: error instanceof Error ? error.name : 'UnknownError',
        });
    }
});
