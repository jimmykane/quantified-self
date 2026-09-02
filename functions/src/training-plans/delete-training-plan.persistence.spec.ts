import { ActivityTypes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    DeleteTrainingPlanRequestV1,
    MutateTrainingScheduleRequestV1,
    ScheduledWorkoutV1,
    TrainingPlanV1,
} from '../../../shared/training-plans';

const guard = vi.hoisted(() => ({ getUserDeletionGuardStateInTransaction: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardStateInTransaction: guard.getUserDeletionGuardStateInTransaction,
}));

import { deleteTrainingPlanForUser } from './delete-training-plan';
import {
    mutateTrainingScheduleForUser,
    trainingScheduleDeletionTombstoneDocumentId,
} from './persistence';

const NOW_MS = Date.UTC(2026, 8, 2, 14);
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

type Stored = Record<string, unknown>;

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

class FakeSnapshot {
    constructor(readonly ref: FakeDocumentReference, private readonly stored: Stored | undefined) {}
    get id(): string { return this.ref.id; }
    get exists(): boolean { return this.stored !== undefined; }
    data(): Stored | undefined { return this.stored === undefined ? undefined : clone(this.stored); }
}

interface Filter {
    field: string;
    operator: string;
    value: unknown;
}

class FakeQuery {
    constructor(
        readonly db: FakeFirestore,
        readonly path: string,
        readonly filters: Filter[] = [],
    ) {}
    where(field: string, operator: string, value: unknown): FakeQuery {
        return new FakeQuery(this.db, this.path, [...this.filters, { field, operator, value }]);
    }
    async get(): Promise<{ docs: FakeSnapshot[]; empty: boolean }> {
        const docs = this.db.query(this);
        return { docs, empty: docs.length === 0 };
    }
}

class FakeCollectionReference extends FakeQuery {
    doc(id: string): FakeDocumentReference { return new FakeDocumentReference(this.db, `${this.path}/${id}`); }
}

class FakeDocumentReference {
    constructor(readonly db: FakeFirestore, readonly path: string) {}
    get id(): string { return this.path.split('/').at(-1) ?? ''; }
    collection(id: string): FakeCollectionReference { return new FakeCollectionReference(this.db, `${this.path}/${id}`); }
}

class FakeTransaction {
    constructor(private readonly db: FakeFirestore) {}
    async get(ref: FakeDocumentReference | FakeQuery): Promise<FakeSnapshot | { docs: FakeSnapshot[]; empty: boolean }> {
        if (ref instanceof FakeDocumentReference) return this.db.snapshot(ref);
        const docs = this.db.query(ref);
        return { docs, empty: docs.length === 0 };
    }
    set(ref: FakeDocumentReference, value: unknown): void { this.db.docs.set(ref.path, clone(value as Stored)); }
    create(ref: FakeDocumentReference, value: unknown): void {
        if (this.db.docs.has(ref.path)) throw new Error(`Document exists: ${ref.path}`);
        this.set(ref, value);
    }
    delete(ref: FakeDocumentReference): void { this.db.docs.delete(ref.path); }
}

class FakeBatch {
    private readonly creates: Array<{ ref: FakeDocumentReference; value: unknown }> = [];
    constructor(private readonly db: FakeFirestore) {}
    create(ref: FakeDocumentReference, value: unknown): FakeBatch {
        this.creates.push({ ref, value });
        return this;
    }
    async commit(): Promise<void> {
        this.creates.forEach(({ ref }) => {
            if (this.db.docs.has(ref.path)) throw new Error(`Document exists: ${ref.path}`);
        });
        this.creates.forEach(({ ref, value }) => this.db.docs.set(ref.path, clone(value as Stored)));
    }
}

