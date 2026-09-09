import { ActivityTypes } from '@sports-alliance/sports-lib';
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from '../../../shared/training-plans';

const guard = vi.hoisted(() => ({ getUserDeletionGuardState: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: guard.getUserDeletionGuardState,
}));

import {
    getTrainingScheduleHistoryForUser,
    parsePreviewTrainingScheduleRestoreRequest,
    parseTrainingScheduleHistoryRequest,
    previewTrainingScheduleRestoreForUser,
    readPlanSnapshotAtRevision,
    readStandaloneWorkoutAtRevision,
} from './history';

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

function plan(overrides: Partial<TrainingPlanV1> = {}): TrainingPlanV1 {
    return {
        schemaVersion: 1,
        id: 'plan-1',
        name: 'Plan one',
        lifecycle: 'paused',
        startLocalDate: '2026-09-01',
        endLocalDate: '2026-09-30',
        revision: 1,
        lastCheckpointRevision: 1,
        workoutCount: 1,
        createdAtMs: 1,
        updatedAtMs: 1,
        ...overrides,
    };
}

function workout(overrides: Partial<ScheduledWorkoutV1> = {}): ScheduledWorkoutV1 {
    return {
        schemaVersion: 1,
        id: 'workout-1',
        planId: 'plan-1',
        localDate: '2026-09-02',
        lifecycle: 'planned',
        title: 'Steady run',
        structure: STRUCTURE,
        revision: 1,
        createdAtMs: 1,
        updatedAtMs: 1,
        ...overrides,
    };
}

class Snapshot {
    constructor(readonly ref: DocRef, private readonly value: unknown) {}
    get id(): string { return this.ref.id; }
    get exists(): boolean { return this.value !== undefined; }
    data(): unknown { return this.value; }
}

class QueryRef {
    constructor(
        readonly db: FakeDb,
        readonly path: string,
        readonly filters: Array<{ field: string; operator: string; value: unknown }> = [],
        readonly direction: 'asc' | 'desc' | null = null,
        readonly max: number | null = null,
    ) {}
    doc(id: string): DocRef { return new DocRef(this.db, `${this.path}/${id}`); }
    orderBy(_field: string, direction: 'asc' | 'desc'): QueryRef {
        return new QueryRef(this.db, this.path, this.filters, direction, this.max);
    }
    where(field: string, operator: string, value: unknown): QueryRef {
        return new QueryRef(this.db, this.path, [...this.filters, { field, operator, value }], this.direction, this.max);
    }
    limit(max: number): QueryRef {
        return new QueryRef(this.db, this.path, this.filters, this.direction, max);
    }
    async get(): Promise<{ docs: Snapshot[] }> { return { docs: this.db.query(this) }; }
}

class DocRef {
    constructor(readonly db: FakeDb, readonly path: string) {}
    get id(): string { return this.path.split('/').at(-1) ?? ''; }
    collection(id: string): QueryRef { return new QueryRef(this.db, `${this.path}/${id}`); }
    async get(): Promise<Snapshot> { return new Snapshot(this, this.db.docs.get(this.path)); }
}

