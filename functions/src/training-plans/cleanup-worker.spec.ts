import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';

const mocks = vi.hoisted(() => ({
    guard: vi.fn(),
    cleanupPlan: vi.fn(),
    firestore: vi.fn(),
    schedules: [] as Array<{ schedule: string; timeZone: string }>,
}));
vi.mock('firebase-admin', () => ({ firestore: mocks.firestore }));
vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (options: { schedule: string; timeZone: string }, handler: unknown) => {
        mocks.schedules.push(options);
        return handler;
    },
}));
vi.mock('firebase-functions/logger', () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: mocks.guard }));
vi.mock('./delete-training-plan', () => ({
    cleanupDeletedPlanData: mocks.cleanupPlan,
    parseStoredDeleteResponse: (value: unknown) => value,
}));

import {
    processTrainingCleanupJob, reconcileTrainingPlanCleanup, reconcileTrainingWorkoutExpiry, runTrainingWorkoutExpiry,
} from './cleanup-worker';
import { TRAINING_CLEANUP_JOBS_COLLECTION_ID, trainingCleanupJob, trainingCleanupJobRef } from './cleanup-job-contract';
import { buildTrainingScheduleDeletionTombstone, trainingScheduleDeletionTombstoneDocumentId } from './persistence';
import { SCHEDULED_WORKOUTS_COLLECTION_ID } from '../../../shared/training-plans';
import {
    claimWorkoutExpiryCheckpoint, saveWorkoutExpiryCheckpoint, WORKOUT_EXPIRY_CHECKPOINT_PATH,
} from './workout-expiry-checkpoint';

type Stored = Record<string, unknown>;

