import { randomUUID } from 'node:crypto';
import type * as admin from 'firebase-admin';
import { SCHEDULED_WORKOUTS_COLLECTION_ID } from '../../../shared/training-plans';

export interface WorkoutExpiryCursor {
    deletedAtMs: number;
    documentPath: string;
}

interface WorkoutExpiryCheckpoint {
    schemaVersion: 1;
    cursor: WorkoutExpiryCursor | null;
    leaseId: string | null;
    leaseUntilMs: number;
}

export const WORKOUT_EXPIRY_CHECKPOINT_PATH = 'systemJobs/trainingWorkoutExpiry';
// Longer than the scheduled Function's five-minute timeout.
const LEASE_MS = 7 * 60 * 1_000;

function checkpointRef(db: admin.firestore.Firestore) {
    return db.doc(WORKOUT_EXPIRY_CHECKPOINT_PATH);
}

function parseCheckpoint(value: unknown): WorkoutExpiryCheckpoint {
    if (!value || typeof value !== 'object') throw new Error('Invalid workout expiry checkpoint.');
    const state = value as Partial<WorkoutExpiryCheckpoint>;
    if (state.schemaVersion !== 1 || (state.leaseId !== null && typeof state.leaseId !== 'string')
        || !Number.isSafeInteger(state.leaseUntilMs) || state.leaseUntilMs! < 0) {
        throw new Error('Invalid workout expiry checkpoint.');
    }
    if (state.cursor !== null) {
        const cursor = state.cursor;
        const parts = typeof cursor?.documentPath === 'string' ? cursor.documentPath.split('/') : [];
        // A malformed due record can be outside users/{uid}. Retain its actual
        // index key so it cannot prevent progress through this collection group.
        // Firestore numeric index keys may include NaN or -Infinity even though
        // the canonical workout parser rejects those values.
        if (typeof cursor?.deletedAtMs !== 'number' || parts.length < 2 || parts.length % 2 !== 0
            || parts.some(part => !part || part === '.' || part === '..')
            || parts[parts.length - 2] !== SCHEDULED_WORKOUTS_COLLECTION_ID) {
            throw new Error('Invalid workout expiry cursor.');
        }
    }
    return state as WorkoutExpiryCheckpoint;
}

export async function claimWorkoutExpiryCheckpoint(db: admin.firestore.Firestore): Promise<{
    leaseId: string;
    cursor: WorkoutExpiryCursor | null;
} | null> {
    const ref = checkpointRef(db);
    const leaseId = randomUUID();
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const state = snapshot.exists ? parseCheckpoint(snapshot.data()) : null;
        // Lease time is wall-clock time, independent of the eligibility cutoff
        // supplied to the sweep (including an operator's historical cutoff).
        const nowMs = Date.now();
        if (state && state.leaseUntilMs > nowMs) return null;
        const cursor = state?.cursor ?? null;
        transaction.set(ref, { schemaVersion: 1, cursor, leaseId, leaseUntilMs: nowMs + LEASE_MS });
        return { leaseId, cursor };
    });
}

export async function saveWorkoutExpiryCheckpoint(
    db: admin.firestore.Firestore,
    leaseId: string,
    cursor: WorkoutExpiryCursor | null,
    release = false,
): Promise<void> {
    const ref = checkpointRef(db);
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const state = parseCheckpoint(snapshot.data());
        const nowMs = Date.now();
        if (state.leaseId !== leaseId || state.leaseUntilMs <= nowMs) {
            throw new Error('Workout expiry lease lost.');
        }
        transaction.set(ref, {
            schemaVersion: 1, cursor,
            leaseId: release ? null : leaseId,
            leaseUntilMs: release ? 0 : nowMs + LEASE_MS,
        });
    });
}