class FakeDb {
    readonly docs = new Map<string, unknown>();
    collection(id: string): QueryRef { return new QueryRef(this, id); }
    async getAll(...refs: DocRef[]): Promise<Snapshot[]> {
        return refs.map(ref => new Snapshot(ref, this.docs.get(ref.path)));
    }
    seed(path: string, value: unknown): void { this.docs.set(path, value); }
    query(ref: QueryRef): Snapshot[] {
        const prefix = `${ref.path}/`;
        let rows = [...this.docs.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .filter(([, value]) => ref.filters.every((filter) => {
                const fieldValue = (value as Record<string, unknown>)[filter.field];
                if (filter.operator === '==') return fieldValue === filter.value;
                if (filter.operator === '<') return Number(fieldValue) < Number(filter.value);
                return false;
            }))
            .map(([path, value]) => new Snapshot(new DocRef(this, path), value));
        if (ref.direction) {
            rows = rows.sort((left, right) => {
                const delta = Number((left.data() as Record<string, unknown>).revision)
                    - Number((right.data() as Record<string, unknown>).revision);
                return ref.direction === 'asc' ? delta : -delta;
            });
        }
        return ref.max === null ? rows : rows.slice(0, ref.max);
    }
}

function planRevision(
    revision: number,
    planAfter: TrainingPlanV1,
    options: {
        checkpointRevision?: number;
        checkpointWorkouts?: ScheduledWorkoutV1[];
        workoutDeltas?: Array<{ workoutId: string; before: ScheduledWorkoutV1 | null; after: ScheduledWorkoutV1 | null }>;
    } = {},
): Record<string, unknown> {
    const workoutDeltas = options.workoutDeltas ?? [];
    const value: Record<string, unknown> = {
        schemaVersion: 1,
        revision,
        mutationId: `mutation-${revision}`,
        operationKind: revision === 1 ? 'create-plan' : 'rename-plan',
        createdAtMs: revision,
        checkpointRevision: options.checkpointRevision ?? 1,
        delta: {
            planBefore: revision === 1 ? null : plan({ revision: revision - 1 }),
            planAfter,
            workoutCount: workoutDeltas.length,
            workoutChunkCount: workoutDeltas.length > 0 ? 1 : 0,
            workoutEncoding: 'gzip-json-base64-v1',
        },
    };
    if (options.checkpointWorkouts) {
        value.checkpoint = {
            plan: planAfter,
            workoutCount: options.checkpointWorkouts.length,
            workoutChunkCount: options.checkpointWorkouts.length > 0 ? 1 : 0,
            workoutEncoding: 'gzip-json-base64-v1',
        };
    }
    return value;
}

function seedPlanRevision(
    db: FakeDb,
    revision: number,
    planAfter: TrainingPlanV1,
    options: {
        checkpointRevision?: number;
        checkpointWorkouts?: ScheduledWorkoutV1[];
        workoutDeltas?: Array<{ workoutId: string; before: ScheduledWorkoutV1 | null; after: ScheduledWorkoutV1 | null }>;
    } = {},
): void {
    const revisionId = `${revision}`.padStart(10, '0');
    const revisionPath = `users/user-1/trainingPlans/plan-1/revisions/${revisionId}`;
    db.seed(revisionPath, planRevision(revision, planAfter, options));
    const seedChunk = (kind: 'delta-workouts' | 'checkpoint-workouts', value: unknown[]): void => {
        if (value.length === 0) return;
        db.seed(`${revisionPath}/chunks/${kind}-0000`, {
            schemaVersion: 1,
            revision,
            kind,
            chunkIndex: 0,
            chunkCount: 1,
            encoding: 'gzip-json-base64-v1',
            payloadBase64: gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64'),
        });
    };
    seedChunk('delta-workouts', options.workoutDeltas ?? []);
    seedChunk('checkpoint-workouts', options.checkpointWorkouts ?? []);
}

describe('training schedule history request parsing', () => {
    it('normalizes bounded history and restore requests', () => {
        expect(parseTrainingScheduleHistoryRequest({ scope: { kind: 'plan', id: 'plan-1' } })).toEqual({
            scope: { kind: 'plan', id: 'plan-1' },
            limit: 20,
        });
        expect(parsePreviewTrainingScheduleRestoreRequest({
            scope: { kind: 'workout', id: 'workout-1' }, targetRevision: 2,
        })).toEqual({ scope: { kind: 'workout', id: 'workout-1' }, targetRevision: 2 });
    });

    it('rejects unknown scope fields and unbounded pages', () => {
        expect(() => parseTrainingScheduleHistoryRequest({
            scope: { kind: 'plan', id: 'plan-1', userID: 'other' },
        })).toThrow('Unknown field');
        expect(() => parseTrainingScheduleHistoryRequest({
            scope: { kind: 'plan', id: 'plan-1' }, limit: 51,
        })).toThrow('at most 50');
    });
});

describe('training schedule history reads', () => {
    let db: FakeDb;

    beforeEach(() => {
        vi.clearAllMocks();
        guard.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: false });
        db = new FakeDb();
    });

    it('returns only safe revision envelopes with pagination', async () => {
        const initialPlan = plan();
        for (let revision = 1; revision <= 3; revision += 1) {
            seedPlanRevision(db, revision, plan({ revision, name: `Plan ${revision}` }), {
                ...(revision === 1 ? { checkpointWorkouts: [workout()] } : {}),
            });
        }
        const response = await getTrainingScheduleHistoryForUser('user-1', {
            scope: { kind: 'plan', id: 'plan-1' }, limit: 2,
        }, db as never);

        expect(response.entries.map(entry => entry.revision)).toEqual([3, 2]);
        expect(response.nextBeforeRevision).toBe(2);
        expect(response.entries[0]).not.toHaveProperty('delta');
        expect(response.entries[0]).not.toHaveProperty('checkpoint');
        expect(initialPlan.id).toBe('plan-1');
    });

    it('reconstructs a plan from its nearest checkpoint and immutable deltas', async () => {
        const initialWorkout = workout();
        const updatedWorkout = workout({ revision: 2, title: 'Updated workout', updatedAtMs: 2 });
        const renamedPlan = plan({ revision: 2, name: 'Renamed', updatedAtMs: 2 });
        seedPlanRevision(db, 1, plan(), { checkpointWorkouts: [initialWorkout] });
        seedPlanRevision(db, 2, renamedPlan, {
            workoutDeltas: [{
                workoutId: initialWorkout.id,
                before: initialWorkout,
                after: updatedWorkout,
            }],
        });

        const reconstructed = await readPlanSnapshotAtRevision(db as never, 'user-1', 'plan-1', 2);

        expect(reconstructed.plan.name).toBe('Renamed');
        expect(reconstructed.workouts.get(initialWorkout.id)).toEqual(updatedWorkout);
    });

