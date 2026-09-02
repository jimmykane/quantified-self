import * as admin from 'firebase-admin';
import { gunzipSync } from 'node:zlib';
import {
    SCHEDULED_WORKOUTS_COLLECTION_ID,
    TRAINING_PLAN_REVISIONS_COLLECTION_ID,
    TRAINING_PLAN_SCHEMA_VERSION,
    TRAINING_PLAN_MAX_CURRENT_WORKOUTS,
    TRAINING_PLANS_COLLECTION_ID,
    TrainingPlanContractError,
    parseScheduledWorkoutV1,
    parseTrainingPlanV1,
    type PreviewTrainingScheduleRestoreRequestV1,
    type ScheduledWorkoutV1,
    type TrainingPlanV1,
    type TrainingScheduleHistoryRequestV1,
    type TrainingScheduleHistoryResponseV1,
    type TrainingScheduleRestorePreviewV1,
} from '../../../shared/training-plans';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { TrainingScheduleMutationError } from './mutation';
import {
    TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID,
    TRAINING_PLAN_REVISION_CHUNK_ENCODING,
    TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS,
    TRAINING_PLAN_REVISION_MAX_CHUNKS,
    type StandaloneWorkoutRevisionDocumentV1,
    type TrainingPlanRevisionChunkKindV1,
    type TrainingPlanRevisionDocumentV1,
    type TrainingPlanWorkoutDeltaV1,
    trainingPlanRevisionChunkDocumentId,
    trainingScheduleRevisionDocumentId,
} from './persistence';

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

export interface ReconstructedTrainingPlanRevisionV1 {
    plan: TrainingPlanV1;
    workouts: Map<string, ScheduledWorkoutV1>;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TrainingPlanContractError(path, 'Expected an object.');
    }
    return value as Record<string, unknown>;
}

function rejectUnknownFields(record: Record<string, unknown>, allowed: readonly string[], path: string): void {
    const unknown = Object.keys(record).find(field => !allowed.includes(field));
    if (unknown) throw new TrainingPlanContractError(`${path}.${unknown}`, 'Unknown field.');
}

function readPositiveInteger(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) {
        throw new TrainingPlanContractError(path, 'Expected a positive integer.');
    }
    return value as number;
}

function readNonNegativeInteger(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new TrainingPlanContractError(path, 'Expected a non-negative integer.');
    }
    return value as number;
}

function readScope(value: unknown, path: string): TrainingScheduleHistoryRequestV1['scope'] {
    const record = asRecord(value, path);
    rejectUnknownFields(record, ['kind', 'id'], path);
    if (record.kind !== 'plan' && record.kind !== 'workout') {
        throw new TrainingPlanContractError(`${path}.kind`, 'Expected plan or workout.');
    }
    if (typeof record.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(record.id)) {
        throw new TrainingPlanContractError(`${path}.id`, 'Expected a Firestore-safe ID.');
    }
    return { kind: record.kind, id: record.id };
}

export function parseTrainingScheduleHistoryRequest(value: unknown): TrainingScheduleHistoryRequestV1 {
    const record = asRecord(value, '$');
    rejectUnknownFields(record, ['scope', 'beforeRevision', 'limit'], '$');
    const beforeRevision = record.beforeRevision === undefined
        ? undefined
        : readPositiveInteger(record.beforeRevision, '$.beforeRevision');
    const limit = record.limit === undefined ? DEFAULT_HISTORY_LIMIT : readPositiveInteger(record.limit, '$.limit');
    if (limit > MAX_HISTORY_LIMIT) {
        throw new TrainingPlanContractError('$.limit', `History pages may contain at most ${MAX_HISTORY_LIMIT} entries.`);
    }
    return {
        scope: readScope(record.scope, '$.scope'),
        ...(beforeRevision === undefined ? {} : { beforeRevision }),
        limit,
    };
}

export function parsePreviewTrainingScheduleRestoreRequest(value: unknown): PreviewTrainingScheduleRestoreRequestV1 {
    const record = asRecord(value, '$');
    rejectUnknownFields(record, ['scope', 'targetRevision'], '$');
    return {
        scope: readScope(record.scope, '$.scope'),
        targetRevision: readPositiveInteger(record.targetRevision, '$.targetRevision'),
    };
}

