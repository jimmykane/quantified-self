import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { deleteTrainingPlanForUser } from './delete-training-plan';
import { restoreTrainingScheduleRevisionForUser } from './restore';
import { reconcileTrainingBulkShifts } from './bulk-shift-worker';
import { BULK_SHIFT_LEASE_MS, stageLargeTrainingPlanShiftForUser } from './staged-shift';
import {
    TRAINING_PLAN_REVISION_CHUNK_ENCODING,
    TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS,
    mutateTrainingScheduleForUser,
    trainingPlanRevisionChunkDocumentId,
    trainingScheduleRevisionDocumentId,
} from './persistence';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('400-workout Training mutations in isolated demo Firestore', { timeout: 180_000 }, () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
        throw new Error('A loopback Firestore emulator is required.');
    }
    const db = new Firestore({ projectId: 'demo-training-657' });
    const uids: string[] = [];
    const nowMs = Date.parse('2026-09-28T10:00:00Z');

    afterAll(async () => {
        for (const uid of uids) await db.recursiveDelete(db.collection('users').doc(uid));
        await db.terminate();
    });

    it('shifts and converts 400 complex workouts with stable retries and no mixed final state', async () => {
        const uid = `large-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set({
            schemaVersion: 1, activePlanId: 'large-plan', revision: 1,
            currentWorkoutCount: 400, updatedAtMs: nowMs,
        });
        await user.collection('trainingPlans').doc('large-plan').set({
            schemaVersion: 1, id: 'large-plan', name: 'Synthetic 400-workout test', lifecycle: 'active',
            startLocalDate: '2026-10-01', endLocalDate: '2026-10-31', revision: 1,
            lastCheckpointRevision: 1, workoutCount: 400, createdAtMs: nowMs, updatedAtMs: nowMs,
        });
        for (let offset = 0; offset < 400; offset += 100) {
            const batch = db.batch();
            for (let index = offset; index < offset + 100; index += 1) {
                const id = `workout-${`${index}`.padStart(3, '0')}`;
                const structure = {
                    version: 1, sport: ActivityTypes.Running,
                    nodes: Array.from({ length: 100 }, (_, step) => ({
                        kind: 'step', id: `step-${step}`, purpose: 'work',
                        ending: { kind: 'time', seconds: 30 }, targets: [],
                        note: `Synthetic segment ${step} for workout ${index}: ${'x'.repeat(190)}`,
                    })),
                };
                batch.set(user.collection('scheduledWorkouts').doc(id), {
                    schemaVersion: 1, id, planId: 'large-plan', localDate: '2026-10-02', lifecycle: 'planned',
                    title: `Synthetic workout ${index}`, structure, revision: 1,
                    createdAtMs: nowMs, updatedAtMs: nowMs,
                });
            }
            await batch.commit();
        }
        const shift = {
            mutationId: 'large-shift',
            expectedRevisions: [{ scope: 'state' as const, id: 'current', revision: 1 },
                { scope: 'plan' as const, id: 'large-plan', revision: 1 }],
            operation: { kind: 'shift-plan' as const, planId: 'large-plan', days: 1 },
        };
        const firstShift = await mutateTrainingScheduleForUser(uid, shift, { db, nowMs: nowMs + 1 });
        expect((await mutateTrainingScheduleForUser(uid, shift, { db, nowMs: nowMs + 2 })).state.revision)
            .toBe(firstShift.state.revision);
        expect((await user.collection('scheduledWorkouts').doc('workout-399').get()).data())
            .toMatchObject({ planId: 'large-plan', localDate: '2026-10-03', revision: 2 });

        // A later committed date edit makes the shift checkpoint a real restore
        // target while retaining all 100-node prescription bodies.
        for (let offset = 0; offset < 400; offset += 100) {
            const batch = db.batch();
            for (let index = offset; index < offset + 100; index += 1) {
                batch.update(user.collection('scheduledWorkouts').doc(`workout-${`${index}`.padStart(3, '0')}`), {
                    localDate: '2026-10-04', revision: 3, updatedAtMs: nowMs + 3,
                });
            }
            await batch.commit();
        }
        await user.collection('trainingPlans').doc('large-plan').update({
            startLocalDate: '2026-10-03', endLocalDate: '2026-11-02', revision: 3, updatedAtMs: nowMs + 3,
        });
        await user.collection('trainingPlanState').doc('current').update({ revision: 3, updatedAtMs: nowMs + 3 });
        const restored = await restoreTrainingScheduleRevisionForUser(uid, {
            mutationId: 'large-restore', scope: { kind: 'plan', id: 'large-plan' }, targetRevision: 2,
            expectedRevisions: [{ scope: 'state', id: 'current', revision: 3 },
                { scope: 'plan', id: 'large-plan', revision: 3 }],
        }, { db, nowMs: nowMs + 4 });
        expect(restored.mutation.state.revision).toBe(4);
        expect((await user.collection('scheduledWorkouts').doc('workout-399').get()).data())
            .toMatchObject({ localDate: '2026-10-03', revision: 4 });

        const deletion = {
            mutationId: 'large-convert', planId: 'large-plan',
            expectedRevisions: [{ scope: 'state' as const, id: 'current', revision: 4 },
                { scope: 'plan' as const, id: 'large-plan', revision: 4 }],
            workoutDisposition: 'convert-to-standalone' as const,
            confirmPlanDeletion: true as const,
        };
        const converted = await deleteTrainingPlanForUser(uid, deletion, { db, nowMs: nowMs + 5 });
        expect(converted.convertedWorkoutIds).toHaveLength(400);
        expect((await deleteTrainingPlanForUser(uid, deletion, { db, nowMs: nowMs + 6 })).state.revision)
            .toBe(converted.state.revision);
        expect((await user.collection('trainingPlans').doc('large-plan').get()).exists).toBe(false);
        expect((await user.collection('scheduledWorkouts').doc('workout-399').get()).data())
            .toMatchObject({ planId: null, localDate: '2026-10-03', revision: 5 });
        expect((await user.collection('scheduledWorkouts').where('planId', '==', 'large-plan').get()).empty).toBe(true);
    });

    it('restores a deleted standalone workout without retaining its deletion timestamp', async () => {
        const uid = `large-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set({
            schemaVersion: 1, activePlanId: null, revision: 2,
            currentWorkoutCount: 0, updatedAtMs: nowMs,
        });
        const workoutRef = user.collection('scheduledWorkouts').doc('recoverable');
        const original = { schemaVersion: 1, id: 'recoverable', planId: null,
            localDate: '2026-10-02', lifecycle: 'planned', title: 'Recoverable run',
            structure: { version: 1, sport: ActivityTypes.Running, nodes: [{
                kind: 'step', id: 'run', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [],
            }] },
            revision: 1, createdAtMs: nowMs, updatedAtMs: nowMs };
        await workoutRef.set({ ...original, lifecycle: 'deleted', deletedAtMs: nowMs + 1, revision: 2 });
        await workoutRef.collection('revisions').doc('0000000001').set({
            schemaVersion: 1, revision: 1, mutationId: 'created', operationKind: 'create-workout',
            createdAtMs: nowMs, snapshot: original,
        });

        const restored = await restoreTrainingScheduleRevisionForUser(uid, {
            mutationId: 'restore-deleted', scope: { kind: 'workout', id: 'recoverable' }, targetRevision: 1,
            expectedRevisions: [{ scope: 'state', id: 'current', revision: 2 },
                { scope: 'workout', id: 'recoverable', revision: 2 }],
        }, { db, nowMs: nowMs + 2 });
        expect(restored.mutation.state.currentWorkoutCount).toBe(1);
        const saved = (await workoutRef.get()).data();
        expect(saved).toMatchObject({ lifecycle: 'planned', revision: 3 });
        expect(saved).not.toHaveProperty('deletedAtMs');
    });

    it('automatically resumes a staged shift after an interrupted callable', async () => {
        const uid = `large-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        const stateRef = user.collection('trainingPlanState').doc('current');
        const planRef = user.collection('trainingPlans').doc('auto-plan');
        const workoutRef = user.collection('scheduledWorkouts').doc('auto-workout');
        await user.set({ test: true });
        await stateRef.set({ schemaVersion: 1, activePlanId: 'auto-plan', revision: 1,
            currentWorkoutCount: 1, updatedAtMs: nowMs });
        await planRef.set({ schemaVersion: 1, id: 'auto-plan', name: 'Synthetic worker recovery',
            lifecycle: 'active', startLocalDate: '2026-10-01', endLocalDate: '2026-10-31',
            revision: 1, lastCheckpointRevision: 1, workoutCount: 1, createdAtMs: nowMs, updatedAtMs: nowMs });
        await workoutRef.set({ schemaVersion: 1, id: 'auto-workout', planId: 'auto-plan',
            localDate: '2026-10-02', lifecycle: 'planned', title: 'Synthetic run',
            structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'step', id: 'run',
                purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [] }] },
            revision: 1, createdAtMs: nowMs, updatedAtMs: nowMs });
        const shift = { mutationId: 'auto-shift', expectedRevisions: [
            { scope: 'state' as const, id: 'current', revision: 1 },
            { scope: 'plan' as const, id: 'auto-plan', revision: 1 },
        ], operation: { kind: 'shift-plan' as const, planId: 'auto-plan', days: 1 } };
        const staged = planRef.collection('revisions').doc(trainingScheduleRevisionDocumentId(2));
        let interrupted = false;
        const interrupt = { collection: (id: string) => db.collection(id),
            runTransaction: async (handler: (transaction: FirebaseFirestore.Transaction) => Promise<unknown>) => {
                const response = await db.runTransaction(handler);
                if (!interrupted && !(await staged.collection('chunks').limit(1).get()).empty && !(await staged.get()).exists) {
                    interrupted = true;
                    throw new Error('synthetic interrupted callable');
                }
                return response;
            } } as unknown as Firestore;
        await expect(stageLargeTrainingPlanShiftForUser(uid, shift, { db: interrupt, nowMs }))
            .rejects.toThrow('synthetic interrupted callable');
        expect((await workoutRef.get()).data()).toMatchObject({ localDate: '2026-10-02', revision: 1 });
        expect((await stateRef.get()).data()).toMatchObject({ revision: 1 });
        expect((await staged.get()).exists).toBe(false);
        const lockNextAttemptAtMs = (await stateRef.collection('planDeletionLocks').doc('_bulk_shift').get())
            .data()!.nextAttemptAtMs as number;
        expect(lockNextAttemptAtMs).toBeGreaterThanOrEqual(nowMs + BULK_SHIFT_LEASE_MS);
        expect(await reconcileTrainingBulkShifts(db, lockNextAttemptAtMs - 1))
            .toEqual({ scanned: 0, completed: 0, failed: 0 });
        const deletedAccountUid = `large-${randomUUID()}`; uids.push(deletedAccountUid);
        await db.collection('users').doc(deletedAccountUid).collection('trainingPlanState').doc('current')
            .collection('planDeletionLocks').doc('_bulk_shift').set({ nextAttemptAtMs: nowMs });
        const concurrent = await Promise.all([
            reconcileTrainingBulkShifts(db, lockNextAttemptAtMs + 1),
            reconcileTrainingBulkShifts(db, lockNextAttemptAtMs + 1),
        ]);
        expect(concurrent.reduce((count, result) => count + result.completed, 0)).toBe(1);
        expect(concurrent.every(result => result.failed === 0)).toBe(true);
        expect(concurrent.some(result => result.scanned >= 2)).toBe(true);
        expect((await stateRef.get()).data()).toMatchObject({ revision: 2 });
        expect((await workoutRef.get()).data()).toMatchObject({ localDate: '2026-10-03', revision: 2 });
        expect((await staged.get()).exists).toBe(true);
        expect((await stateRef.collection('planDeletionLocks').doc('_bulk_shift').get()).exists).toBe(false);
        const firstReceipt = (await stateRef.collection('mutationReceipts').doc('auto-shift').get()).data()!;
        expect(firstReceipt.createdAtMs).toBeGreaterThanOrEqual(lockNextAttemptAtMs + 1);
        expect(firstReceipt.expireAt.toMillis()).toBe(firstReceipt.createdAtMs + 30 * 24 * 60 * 60 * 1000);

        const nextShift = { mutationId: 'lost-final-response', expectedRevisions: [
            { scope: 'state' as const, id: 'current', revision: 2 },
            { scope: 'plan' as const, id: 'auto-plan', revision: 2 },
        ], operation: { kind: 'shift-plan' as const, planId: 'auto-plan', days: 1 } };
        const nextReceipt = stateRef.collection('mutationReceipts').doc(nextShift.mutationId);
        let lostFinalResponse = false;
        const loseFinalResponse = { collection: (id: string) => db.collection(id),
            runTransaction: async (handler: (transaction: FirebaseFirestore.Transaction) => Promise<unknown>) => {
                const response = await db.runTransaction(handler);
                if (!lostFinalResponse && (await nextReceipt.get()).exists) {
                    lostFinalResponse = true;
                    throw new Error('synthetic lost final response');
                }
                return response;
            } } as unknown as Firestore;
        const committed = await stageLargeTrainingPlanShiftForUser(uid, nextShift,
            { db: loseFinalResponse, nowMs: nowMs + 1 });
        expect(lostFinalResponse).toBe(true);
        expect(committed.state.revision).toBe(3);
        expect((await workoutRef.get()).data()).toMatchObject({ localDate: '2026-10-04', revision: 3 });
        expect((await stateRef.collection('planDeletionLocks').doc('_bulk_shift').get()).exists).toBe(false);

        const retryShift = { mutationId: 'canonical-third-shift', expectedRevisions: [
            { scope: 'state' as const, id: 'current', revision: 3 },
            { scope: 'plan' as const, id: 'auto-plan', revision: 3 },
        ], operation: { kind: 'shift-plan' as const, planId: 'auto-plan', days: 1 } };
        const lockRef = stateRef.collection('planDeletionLocks').doc('_bulk_shift');
        let interruptedAfterLock = false;
        const interruptLock = { collection: (id: string) => db.collection(id),
            runTransaction: async (handler: (transaction: FirebaseFirestore.Transaction) => Promise<unknown>) => {
                const response = await db.runTransaction(handler);
                if (!interruptedAfterLock && (await lockRef.get()).exists) {
                    interruptedAfterLock = true;
                    throw new Error('synthetic lost lock response');
                }
                return response;
            } } as unknown as Firestore;
        await expect(stageLargeTrainingPlanShiftForUser(uid, retryShift, { db: interruptLock, nowMs: nowMs + 2 }))
            .rejects.toThrow('synthetic lost lock response');
        const replacement = { ...retryShift, mutationId: 'reordered-third-shift',
            expectedRevisions: [...retryShift.expectedRevisions].reverse() };
        const resumed = await stageLargeTrainingPlanShiftForUser(uid, replacement, { db, nowMs: nowMs + 3 });
        expect(resumed.mutationId).toBe(retryShift.mutationId);
        expect(resumed.state.revision).toBe(4);
        expect((await workoutRef.get()).data()).toMatchObject({ localDate: '2026-10-05', revision: 4 });
        expect((await lockRef.get()).exists).toBe(false);
    });

    it('stages an oversized 400-prescription restore and a high-entropy shift', async () => {
        const uid = `large-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        const stateRef = user.collection('trainingPlanState').doc('current');
        const planRef = user.collection('trainingPlans').doc('large-plan');
        const plan = {
            schemaVersion: 1, id: 'large-plan', name: 'Synthetic restore safety test', lifecycle: 'active',
            startLocalDate: '2026-10-01', endLocalDate: '2026-10-31', revision: 3,
            lastCheckpointRevision: 2, workoutCount: 400, createdAtMs: nowMs, updatedAtMs: nowMs,
        };
        await stateRef.set({ schemaVersion: 1, activePlanId: plan.id, revision: 3,
            currentWorkoutCount: 400, updatedAtMs: nowMs });
        await planRef.set(plan);

        const desired = [];
        for (let offset = 0; offset < 400; offset += 100) {
            const batch = db.batch();
            for (let index = offset; index < offset + 100; index += 1) {
                const id = `workout-${`${index}`.padStart(3, '0')}`;
                const current = {
                    schemaVersion: 1, id, planId: plan.id, localDate: '2026-10-02', lifecycle: 'planned',
                    title: `Synthetic workout ${index}`,
                    structure: { version: 1, sport: ActivityTypes.Running, nodes: [{
                        kind: 'step', id: 'run', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [],
                    }] },
                    revision: 3, createdAtMs: nowMs, updatedAtMs: nowMs,
                };
                batch.set(user.collection('scheduledWorkouts').doc(id), current);
                desired.push({ ...current, revision: 2, structure: {
                    version: 1, sport: ActivityTypes.Running,
                    nodes: Array.from({ length: 100 }, (_, step) => ({
                        kind: 'step', id: `step-${step}`, purpose: 'work',
                        ending: { kind: 'time', seconds: 30 }, targets: [],
                        note: Array.from({ length: 3 }, (_, part) => createHash('sha256')
                            .update(`${index}:${step}:${part}`).digest('hex')).join(''),
                    })),
                } });
            }
            await batch.commit();
        }
        const checkpointPlan = { ...plan, revision: 2, lastCheckpointRevision: 2 };
        expect(Buffer.byteLength(JSON.stringify(desired), 'utf8')).toBeGreaterThan(7 * 1024 * 1024);
        const payload = gzipSync(Buffer.from(JSON.stringify(desired), 'utf8')).toString('base64');
        const chunkCount = Math.ceil(payload.length / TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS);
        expect(chunkCount).toBeLessThanOrEqual(100);
        const revisionRef = planRef.collection('revisions').doc(trainingScheduleRevisionDocumentId(2));
        await revisionRef.set({
            schemaVersion: 1, revision: 2, mutationId: 'synthetic-checkpoint', operationKind: 'shift-plan',
            createdAtMs: nowMs, checkpointRevision: 2,
            delta: { planBefore: null, planAfter: checkpointPlan, workoutCount: 0, workoutChunkCount: 0,
                workoutEncoding: TRAINING_PLAN_REVISION_CHUNK_ENCODING },
            checkpoint: { plan: checkpointPlan, workoutCount: 400, workoutChunkCount: chunkCount,
                workoutEncoding: TRAINING_PLAN_REVISION_CHUNK_ENCODING },
        });
        for (let offset = 0; offset < chunkCount; offset += 100) {
            const batch = db.batch();
            for (let index = offset; index < Math.min(offset + 100, chunkCount); index += 1) {
                batch.set(revisionRef.collection('chunks').doc(trainingPlanRevisionChunkDocumentId('checkpoint-workouts', index)), {
                    schemaVersion: 1, revision: 2, kind: 'checkpoint-workouts', chunkIndex: index,
                    chunkCount, encoding: TRAINING_PLAN_REVISION_CHUNK_ENCODING,
                    payloadBase64: payload.slice(index * TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS,
                        (index + 1) * TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS),
                });
            }
            await batch.commit();
        }

        const request = { mutationId: 'oversized-restore', scope: { kind: 'plan' as const, id: plan.id },
            targetRevision: 2,
            expectedRevisions: [{ scope: 'state' as const, id: 'current', revision: 3 },
                { scope: 'plan' as const, id: plan.id, revision: 3 }] };
        const restoreLockRef = stateRef.collection('planDeletionLocks').doc('_bulk_restore');
        let lostLockResponse = false;
        const interruptBeforeStage = {
            collection: (id: string) => db.collection(id),
            getAll: (...refs: FirebaseFirestore.DocumentReference[]) => db.getAll(...refs),
            runTransaction: async (handler: (transaction: FirebaseFirestore.Transaction) => Promise<unknown>) => {
                const result = await db.runTransaction(handler);
                if (!lostLockResponse && (await restoreLockRef.get()).exists) {
                    lostLockResponse = true;
                    throw new Error('synthetic lost restore lock response');
                }
                return result;
            },
        } as unknown as Firestore;
        await expect(restoreTrainingScheduleRevisionForUser(uid, request, { db: interruptBeforeStage, nowMs: nowMs + 1 }))
            .rejects.toThrow('synthetic lost restore lock response');
        expect(lostLockResponse).toBe(true);
        expect((await stateRef.get()).data()).toMatchObject({ revision: 3 });
        expect((await user.collection('scheduledWorkouts').doc('workout-000').get()).data())
            .toMatchObject({ revision: 3 });
        let interruptedRestore = false;
        const interruptRestore = {
            collection: (id: string) => db.collection(id),
            getAll: (...refs: FirebaseFirestore.DocumentReference[]) => db.getAll(...refs),
            runTransaction: async (handler: (transaction: FirebaseFirestore.Transaction) => Promise<unknown>) => {
                const result = await db.runTransaction(handler);
                const lock = (await restoreLockRef.get()).data();
                if (!interruptedRestore && lock?.phase === 'applying' && lock.nextIndex > 0) {
                    interruptedRestore = true;
                    throw new Error('synthetic lost restore chunk response');
                }
                return result;
            },
        } as unknown as Firestore;
        await expect(restoreTrainingScheduleRevisionForUser(uid, request, { db: interruptRestore, nowMs: nowMs + 1 }))
            .rejects.toThrow('synthetic lost restore chunk response');
        expect(interruptedRestore).toBe(true);
        expect((await stateRef.get()).data()).toMatchObject({ revision: 3 });
        expect((await planRef.get()).data()).toMatchObject({ revision: 3 });
        expect((await user.collection('scheduledWorkouts').doc('workout-000').get()).data())
            .toMatchObject({ revision: 4 });
        expect((await user.collection('scheduledWorkouts').doc('workout-399').get()).data())
            .toMatchObject({ revision: 3 });
        expect((await stateRef.collection('availability').doc('restore').get()).data())
            .toMatchObject({ status: 'restoring' });
        const pendingResponse = (await restoreLockRef.get()).data()?.response;
        expect(pendingResponse?.mutation).toMatchObject({ workouts: [], workoutsDeferred: true });
        expect(Buffer.byteLength(JSON.stringify(pendingResponse), 'utf8')).toBeLessThan(100_000);
        expect((await stateRef.collection('mutationReceipts').doc(request.mutationId).get()).exists).toBe(false);
        const resumeAt = (await restoreLockRef.get()).data()!.nextAttemptAtMs as number;
        const workers = await Promise.all([
            reconcileTrainingBulkShifts(db, resumeAt + 1),
            reconcileTrainingBulkShifts(db, resumeAt + 1),
        ]);
        expect(workers.reduce((total, result) => total + result.completed, 0)).toBe(1);
        const restored = await restoreTrainingScheduleRevisionForUser(uid, request, { db, nowMs: resumeAt + 2 });
        expect(restored.mutation.state.revision).toBe(4);
        expect(restored.mutation.workoutsDeferred).toBe(true);
        expect(restored.mutation.workouts).toEqual([]);
        expect((await stateRef.get()).data()).toMatchObject({ revision: 4 });
        expect((await planRef.get()).data()).toMatchObject({ revision: 4 });
        const restoredWorkout = (await user.collection('scheduledWorkouts').doc('workout-399').get()).data()!;
        expect(restoredWorkout.revision).toBe(4);
        expect((restoredWorkout.structure as { nodes: { id: string }[] }).nodes).toHaveLength(100);
        expect((restoredWorkout.structure as { nodes: { id: string }[] }).nodes[0].id).toBe('step-0');
        expect((await stateRef.collection('mutationReceipts').doc(request.mutationId).get()).exists).toBe(true);
        expect((await restoreLockRef.get()).exists).toBe(false);
        expect((await stateRef.collection('availability').doc('restore').get()).exists).toBe(false);
        const replacementRestore = { ...request, mutationId: 'oversized-restore-retry',
            expectedRevisions: [...request.expectedRevisions].reverse() };
        expect(await restoreTrainingScheduleRevisionForUser(uid, replacementRestore, { db, nowMs: resumeAt + 3 }))
            .toEqual(restored);
        const shift = { mutationId: 'oversized-shift',
            expectedRevisions: [{ scope: 'state' as const, id: 'current', revision: 4 },
                { scope: 'plan' as const, id: plan.id, revision: 4 }],
            operation: { kind: 'shift-plan' as const, planId: plan.id, days: 1 } };
        const pendingRevision = planRef.collection('revisions').doc(trainingScheduleRevisionDocumentId(5));
        let interrupted = false;
        const interruptAfterFirstChunk = {
            collection: (id: string) => db.collection(id),
            runTransaction: async (handler: (transaction: FirebaseFirestore.Transaction) => Promise<unknown>) => {
                const result = await db.runTransaction(handler);
                if (!interrupted && !(await pendingRevision.collection('chunks').limit(1).get()).empty
                    && !(await pendingRevision.get()).exists) {
                    interrupted = true;
                    expect((await stateRef.get()).data()).toMatchObject({ revision: 4 });
                    expect((await planRef.get()).data()).toMatchObject({ revision: 4 });
                    expect((await user.collection('scheduledWorkouts').doc('workout-399').get()).data())
                        .toMatchObject({ localDate: '2026-10-02', revision: 4 });
                    throw new Error('synthetic lost stage response');
                }
                return result;
            },
        } as unknown as Firestore;
        await expect(mutateTrainingScheduleForUser(uid, shift, { db: interruptAfterFirstChunk, nowMs: nowMs + 2 }))
            .rejects.toThrow('synthetic lost stage response');
        expect(interrupted).toBe(true);
        expect((await stateRef.collection('planDeletionLocks').doc('_bulk_shift').get()).exists).toBe(true);
        expect((await pendingRevision.get()).exists).toBe(false);
        await expect(mutateTrainingScheduleForUser(uid, {
            mutationId: 'conflicting-rename', expectedRevisions: shift.expectedRevisions,
            operation: { kind: 'rename-plan', planId: plan.id, name: 'Must not overwrite staged shift' },
        }, { db, nowMs: nowMs + 3 })).rejects.toMatchObject({ code: 'failed-precondition' });
        // Equivalent revision order must not poison the persisted lock's alias validation.
        const resumedShift = { ...shift, mutationId: 'resumed-oversized-shift',
            expectedRevisions: [...shift.expectedRevisions].reverse() };
        let completedElsewhere = false;
        const finishDuringRetry = {
            collection: (id: string) => db.collection(id),
            runTransaction: async (handler: (transaction: FirebaseFirestore.Transaction) => Promise<unknown>) => {
                const result = await db.runTransaction(handler);
                const currentLock = (await stateRef.collection('planDeletionLocks').doc('_bulk_shift').get()).data();
                if (!completedElsewhere && currentLock?.receiptAliases?.some((alias: { mutationId: string }) =>
                    alias.mutationId === resumedShift.mutationId)) {
                    completedElsewhere = true;
                    await stageLargeTrainingPlanShiftForUser(uid, shift, { db, nowMs: nowMs + 4 });
                }
                return result;
            },
        } as unknown as Firestore;
        const shifted = await mutateTrainingScheduleForUser(uid, resumedShift, { db: finishDuringRetry, nowMs: nowMs + 4 });
        expect(completedElsewhere).toBe(true);
        expect(shifted.mutationId).toBe(shift.mutationId);
        expect(shifted.state.revision).toBe(5);
        expect((await stateRef.get()).data()).toMatchObject({ revision: 5 });
        expect((await planRef.get()).data()).toMatchObject({ revision: 5 });
        expect((await user.collection('scheduledWorkouts').doc('workout-399').get()).data())
            .toMatchObject({ localDate: '2026-10-03', revision: 5 });
        expect((await stateRef.collection('mutationReceipts').doc(shift.mutationId).get()).exists).toBe(true);
        expect((await stateRef.collection('mutationReceipts').doc(resumedShift.mutationId).get()).exists).toBe(true);
        expect((await planRef.collection('revisions').doc(trainingScheduleRevisionDocumentId(5)).get()).exists).toBe(true);
        expect((await stateRef.collection('planDeletionLocks').doc('_bulk_shift').get()).exists).toBe(false);
        expect(await mutateTrainingScheduleForUser(uid, shift, { db, nowMs: nowMs + 3 })).toEqual(shifted);
        expect(await mutateTrainingScheduleForUser(uid, resumedShift, { db, nowMs: nowMs + 5 })).toEqual(shifted);
        const lateRetry = { ...shift, mutationId: 'late-oversized-shift',
            expectedRevisions: [...shift.expectedRevisions].reverse() };
        expect(await mutateTrainingScheduleForUser(uid, lateRetry, { db, nowMs: nowMs + 6 })).toEqual(shifted);
        expect((await stateRef.collection('mutationReceipts').doc(lateRetry.mutationId).get()).data())
            .toMatchObject({ response: shifted });
        expect((await stateRef.get()).data()).toMatchObject({ revision: 5 });
        await expect(mutateTrainingScheduleForUser(uid, {
            ...lateRetry, operation: { ...lateRetry.operation, days: 2 },
        }, { db, nowMs: nowMs + 7 })).rejects.toMatchObject({ code: 'failed-precondition' });
        await expect(mutateTrainingScheduleForUser(uid, {
            ...shift, mutationId: 'stale-different-shift', operation: { ...shift.operation, days: 2 },
        }, { db, nowMs: nowMs + 8 })).rejects.toMatchObject({ code: 'revision-conflict' });
        expect((await stateRef.collection('planDeletionLocks').doc('_bulk_shift').get()).exists).toBe(false);
    });
});
