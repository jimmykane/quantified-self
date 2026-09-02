import { ActivityTypes } from '@sports-alliance/sports-lib';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    MutateTrainingScheduleRequestV1,
    ScheduledWorkoutV1,
    TrainingPlanV1,
} from '../../../shared/training-plans';
import {
    applyTrainingScheduleMutation,
    createEmptyTrainingPlanState,
    type TrainingScheduleSnapshotV1,
} from './mutation';

const guard = vi.hoisted(() => ({
    result: { shouldSkip: false },
    getUserDeletionGuardStateInTransaction: vi.fn(),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardStateInTransaction: guard.getUserDeletionGuardStateInTransaction,
}));

import {
    buildTrainingScheduleRevisionWrites,
    hashTrainingScheduleMutationRequest,
    mutateTrainingScheduleForUser,
    trainingScheduleDeletionTombstoneDocumentId,
} from './persistence';

const NOW_MS = Date.UTC(2026, 8, 2, 10);
const STRUCTURE = {
    version: 1 as const,
    sport: ActivityTypes.Running,
    nodes: [{
        kind: 'step' as const,
        id: 'steady',
        purpose: 'work' as const,
        ending: { kind: 'time' as const, seconds: 1800 },
        targets: [],
    }],
};

interface FakeDocumentData {
    [key: string]: unknown;
}

class FakeDocumentSnapshot {
    constructor(
        readonly ref: FakeDocumentReference,
        private readonly stored: FakeDocumentData | undefined,
    ) {}

    get id(): string { return this.ref.id; }
    get exists(): boolean { return this.stored !== undefined; }
    data(): FakeDocumentData | undefined {
        return this.stored === undefined
            ? undefined
            : JSON.parse(JSON.stringify(this.stored)) as FakeDocumentData;
    }
}

class FakeQuery {
    constructor(
        readonly collectionRef: FakeCollectionReference,
        readonly filter?: { field: string; operator: string; value: unknown },
    ) {}
}

class FakeDocumentReference {
    readonly kind = 'document';

    constructor(
        readonly db: FakeFirestore,
        readonly path: string,
    ) {}

    get id(): string { return this.path.split('/').at(-1) ?? ''; }
    collection(id: string): FakeCollectionReference {
        return new FakeCollectionReference(this.db, `${this.path}/${id}`);
    }
}

class FakeCollectionReference extends FakeQuery {
    readonly kind = 'collection';

    constructor(
        readonly db: FakeFirestore,
        readonly path: string,
    ) {
        super(undefined as never);
        this.collectionRef = this;
    }

    override collectionRef: FakeCollectionReference;
    get id(): string { return this.path.split('/').at(-1) ?? ''; }
    doc(id: string): FakeDocumentReference {
        return new FakeDocumentReference(this.db, `${this.path}/${id}`);
    }
    where(field: string, operator: string, value: unknown): FakeQuery {
        return new FakeQuery(this, { field, operator, value });
    }
}

class FakeTransaction {
    constructor(private readonly db: FakeFirestore) {}

    async get(ref: FakeDocumentReference | FakeQuery): Promise<FakeDocumentSnapshot | { docs: FakeDocumentSnapshot[] }> {
        if (ref instanceof FakeDocumentReference) return this.db.documentSnapshot(ref);
        return { docs: this.db.querySnapshots(ref) };
    }

    set(ref: FakeDocumentReference, value: unknown): void {
        this.db.documents.set(ref.path, JSON.parse(JSON.stringify(value)) as FakeDocumentData);
    }

    create(ref: FakeDocumentReference, value: unknown): void {
        if (this.db.documents.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
        this.set(ref, value);
    }

    delete(ref: FakeDocumentReference): void {
        this.db.documents.delete(ref.path);
    }
}

class FakeFirestore {
    readonly documents = new Map<string, FakeDocumentData>();
    readonly recursiveDelete = vi.fn(async (ref: FakeDocumentReference) => {
        for (const path of [...this.documents.keys()]) {
            if (path === ref.path || path.startsWith(`${ref.path}/`)) this.documents.delete(path);
        }
    });

    collection(id: string): FakeCollectionReference {
        return new FakeCollectionReference(this, id);
    }

    async runTransaction<T>(handler: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
        return handler(new FakeTransaction(this));
    }

    documentSnapshot(ref: FakeDocumentReference): FakeDocumentSnapshot {
        return new FakeDocumentSnapshot(ref, this.documents.get(ref.path));
    }

