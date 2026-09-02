import {
  parseWorkoutStructureV1,
  type WorkoutStructureV1,
} from './planned-workout';

export const TRAINING_PLAN_SCHEMA_VERSION = 1 as const;
export const TRAINING_PLAN_MAX_DAYS = 366;
export const TRAINING_PLAN_MAX_CURRENT_WORKOUTS = 400;
export const TRAINING_PLAN_CHECKPOINT_INTERVAL = 20;

export const TRAINING_PLAN_STATE_COLLECTION_ID = 'trainingPlanState';
export const TRAINING_PLAN_STATE_DOCUMENT_ID = 'current';
export const TRAINING_PLAN_STATE_DOCUMENT_PATH = `${TRAINING_PLAN_STATE_COLLECTION_ID}/${TRAINING_PLAN_STATE_DOCUMENT_ID}`;
export const TRAINING_PLANS_COLLECTION_ID = 'trainingPlans';
export const SCHEDULED_WORKOUTS_COLLECTION_ID = 'scheduledWorkouts';
export const TRAINING_PLAN_REVISIONS_COLLECTION_ID = 'revisions';
export const TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID = 'mutationReceipts';
export const TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID = 'planDeletionLocks';
export const TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID = 'deletionTombstones';

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const TRAINING_PLAN_LIFECYCLES = ['active', 'paused', 'archived'] as const;
export type TrainingPlanLifecycle = typeof TRAINING_PLAN_LIFECYCLES[number];

export const SCHEDULED_WORKOUT_LIFECYCLES = ['planned', 'skipped', 'deleted'] as const;
export type ScheduledWorkoutLifecycle = typeof SCHEDULED_WORKOUT_LIFECYCLES[number];

export interface TrainingPlanStateV1 {
  schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
  activePlanId: string | null;
  revision: number;
  currentWorkoutCount: number;
  updatedAtMs: number;
}