function documentData(snapshot: admin.firestore.DocumentSnapshot): Record<string, unknown> {
    return (snapshot.data() ?? {}) as Record<string, unknown>;
}

function parsePlanRevision(value: unknown): TrainingPlanRevisionDocumentV1 {
    const record = asRecord(value, '$revision');
    rejectUnknownFields(record, [
        'schemaVersion', 'revision', 'mutationId', 'operationKind', 'createdAtMs',
        'checkpointRevision', 'delta', 'checkpoint',
    ], '$revision');
    if (record.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION) throw new Error('Unsupported plan revision schema.');
    const revision = readPositiveInteger(record.revision, '$revision.revision');
    const checkpointRevision = readPositiveInteger(record.checkpointRevision, '$revision.checkpointRevision');
    if (checkpointRevision > revision) throw new Error('Invalid checkpoint revision.');
    if (typeof record.mutationId !== 'string' || typeof record.operationKind !== 'string') {
        throw new Error('Invalid plan revision identity.');
    }
    if (!Number.isSafeInteger(record.createdAtMs) || (record.createdAtMs as number) < 0) {
        throw new Error('Invalid plan revision timestamp.');
    }
    const delta = asRecord(record.delta, '$revision.delta');
    rejectUnknownFields(delta, [
        'planBefore', 'planAfter', 'workoutCount', 'workoutChunkCount', 'workoutEncoding',
    ], '$revision.delta');
    const workoutCount = readNonNegativeInteger(delta.workoutCount, '$revision.delta.workoutCount');
    const workoutChunkCount = readNonNegativeInteger(
        delta.workoutChunkCount,
        '$revision.delta.workoutChunkCount',
    );
    if (delta.workoutEncoding !== TRAINING_PLAN_REVISION_CHUNK_ENCODING) {
        throw new Error('Unsupported plan workout-delta encoding.');
    }
    if ((workoutCount === 0) !== (workoutChunkCount === 0)) {
        throw new Error('Invalid plan workout-delta chunk counts.');
    }
    if (
        workoutCount > TRAINING_PLAN_MAX_CURRENT_WORKOUTS * 2
        || workoutChunkCount > TRAINING_PLAN_REVISION_MAX_CHUNKS
    ) {
        throw new Error('Plan workout-delta limits were exceeded.');
    }
    const parsed: TrainingPlanRevisionDocumentV1 = {
        schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
        revision,
        mutationId: record.mutationId,
        operationKind: record.operationKind,
        createdAtMs: record.createdAtMs as number,
        checkpointRevision,
        delta: {
            planBefore: delta.planBefore === null ? null : parseTrainingPlanV1(delta.planBefore),
            planAfter: parseTrainingPlanV1(delta.planAfter),
            workoutCount,
            workoutChunkCount,
            workoutEncoding: TRAINING_PLAN_REVISION_CHUNK_ENCODING,
        },
    };
    if (record.checkpoint !== undefined) {
        const checkpoint = asRecord(record.checkpoint, '$revision.checkpoint');
        rejectUnknownFields(checkpoint, [
            'plan', 'workoutCount', 'workoutChunkCount', 'workoutEncoding',
        ], '$revision.checkpoint');
        const checkpointWorkoutCount = readNonNegativeInteger(
            checkpoint.workoutCount,
            '$revision.checkpoint.workoutCount',
        );
        const checkpointWorkoutChunkCount = readNonNegativeInteger(
            checkpoint.workoutChunkCount,
            '$revision.checkpoint.workoutChunkCount',
        );
        if (checkpoint.workoutEncoding !== TRAINING_PLAN_REVISION_CHUNK_ENCODING) {
            throw new Error('Unsupported plan checkpoint encoding.');
        }
        if ((checkpointWorkoutCount === 0) !== (checkpointWorkoutChunkCount === 0)) {
            throw new Error('Invalid plan checkpoint chunk counts.');
        }
        if (
            checkpointWorkoutCount > TRAINING_PLAN_MAX_CURRENT_WORKOUTS
            || checkpointWorkoutChunkCount > TRAINING_PLAN_REVISION_MAX_CHUNKS
        ) {
            throw new Error('Plan checkpoint limits were exceeded.');
        }
        parsed.checkpoint = {
            plan: parseTrainingPlanV1(checkpoint.plan),
            workoutCount: checkpointWorkoutCount,
            workoutChunkCount: checkpointWorkoutChunkCount,
            workoutEncoding: TRAINING_PLAN_REVISION_CHUNK_ENCODING,
        };
    }
    return parsed;
}