class FakeRef {
    constructor(readonly db: FakeDb, readonly path: string) {}
    collection(id: string): FakeCollection { return new FakeCollection(this.db, `${this.path}/${id}`); }
}
class FakeCollection {
    constructor(readonly db: FakeDb, readonly path: string) {}
    doc(id: string): FakeRef { return new FakeRef(this.db, `${this.path}/${id}`); }
    where(field: string, operator: string, value: unknown): FakeFilteredCollection {
        return new FakeFilteredCollection(this.db, this.path, field, operator, value);
    }
}
class FakeFilteredCollection {
    private max = 25;
    constructor(readonly db: FakeDb, readonly path: string,
        readonly field: string, readonly operator: string, readonly value: unknown) {}
    limit(count: number): FakeFilteredCollection { this.max = count; return this; }
    async get(): Promise<{ empty: boolean; docs: Array<{ ref: FakeRef }> }> {
        const prefix = `${this.path}/`;
        const docs = [...this.db.docs.entries()]
            .filter(([path, data]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')
                && this.operator === '==' && data[this.field] === this.value)
            .slice(0, this.max).map(([path]) => ({ ref: new FakeRef(this.db, path) }));
        return { empty: docs.length === 0, docs };
    }
}
class FakeDb {
    readonly docs = new Map<string, Stored>();
    readonly recursiveDelete = vi.fn(async (ref: FakeRef) => {
        for (const path of [...this.docs.keys()]) {
            if (path === ref.path || path.startsWith(`${ref.path}/`)) this.docs.delete(path);
        }
    });
    collection(id: string): FakeCollection { return new FakeCollection(this, id); }
    doc(path: string): FakeRef { return new FakeRef(this, path); }
    async runTransaction<T>(handler: (transaction: {
        get: (ref: FakeRef) => Promise<{ exists: boolean; data: () => Stored | undefined }>;
        update: (ref: FakeRef, value: Stored) => void;
        set: (ref: FakeRef, value: Stored) => void;
        delete: (ref: FakeRef) => void;
    }) => Promise<T>): Promise<T> {
        return handler({
            get: async ref => ({ exists: this.docs.has(ref.path), data: () => this.docs.get(ref.path) }),
            update: (ref, value) => {
                const current = this.docs.get(ref.path);
                if (!current) throw new Error('Missing document.');
                this.docs.set(ref.path, { ...current, ...value });
            },
            set: (ref, value) => { this.docs.set(ref.path, value); },
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

    it('keeps retry and expiry scans on separate scheduled handlers', async () => {
        const queriedCollections: string[] = [];
        const emptyQuery = () => {
            const query = {
                where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
                get: vi.fn(async () => ({ empty: true, docs: [] })),
            };
            query.where.mockReturnValue(query);
            query.orderBy.mockReturnValue(query);
            query.limit.mockReturnValue(query);
            return query;
        };
        const scheduleDb = Object.assign(new FakeDb(), {
            collectionGroup: vi.fn((name: string) => {
                queriedCollections.push(name);
                return emptyQuery();
            }),
        });

        mocks.firestore.mockReturnValue(scheduleDb);
        expect(mocks.schedules).toEqual([
            expect.objectContaining({ schedule: 'every 15 minutes', timeZone: 'UTC' }),
            expect.objectContaining({ schedule: '0 3 * * *', timeZone: 'UTC' }),
        ]);

        await (reconcileTrainingPlanCleanup as unknown as () => Promise<void>)();
        expect(queriedCollections).toEqual([TRAINING_CLEANUP_JOBS_COLLECTION_ID]);

        queriedCollections.length = 0;
        await (reconcileTrainingWorkoutExpiry as unknown as () => Promise<void>)();
        expect(queriedCollections).toEqual([SCHEDULED_WORKOUTS_COLLECTION_ID, SCHEDULED_WORKOUTS_COLLECTION_ID]);
        expect(logger.info).toHaveBeenCalledWith('[TrainingWorkoutExpiry]', {
            scanned: 0, deleted: 0, deferred: 0, failed: 0,
            batches: 1, moreDue: false, stopReason: 'drained',
        });
    });

    it('stops before scanning when the daily time budget is spent', async () => {
        const query = {
            where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
            get: vi.fn(async () => ({ empty: true, docs: [] })),
        };
        query.where.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        const collectionGroup = vi.fn(() => query);
        const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(240_000);
        const result = await runTrainingWorkoutExpiry({ collectionGroup } as never, nowMs, clock);
        expect(result).toMatchObject({ scanned: 0, deleted: 0, batches: 0, moreDue: null, stopReason: 'time-budget' });
        expect(collectionGroup).not.toHaveBeenCalled();
    });

    it('keeps the sweep successful when only the final backlog check fails', async () => {
        const query = {
            where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
            get: vi.fn().mockResolvedValueOnce({ empty: true, docs: [] })
                .mockRejectedValueOnce(new Error('backlog query unavailable')),
        };
        query.where.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        const expiryDb = Object.assign(new FakeDb(), { collectionGroup: vi.fn(() => query) });
        const result = await runTrainingWorkoutExpiry(expiryDb as never, nowMs);
        expect(result).toMatchObject({ scanned: 0, deleted: 0, moreDue: null, stopReason: 'drained' });
        expect(logger.warn).toHaveBeenCalledWith('[TrainingWorkoutExpiry]', { event: 'backlog_check_failed' });
    });

    it('reports progress within a failed batch and rethrows a later page failure', async () => {
        let page = 0;
        const query = {
            where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
            get: vi.fn(async () => {
                if (page === 5) throw new Error('query unavailable');
                const count = page === 3 ? 10 : 30;
                const start = page++ * 30;
                const docs = Array.from({ length: count }, (_, index) => ({
                    id: `invalid-${start + index}`,
                    ref: { path: `users/owner-1/scheduledWorkouts/invalid-${start + index}` },
                    get: () => nowMs - 100_000_000_000,
                    data: () => ({}),
                }));
                return { empty: false, size: docs.length, docs };
            }),
        };
        query.where.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        query.startAfter.mockReturnValue(query);
        const collectionGroup = vi.fn(() => query);
        const expiryDb = Object.assign(new FakeDb(), { collectionGroup });
        await expect(runTrainingWorkoutExpiry(expiryDb as never, nowMs))
            .rejects.toThrow('query unavailable');
        expect(logger.error).toHaveBeenCalledWith('[TrainingWorkoutExpiry]', {
            event: 'sweep_failed', scanned: 130, deleted: 0, deferred: 0, failed: 130,
            batches: 2, moreDue: null, stopReason: 'sweep-error',
        });
        expect(expiryDb.docs.get(WORKOUT_EXPIRY_CHECKPOINT_PATH)).toMatchObject({
            cursor: { deletedAtMs: nowMs - 100_000_000_000,
                documentPath: 'users/owner-1/scheduledWorkouts/invalid-99' },
            leaseId: null, leaseUntilMs: 0,
        });
    });

    it('retains the last inspected key on a time limit and clears it after exhausting the next run', async () => {
        let timeSpent = false;
        const path = 'users/owner-1/scheduledWorkouts/invalid';
        const deletedAtMs = nowMs - 100_000_000_000;
        const query = {
            where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
            get: vi.fn().mockResolvedValueOnce({ empty: false, size: 2, docs: [{
                id: 'invalid', ref: { path }, get: () => deletedAtMs,
                data: () => { timeSpent = true; return {}; },
            }, {
                id: 'uninspected', ref: { path: 'users/owner-1/scheduledWorkouts/uninspected' },
                get: () => deletedAtMs, data: () => ({}),
            }] }).mockResolvedValue({ empty: true, size: 0, docs: [] }),
        };
        for (const method of ['where', 'orderBy', 'limit', 'startAfter'] as const) query[method].mockReturnValue(query);
        const expiryDb = Object.assign(new FakeDb(), { collectionGroup: vi.fn(() => query) });
        expect(await runTrainingWorkoutExpiry(expiryDb as never, nowMs, () => timeSpent ? 240_000 : 0))
            .toMatchObject({ scanned: 1, failed: 1, stopReason: 'time-budget' });
        expect(expiryDb.docs.get(WORKOUT_EXPIRY_CHECKPOINT_PATH)).toMatchObject({
            cursor: { deletedAtMs, documentPath: path }, leaseId: null,
        });
        await runTrainingWorkoutExpiry(expiryDb as never, nowMs);
        expect(query.startAfter).toHaveBeenCalledWith(deletedAtMs, expect.objectContaining({ path }));
        expect(expiryDb.docs.get(WORKOUT_EXPIRY_CHECKPOINT_PATH)?.cursor).toBeNull();
    });

    it('skips an overlapping sweep and fences a stale worker after lease recovery', async () => {
        const first = (await claimWorkoutExpiryCheckpoint(db as never))!;
        const collectionGroup = vi.fn();
        expect(await runTrainingWorkoutExpiry(Object.assign(db, { collectionGroup }) as never, nowMs))
            .toMatchObject({ scanned: 0, batches: 0, stopReason: 'lease-held' });
        expect(collectionGroup).not.toHaveBeenCalled();
        const cursor = { deletedAtMs: nowMs, documentPath: 'users/owner-1/scheduledWorkouts/deleted' };
        db.docs.set(WORKOUT_EXPIRY_CHECKPOINT_PATH, {
            ...db.docs.get(WORKOUT_EXPIRY_CHECKPOINT_PATH), cursor, leaseUntilMs: 0,
        });
        const recovered = (await claimWorkoutExpiryCheckpoint(db as never))!;
        expect(recovered.cursor).toEqual(cursor);
        expect(recovered.leaseId).not.toBe(first.leaseId);
        await expect(saveWorkoutExpiryCheckpoint(db as never, first.leaseId, null, true))
            .rejects.toThrow('lease lost');
        expect(db.docs.get(WORKOUT_EXPIRY_CHECKPOINT_PATH)?.cursor).toEqual(cursor);
    });

    it('fails closed on an invalid persisted cursor without querying workouts', async () => {
        db.docs.set(WORKOUT_EXPIRY_CHECKPOINT_PATH, {
            schemaVersion: 1, cursor: { deletedAtMs: nowMs, documentPath: 'users/owner-1' },
            leaseId: null, leaseUntilMs: 0,
        });
        const collectionGroup = vi.fn();
        await expect(runTrainingWorkoutExpiry(Object.assign(db, { collectionGroup }) as never, nowMs))
            .rejects.toThrow('Invalid workout expiry cursor');
        expect(collectionGroup).not.toHaveBeenCalled();
    });

    function seedWorkout(): FakeRef {
        const ref = jobRef('workout', 'workout-1') as unknown as FakeRef;
        db.docs.set(ref.path, trainingCleanupJob('workout', 'workout-1', 'mutation-1', nowMs));
        db.docs.set(tombstonePath('workout', 'workout-1'),
            buildTrainingScheduleDeletionTombstone('workout', 'workout-1', 'mutation-1', nowMs));
        db.docs.set(`users/${uid}/scheduledWorkouts/workout-1/revisions/0000000001`, { privateHistory: true });
        db.docs.set(`users/${uid}/trainingActivityCompletionLinks/activity-1`, { workoutId: 'workout-1' });
        return ref;
    }

    it('recursively removes a permanently deleted workout subtree and its leaf job', async () => {
        const ref = seedWorkout();
        expect(await processTrainingCleanupJob(db as never, ref as never, nowMs)).toBe(true);
        expect(db.recursiveDelete).toHaveBeenCalledTimes(3);
        expect(db.recursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
            path: `users/${uid}/trainingActivityCompletionLinks/activity-1`,
        }));
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
        expect(db.docs.get(ref.path)?.nextAttemptAtMs).toBe(nowMs + 7 * 60 * 1000);
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

    it('refuses deletion when the tombstone has the right receipt but the wrong entity kind', async () => {
        const ref = seedWorkout();
        db.docs.set(tombstonePath('workout', 'workout-1'), {
            ...buildTrainingScheduleDeletionTombstone('workout', 'workout-1', 'mutation-1', nowMs),
            entityKind: 'plan',
        });
        await expect(processTrainingCleanupJob(db as never, ref as never, nowMs))
            .rejects.toThrow('tombstone mismatch');
        expect(db.recursiveDelete).not.toHaveBeenCalled();
    });
});