    querySnapshots(query: FakeQuery): FakeDocumentSnapshot[] {
        const prefix = `${query.collectionRef.path}/`;
        return [...this.documents.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .filter(([, value]) => {
                if (!query.filter) return true;
                if (query.filter.operator === 'in' && Array.isArray(query.filter.value)) {
                    return query.filter.value.includes(value[query.filter.field]);
                }
                return false;
            })
            .map(([path, value]) => new FakeDocumentSnapshot(new FakeDocumentReference(this, path), value));
    }

    seed(path: string, value: unknown): void {
        this.documents.set(path, JSON.parse(JSON.stringify(value)) as FakeDocumentData);
    }

    read(path: string): FakeDocumentData | undefined {
        return this.documents.get(path);
    }
}

function plan(overrides: Partial<TrainingPlanV1> = {}): TrainingPlanV1 {
    return {
        schemaVersion: 1,
        id: 'plan-1',
        name: 'Plan one',
        lifecycle: 'active',
        startLocalDate: '2026-09-01',
        endLocalDate: '2026-09-30',
        revision: 3,
        lastCheckpointRevision: 1,
        workoutCount: 1,
        createdAtMs: 1,
        updatedAtMs: 2,
        ...overrides,
    };
}

function workout(overrides: Partial<ScheduledWorkoutV1> = {}): ScheduledWorkoutV1 {
    return {
        schemaVersion: 1,
        id: 'workout-1',
        planId: null,
        localDate: '2026-09-02',
        lifecycle: 'planned',
        title: 'Steady run',
        structure: STRUCTURE,
        revision: 2,
        createdAtMs: 1,
        updatedAtMs: 2,
        ...overrides,
    };
}

function request(
    operation: MutateTrainingScheduleRequestV1['operation'],
    expectedRevisions: MutateTrainingScheduleRequestV1['expectedRevisions'] = [],
    mutationId = `mutation-${operation.kind}`,
): MutateTrainingScheduleRequestV1 {
    return {
        mutationId,
        expectedRevisions: [
            { scope: 'state', id: 'current', revision: 0 },
            ...expectedRevisions,
        ],
        operation,
    };
}

describe('training schedule revision writes', () => {
    it('creates complete standalone snapshots for both sides of a scope transfer', () => {
        const sourcePlan = plan();
        const scheduled = workout({ planId: sourcePlan.id });
        const snapshot: TrainingScheduleSnapshotV1 = {
            state: {
                ...createEmptyTrainingPlanState(),
                activePlanId: sourcePlan.id,
                revision: 1,
                currentWorkoutCount: 1,
            },
            plans: new Map([[sourcePlan.id, sourcePlan]]),
            workouts: new Map([[scheduled.id, scheduled]]),
        };
        const moveRequest: MutateTrainingScheduleRequestV1 = {
            mutationId: 'detach',
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: 1 },
                { scope: 'plan', id: sourcePlan.id, revision: sourcePlan.revision },
                { scope: 'workout', id: scheduled.id, revision: scheduled.revision },
            ],
            operation: {
                kind: 'move-workout',
                workoutId: scheduled.id,
                planId: null,
                localDate: '2026-09-03',
                confirmPlanRangeExtension: false,
            },
        };
        const applied = applyTrainingScheduleMutation(snapshot, moveRequest, NOW_MS);
        const revisions = buildTrainingScheduleRevisionWrites(applied, moveRequest, NOW_MS);

        expect(revisions.planRevisions.get(sourcePlan.id)?.delta).toMatchObject({
            workoutCount: 1,
            workoutChunkCount: 1,
            workoutEncoding: 'gzip-json-base64-v1',
        });
        const encodedDelta = (revisions.planRevisionChunks.get(sourcePlan.id) ?? [])
            .filter(chunk => chunk.kind === 'delta-workouts')
            .map(chunk => chunk.payloadBase64)
            .join('');
        const workoutDeltas = JSON.parse(
            gunzipSync(Buffer.from(encodedDelta, 'base64')).toString('utf8'),
        ) as unknown[];
        expect(workoutDeltas).toEqual([expect.objectContaining({
            workoutId: scheduled.id,
            before: expect.objectContaining({ planId: sourcePlan.id }),
            after: expect.objectContaining({ planId: null }),
        })]);
        expect(revisions.standaloneWorkoutRevisions.get(scheduled.id)?.snapshot).toMatchObject({
            id: scheduled.id,
            planId: null,
        });
    });