function parseWorkoutDelta(value: unknown, path: string): TrainingPlanWorkoutDeltaV1 {
    const record = asRecord(value, path);
    rejectUnknownFields(record, ['workoutId', 'before', 'after'], path);
    if (typeof record.workoutId !== 'string') throw new Error('Invalid workout delta ID.');
    const before = record.before === null ? null : parseScheduledWorkoutV1(record.before);
    const after = record.after === null ? null : parseScheduledWorkoutV1(record.after);
    if (before?.id !== undefined && before.id !== record.workoutId) throw new Error('Workout delta before ID mismatch.');
    if (after?.id !== undefined && after.id !== record.workoutId) throw new Error('Workout delta after ID mismatch.');
    return { workoutId: record.workoutId, before, after };
}

async function readRevisionChunkPayload<T>(params: {
    db: admin.firestore.Firestore;
    revisionRef: admin.firestore.DocumentReference;
    revision: number;
    kind: TrainingPlanRevisionChunkKindV1;
    itemCount: number;
    chunkCount: number;
    parseItem: (value: unknown, path: string) => T;
}): Promise<T[]> {
    if (params.itemCount === 0) {
        if (params.chunkCount !== 0) throw new Error('Empty revision payload has unexpected chunks.');
        return [];
    }
    if (params.chunkCount <= 0) throw new Error('Revision payload chunks are missing.');
    const chunkRefs = Array.from({ length: params.chunkCount }, (_, chunkIndex) => (
        params.revisionRef.collection(TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID)
            .doc(trainingPlanRevisionChunkDocumentId(params.kind, chunkIndex))
    ));
    const chunkSnapshots = await params.db.getAll(...chunkRefs);
    const payloadBase64 = chunkSnapshots.map((snapshot, chunkIndex) => {
        if (!snapshot.exists) throw new Error('A training-plan revision chunk is missing.');
        const record = asRecord(documentData(snapshot), `$revision.chunks[${chunkIndex}]`);
        rejectUnknownFields(record, [
            'schemaVersion', 'revision', 'kind', 'chunkIndex', 'chunkCount', 'encoding', 'payloadBase64',
        ], `$revision.chunks[${chunkIndex}]`);
        if (
            record.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION
            || record.revision !== params.revision
            || record.kind !== params.kind
            || record.chunkIndex !== chunkIndex
            || record.chunkCount !== params.chunkCount
            || record.encoding !== TRAINING_PLAN_REVISION_CHUNK_ENCODING
            || typeof record.payloadBase64 !== 'string'
            || record.payloadBase64.length === 0
            || record.payloadBase64.length > TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS
        ) {
            throw new Error('A training-plan revision chunk is invalid.');
        }
        return record.payloadBase64;
    }).join('');

    let decoded: unknown;
    try {
        decoded = JSON.parse(gunzipSync(Buffer.from(payloadBase64, 'base64')).toString('utf8')) as unknown;
    } catch {
        throw new Error('A training-plan revision payload could not be decoded.');
    }
    if (!Array.isArray(decoded) || decoded.length !== params.itemCount) {
        throw new Error('A training-plan revision payload has the wrong item count.');
    }
    return decoded.map((item, index) => params.parseItem(item, `$revision.items[${index}]`));
}

