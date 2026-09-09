import {
    TRAINING_PLAN_MAX_CURRENT_WORKOUTS,
    TRAINING_PLAN_SCHEMA_VERSION,
    addDaysToTrainingLocalDate,
    extendTrainingPlanRangeToDate,
    isTrainingLocalDateWithinPlan,
    parseScheduledWorkoutV1,
    parseTrainingPlanStateV1,
    parseTrainingPlanV1,
    shouldCheckpointTrainingPlanRevision,
    type ExpectedTrainingScheduleRevision,
    type MutateTrainingScheduleRequestV1,
    type MutateTrainingScheduleResponseV1,
    type ScheduledWorkoutV1,
    type TrainingPlanStateV1,
    type TrainingPlanV1,
} from '../../../shared/training-plans';

export type TrainingScheduleMutationErrorCode =
    | 'not-found'
    | 'already-exists'
    | 'revision-conflict'
    | 'failed-precondition'
    | 'range-extension-required'
    | 'limit-exceeded';

export class TrainingScheduleMutationError extends Error {
    constructor(
        public readonly code: TrainingScheduleMutationErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'TrainingScheduleMutationError';
    }
}

export interface TrainingScheduleSnapshotV1 {
    state: TrainingPlanStateV1;
    plans: Map<string, TrainingPlanV1>;
    workouts: Map<string, ScheduledWorkoutV1>;
}

export interface AppliedTrainingScheduleMutationV1 {
    response: MutateTrainingScheduleResponseV1;
    before: TrainingScheduleSnapshotV1;
    after: TrainingScheduleSnapshotV1;
    affectedPlanIds: string[];
    changedWorkoutIds: string[];
    permanentlyDeletedWorkoutIds: string[];
    bulkOperation: boolean;
}

export function createEmptyTrainingPlanState(nowMs = 0): TrainingPlanStateV1 {
    return {
        schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
        activePlanId: null,
        revision: 0,
        currentWorkoutCount: 0,
        updatedAtMs: nowMs,
    };
}

function cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneTrainingScheduleSnapshot(snapshot: TrainingScheduleSnapshotV1): TrainingScheduleSnapshotV1 {
    return {
        state: cloneValue(snapshot.state),
        plans: new Map([...snapshot.plans].map(([id, plan]) => [id, cloneValue(plan)])),
        workouts: new Map([...snapshot.workouts].map(([id, workout]) => [id, cloneValue(workout)])),
    };
}

function expectedRevisionMap(expected: readonly ExpectedTrainingScheduleRevision[]): Map<string, number> {
    return new Map(expected.map(item => [`${item.scope}:${item.id}`, item.revision]));
}

function requireExpectedRevision(
    expected: Map<string, number>,
    scope: ExpectedTrainingScheduleRevision['scope'],
    id: string,
    actualRevision: number,
): void {
    const key = `${scope}:${id}`;
    if (!expected.has(key)) {
        throw new TrainingScheduleMutationError(
            'revision-conflict',
            `The current ${scope} revision is required before changing ${id}.`,
        );
    }
    if (expected.get(key) !== actualRevision) {
        throw new TrainingScheduleMutationError(
            'revision-conflict',
            `${scope} ${id} changed from revision ${expected.get(key)} to ${actualRevision}.`,
        );
    }
}

function currentWorkoutCount(workouts: Map<string, ScheduledWorkoutV1>): number {
    return [...workouts.values()].filter(workout => workout.lifecycle !== 'deleted').length;
}

function planWorkoutCount(workouts: Map<string, ScheduledWorkoutV1>, planId: string): number {
    return [...workouts.values()].filter(workout => (
        workout.planId === planId && workout.lifecycle !== 'deleted'
    )).length;
}

function getPlan(plans: Map<string, TrainingPlanV1>, planId: string): TrainingPlanV1 {
    const plan = plans.get(planId);
    if (!plan) throw new TrainingScheduleMutationError('not-found', `Training plan ${planId} was not found.`);
    return plan;
}

function getWorkout(workouts: Map<string, ScheduledWorkoutV1>, workoutId: string): ScheduledWorkoutV1 {
    const workout = workouts.get(workoutId);
    if (!workout) throw new TrainingScheduleMutationError('not-found', `Scheduled workout ${workoutId} was not found.`);
    return workout;
}

