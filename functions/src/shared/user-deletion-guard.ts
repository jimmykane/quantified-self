import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

const FIRESTORE_ERROR_CODES = [
    'ok', 'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found',
    'already-exists', 'permission-denied', 'resource-exhausted', 'failed-precondition',
    'aborted', 'out-of-range', 'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated',
];

function firestoreReadErrorCode(error: unknown): string {
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
    if (typeof code === 'number' && Number.isInteger(code)) return FIRESTORE_ERROR_CODES[code] ?? 'unknown';
    if (typeof code !== 'string' || code.length > 64) return 'unknown';
    const normalized = code.toLowerCase().replace(/^firestore\//, '').replace(/_/g, '-');
    if (/^\d{1,2}$/.test(normalized)) return FIRESTORE_ERROR_CODES[Number(normalized)] ?? 'unknown';
    return FIRESTORE_ERROR_CODES.includes(normalized) ? normalized : 'unknown';
}

export const USER_DELETION_TOMBSTONES_COLLECTION = 'userDeletionTombstones';

export interface UserDeletionGuardState {
    userExists: boolean;
    deletionInProgress: boolean;
    shouldSkip: boolean;
}

export class UserDeletionGuardReadError extends Error {
    public readonly name = 'UserDeletionGuardReadError';
    public readonly code = 'unavailable';
    public readonly statusCode = 503;

    constructor(
        public readonly uid: string,
        public readonly phase: string,
        public readonly originalError: unknown,
    ) {
        super(`Could not read deletion guard for user ${uid} during ${phase}.`);
        // The wrapper preserves the original error for callers, but logs only a
        // fixed native status: never UID, phase, message, stack, details or metadata.
        try {
            logger.warn('[UserDeletionGuard] Firestore guard read failed', {
                firestoreCode: firestoreReadErrorCode(originalError),
            });
        } catch { /* Diagnostics must not replace the retryable guard error. */ }
    }
}

function getTimestampMillis(value: unknown): number | null {
    if (!value) {
        return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        const time = (value as { toMillis: () => number }).toMillis();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
        const date = (value as { toDate: () => Date }).toDate();
        const time = date.getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
        const seconds = Number((value as Record<string, unknown>).seconds);
        const nanoseconds = Number((value as Record<string, unknown>).nanoseconds || 0);
        if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) {
            return null;
        }
        return Math.floor((seconds * 1000) + (nanoseconds / 1_000_000));
    }

    return null;
}

export function isUserDeletionTombstoneActive(
    data: Record<string, unknown> | null | undefined,
    nowMs = Date.now(),
): boolean {
    if (!data) {
        return false;
    }

    const expireAtMs = getTimestampMillis(data.expireAt);
    return expireAtMs === null || expireAtMs > nowMs;
}

export function getUserDeletionRefs(
    db: admin.firestore.Firestore,
    uid: string,
): {
    userRef: admin.firestore.DocumentReference;
    tombstoneRef: admin.firestore.DocumentReference;
} {
    return {
        userRef: db.collection('users').doc(uid),
        tombstoneRef: db.collection(USER_DELETION_TOMBSTONES_COLLECTION).doc(uid),
    };
}

export async function getUserDeletionGuardState(
    db: admin.firestore.Firestore,
    uid: string,
    nowMs = Date.now(),
): Promise<UserDeletionGuardState> {
    const { userRef, tombstoneRef } = getUserDeletionRefs(db, uid);
    const [userSnapshot, tombstoneSnapshot] = await db.getAll(userRef, tombstoneRef);
    return deletionGuardStateFromSnapshots(userSnapshot, tombstoneSnapshot, nowMs);
}

export async function getUserDeletionGuardStateInTransaction(
    db: admin.firestore.Firestore,
    transaction: admin.firestore.Transaction,
    uid: string,
    nowMs = Date.now(),
): Promise<UserDeletionGuardState> {
    const { userRef, tombstoneRef } = getUserDeletionRefs(db, uid);
    const [userSnapshot, tombstoneSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(tombstoneRef),
    ]);
    return deletionGuardStateFromSnapshots(userSnapshot, tombstoneSnapshot, nowMs);
}

function deletionGuardStateFromSnapshots(
    userSnapshot: admin.firestore.DocumentSnapshot,
    tombstoneSnapshot: admin.firestore.DocumentSnapshot,
    nowMs: number,
): UserDeletionGuardState {
    const deletionInProgress = isUserDeletionTombstoneActive(
        tombstoneSnapshot.exists ? tombstoneSnapshot.data() as Record<string, unknown> | undefined : null,
        nowMs,
    );
    const userExists = userSnapshot.exists;
    return {
        userExists,
        deletionInProgress,
        shouldSkip: !userExists || deletionInProgress,
    };
}

/** Batch known source reads with the guard, inside every transaction attempt. */
export async function getUserDeletionGuardedDocumentsInTransaction(
    db: admin.firestore.Firestore,
    transaction: admin.firestore.Transaction,
    uid: string,
    refs: readonly admin.firestore.DocumentReference[],
): Promise<{ guard: UserDeletionGuardState; snapshots: admin.firestore.DocumentSnapshot[] }> {
    const { userRef, tombstoneRef } = getUserDeletionRefs(db, uid);
    const [userSnapshot, tombstoneSnapshot, ...snapshots] = await transaction.getAll(userRef, tombstoneRef, ...refs);
    return { guard: deletionGuardStateFromSnapshots(userSnapshot, tombstoneSnapshot, Date.now()), snapshots };
}