function parseStandaloneRevision(value: unknown): StandaloneWorkoutRevisionDocumentV1 {
    const record = asRecord(value, '$revision');
    rejectUnknownFields(record, [
        'schemaVersion', 'revision', 'mutationId', 'operationKind', 'createdAtMs', 'snapshot',
    ], '$revision');
    if (record.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION) throw new Error('Unsupported workout revision schema.');
    if (typeof record.mutationId !== 'string' || typeof record.operationKind !== 'string') {
        throw new Error('Invalid workout revision identity.');
    }
    const createdAtMs = Number(record.createdAtMs);
    if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) {
        throw new Error('Invalid workout revision timestamp.');
    }
    return {
        schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
        revision: readPositiveInteger(record.revision, '$revision.revision'),
        mutationId: record.mutationId,
        operationKind: record.operationKind,
        createdAtMs,
        snapshot: parseScheduledWorkoutV1(record.snapshot),
    };
}

async function requireAvailableUser(db: admin.firestore.Firestore, uid: string): Promise<void> {
    const deletionGuard = await getUserDeletionGuardState(db, uid);
    if (deletionGuard.shouldSkip) {
        throw new TrainingScheduleMutationError(
            'failed-precondition',
            'This account is being deleted or is no longer available.',
        );
    }
}

export async function getTrainingScheduleHistoryForUser(
    uid: string,
    request: TrainingScheduleHistoryRequestV1,
    db: admin.firestore.Firestore = admin.firestore(),
): Promise<TrainingScheduleHistoryResponseV1> {
    await requireAvailableUser(db, uid);
    const userRef = db.collection('users').doc(uid);
    const ownerRef = request.scope.kind === 'plan'
        ? userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(request.scope.id)
        : userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(request.scope.id);
    let query: admin.firestore.Query = ownerRef.collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
        .orderBy('revision', 'desc');
    if (request.beforeRevision !== undefined) query = query.where('revision', '<', request.beforeRevision);
    const limit = request.limit ?? DEFAULT_HISTORY_LIMIT;
    const snapshot = await query.limit(limit + 1).get();
    const visible = snapshot.docs.slice(0, limit).map((revisionSnapshot) => {
        const record = documentData(revisionSnapshot);
        const revision = readPositiveInteger(record.revision, '$revision.revision');
        if (typeof record.operationKind !== 'string' || typeof record.mutationId !== 'string') {
            throw new Error('Invalid schedule revision envelope.');
        }
        const createdAtMs = Number(record.createdAtMs);
        if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) throw new Error('Invalid revision timestamp.');
        return {
            revision,
            operationKind: record.operationKind,
            createdAtMs,
            mutationId: record.mutationId,
            isCheckpoint: record.checkpoint !== undefined || request.scope.kind === 'workout',
        };
    });
    return {
        scope: request.scope,
        entries: visible,
        nextBeforeRevision: snapshot.docs.length > limit && visible.length > 0
            ? visible[visible.length - 1].revision
            : null,
    };
}