export interface TrainingPlanV1 {
  schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
  id: string;
  name: string;
  lifecycle: TrainingPlanLifecycle;
  startLocalDate: string;
  endLocalDate: string;
  revision: number;
  lastCheckpointRevision: number;
  workoutCount: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ScheduledWorkoutV1 {
  schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
  id: string;
  planId: string | null;
  localDate: string;
  lifecycle: ScheduledWorkoutLifecycle;
  title: string;
  structure: WorkoutStructureV1;
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
  deletedAtMs?: number;
}

export type TrainingScheduleRevisionScope =
  | { kind: 'plan'; id: string }
  | { kind: 'workout'; id: string };

export interface ExpectedTrainingScheduleRevision {
  scope: 'state' | 'plan' | 'workout';
  id: string;
  revision: number;
}

export interface CreateTrainingPlanMutationV1 {
  kind: 'create-plan';
  planId: string;
  name: string;
  startLocalDate: string;
  endLocalDate: string;
  activate: boolean;
}

export interface RenameTrainingPlanMutationV1 {
  kind: 'rename-plan';
  planId: string;
  name: string;
}

export interface SetTrainingPlanLifecycleMutationV1 {
  kind: 'set-plan-lifecycle';
  planId: string;
  lifecycle: TrainingPlanLifecycle;
}

export interface ShiftTrainingPlanMutationV1 {
  kind: 'shift-plan';
  planId: string;
  days: number;
}

export interface CreateScheduledWorkoutMutationV1 {
  kind: 'create-workout';
  workoutId: string;
  planId: string | null;
  localDate: string;
  title: string;
  structure: WorkoutStructureV1;
  confirmPlanRangeExtension: boolean;
}

export interface UpdateScheduledWorkoutMutationV1 {
  kind: 'update-workout';
  workoutId: string;
  planId: string | null;
  localDate: string;
  title: string;
  structure: WorkoutStructureV1;
  confirmPlanRangeExtension: boolean;
}

export interface MoveScheduledWorkoutMutationV1 {
  kind: 'move-workout';
  workoutId: string;
  planId: string | null;
  localDate: string;
  confirmPlanRangeExtension: boolean;
}

export interface CopyScheduledWorkoutMutationV1 {
  kind: 'copy-workout';
  sourceWorkoutId: string;
  workoutId: string;
  planId: string | null;
  localDate: string;
  confirmPlanRangeExtension: boolean;
}

export interface SetScheduledWorkoutLifecycleMutationV1 {
  kind: 'set-workout-lifecycle';
  workoutId: string;
  lifecycle: Exclude<ScheduledWorkoutLifecycle, 'deleted'>;
}

export interface DeleteScheduledWorkoutMutationV1 {
  kind: 'delete-workout';
  workoutId: string;
}

export interface PermanentlyDeleteScheduledWorkoutMutationV1 {
  kind: 'permanently-delete-workout';
  workoutId: string;
  confirmPermanentDeletion: true;
}

export type TrainingScheduleMutationOperationV1 =
  | CreateTrainingPlanMutationV1
  | RenameTrainingPlanMutationV1
  | SetTrainingPlanLifecycleMutationV1
  | ShiftTrainingPlanMutationV1
  | CreateScheduledWorkoutMutationV1
  | UpdateScheduledWorkoutMutationV1
  | MoveScheduledWorkoutMutationV1
  | CopyScheduledWorkoutMutationV1
  | SetScheduledWorkoutLifecycleMutationV1
  | DeleteScheduledWorkoutMutationV1
  | PermanentlyDeleteScheduledWorkoutMutationV1;

export interface MutateTrainingScheduleRequestV1 {
  mutationId: string;
  expectedRevisions: ExpectedTrainingScheduleRevision[];
  operation: TrainingScheduleMutationOperationV1;
}

export interface MutateTrainingScheduleResponseV1 {
  mutationId: string;
  state: TrainingPlanStateV1;
  plans: TrainingPlanV1[];
  workouts: ScheduledWorkoutV1[];
  removedPlanIds: string[];
  permanentlyDeletedWorkoutIds: string[];
}

export interface TrainingScheduleHistoryRequestV1 {
  scope: TrainingScheduleRevisionScope;
  beforeRevision?: number;
  limit?: number;
}

export interface TrainingScheduleHistoryEntryV1 {
  revision: number;
  operationKind: string;
  createdAtMs: number;
  mutationId: string;
  isCheckpoint: boolean;
}

export interface TrainingScheduleHistoryResponseV1 {
  scope: TrainingScheduleRevisionScope;
  entries: TrainingScheduleHistoryEntryV1[];
  nextBeforeRevision: number | null;
}

export interface PreviewTrainingScheduleRestoreRequestV1 {
  scope: TrainingScheduleRevisionScope;
  targetRevision: number;
}

export interface TrainingScheduleRestorePreviewV1 {
  scope: TrainingScheduleRevisionScope;
  targetRevision: number;
  changedPlanIds: string[];
  changedWorkoutIds: string[];
  skippedWorkoutIds: string[];
  warnings: string[];
}

export interface RestoreTrainingScheduleRevisionRequestV1 extends PreviewTrainingScheduleRestoreRequestV1 {
  mutationId: string;
  expectedRevisions: ExpectedTrainingScheduleRevision[];
}

export interface RestoreTrainingScheduleRevisionResponseV1 {
  mutation: MutateTrainingScheduleResponseV1;
  skippedWorkoutIds: string[];
}

export interface DeleteTrainingPlanRequestV1 {
  mutationId: string;
  planId: string;
  expectedRevisions: ExpectedTrainingScheduleRevision[];
  workoutDisposition: 'convert-to-standalone' | 'delete-workouts';
  confirmPlanDeletion: true;
}

export interface DeleteTrainingPlanResponseV1 {
  mutationId: string;
  state: TrainingPlanStateV1;
  removedPlanId: string;
  workoutDisposition: DeleteTrainingPlanRequestV1['workoutDisposition'];
  convertedWorkoutIds: string[];
  permanentlyDeletedWorkoutIds: string[];
}

export class TrainingPlanContractError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'TrainingPlanContractError';
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TrainingPlanContractError(path, 'Expected an object.');
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(record: Record<string, unknown>, fields: readonly string[], path: string): void {
  const unknown = Object.keys(record).find(field => !fields.includes(field));
  if (unknown) throw new TrainingPlanContractError(`${path}.${unknown}`, 'Unknown field.');
}

function readEntityId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ENTITY_ID_PATTERN.test(value)) {
    throw new TrainingPlanContractError(path, 'Expected a Firestore-safe ID of at most 128 characters.');
  }
  return value;
}

export function normalizeTrainingScheduleMutationId(value: unknown): string {
  if (typeof value !== 'string' || !MUTATION_ID_PATTERN.test(value)) {
    throw new TrainingPlanContractError('$.mutationId', 'Expected a stable mutation ID of at most 128 characters.');
  }
  return value;
}

