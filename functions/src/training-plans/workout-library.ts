import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
    WORKOUT_LIBRARY_COLLECTION_ID,
    WORKOUT_LIBRARY_MAX_ITEMS,
    WORKOUT_LIBRARY_SCHEMA_VERSION,
    parseWorkoutLibraryItemV1,
    parseWorkoutLibraryPrescription,
    type MutateWorkoutLibraryRequestV1,
    type MutateWorkoutLibraryResponseV1,
    type PlaceWorkoutLibraryRequestV1,
    type PlaceWorkoutLibraryResponseV1,
    type WorkoutLibraryItemV1,
} from '../../../shared/workout-library';
import {
    SCHEDULED_WORKOUTS_COLLECTION_ID,
    parseScheduledWorkoutV1,
    type MutateTrainingScheduleRequestV1,
} from '../../../shared/training-plans';
import {
    STRENGTH_DETAILS_COLLECTION_ID,
    STRENGTH_DETAILS_DOCUMENT_ID,
    parseStrengthWorkoutDetailsV1,
} from '../../../shared/strength-workout';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { TrainingScheduleMutationError } from './mutation';
import { mutateTrainingScheduleForUser, TrainingScheduleOversizedMutationError } from './persistence';

const LIBRARY_RECEIPTS = 'workoutLibraryMutationReceipts';
const PLACEMENT_RECEIPTS = 'workoutLibraryPlacementReceipts';
const LIBRARY_TOMBSTONES = 'workoutLibraryTombstones';

function hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sameRequest(snapshot: admin.firestore.DocumentSnapshot, requestHash: string): void {
    if (snapshot.data()?.requestHash !== requestHash) {
        throw new TrainingScheduleMutationError('failed-precondition', 'This mutation ID was used for a different request.');
    }
}