    it('reads complete standalone snapshots', async () => {
        const standalone = workout({ planId: null, revision: 2 });
        db.seed('users/user-1/scheduledWorkouts/workout-1/revisions/0000000002', {
            schemaVersion: 1,
            revision: 2,
            mutationId: 'mutation-2',
            operationKind: 'update-workout',
            createdAtMs: 2,
            snapshot: standalone,
        });
        await expect(readStandaloneWorkoutAtRevision(db as never, 'user-1', 'workout-1', 2))
            .resolves.toEqual(standalone);
    });

    it('previews moved plan workouts as conflicts instead of reclaiming them', async () => {
        const desiredWorkout = workout();
        seedPlanRevision(db, 1, plan(), { checkpointWorkouts: [desiredWorkout] });
        db.seed('users/user-1/trainingPlans/plan-1', plan({ revision: 2, name: 'Current' }));
        db.seed('users/user-1/scheduledWorkouts/workout-1', workout({
            planId: 'plan-2', revision: 4,
        }));

        const preview = await previewTrainingScheduleRestoreForUser('user-1', {
            scope: { kind: 'plan', id: 'plan-1' }, targetRevision: 1,
        }, db as never);

        expect(preview.skippedWorkoutIds).toEqual(['workout-1']);
        expect(preview.changedWorkoutIds).toEqual([]);
        expect(preview.warnings[0]).toContain('will not be reclaimed');
    });

    it('does not report metadata-only workout revision differences as plan restore changes', async () => {
        const desiredWorkout = workout();
        seedPlanRevision(db, 1, plan(), { checkpointWorkouts: [desiredWorkout] });
        db.seed('users/user-1/trainingPlans/plan-1', plan({ revision: 2, name: 'Current' }));
        db.seed('users/user-1/scheduledWorkouts/workout-1', workout({ revision: 4, updatedAtMs: 4 }));

        const preview = await previewTrainingScheduleRestoreForUser('user-1', {
            scope: { kind: 'plan', id: 'plan-1' }, targetRevision: 1,
        }, db as never);

        expect(preview.changedWorkoutIds).toEqual([]);
        expect(preview.changedPlanIds).toEqual(['plan-1']);
    });

    it('previews permanently deleted plan workouts as skipped instead of recreating them', async () => {
        const desiredWorkout = workout();
        seedPlanRevision(db, 1, plan(), { checkpointWorkouts: [desiredWorkout] });
        db.seed('users/user-1/trainingPlans/plan-1', plan({ revision: 2, name: 'Current', workoutCount: 0 }));
        db.seed('users/user-1/scheduledWorkouts/already-deleted', workout({
            id: 'already-deleted',
            lifecycle: 'deleted',
            deletedAtMs: 2,
        }));

        const preview = await previewTrainingScheduleRestoreForUser('user-1', {
            scope: { kind: 'plan', id: 'plan-1' }, targetRevision: 1,
        }, db as never);

        expect(preview.skippedWorkoutIds).toEqual(['workout-1']);
        expect(preview.changedWorkoutIds).toEqual([]);
        expect(preview.warnings[0]).toContain('permanently deleted');
    });

    it('previews standalone workouts moved into a plan as conflicts', async () => {
        const standalone = workout({ planId: null });
        db.seed('users/user-1/scheduledWorkouts/workout-1/revisions/0000000001', {
            schemaVersion: 1,
            revision: 1,
            mutationId: 'create',
            operationKind: 'create-workout',
            createdAtMs: 1,
            snapshot: standalone,
        });
        db.seed('users/user-1/scheduledWorkouts/workout-1', workout({ planId: 'plan-2', revision: 3 }));

        const preview = await previewTrainingScheduleRestoreForUser('user-1', {
            scope: { kind: 'workout', id: 'workout-1' }, targetRevision: 1,
        }, db as never);
        expect(preview).toMatchObject({
            changedWorkoutIds: [],
            skippedWorkoutIds: ['workout-1'],
        });
    });

    it('does not offer a plan-bound snapshot from the standalone revision stream for restore', async () => {
        const planBound = workout({ planId: 'plan-2', revision: 2 });
        db.seed('users/user-1/scheduledWorkouts/workout-1/revisions/0000000002', {
            schemaVersion: 1,
            revision: 2,
            mutationId: 'attach',
            operationKind: 'move-workout',
            createdAtMs: 2,
            snapshot: planBound,
        });
        db.seed('users/user-1/scheduledWorkouts/workout-1', workout({ planId: null, revision: 3 }));

        const preview = await previewTrainingScheduleRestoreForUser('user-1', {
            scope: { kind: 'workout', id: 'workout-1' }, targetRevision: 2,
        }, db as never);
        expect(preview).toMatchObject({
            changedWorkoutIds: [],
            skippedWorkoutIds: ['workout-1'],
        });
        expect(preview.warnings[0]).toContain('belongs to a plan');
    });

    it('stops history reads when account deletion has begun', async () => {
        guard.getUserDeletionGuardState.mockResolvedValueOnce({ shouldSkip: true });
        await expect(getTrainingScheduleHistoryForUser('user-1', {
            scope: { kind: 'plan', id: 'plan-1' }, limit: 20,
        }, db as never)).rejects.toMatchObject({ code: 'failed-precondition' });
    });
});