function readString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string') throw new TrainingPlanContractError(path, 'Expected a string.');
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new TrainingPlanContractError(path, `Expected 1 to ${maximum} characters.`);
  }
  return normalized;
}

function readInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TrainingPlanContractError(path, `Expected an integer greater than or equal to ${minimum}.`);
  }
  return value as number;
}

function readCurrentWorkoutCount(value: unknown, path: string): number {
  const count = readInteger(value, path);
  if (count > TRAINING_PLAN_MAX_CURRENT_WORKOUTS) {
    throw new TrainingPlanContractError(
      path,
      `Expected at most ${TRAINING_PLAN_MAX_CURRENT_WORKOUTS} current workouts.`,
    );
  }
  return count;
}

function readTimestampMs(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TrainingPlanContractError(path, 'Expected a non-negative millisecond timestamp.');
  }
  return value;
}

export function normalizeTrainingLocalDate(value: unknown, path = '$.localDate'): string {
  if (typeof value !== 'string') throw new TrainingPlanContractError(path, 'Expected YYYY-MM-DD.');
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) throw new TrainingPlanContractError(path, 'Expected YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new TrainingPlanContractError(path, 'Expected a real calendar date.');
  }
  return value;
}

export function addDaysToTrainingLocalDate(localDate: string, days: number): string {
  const normalized = normalizeTrainingLocalDate(localDate);
  if (!Number.isSafeInteger(days)) throw new TrainingPlanContractError('$.days', 'Expected an integer.');
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    `${date.getUTCFullYear()}`.padStart(4, '0'),
    `${date.getUTCMonth() + 1}`.padStart(2, '0'),
    `${date.getUTCDate()}`.padStart(2, '0'),
  ].join('-');
}

export function countTrainingPlanDays(startLocalDate: string, endLocalDate: string): number {
  const start = normalizeTrainingLocalDate(startLocalDate, '$.startLocalDate');
  const end = normalizeTrainingLocalDate(endLocalDate, '$.endLocalDate');
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (endMs < startMs) throw new TrainingPlanContractError('$.endLocalDate', 'Must not precede the start date.');
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

export function validateTrainingPlanDateRange(startLocalDate: string, endLocalDate: string): void {
  const days = countTrainingPlanDays(startLocalDate, endLocalDate);
  if (days > TRAINING_PLAN_MAX_DAYS) {
    throw new TrainingPlanContractError('$.endLocalDate', `A plan may contain at most ${TRAINING_PLAN_MAX_DAYS} days.`);
  }
}

export function isTrainingLocalDateWithinPlan(localDate: string, plan: Pick<TrainingPlanV1, 'startLocalDate' | 'endLocalDate'>): boolean {
  const normalized = normalizeTrainingLocalDate(localDate);
  return normalized >= plan.startLocalDate && normalized <= plan.endLocalDate;
}

export function extendTrainingPlanRangeToDate(
  plan: TrainingPlanV1,
  localDate: string,
): Pick<TrainingPlanV1, 'startLocalDate' | 'endLocalDate'> {
  const normalized = normalizeTrainingLocalDate(localDate);
  const startLocalDate = normalized < plan.startLocalDate ? normalized : plan.startLocalDate;
  const endLocalDate = normalized > plan.endLocalDate ? normalized : plan.endLocalDate;
  validateTrainingPlanDateRange(startLocalDate, endLocalDate);
  return { startLocalDate, endLocalDate };
}

function readNullableEntityId(value: unknown, path: string): string | null {
  return value === null ? null : readEntityId(value, path);
}

function readLifecycle<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new TrainingPlanContractError(path, `Expected one of: ${values.join(', ')}.`);
  }
  return value as T;
}

export function parseTrainingPlanStateV1(value: unknown): TrainingPlanStateV1 {
  const record = asRecord(value, '$');
  rejectUnknownFields(record, ['schemaVersion', 'activePlanId', 'revision', 'currentWorkoutCount', 'updatedAtMs'], '$');
  if (record.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION) {
    throw new TrainingPlanContractError('$.schemaVersion', 'Unsupported training-plan state version.');
  }
  return {
    schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
    activePlanId: readNullableEntityId(record.activePlanId, '$.activePlanId'),
    revision: readInteger(record.revision, '$.revision'),
    currentWorkoutCount: readCurrentWorkoutCount(record.currentWorkoutCount, '$.currentWorkoutCount'),
    updatedAtMs: readTimestampMs(record.updatedAtMs, '$.updatedAtMs'),
  };
}