export async function readPlanSnapshotAtRevision(
    db: admin.firestore.Firestore,
    uid: string,
    planId: string,
    targetRevision: number,
): Promise<ReconstructedTrainingPlanRevisionV1> {
    const revisionsRef = db.collection('users').doc(uid)
        .collection(TRAINING_PLANS_COLLECTION_ID).doc(planId)
        .collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID);
    const targetSnapshot = await revisionsRef.doc(trainingScheduleRevisionDocumentId(targetRevision)).get();
    if (!targetSnapshot.exists) throw new TrainingScheduleMutationError('not-found', 'The requested plan revision was not found.');
    const target = parsePlanRevision(documentData(targetSnapshot));
    if (target.revision !== targetRevision) throw new Error('Plan revision document ID mismatch.');
    const checkpointSnapshot = target.checkpointRevision === targetRevision
        ? targetSnapshot
        : await revisionsRef.doc(trainingScheduleRevisionDocumentId(target.checkpointRevision)).get();
    if (!checkpointSnapshot.exists) throw new Error('The plan checkpoint is missing.');
    const checkpointRevision = parsePlanRevision(documentData(checkpointSnapshot));
    if (!checkpointRevision.checkpoint || checkpointRevision.revision !== target.checkpointRevision) {
        throw new Error('The plan checkpoint is invalid.');
    }
    let plan = checkpointRevision.checkpoint.plan;
    const checkpointRef = revisionsRef.doc(trainingScheduleRevisionDocumentId(checkpointRevision.revision));
    const checkpointWorkouts = await readRevisionChunkPayload({
        db,
        revisionRef: checkpointRef,
        revision: checkpointRevision.revision,
        kind: 'checkpoint-workouts',
        itemCount: checkpointRevision.checkpoint.workoutCount,
        chunkCount: checkpointRevision.checkpoint.workoutChunkCount,
        parseItem: value => parseScheduledWorkoutV1(value),
    });
    const workouts = new Map(checkpointWorkouts.map((workout) => {
        if (workout.planId !== planId || workout.lifecycle === 'deleted') {
            throw new Error('The plan checkpoint contains an invalid workout.');
        }
        return [workout.id, workout];
    }));

    const followingRevisionNumbers = Array.from(
        { length: targetRevision - target.checkpointRevision },
        (_, index) => target.checkpointRevision + index + 1,
    );
    if (followingRevisionNumbers.length > 0) {
        const followingSnapshots = await db.getAll(...followingRevisionNumbers.map(revision => (
            revisionsRef.doc(trainingScheduleRevisionDocumentId(revision))
        )));
        for (let index = 0; index < followingSnapshots.length; index += 1) {
            const snapshot = followingSnapshots[index];
            if (!snapshot.exists) throw new Error('The plan revision stream contains a gap.');
            const revision = parsePlanRevision(documentData(snapshot));
            if (revision.revision !== followingRevisionNumbers[index]) throw new Error('Plan revisions are out of order.');
            plan = revision.delta.planAfter;
            const workoutDeltas = await readRevisionChunkPayload({
                db,
                revisionRef: revisionsRef.doc(trainingScheduleRevisionDocumentId(revision.revision)),
                revision: revision.revision,
                kind: 'delta-workouts',
                itemCount: revision.delta.workoutCount,
                chunkCount: revision.delta.workoutChunkCount,
                parseItem: parseWorkoutDelta,
            });
            workoutDeltas.forEach((delta) => {
                if (delta.after?.planId === planId && delta.after.lifecycle !== 'deleted') {
                    workouts.set(delta.workoutId, delta.after);
                } else {
                    workouts.delete(delta.workoutId);
                }
            });
        }
    }
    return { plan, workouts };
}

export async function readStandaloneWorkoutAtRevision(
    db: admin.firestore.Firestore,
    uid: string,
    workoutId: string,
    targetRevision: number,
): Promise<ScheduledWorkoutV1> {
    const revisionRef = db.collection('users').doc(uid)
        .collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId)
        .collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
        .doc(trainingScheduleRevisionDocumentId(targetRevision));
    const snapshot = await revisionRef.get();
    if (!snapshot.exists) throw new TrainingScheduleMutationError('not-found', 'The requested workout revision was not found.');
    const revision = parseStandaloneRevision(documentData(snapshot));
    if (revision.revision !== targetRevision) throw new Error('Workout revision document ID mismatch.');
    return revision.snapshot;
}

function valuesEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function logicalWorkoutValuesEqual(
    left: ScheduledWorkoutV1 | null | undefined,
    right: ScheduledWorkoutV1 | null | undefined,
): boolean {
    const logicalValue = (workout: ScheduledWorkoutV1 | null | undefined): unknown => workout ? {
        planId: workout.planId,
        localDate: workout.localDate,
        lifecycle: workout.lifecycle,
        title: workout.title,
        structure: workout.structure,
    } : null;
    return valuesEqual(logicalValue(left), logicalValue(right));
}