    it('writes the complete plan state in first and bulk checkpoints', () => {
        const newPlanRequest = request({
            kind: 'create-plan',
            planId: 'plan-new',
            name: 'New plan',
            startLocalDate: '2026-09-01',
            endLocalDate: '2026-09-30',
            activate: false,
        });
        const snapshot: TrainingScheduleSnapshotV1 = {
            state: createEmptyTrainingPlanState(),
            plans: new Map(),
            workouts: new Map(),
        };
        const applied = applyTrainingScheduleMutation(snapshot, newPlanRequest, NOW_MS);
        const revision = buildTrainingScheduleRevisionWrites(applied, newPlanRequest, NOW_MS)
            .planRevisions.get('plan-new');

        expect(revision).toMatchObject({
            revision: 1,
            checkpointRevision: 1,
            checkpoint: {
                plan: { id: 'plan-new' },
                workoutCount: 0,
                workoutChunkCount: 0,
                workoutEncoding: 'gzip-json-base64-v1',
            },
        });

        const existingPlan = plan();
        const scheduled = workout({ planId: existingPlan.id });
        const bulkSnapshot: TrainingScheduleSnapshotV1 = {
            state: {
                ...createEmptyTrainingPlanState(),
                activePlanId: existingPlan.id,
                revision: 1,
                currentWorkoutCount: 1,
            },
            plans: new Map([[existingPlan.id, existingPlan]]),
            workouts: new Map([[scheduled.id, scheduled]]),
        };
        const shiftRequest: MutateTrainingScheduleRequestV1 = {
            mutationId: 'bulk-shift',
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: 1 },
                { scope: 'plan', id: existingPlan.id, revision: existingPlan.revision },
            ],
            operation: { kind: 'shift-plan', planId: existingPlan.id, days: 1 },
        };
        const shifted = applyTrainingScheduleMutation(bulkSnapshot, shiftRequest, NOW_MS);
        const shiftedWrites = buildTrainingScheduleRevisionWrites(shifted, shiftRequest, NOW_MS);
        expect(shiftedWrites.planRevisions.get(existingPlan.id)?.checkpoint).toMatchObject({
            workoutCount: 1,
            workoutChunkCount: 1,
        });
        const checkpointPayload = shiftedWrites.planRevisionChunks.get(existingPlan.id)
            ?.filter(chunk => chunk.kind === 'checkpoint-workouts')
            .map(chunk => chunk.payloadBase64)
            .join('') ?? '';
        expect(JSON.parse(
            gunzipSync(Buffer.from(checkpointPayload, 'base64')).toString('utf8'),
        )).toEqual([expect.objectContaining({ id: scheduled.id, localDate: '2026-09-03' })]);
    });

    it('hashes canonical request content independently of object key order', () => {
        const first = request({
            kind: 'rename-plan', planId: 'plan-1', name: 'Updated',
        }, [{ scope: 'plan', id: 'plan-1', revision: 1 }]);
        const second = {
            operation: { name: 'Updated', planId: 'plan-1', kind: 'rename-plan' as const },
            expectedRevisions: first.expectedRevisions.map(item => ({
                revision: item.revision, id: item.id, scope: item.scope,
            })),
            mutationId: first.mutationId,
        };
        expect(hashTrainingScheduleMutationRequest(first)).toBe(hashTrainingScheduleMutationRequest(second));
    });
});