export function parseTrainingPlanV1(value: unknown): TrainingPlanV1 {
  const record = asRecord(value, '$');
  rejectUnknownFields(record, [
    'schemaVersion', 'id', 'name', 'lifecycle', 'startLocalDate', 'endLocalDate',
    'revision', 'lastCheckpointRevision', 'workoutCount', 'createdAtMs', 'updatedAtMs',
  ], '$');
  if (record.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION) {
    throw new TrainingPlanContractError('$.schemaVersion', 'Unsupported training-plan version.');
  }
  const startLocalDate = normalizeTrainingLocalDate(record.startLocalDate, '$.startLocalDate');
  const endLocalDate = normalizeTrainingLocalDate(record.endLocalDate, '$.endLocalDate');
  validateTrainingPlanDateRange(startLocalDate, endLocalDate);
  const revision = readInteger(record.revision, '$.revision', 1);
  const lastCheckpointRevision = readInteger(record.lastCheckpointRevision, '$.lastCheckpointRevision', 1);
  if (lastCheckpointRevision > revision) {
    throw new TrainingPlanContractError('$.lastCheckpointRevision', 'Must not exceed revision.');
  }
  return {
    schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
    id: readEntityId(record.id, '$.id'),
    name: readString(record.name, '$.name', 120),
    lifecycle: readLifecycle(record.lifecycle, TRAINING_PLAN_LIFECYCLES, '$.lifecycle'),
    startLocalDate,
    endLocalDate,
    revision,
    lastCheckpointRevision,
    workoutCount: readCurrentWorkoutCount(record.workoutCount, '$.workoutCount'),
    createdAtMs: readTimestampMs(record.createdAtMs, '$.createdAtMs'),
    updatedAtMs: readTimestampMs(record.updatedAtMs, '$.updatedAtMs'),
  };
}

export function parseScheduledWorkoutV1(value: unknown): ScheduledWorkoutV1 {
  const record = asRecord(value, '$');
  rejectUnknownFields(record, [
    'schemaVersion', 'id', 'planId', 'localDate', 'lifecycle', 'title', 'structure',
    'revision', 'createdAtMs', 'updatedAtMs', 'deletedAtMs',
  ], '$');
  if (record.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION) {
    throw new TrainingPlanContractError('$.schemaVersion', 'Unsupported scheduled-workout version.');
  }
  const deletedAtMs = record.deletedAtMs === undefined
    ? undefined
    : readTimestampMs(record.deletedAtMs, '$.deletedAtMs');
  const lifecycle = readLifecycle(record.lifecycle, SCHEDULED_WORKOUT_LIFECYCLES, '$.lifecycle');
  if ((lifecycle === 'deleted') !== (deletedAtMs !== undefined)) {
    throw new TrainingPlanContractError('$.deletedAtMs', 'Deleted workouts require deletedAtMs and current workouts must omit it.');
  }
  const parsed: ScheduledWorkoutV1 = {
    schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
    id: readEntityId(record.id, '$.id'),
    planId: readNullableEntityId(record.planId, '$.planId'),
    localDate: normalizeTrainingLocalDate(record.localDate),
    lifecycle,
    title: readString(record.title, '$.title', 120),
    structure: parseWorkoutStructureV1(record.structure),
    revision: readInteger(record.revision, '$.revision', 1),
    createdAtMs: readTimestampMs(record.createdAtMs, '$.createdAtMs'),
    updatedAtMs: readTimestampMs(record.updatedAtMs, '$.updatedAtMs'),
  };
  return deletedAtMs === undefined ? parsed : { ...parsed, deletedAtMs };
}

function parseExpectedRevisions(value: unknown): ExpectedTrainingScheduleRevision[] {
  if (!Array.isArray(value) || value.length > 4) {
    throw new TrainingPlanContractError('$.expectedRevisions', 'Expected an array of at most four revisions.');
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const path = `$.expectedRevisions[${index}]`;
    const record = asRecord(entry, path);
    rejectUnknownFields(record, ['scope', 'id', 'revision'], path);
    const scope = readLifecycle(record.scope, ['state', 'plan', 'workout'], `${path}.scope`);
    const id = scope === 'state'
      ? (record.id === 'current' ? 'current' : (() => { throw new TrainingPlanContractError(`${path}.id`, 'State ID must be current.'); })())
      : readEntityId(record.id, `${path}.id`);
    const key = `${scope}:${id}`;
    if (seen.has(key)) throw new TrainingPlanContractError(path, 'Duplicate expected revision.');
    seen.add(key);
    return { scope, id, revision: readInteger(record.revision, `${path}.revision`) };
  });
}