export async function previewTrainingScheduleRestoreForUser(
    uid: string,
    request: PreviewTrainingScheduleRestoreRequestV1,
    db: admin.firestore.Firestore = admin.firestore(),
): Promise<TrainingScheduleRestorePreviewV1> {
    await requireAvailableUser(db, uid);
    const userRef = db.collection('users').doc(uid);
    if (request.scope.kind === 'workout') {
        const desired = await readStandaloneWorkoutAtRevision(db, uid, request.scope.id, request.targetRevision);
        const currentSnapshot = await userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(request.scope.id).get();
        const current = currentSnapshot.exists ? parseScheduledWorkoutV1(documentData(currentSnapshot)) : null;
        const selectedRevisionIsPlanBound = desired.planId !== null;
        const moved = current?.planId !== null && current?.planId !== undefined;
        const blocked = selectedRevisionIsPlanBound || moved;
        return {
            scope: request.scope,
            targetRevision: request.targetRevision,
            changedPlanIds: [],
            changedWorkoutIds: blocked || valuesEqual(current, desired) ? [] : [request.scope.id],
            skippedWorkoutIds: blocked ? [request.scope.id] : [],
            warnings: selectedRevisionIsPlanBound
                ? ['The selected revision belongs to a plan and cannot be restored from standalone history.']
                : moved
                    ? ['The workout now belongs to a plan and will not be reclaimed automatically.']
                    : [],
        };
    }

    const desired = await readPlanSnapshotAtRevision(db, uid, request.scope.id, request.targetRevision);
    const planRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(request.scope.id);
    const [currentPlanSnapshot, currentPlanWorkoutsSnapshot] = await Promise.all([
        planRef.get(),
        userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).where('planId', '==', request.scope.id).get(),
    ]);
    if (!currentPlanSnapshot.exists) throw new TrainingScheduleMutationError('not-found', 'The current training plan was not found.');
    const currentPlan = parseTrainingPlanV1(documentData(currentPlanSnapshot));
    const currentWorkouts = new Map(currentPlanWorkoutsSnapshot.docs.map((snapshot) => {
        const parsed = parseScheduledWorkoutV1(documentData(snapshot));
        return [parsed.id, parsed] as const;
    }));
    const desiredWorkoutIds = [...desired.workouts.keys()];
    const desiredSnapshots = desiredWorkoutIds.length === 0
        ? []
        : await db.getAll(...desiredWorkoutIds.map(workoutId => (
            userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId)
        )));
    const movedIds = new Set<string>();
    const permanentlyDeletedIds = new Set<string>();
    desiredSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) {
            permanentlyDeletedIds.add(desiredWorkoutIds[index]);
            return;
        }
        const current = parseScheduledWorkoutV1(documentData(snapshot));
        currentWorkouts.set(current.id, current);
        if (current.planId !== request.scope.id) movedIds.add(current.id);
    });
    const changedWorkoutIds = new Set<string>();
    desired.workouts.forEach((workout, workoutId) => {
        if (
            !movedIds.has(workoutId)
            && !permanentlyDeletedIds.has(workoutId)
            && !logicalWorkoutValuesEqual(currentWorkouts.get(workoutId), workout)
        ) {
            changedWorkoutIds.add(workoutId);
        }
    });
    currentWorkouts.forEach((workout, workoutId) => {
        if (
            workout.planId === request.scope.id
            && workout.lifecycle !== 'deleted'
            && !desired.workouts.has(workoutId)
        ) {
            changedWorkoutIds.add(workoutId);
        }
    });
    const skippedWorkoutIds = [...new Set([...movedIds, ...permanentlyDeletedIds])].sort();
    const warnings: string[] = [];
    if (movedIds.size > 0) {
        warnings.push(`${movedIds.size} workout${movedIds.size === 1 ? '' : 's'} moved to another scope and will not be reclaimed.`);
    }
    if (permanentlyDeletedIds.size > 0) {
        warnings.push(`${permanentlyDeletedIds.size} permanently deleted workout${permanentlyDeletedIds.size === 1 ? '' : 's'} will remain deleted.`);
    }
    return {
        scope: request.scope,
        targetRevision: request.targetRevision,
        changedPlanIds: valuesEqual(currentPlan, desired.plan) ? [] : [request.scope.id],
        changedWorkoutIds: [...changedWorkoutIds].sort(),
        skippedWorkoutIds,
        warnings,
    };
}