export async function mutateWorkoutLibraryForUser(
    uid: string,
    request: MutateWorkoutLibraryRequestV1,
    options: { db?: admin.firestore.Firestore; nowMs?: number } = {},
): Promise<MutateWorkoutLibraryResponseV1> {
    const db = options.db ?? admin.firestore();
    const nowMs = options.nowMs ?? Date.now();
    const user = db.collection('users').doc(uid);
    const library = user.collection(WORKOUT_LIBRARY_COLLECTION_ID);
    const itemRef = library.doc(request.operation.itemId);
    const state = user.collection('trainingPlanState').doc('current');
    const receiptRef = state.collection(LIBRARY_RECEIPTS).doc(request.mutationId);
    const libraryStateRef = state.collection('workoutLibraryState').doc('current');
    const tombstoneRef = state.collection(LIBRARY_TOMBSTONES).doc(request.operation.itemId);
    const requestHash = hash(request);
    return db.runTransaction(async transaction => {
        const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (guard.shouldSkip) throw new TrainingScheduleMutationError('failed-precondition', 'This account is unavailable.');
        const receipt = await transaction.get(receiptRef);
        if (receipt.exists) {
            sameRequest(receipt, requestHash);
            const response = receipt.data()?.response as MutateWorkoutLibraryResponseV1;
            return { mutationId: request.mutationId,
                item: response.item === null ? null : parseWorkoutLibraryItemV1(response.item) };
        }
        const [itemSnapshot, libraryStateSnapshot] = await Promise.all([
            transaction.get(itemRef), transaction.get(libraryStateRef),
        ]);
        const operation = request.operation;
        let item: WorkoutLibraryItemV1 | null = null;
        if (operation.kind === 'create' || operation.kind === 'save-workout' || operation.kind === 'copy') {
            const [tombstone, allItems] = await Promise.all([
                transaction.get(tombstoneRef), transaction.get(library.limit(WORKOUT_LIBRARY_MAX_ITEMS)),
            ]);
            if (itemSnapshot.exists || tombstone.exists) {
                throw new TrainingScheduleMutationError('already-exists', 'This library ID is already in use.');
            }
            if (allItems.size >= WORKOUT_LIBRARY_MAX_ITEMS) {
                throw new TrainingScheduleMutationError('limit-exceeded', 'The workout library has reached 200 entries.');
            }
            let prescription;
            if (operation.kind === 'create') {
                prescription = parseWorkoutLibraryPrescription(operation.title, operation.structure, operation.strength);
            } else if (operation.kind === 'copy') {
                const source = await transaction.get(library.doc(operation.sourceItemId));
                if (!source.exists) throw new TrainingScheduleMutationError('not-found', 'The saved workout no longer exists.');
                const previous = parseWorkoutLibraryItemV1(source.data());
                if (previous.id !== operation.sourceItemId || previous.revision !== operation.expectedSourceRevision) {
                    throw new TrainingScheduleMutationError('revision-conflict', 'The saved workout changed. Reload it first.');
                }
                prescription = parseWorkoutLibraryPrescription(`${previous.title.slice(0, 115)} copy`,
                    previous.structure, previous.strength);
            } else {
                const source = await transaction.get(user.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(operation.sourceWorkoutId));
                if (!source.exists) throw new TrainingScheduleMutationError('not-found', 'The source workout no longer exists.');
                const workout = parseScheduledWorkoutV1(source.data());
                if (workout.id !== operation.sourceWorkoutId || workout.lifecycle === 'deleted') {
                    throw new TrainingScheduleMutationError('not-found', 'The source workout no longer exists.');
                }
                if (workout.revision !== operation.expectedSourceRevision) {
                    throw new TrainingScheduleMutationError('revision-conflict', 'The source workout changed. Reload it first.');
                }
                let strength;
                if (workout.structure.sport === ActivityTypes.StrengthTraining) {
                    const details = await transaction.get(source.ref.collection(STRENGTH_DETAILS_COLLECTION_ID)
                        .doc(STRENGTH_DETAILS_DOCUMENT_ID));
                    if (!details.exists) throw new TrainingScheduleMutationError('failed-precondition', 'Strength details are missing.');
                    const parsed = parseStrengthWorkoutDetailsV1(details.data());
                    if (parsed.workoutId !== workout.id || parsed.revision !== workout.revision) {
                        throw new TrainingScheduleMutationError('failed-precondition', 'Strength details do not match the workout.');
                    }
                    strength = { version: parsed.version, exercises: parsed.exercises } as const;
                }
                prescription = parseWorkoutLibraryPrescription(workout.title, workout.structure, strength);
            }
            item = { schemaVersion: WORKOUT_LIBRARY_SCHEMA_VERSION, id: operation.itemId, ...prescription,
                status: 'active', revision: 1, createdAtMs: nowMs, updatedAtMs: nowMs };
            transaction.create(itemRef, item);
        } else {
            if (!itemSnapshot.exists) throw new TrainingScheduleMutationError('not-found', 'The library workout no longer exists.');
            const previous = parseWorkoutLibraryItemV1(itemSnapshot.data());
            if (previous.id !== operation.itemId) throw new Error('Workout library document ID mismatch.');
            if (previous.revision !== operation.expectedRevision) {
                throw new TrainingScheduleMutationError('revision-conflict', 'This library workout changed. Reload it first.');
            }
            if (operation.kind === 'delete') {
                transaction.delete(itemRef);
                transaction.create(tombstoneRef, { deletedAtMs: nowMs });
            } else {
                const changes = operation.kind === 'update'
                    ? parseWorkoutLibraryPrescription(operation.title, operation.structure, operation.strength)
                    : { status: operation.status };
                const { strength: _oldStrength, ...previousWithoutStrength } = previous;
                item = parseWorkoutLibraryItemV1({ ...previousWithoutStrength,
                    ...(operation.kind === 'update' ? changes : { ...changes, ...(_oldStrength ? { strength: _oldStrength } : {}) }),
                    revision: previous.revision + 1,
                    updatedAtMs: nowMs });
                transaction.set(itemRef, item);
            }
        }
        const response: MutateWorkoutLibraryResponseV1 = { mutationId: request.mutationId, item };
        const priorRevision = libraryStateSnapshot.exists ? libraryStateSnapshot.get('revision') : 0;
        if (!Number.isSafeInteger(priorRevision) || priorRevision < 0) throw new Error('Invalid workout library state.');
        transaction.set(libraryStateRef, { revision: priorRevision + 1, updatedAtMs: nowMs });
        transaction.create(receiptRef, { requestHash, response, createdAtMs: nowMs });
        return response;
    });
}