function parsePlanFields(record: Record<string, unknown>, path = '$.operation'): {
  planId: string;
  name: string;
  startLocalDate: string;
  endLocalDate: string;
} {
  const startLocalDate = normalizeTrainingLocalDate(record.startLocalDate, `${path}.startLocalDate`);
  const endLocalDate = normalizeTrainingLocalDate(record.endLocalDate, `${path}.endLocalDate`);
  validateTrainingPlanDateRange(startLocalDate, endLocalDate);
  return {
    planId: readEntityId(record.planId, `${path}.planId`),
    name: readString(record.name, `${path}.name`, 120),
    startLocalDate,
    endLocalDate,
  };
}

function parseWorkoutDestinationFields(record: Record<string, unknown>, path = '$.operation'): {
  planId: string | null;
  localDate: string;
  confirmPlanRangeExtension: boolean;
} {
  if (typeof record.confirmPlanRangeExtension !== 'boolean') {
    throw new TrainingPlanContractError(`${path}.confirmPlanRangeExtension`, 'Expected a boolean.');
  }
  return {
    planId: readNullableEntityId(record.planId, `${path}.planId`),
    localDate: normalizeTrainingLocalDate(record.localDate, `${path}.localDate`),
    confirmPlanRangeExtension: record.confirmPlanRangeExtension,
  };
}