describe('mutateTrainingScheduleForUser persistence', () => {
    let db: FakeFirestore;

    beforeEach(() => {
        vi.clearAllMocks();
        db = new FakeFirestore();
        guard.result = { shouldSkip: false };
        guard.getUserDeletionGuardStateInTransaction.mockImplementation(async () => guard.result);
    });

    it('persists current state, a standalone snapshot, and an internal idempotency receipt', async () => {
        const mutation = request({
            kind: 'create-workout',
            workoutId: 'standalone-1',
            planId: null,
            localDate: '2026-09-03',
            title: 'Standalone run',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        });

        const response = await mutateTrainingScheduleForUser('user-1', mutation, {
            db: db as never,
            nowMs: NOW_MS,
        });

        expect(response.workouts).toEqual([expect.objectContaining({ id: 'standalone-1', planId: null })]);
        expect(db.read('users/user-1/trainingPlanState/current')).toMatchObject({
            revision: 1,
            currentWorkoutCount: 1,
        });
        expect(db.read('users/user-1/scheduledWorkouts/standalone-1')).toMatchObject({ revision: 1 });
        expect(db.read('users/user-1/scheduledWorkouts/standalone-1/revisions/0000000001')).toMatchObject({
            operationKind: 'create-workout',
            snapshot: { id: 'standalone-1' },
        });
        expect(db.read('users/user-1/trainingPlanState/current/mutationReceipts/mutation-create-workout'))
            .toMatchObject({ requestHash: hashTrainingScheduleMutationRequest(mutation) });
    });

    it('returns the stored response for exact retries without creating another revision', async () => {
        const mutation = request({
            kind: 'create-workout',
            workoutId: 'standalone-1',
            planId: null,
            localDate: '2026-09-03',
            title: 'Standalone run',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        });
        const first = await mutateTrainingScheduleForUser('user-1', mutation, { db: db as never, nowMs: NOW_MS });
        const second = await mutateTrainingScheduleForUser('user-1', mutation, { db: db as never, nowMs: NOW_MS + 100 });

        expect(second).toEqual(first);
        expect(db.read('users/user-1/trainingPlanState/current')).toMatchObject({ revision: 1 });
        expect([...db.documents.keys()].filter(path => path.includes('/revisions/'))).toHaveLength(1);
    });

    it('rejects mutation-ID reuse with different content', async () => {
        const first = request({
            kind: 'create-plan',
            planId: 'plan-1',
            name: 'First',
            startLocalDate: '2026-09-01',
            endLocalDate: '2026-09-30',
            activate: false,
        }, [], 'same-id');
        await mutateTrainingScheduleForUser('user-1', first, { db: db as never, nowMs: NOW_MS });

        const reused = {
            ...first,
            operation: { ...first.operation, name: 'Different' },
        } as MutateTrainingScheduleRequestV1;
        await expect(mutateTrainingScheduleForUser('user-1', reused, { db: db as never, nowMs: NOW_MS + 1 }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('rechecks account deletion inside the transaction before every write', async () => {
        guard.result = { shouldSkip: true };
        const mutation = request({
            kind: 'create-plan',
            planId: 'plan-1',
            name: 'Blocked',
            startLocalDate: '2026-09-01',
            endLocalDate: '2026-09-30',
            activate: false,
        });

        await expect(mutateTrainingScheduleForUser('user-1', mutation, { db: db as never, nowMs: NOW_MS }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(db.documents.size).toBe(0);
    });

    it('fences all schedule mutations while a resumable plan deletion is active', async () => {
        db.seed('users/user-1/trainingPlanState/current/planDeletionLocks/plan-1', {
            schemaVersion: 1,
            mutationId: 'delete-plan-1',
        });
        const mutation = request({
            kind: 'create-workout',
            workoutId: 'standalone-1',
            planId: null,
            localDate: '2026-09-03',
            title: 'Blocked standalone run',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        });

        await expect(mutateTrainingScheduleForUser('user-1', mutation, { db: db as never, nowMs: NOW_MS }))
            .rejects.toThrow('plan deletion is in progress');
        expect(db.read('users/user-1/scheduledWorkouts/standalone-1')).toBeUndefined();
    });

    it('recursively removes a permanently deleted workout history after the atomic receipt', async () => {
        const deletedWorkout = workout({ lifecycle: 'deleted', deletedAtMs: NOW_MS - 1 });
        db.seed('users/user-1/trainingPlanState/current', {
            ...createEmptyTrainingPlanState(), revision: 2,
        });
        db.seed(`users/user-1/scheduledWorkouts/${deletedWorkout.id}`, deletedWorkout);
        db.seed(`users/user-1/scheduledWorkouts/${deletedWorkout.id}/revisions/0000000002`, {
            revision: 2,
        });
        const mutation: MutateTrainingScheduleRequestV1 = {
            mutationId: 'permanent-delete',
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: 2 },
                { scope: 'workout', id: deletedWorkout.id, revision: deletedWorkout.revision },
            ],
            operation: {
                kind: 'permanently-delete-workout',
                workoutId: deletedWorkout.id,
                confirmPermanentDeletion: true,
            },
        };

        await mutateTrainingScheduleForUser('user-1', mutation, { db: db as never, nowMs: NOW_MS });

        expect(db.recursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
            path: `users/user-1/scheduledWorkouts/${deletedWorkout.id}`,
        }));
        expect(db.read(`users/user-1/scheduledWorkouts/${deletedWorkout.id}`)).toBeUndefined();
        expect(db.read(`users/user-1/scheduledWorkouts/${deletedWorkout.id}/revisions/0000000002`)).toBeUndefined();
        const tombstoneId = trainingScheduleDeletionTombstoneDocumentId('workout', deletedWorkout.id);
        expect(db.read(`users/user-1/trainingPlanState/current/deletionTombstones/${tombstoneId}`)).toMatchObject({
            entityKind: 'workout',
            entityIdHash: tombstoneId,
            mutationId: mutation.mutationId,
        });

        const recreate = request({
            kind: 'create-workout',
            workoutId: deletedWorkout.id,
            planId: null,
            localDate: '2026-09-04',
            title: 'Must not be recreated',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        });
        recreate.expectedRevisions[0].revision = 3;
        await expect(mutateTrainingScheduleForUser('user-1', recreate, {
            db: db as never,
            nowMs: NOW_MS + 1,
        })).rejects.toMatchObject({ code: 'already-exists' });
    });
});