class FakeFirestore {
    readonly docs = new Map<string, Stored>();
    readonly recursiveDelete = vi.fn(async (ref: FakeDocumentReference) => {
        [...this.docs.keys()].forEach((path) => {
            if (path === ref.path || path.startsWith(`${ref.path}/`)) this.docs.delete(path);
        });
    });
    collection(id: string): FakeCollectionReference { return new FakeCollectionReference(this, id); }
    batch(): FakeBatch { return new FakeBatch(this); }
    async runTransaction<T>(handler: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
        return handler(new FakeTransaction(this));
    }
    async getAll(...refs: FakeDocumentReference[]): Promise<FakeSnapshot[]> {
        return refs.map(ref => this.snapshot(ref));
    }
    snapshot(ref: FakeDocumentReference): FakeSnapshot { return new FakeSnapshot(ref, this.docs.get(ref.path)); }
    query(query: FakeQuery): FakeSnapshot[] {
        const prefix = `${query.path}/`;
        return [...this.docs.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .filter(([, value]) => query.filters.every((filter) => {
                if (filter.operator === '==') return value[filter.field] === filter.value;
                if (filter.operator === 'in' && Array.isArray(filter.value)) {
                    return filter.value.includes(value[filter.field]);
                }
                throw new Error(`Unsupported operator ${filter.operator}`);
            }))
            .map(([path, value]) => new FakeSnapshot(new FakeDocumentReference(this, path), value));
    }
    seed(path: string, value: unknown): void { this.docs.set(path, clone(value as Stored)); }
    read(path: string): Stored | undefined { return this.docs.get(path); }
}

function plan(workoutCount: number): TrainingPlanV1 {
    return {
        schemaVersion: 1,
        id: 'plan-1',
        name: 'Plan one',
        lifecycle: 'active',
        startLocalDate: '2026-09-01',
        endLocalDate: '2026-09-30',
        revision: 4,
        lastCheckpointRevision: 1,
        workoutCount,
        createdAtMs: 1,
        updatedAtMs: 4,
    };
}

function workout(id: string): ScheduledWorkoutV1 {
    return {
        schemaVersion: 1,
        id,
        planId: 'plan-1',
        localDate: '2026-09-03',
        lifecycle: 'planned',
        title: id,
        structure: STRUCTURE,
        revision: 2,
        createdAtMs: 1,
        updatedAtMs: 2,
    };
}

function request(workoutDisposition: DeleteTrainingPlanRequestV1['workoutDisposition']): DeleteTrainingPlanRequestV1 {
    return {
        mutationId: `delete-${workoutDisposition}`,
        planId: 'plan-1',
        expectedRevisions: [
            { scope: 'state', id: 'current', revision: 8 },
            { scope: 'plan', id: 'plan-1', revision: 4 },
        ],
        workoutDisposition,
        confirmPlanDeletion: true,
    };
}

function seed(db: FakeFirestore, workouts: ScheduledWorkoutV1[]): void {
    db.seed('users/user-1/trainingPlanState/current', {
        schemaVersion: 1,
        activePlanId: 'plan-1',
        revision: 8,
        currentWorkoutCount: workouts.length,
        updatedAtMs: 8,
    });
    db.seed('users/user-1/trainingPlans/plan-1', plan(workouts.length));
    db.seed('users/user-1/trainingPlans/plan-1/revisions/0000000001', { privateHistory: true });
    workouts.forEach(item => db.seed(`users/user-1/scheduledWorkouts/${item.id}`, item));
}

describe('deleteTrainingPlanForUser persistence', () => {
    let db: FakeFirestore;

    beforeEach(() => {
        vi.clearAllMocks();
        guard.getUserDeletionGuardStateInTransaction.mockResolvedValue({ shouldSkip: false });
        db = new FakeFirestore();
    });

    it('prepares standalone history, atomically converts workouts, and cleans plan history', async () => {
        seed(db, [workout('workout-1'), workout('workout-2')]);
        const deletion = request('convert-to-standalone');

        const response = await deleteTrainingPlanForUser('user-1', deletion, { db: db as never, nowMs: NOW_MS });

        expect(response.convertedWorkoutIds).toEqual(['workout-1', 'workout-2']);
        expect(db.read('users/user-1/trainingPlans/plan-1')).toBeUndefined();
        expect(db.read('users/user-1/trainingPlans/plan-1/revisions/0000000001')).toBeUndefined();
        expect(db.read('users/user-1/scheduledWorkouts/workout-1')).toMatchObject({ planId: null, revision: 3 });
        expect(db.read('users/user-1/scheduledWorkouts/workout-1/revisions/0000000003')).toMatchObject({
            mutationId: deletion.mutationId,
            operationKind: 'delete-plan-convert-workouts',
            snapshot: expect.objectContaining({ planId: null, revision: 3 }),
        });
        expect(db.read('users/user-1/trainingPlanState/current')).toMatchObject({
            activePlanId: null, revision: 9, currentWorkoutCount: 2,
        });
        expect(db.read('users/user-1/trainingPlanState/current/planDeletionLocks/plan-1')).toBeUndefined();
        const planTombstoneId = trainingScheduleDeletionTombstoneDocumentId('plan', 'plan-1');
        expect(db.read(`users/user-1/trainingPlanState/current/deletionTombstones/${planTombstoneId}`)).toMatchObject({
            entityKind: 'plan',
            entityIdHash: planTombstoneId,
            mutationId: deletion.mutationId,
        });

        await expect(deleteTrainingPlanForUser('user-1', deletion, { db: db as never, nowMs: NOW_MS + 100 }))
            .resolves.toEqual(response);

        const recreate: MutateTrainingScheduleRequestV1 = {
            mutationId: 'recreate-retired-plan',
            expectedRevisions: [{ scope: 'state', id: 'current', revision: 9 }],
            operation: {
                kind: 'create-plan',
                planId: 'plan-1',
                name: 'Reused plan ID',
                startLocalDate: '2026-10-01',
                endLocalDate: '2026-10-31',
                activate: false,
            },
        };
        await expect(mutateTrainingScheduleForUser('user-1', recreate, {
            db: db as never,
            nowMs: NOW_MS + 101,
        })).rejects.toMatchObject({ code: 'already-exists' });
    });

    it('permanently deletes workouts and their nested history', async () => {
        const current = workout('workout-1');
        seed(db, [current]);
        db.seed('users/user-1/scheduledWorkouts/workout-1/revisions/0000000002', { privateHistory: true });

        const response = await deleteTrainingPlanForUser(
            'user-1', request('delete-workouts'), { db: db as never, nowMs: NOW_MS },
        );

        expect(response.permanentlyDeletedWorkoutIds).toEqual(['workout-1']);
        expect(db.read('users/user-1/scheduledWorkouts/workout-1')).toBeUndefined();
        expect(db.read('users/user-1/scheduledWorkouts/workout-1/revisions/0000000002')).toBeUndefined();
        expect(db.read('users/user-1/trainingPlanState/current')).toMatchObject({ currentWorkoutCount: 0 });
        const workoutTombstoneId = trainingScheduleDeletionTombstoneDocumentId('workout', 'workout-1');
        expect(db.read(`users/user-1/trainingPlanState/current/deletionTombstones/${workoutTombstoneId}`)).toMatchObject({
            entityKind: 'workout',
            entityIdHash: workoutTombstoneId,
        });
    });

    it('honors the declared 400-current-workout limit without exceeding one batch', async () => {
        const workouts = Array.from({ length: 400 }, (_, index) => workout(`workout-${`${index}`.padStart(3, '0')}`));
        seed(db, workouts);

        const response = await deleteTrainingPlanForUser(
            'user-1', request('convert-to-standalone'), { db: db as never, nowMs: NOW_MS },
        );

        expect(response.convertedWorkoutIds).toHaveLength(400);
        expect(db.read('users/user-1/scheduledWorkouts/workout-399')).toMatchObject({ planId: null, revision: 3 });
    });

    it('rechecks account deletion before acquiring or finalizing a lock', async () => {
        seed(db, [workout('workout-1')]);
        guard.getUserDeletionGuardStateInTransaction.mockResolvedValue({ shouldSkip: true });

        await expect(deleteTrainingPlanForUser(
            'user-1', request('delete-workouts'), { db: db as never, nowMs: NOW_MS },
        )).rejects.toThrow('account is being deleted');
        expect(db.read('users/user-1/trainingPlanState/current/planDeletionLocks/plan-1')).toBeUndefined();
    });

    it('serializes plan deletions for a user', async () => {
        seed(db, [workout('workout-1')]);
        db.seed('users/user-1/trainingPlanState/current/planDeletionLocks/plan-2', {
            schemaVersion: 1,
            mutationId: 'delete-plan-2',
            requestHash: 'different-request',
            planId: 'plan-2',
            planRevision: 1,
            workoutDisposition: 'delete-workouts',
            workouts: [],
            createdAtMs: NOW_MS - 1,
        });

        await expect(deleteTrainingPlanForUser(
            'user-1', request('delete-workouts'), { db: db as never, nowMs: NOW_MS },
        )).rejects.toThrow('Another training plan deletion is in progress');
        expect(db.read('users/user-1/trainingPlanState/current/planDeletionLocks/plan-1')).toBeUndefined();
    });
});
