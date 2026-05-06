import * as admin from 'firebase-admin';

export const USER_DELETION_TOMBSTONES_COLLECTION = 'userDeletionTombstones';

export interface UserDeletionGuardState {
    userExists: boolean;
    deletionInProgress: boolean;
    shouldSkip: boolean;
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