function requireCurrentWorkout(workouts: Map<string, ScheduledWorkoutV1>, workoutId: string): ScheduledWorkoutV1 {
    const workout = getWorkout(workouts, workoutId);
    if (workout.lifecycle === 'deleted') {
        throw new TrainingScheduleMutationError('failed-precondition', 'Restore the workout before changing it.');
    }
    return workout;
}

function enforceDestinationRange(
    plan: TrainingPlanV1,
    localDate: string,
    confirmed: boolean,
): void {
    if (isTrainingLocalDateWithinPlan(localDate, plan)) return;
    if (!confirmed) {
        throw new TrainingScheduleMutationError(
            'range-extension-required',
            `Moving this workout requires extending ${plan.name} to include ${localDate}.`,
        );
    }
    Object.assign(plan, extendTrainingPlanRangeToDate(plan, localDate));
}

function sortPlans(plans: TrainingPlanV1[]): TrainingPlanV1[] {
    return [...plans].sort((left, right) => (
        left.startLocalDate.localeCompare(right.startLocalDate)
        || left.name.localeCompare(right.name)
        || left.id.localeCompare(right.id)
    ));
}

function sortWorkouts(workouts: ScheduledWorkoutV1[]): ScheduledWorkoutV1[] {
    return [...workouts].sort((left, right) => (
        left.localDate.localeCompare(right.localDate)
        || left.title.localeCompare(right.title)
        || left.id.localeCompare(right.id)
    ));
}

