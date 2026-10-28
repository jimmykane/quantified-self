import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    RestoreTrainingScheduleRevisionRequestV1,
    RestoreTrainingScheduleRevisionResponseV1,
} from '../../../shared/training-plans';

const dependencies = vi.hoisted(() => ({
    guard: vi.fn(),
    readPlanSnapshotAtRevision: vi.fn(),
    readStandaloneWorkoutAtRevision: vi.fn(),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardStateInTransaction: dependencies.guard,
}));

vi.mock('./history', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./history')>();
    return {
        ...actual,
        readPlanSnapshotAtRevision: dependencies.readPlanSnapshotAtRevision,
        readStandaloneWorkoutAtRevision: dependencies.readStandaloneWorkoutAtRevision,
    };
});

import { hashTrainingScheduleRequestPayload } from './persistence';
import { restoreTrainingScheduleRevisionForUser } from './restore';

type Stored = Record<string, unknown>;

class FakeSnapshot {
    constructor(private readonly stored: Stored | undefined) {}
    get exists(): boolean { return this.stored !== undefined; }
    data(): Stored | undefined {
        return this.stored === undefined
            ? undefined
            : JSON.parse(JSON.stringify(this.stored)) as Stored;
    }
}

class FakeDocumentReference {
    constructor(readonly db: FakeFirestore, readonly path: string) {}
    collection(id: string): FakeCollectionReference {
        return new FakeCollectionReference(this.db, `${this.path}/${id}`);
    }
}

class FakeCollectionReference {
    constructor(readonly db: FakeFirestore, readonly path: string) {}
    doc(id: string): FakeDocumentReference {
        return new FakeDocumentReference(this.db, `${this.path}/${id}`);
    }
}

class FakeTransaction {
    constructor(private readonly db: FakeFirestore) {}
    async get(ref: FakeDocumentReference): Promise<FakeSnapshot> {
        return new FakeSnapshot(this.db.documents.get(ref.path));
    }
}

class FakeFirestore {
    readonly documents = new Map<string, Stored>();
    readonly runTransaction = vi.fn(async <T>(handler: (transaction: FakeTransaction) => Promise<T>): Promise<T> => (
        handler(new FakeTransaction(this))
    ));

    collection(id: string): FakeCollectionReference {
        return new FakeCollectionReference(this, id);
    }
}

const REQUEST: RestoreTrainingScheduleRevisionRequestV1 = {
    mutationId: 'restore-plan-retry',
    expectedRevisions: [
        { scope: 'state', id: 'current', revision: 8 },
        { scope: 'plan', id: 'plan-1', revision: 4 },
    ],
    scope: { kind: 'plan', id: 'plan-1' },
    targetRevision: 2,
};

const RESPONSE: RestoreTrainingScheduleRevisionResponseV1 = {
    mutation: {
        mutationId: REQUEST.mutationId,
        state: {
            schemaVersion: 1,
            activePlanId: null,
            revision: 9,
            currentWorkoutCount: 0,
            updatedAtMs: 10,
        },
        plans: [],
        workouts: [],
        removedPlanIds: [],
        permanentlyDeletedWorkoutIds: [],
    },
    skippedWorkoutIds: [],
};

describe('restoreTrainingScheduleRevisionForUser receipt preflight', () => {
    beforeEach(() => {
        dependencies.guard.mockReset().mockResolvedValue({ shouldSkip: false });
        dependencies.readPlanSnapshotAtRevision.mockReset();
        dependencies.readStandaloneWorkoutAtRevision.mockReset();
    });

    it('returns a completed retry before reading history that may already be gone', async () => {
        const db = new FakeFirestore();
        db.documents.set(
            `users/user-1/trainingPlanState/current/mutationReceipts/${REQUEST.mutationId}`,
            {
                schemaVersion: 1,
                requestHash: hashTrainingScheduleRequestPayload(REQUEST),
                response: RESPONSE,
                createdAtMs: 10,
            },
        );
        dependencies.readPlanSnapshotAtRevision.mockRejectedValue(new Error('History was deleted.'));

        await expect(restoreTrainingScheduleRevisionForUser('user-1', REQUEST, {
            db: db as never,
            nowMs: 20,
        })).resolves.toEqual(RESPONSE);
        expect(dependencies.readPlanSnapshotAtRevision).not.toHaveBeenCalled();
        expect(dependencies.readStandaloneWorkoutAtRevision).not.toHaveBeenCalled();
        expect(db.runTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects mutation-ID reuse before reading the requested history', async () => {
        const db = new FakeFirestore();
        db.documents.set(
            `users/user-1/trainingPlanState/current/mutationReceipts/${REQUEST.mutationId}`,
            { requestHash: 'different-request', response: RESPONSE },
        );

        await expect(restoreTrainingScheduleRevisionForUser('user-1', REQUEST, {
            db: db as never,
            nowMs: 20,
        })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(dependencies.readPlanSnapshotAtRevision).not.toHaveBeenCalled();
    });
});