export async function placeWorkoutLibraryForUser(
    uid: string,
    request: PlaceWorkoutLibraryRequestV1,
    options: { db?: admin.firestore.Firestore; nowMs?: number } = {},
): Promise<PlaceWorkoutLibraryResponseV1> {
    const db = options.db ?? admin.firestore();
    const nowMs = options.nowMs ?? Date.now();
    const user = db.collection('users').doc(uid);
    const state = user.collection('trainingPlanState').doc('current');
    const itemRef = user.collection(WORKOUT_LIBRARY_COLLECTION_ID).doc(request.itemId);
    const receiptRef = state.collection(PLACEMENT_RECEIPTS).doc(request.mutationId);
    const requestHash = hash(request);
    const guard = await getUserDeletionGuardState(db, uid, nowMs);
    if (guard.shouldSkip) throw new TrainingScheduleMutationError('failed-precondition', 'This account is unavailable.');
    const previousReceipt = await receiptRef.get();
    if (previousReceipt.exists) {
        sameRequest(previousReceipt, requestHash);
        return previousReceipt.data()?.response as PlaceWorkoutLibraryResponseV1;
    }
    const itemSnapshot = await itemRef.get();
    if (!itemSnapshot.exists) throw new TrainingScheduleMutationError('not-found', 'The library workout no longer exists.');
    const item = parseWorkoutLibraryItemV1(itemSnapshot.data());
    if (item.id !== request.itemId || item.status !== 'active' || item.revision !== request.expectedTemplateRevision) {
        throw new TrainingScheduleMutationError('revision-conflict', 'The library workout changed. Reload it first.');
    }
    const placements = request.dates.map((localDate, index) => ({
        localDate,
        workoutId: `lib-${createHash('sha256').update(`${request.mutationId}:${index}`).digest('hex').slice(0, 32)}`,
    }));
    const scheduleRequest: MutateTrainingScheduleRequestV1 = {
        mutationId: request.mutationId,
        expectedRevisions: [{ scope: 'state', id: 'current', revision: request.expectedStateRevision },
            ...(request.planId === null ? [] as const : [{ scope: 'plan' as const, id: request.planId,
                revision: request.expectedPlanRevision! }])],
        operation: { kind: 'bulk-create-workouts', planId: request.planId, placements,
            title: item.title, structure: item.structure, ...(item.strength ? { strength: item.strength } : {}),
            templateOrigin: { itemId: item.id, revision: item.revision },
            confirmPlanRangeExtension: request.confirmPlanRangeExtension },
    };
    let placementReceiptExists = false;
    let response;
    try {
        response = await mutateTrainingScheduleForUser(uid, scheduleRequest, {
            db, nowMs, additionalWriteBudget: 1,
            transactionPrecondition: async transaction => {
                const [receipt, current] = await Promise.all([transaction.get(receiptRef), transaction.get(itemRef)]);
                placementReceiptExists = receipt.exists;
                if (receipt.exists) {
                    sameRequest(receipt, requestHash);
                    return;
                }
                if (!current.exists) throw new TrainingScheduleMutationError('not-found', 'The library workout no longer exists.');
                const fresh = parseWorkoutLibraryItemV1(current.data());
                if (fresh.id !== item.id || fresh.status !== 'active' || fresh.revision !== item.revision
                    || hash(fresh) !== hash(item)) {
                    throw new TrainingScheduleMutationError('revision-conflict', 'The library workout changed. Reload it first.');
                }
            },
            transactionPostcondition: (transaction, responses) => {
                if (placementReceiptExists) return;
                const result = responses[0];
                const placed: PlaceWorkoutLibraryResponseV1 = { mutationId: request.mutationId,
                    workoutIds: placements.map(value => value.workoutId), dates: request.dates,
                    stateRevision: result.state.revision,
                    planRevision: request.planId === null ? null
                        : (result.plans.find(plan => plan.id === request.planId)?.revision ?? null) };
                transaction.create(receiptRef, { requestHash, response: placed, createdAtMs: nowMs });
            },
        });
    } catch (error) {
        if (error instanceof TrainingScheduleOversizedMutationError) {
            throw new TrainingScheduleMutationError('limit-exceeded',
                'This placement is too large for one save. Choose fewer dates and try again. No workouts were added.');
        }
        throw error;
    }
    return { mutationId: request.mutationId, workoutIds: placements.map(value => value.workoutId),
        dates: request.dates, stateRevision: response.state.revision,
        planRevision: request.planId === null ? null
            : (response.plans.find(plan => plan.id === request.planId)?.revision ?? null) };
}
