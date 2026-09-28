import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    guard: vi.fn(),
    cleanupPlan: vi.fn(),
}));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/logger', () => ({ warn: vi.fn(), info: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: mocks.guard }));
vi.mock('./delete-training-plan', () => ({
    cleanupDeletedPlanData: mocks.cleanupPlan,
    parseStoredDeleteResponse: (value: unknown) => value,
}));

import { processTrainingCleanupJob } from './cleanup-worker';
import { trainingCleanupJob, trainingCleanupJobRef } from './cleanup-job-contract';
import { trainingScheduleDeletionTombstoneDocumentId } from './persistence';

type Stored = Record<string, unknown>;

class FakeRef {
    constructor(readonly db: FakeDb, readonly path: string) {}
    collection(id: string): FakeCollection { return new FakeCollection(this.db, `${this.path}/${id}`); }
}
class FakeCollection {
    constructor(readonly db: FakeDb, readonly path: string) {}
    doc(id: string): FakeRef { return new FakeRef(this.db, `${this.path}/${id}`); }
}
class FakeDb {
    readonly docs = new Map<string, Stored>();
    readonly recursiveDelete = vi.fn(async (ref: FakeRef) => {
        for (const path of [...this.docs.keys()]) {
            if (path === ref.path || path.startsWith(`${ref.path}/`)) this.docs.delete(path);
        }
    });
    collection(id: string): FakeCollection { return new FakeCollection(this, id); }
    async runTransaction<T>(handler: (transaction: {
        get: (ref: FakeRef) => Promise<{ exists: boolean; data: () => Stored | undefined }>;
        update: (ref: FakeRef, value: Stored) => void;
        delete: (ref: FakeRef) => void;
    }) => Promise<T>): Promise<T> {
        return handler({
            get: async ref => ({ exists: this.docs.has(ref.path), data: () => this.docs.get(ref.path) }),
            update: (ref, value) => {
                const current = this.docs.get(ref.path);
                if (!current) throw new Error('Missing document.');
                this.docs.set(ref.path, { ...current, ...value });
            },
            delete: ref => { this.docs.delete(ref.path); },
        });
    }
}

describe('durable Training cleanup worker', () => {
    const uid = 'owner-1';
    const nowMs = 1_800_000_000_000;
    let db: FakeDb;
    const jobRef = (kind: 'plan' | 'workout', entityId: string) => trainingCleanupJobRef(db as never, uid, kind, entityId);
    const tombstonePath = (kind: 'plan' | 'workout', entityId: string) =>
        `users/${uid}/trainingPlanState/current/deletionTombstones/${trainingScheduleDeletionTombstoneDocumentId(kind, entityId)}`;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.guard.mockResolvedValue({ shouldSkip: false });
        mocks.cleanupPlan.mockResolvedValue(undefined);
        db = new FakeDb();
    });

    function seedWorkout(): FakeRef {
        const ref = jobRef('workout', 'workout-1') as unknown as FakeRef;
        db.docs.set(ref.path, trainingCleanupJob('workout', 'workout-1', 'mutation-1', nowMs));
        db.docs.set(tombstonePath('workout', 'workout-1'), { mutationId: 'mutation-1' });
        db.docs.set(`users/${uid}/scheduledWorkouts/workout-1/revisions/0000000001`, { privateHistory: true });
        return ref;
    }

    it('recursively removes a permanently deleted workout subtree and its leaf job', async () => {
        const ref = seedWorkout();
        expect(await processTrainingCleanupJob(db as never, ref as never, nowMs)).toBe(true);
        expect(db.recursiveDelete).toHaveBeenCalledTimes(2);
        expect(db.recursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
            path: `users/${uid}/trainingWorkoutCompletions/workout-1`,
        }));
        expect(db.recursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
            path: `users/${uid}/scheduledWorkouts/workout-1`,
        }));
        expect([...db.docs.keys()].some(path => path.startsWith(`users/${uid}/scheduledWorkouts/workout-1/`))).toBe(false);
        expect(db.docs.has(ref.path)).toBe(false);
    });

    it('leases a failed job, backs off, and resumes without another browser request', async () => {
        const ref = seedWorkout();
        db.recursiveDelete.mockRejectedValueOnce(new Error('temporary cleanup failure'));
        await expect(processTrainingCleanupJob(db as never, ref as never, nowMs)).rejects.toThrow('temporary cleanup failure');
        const retryAt = db.docs.get(ref.path)?.nextAttemptAtMs as number;
        expect(retryAt).toBeGreaterThan(nowMs);
        expect(await processTrainingCleanupJob(db as never, ref as never, nowMs + 1)).toBe(false);
        expect(await processTrainingCleanupJob(db as never, ref as never, retryAt)).toBe(true);
        expect(db.docs.has(ref.path)).toBe(false);
    });

    it('lets only one worker claim a due cleanup job', async () => {
        const ref = seedWorkout();
        const originalDelete = db.recursiveDelete.getMockImplementation()!;
        let entered!: () => void;
        let release!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const paused = new Promise<void>(resolve => { release = resolve; });
        let firstCall = true;
        db.recursiveDelete.mockImplementation(async target => {
            if (firstCall) {
                firstCall = false;
                entered();
                await paused;
            }
            await originalDelete(target);
        });
        const first = processTrainingCleanupJob(db as never, ref as never, nowMs);
        await started;
        expect(await processTrainingCleanupJob(db as never, ref as never, nowMs)).toBe(false);
        release();
        expect(await first).toBe(true);
        expect(db.docs.has(ref.path)).toBe(false);
    });

    it('denies a job without the matching durable tombstone and skips deleted owners', async () => {
        const ref = seedWorkout();
        db.docs.delete(tombstonePath('workout', 'workout-1'));
        await expect(processTrainingCleanupJob(db as never, ref as never, nowMs)).rejects.toThrow('tombstone mismatch');
        expect(db.recursiveDelete).not.toHaveBeenCalled();
        mocks.guard.mockResolvedValue({ shouldSkip: true });
        expect(await processTrainingCleanupJob(db as never, ref as never, nowMs)).toBe(false);
    });
});