export function parseMutateTrainingScheduleRequestV1(value: unknown): MutateTrainingScheduleRequestV1 {
  const record = asRecord(value, '$');
  rejectUnknownFields(record, ['mutationId', 'expectedRevisions', 'operation'], '$');
  const operationRecord = asRecord(record.operation, '$.operation');
  const kind = readLifecycle(operationRecord.kind, [
    'create-plan', 'rename-plan', 'set-plan-lifecycle', 'shift-plan', 'create-workout',
    'update-workout', 'move-workout', 'copy-workout', 'set-workout-lifecycle',
    'delete-workout', 'permanently-delete-workout',
  ] as const, '$.operation.kind');

  let operation: TrainingScheduleMutationOperationV1;
  switch (kind) {
    case 'create-plan': {
      rejectUnknownFields(operationRecord, ['kind', 'planId', 'name', 'startLocalDate', 'endLocalDate', 'activate'], '$.operation');
      if (typeof operationRecord.activate !== 'boolean') {
        throw new TrainingPlanContractError('$.operation.activate', 'Expected a boolean.');
      }
      operation = { kind, ...parsePlanFields(operationRecord), activate: operationRecord.activate };
      break;
    }
    case 'rename-plan':
      rejectUnknownFields(operationRecord, ['kind', 'planId', 'name'], '$.operation');
      operation = {
        kind,
        planId: readEntityId(operationRecord.planId, '$.operation.planId'),
        name: readString(operationRecord.name, '$.operation.name', 120),
      };
      break;
    case 'set-plan-lifecycle':
      rejectUnknownFields(operationRecord, ['kind', 'planId', 'lifecycle'], '$.operation');
      operation = {
        kind,
        planId: readEntityId(operationRecord.planId, '$.operation.planId'),
        lifecycle: readLifecycle(operationRecord.lifecycle, TRAINING_PLAN_LIFECYCLES, '$.operation.lifecycle'),
      };
      break;
    case 'shift-plan':
      rejectUnknownFields(operationRecord, ['kind', 'planId', 'days'], '$.operation');
      operation = {
        kind,
        planId: readEntityId(operationRecord.planId, '$.operation.planId'),
        days: readInteger(operationRecord.days, '$.operation.days', -366),
      };
      if (operation.days === 0 || operation.days > 366) {
        throw new TrainingPlanContractError('$.operation.days', 'Expected a non-zero shift between -366 and 366 days.');
      }
      break;
    case 'create-workout': {
      rejectUnknownFields(
        operationRecord,
        ['kind', 'workoutId', 'planId', 'localDate', 'title', 'structure', 'confirmPlanRangeExtension'],
        '$.operation',
      );
      operation = {
        kind,
        workoutId: readEntityId(operationRecord.workoutId, '$.operation.workoutId'),
        ...parseWorkoutDestinationFields(operationRecord),
        title: readString(operationRecord.title, '$.operation.title', 120),
        structure: parseWorkoutStructureV1(operationRecord.structure),
      };
      break;
    }
    case 'update-workout':
      rejectUnknownFields(
        operationRecord,
        ['kind', 'workoutId', 'planId', 'localDate', 'title', 'structure', 'confirmPlanRangeExtension'],
        '$.operation',
      );
      operation = {
        kind,
        workoutId: readEntityId(operationRecord.workoutId, '$.operation.workoutId'),
        ...parseWorkoutDestinationFields(operationRecord),
        title: readString(operationRecord.title, '$.operation.title', 120),
        structure: parseWorkoutStructureV1(operationRecord.structure),
      };
      break;
    case 'move-workout':
      rejectUnknownFields(
        operationRecord,
        ['kind', 'workoutId', 'planId', 'localDate', 'confirmPlanRangeExtension'],
        '$.operation',
      );
      operation = {
        kind,
        workoutId: readEntityId(operationRecord.workoutId, '$.operation.workoutId'),
        ...parseWorkoutDestinationFields(operationRecord),
      };
      break;
    case 'copy-workout':
      rejectUnknownFields(
        operationRecord,
        ['kind', 'sourceWorkoutId', 'workoutId', 'planId', 'localDate', 'confirmPlanRangeExtension'],
        '$.operation',
      );
      operation = {
        kind,
        sourceWorkoutId: readEntityId(operationRecord.sourceWorkoutId, '$.operation.sourceWorkoutId'),
        workoutId: readEntityId(operationRecord.workoutId, '$.operation.workoutId'),
        ...parseWorkoutDestinationFields(operationRecord),
      };
      if (operation.sourceWorkoutId === operation.workoutId) {
        throw new TrainingPlanContractError('$.operation.workoutId', 'Copy destination must use a new workout ID.');
      }
      break;
    case 'set-workout-lifecycle':
      rejectUnknownFields(operationRecord, ['kind', 'workoutId', 'lifecycle'], '$.operation');
      operation = {
        kind,
        workoutId: readEntityId(operationRecord.workoutId, '$.operation.workoutId'),
        lifecycle: readLifecycle(operationRecord.lifecycle, ['planned', 'skipped'], '$.operation.lifecycle'),
      };
      break;
    case 'delete-workout':
      rejectUnknownFields(operationRecord, ['kind', 'workoutId'], '$.operation');
      operation = { kind, workoutId: readEntityId(operationRecord.workoutId, '$.operation.workoutId') };
      break;
    case 'permanently-delete-workout':
      rejectUnknownFields(operationRecord, ['kind', 'workoutId', 'confirmPermanentDeletion'], '$.operation');
      if (operationRecord.confirmPermanentDeletion !== true) {
        throw new TrainingPlanContractError('$.operation.confirmPermanentDeletion', 'Explicit confirmation is required.');
      }
      operation = {
        kind,
        workoutId: readEntityId(operationRecord.workoutId, '$.operation.workoutId'),
        confirmPermanentDeletion: true,
      };
      break;
  }

  return {
    mutationId: normalizeTrainingScheduleMutationId(record.mutationId),
    expectedRevisions: parseExpectedRevisions(record.expectedRevisions),
    operation,
  };
}

export function parseDeleteTrainingPlanRequestV1(value: unknown): DeleteTrainingPlanRequestV1 {
  const record = asRecord(value, '$');
  rejectUnknownFields(record, [
    'mutationId', 'planId', 'expectedRevisions', 'workoutDisposition', 'confirmPlanDeletion',
  ], '$');
  const workoutDisposition = readLifecycle(
    record.workoutDisposition,
    ['convert-to-standalone', 'delete-workouts'] as const,
    '$.workoutDisposition',
  );
  if (record.confirmPlanDeletion !== true) {
    throw new TrainingPlanContractError('$.confirmPlanDeletion', 'Explicit plan-deletion confirmation is required.');
  }
  return {
    mutationId: normalizeTrainingScheduleMutationId(record.mutationId),
    planId: readEntityId(record.planId, '$.planId'),
    expectedRevisions: parseExpectedRevisions(record.expectedRevisions),
    workoutDisposition,
    confirmPlanDeletion: true,
  };
}

export function shouldCheckpointTrainingPlanRevision(revision: number, bulkOperation = false): boolean {
  return revision === 1 || bulkOperation || revision % TRAINING_PLAN_CHECKPOINT_INTERVAL === 0;
}