export function applyTrainingScheduleMutation(
    snapshotInput: TrainingScheduleSnapshotV1,
    request: MutateTrainingScheduleRequestV1,
    nowMs: number,
): AppliedTrainingScheduleMutationV1 {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
        throw new TypeError('nowMs must be a non-negative safe integer.');
    }

    const before = cloneTrainingScheduleSnapshot(snapshotInput);
    const after = cloneTrainingScheduleSnapshot(snapshotInput);
    const expected = expectedRevisionMap(request.expectedRevisions);
    const affectedPlanIds = new Set<string>();
    const changedWorkoutIds = new Set<string>();
    const permanentlyDeletedWorkoutIds = new Set<string>();
    let bulkOperation = false;

    requireExpectedRevision(expected, 'state', 'current', before.state.revision);

    const expectPlan = (planId: string): TrainingPlanV1 => {
        const plan = getPlan(after.plans, planId);
        requireExpectedRevision(expected, 'plan', planId, before.plans.get(planId)!.revision);
        return plan;
    };
    const expectWorkout = (workoutId: string, allowDeleted = false): ScheduledWorkoutV1 => {
        const workout = allowDeleted
            ? getWorkout(after.workouts, workoutId)
            : requireCurrentWorkout(after.workouts, workoutId);
        requireExpectedRevision(expected, 'workout', workoutId, before.workouts.get(workoutId)!.revision);
        return workout;
    };
    const affectPlan = (planId: string | null): void => {
        if (planId) affectedPlanIds.add(planId);
    };
    const changeWorkout = (workoutId: string): void => {
        changedWorkoutIds.add(workoutId);
    };
    const activatePlan = (planId: string): void => {
        const target = expectPlan(planId);
        if (after.state.activePlanId && after.state.activePlanId !== planId) {
            const previous = expectPlan(after.state.activePlanId);
            previous.lifecycle = 'paused';
            affectedPlanIds.add(previous.id);
        }
        target.lifecycle = 'active';
        after.state.activePlanId = planId;
        affectedPlanIds.add(planId);
    };

    const operation = request.operation;
    switch (operation.kind) {
        case 'create-plan': {
            if (after.plans.has(operation.planId)) {
                throw new TrainingScheduleMutationError('already-exists', `Training plan ${operation.planId} already exists.`);
            }
            if (operation.activate && after.state.activePlanId) {
                const previous = expectPlan(after.state.activePlanId);
                previous.lifecycle = 'paused';
                affectedPlanIds.add(previous.id);
            }
            const plan: TrainingPlanV1 = {
                schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
                id: operation.planId,
                name: operation.name,
                lifecycle: operation.activate ? 'active' : 'paused',
                startLocalDate: operation.startLocalDate,
                endLocalDate: operation.endLocalDate,
                revision: 1,
                lastCheckpointRevision: 1,
                workoutCount: 0,
                createdAtMs: nowMs,
                updatedAtMs: nowMs,
            };
            after.plans.set(plan.id, plan);
            affectedPlanIds.add(plan.id);
            if (operation.activate) after.state.activePlanId = plan.id;
            break;
        }
        case 'rename-plan': {
            const plan = expectPlan(operation.planId);
            plan.name = operation.name;
            affectedPlanIds.add(plan.id);
            break;
        }
        case 'set-plan-lifecycle': {
            if (operation.lifecycle === 'active') {
                activatePlan(operation.planId);
                break;
            }
            const plan = expectPlan(operation.planId);
            plan.lifecycle = operation.lifecycle;
            affectedPlanIds.add(plan.id);
            if (after.state.activePlanId === plan.id) after.state.activePlanId = null;
            break;
        }
        case 'shift-plan': {
            const plan = expectPlan(operation.planId);
            plan.startLocalDate = addDaysToTrainingLocalDate(plan.startLocalDate, operation.days);
            plan.endLocalDate = addDaysToTrainingLocalDate(plan.endLocalDate, operation.days);
            affectedPlanIds.add(plan.id);
            for (const workout of after.workouts.values()) {
                if (workout.planId !== plan.id || workout.lifecycle === 'deleted') continue;
                workout.localDate = addDaysToTrainingLocalDate(workout.localDate, operation.days);
                changeWorkout(workout.id);
            }
            bulkOperation = true;
            break;
        }
        case 'create-workout': {
            if (after.workouts.has(operation.workoutId)) {
                throw new TrainingScheduleMutationError('already-exists', `Scheduled workout ${operation.workoutId} already exists.`);
            }
            if (currentWorkoutCount(after.workouts) >= TRAINING_PLAN_MAX_CURRENT_WORKOUTS) {
                throw new TrainingScheduleMutationError(
                    'limit-exceeded',
                    `An account may contain at most ${TRAINING_PLAN_MAX_CURRENT_WORKOUTS} current workouts.`,
                );
            }
            if (operation.planId) {
                const plan = expectPlan(operation.planId);
                enforceDestinationRange(plan, operation.localDate, operation.confirmPlanRangeExtension);
                affectedPlanIds.add(plan.id);
            }
            after.workouts.set(operation.workoutId, {
                schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
                id: operation.workoutId,
                planId: operation.planId,
                localDate: operation.localDate,
                lifecycle: 'planned',
                title: operation.title,
                structure: cloneValue(operation.structure),
                revision: 1,
                createdAtMs: nowMs,
                updatedAtMs: nowMs,
            });
            changeWorkout(operation.workoutId);
            break;
        }
        case 'update-workout': {
            const workout = expectWorkout(operation.workoutId);
            const sourcePlanId = workout.planId;
            if (sourcePlanId) expectPlan(sourcePlanId);
            if (operation.planId) {
                const destination = expectPlan(operation.planId);
                enforceDestinationRange(destination, operation.localDate, operation.confirmPlanRangeExtension);
            }
            workout.planId = operation.planId;
            workout.localDate = operation.localDate;
            workout.title = operation.title;
            workout.structure = cloneValue(operation.structure);
            affectPlan(sourcePlanId);
            affectPlan(operation.planId);
            changeWorkout(workout.id);
            break;
        }
        case 'move-workout': {
            const workout = expectWorkout(operation.workoutId);
            const sourcePlanId = workout.planId;
            if (sourcePlanId) expectPlan(sourcePlanId);
            if (operation.planId && operation.planId !== sourcePlanId) {
                const destination = expectPlan(operation.planId);
                enforceDestinationRange(destination, operation.localDate, operation.confirmPlanRangeExtension);
            } else if (operation.planId) {
                const destination = getPlan(after.plans, operation.planId);
                enforceDestinationRange(destination, operation.localDate, operation.confirmPlanRangeExtension);
            }
            workout.planId = operation.planId;
            workout.localDate = operation.localDate;
            affectPlan(sourcePlanId);
            affectPlan(operation.planId);
            changeWorkout(workout.id);
            break;
        }
        case 'copy-workout': {
            const source = expectWorkout(operation.sourceWorkoutId);
            if (after.workouts.has(operation.workoutId)) {
                throw new TrainingScheduleMutationError('already-exists', `Scheduled workout ${operation.workoutId} already exists.`);
            }
            if (currentWorkoutCount(after.workouts) >= TRAINING_PLAN_MAX_CURRENT_WORKOUTS) {
                throw new TrainingScheduleMutationError(
                    'limit-exceeded',
                    `An account may contain at most ${TRAINING_PLAN_MAX_CURRENT_WORKOUTS} current workouts.`,
                );
            }
            if (operation.planId) {
                const plan = expectPlan(operation.planId);
                enforceDestinationRange(plan, operation.localDate, operation.confirmPlanRangeExtension);
                affectPlan(plan.id);
            }
            after.workouts.set(operation.workoutId, {
                ...cloneValue(source),
                id: operation.workoutId,
                planId: operation.planId,
                localDate: operation.localDate,
                lifecycle: 'planned',
                revision: 1,
                createdAtMs: nowMs,
                updatedAtMs: nowMs,
            });
            changeWorkout(operation.workoutId);
            break;
        }
        case 'set-workout-lifecycle': {
            const workout = expectWorkout(operation.workoutId);
            workout.lifecycle = operation.lifecycle;
            if (workout.planId) expectPlan(workout.planId);
            affectPlan(workout.planId);
            changeWorkout(workout.id);
            break;
        }
        case 'delete-workout': {
            const workout = expectWorkout(operation.workoutId);
            workout.lifecycle = 'deleted';
            workout.deletedAtMs = nowMs;
            if (workout.planId) expectPlan(workout.planId);
            affectPlan(workout.planId);
            changeWorkout(workout.id);
            break;
        }
        case 'permanently-delete-workout': {
            const workout = expectWorkout(operation.workoutId, true);
            if (workout.lifecycle !== 'deleted') {
                throw new TrainingScheduleMutationError(
                    'failed-precondition',
                    'Delete the workout before permanently deleting its history.',
                );
            }
            if (workout.planId) expectPlan(workout.planId);
            affectPlan(workout.planId);
            // Plan history must record that this retained root became
            // unavailable. The persisted plan delta keeps the before snapshot
            // and an explicit null after value, while the root and its nested
            // standalone history are removed below.
            changeWorkout(workout.id);
            after.workouts.delete(workout.id);
            permanentlyDeletedWorkoutIds.add(workout.id);
            break;
        }
    }

    for (const workoutId of changedWorkoutIds) {
        const workout = after.workouts.get(workoutId);
        const previous = before.workouts.get(workoutId);
        if (!workout) continue;
        if (previous) {
            workout.revision = previous.revision + 1;
            workout.createdAtMs = previous.createdAtMs;
        }
        workout.updatedAtMs = nowMs;
        after.workouts.set(workout.id, parseScheduledWorkoutV1(workout));
    }

    for (const planId of affectedPlanIds) {
        const plan = getPlan(after.plans, planId);
        const previous = before.plans.get(planId);
        if (previous) {
            plan.revision = previous.revision + 1;
            plan.createdAtMs = previous.createdAtMs;
        }
        plan.workoutCount = planWorkoutCount(after.workouts, planId);
        plan.updatedAtMs = nowMs;
        if (shouldCheckpointTrainingPlanRevision(plan.revision, bulkOperation)) {
            plan.lastCheckpointRevision = plan.revision;
        } else if (previous) {
            plan.lastCheckpointRevision = previous.lastCheckpointRevision;
        }
        after.plans.set(plan.id, parseTrainingPlanV1(plan));
    }

    after.state = parseTrainingPlanStateV1({
        ...after.state,
        schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
        revision: before.state.revision + 1,
        currentWorkoutCount: currentWorkoutCount(after.workouts),
        updatedAtMs: nowMs,
    });

    const changedPlans = [...affectedPlanIds].map(planId => cloneValue(getPlan(after.plans, planId)));
    // Bulk operations are observed through the current-data listeners. Keeping
    // hundreds of full workout structures out of the callable response also
    // keeps the idempotency receipt safely below Firestore's document limit.
    const changedWorkouts = bulkOperation
        ? []
        : [...changedWorkoutIds]
            .map(workoutId => after.workouts.get(workoutId))
            .filter((workout): workout is ScheduledWorkoutV1 => Boolean(workout))
            .map(cloneValue);
    const permanentlyDeleted = [...permanentlyDeletedWorkoutIds];

    return {
        response: {
            mutationId: request.mutationId,
            state: cloneValue(after.state),
            plans: sortPlans(changedPlans),
            workouts: sortWorkouts(changedWorkouts),
            removedPlanIds: [],
            permanentlyDeletedWorkoutIds: permanentlyDeleted,
        },
        before,
        after,
        affectedPlanIds: [...affectedPlanIds],
        changedWorkoutIds: [...changedWorkoutIds],
        permanentlyDeletedWorkoutIds: permanentlyDeleted,
        bulkOperation,
    };
}
