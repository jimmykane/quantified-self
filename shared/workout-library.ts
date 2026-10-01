import { ActivityTypes } from '@sports-alliance/sports-lib';
import { parseWorkoutStructureV1, type WorkoutStructureV1 } from './planned-workout';
import {
  parseStrengthWorkoutDraftV1,
  projectStrengthWorkoutToV1,
  type StrengthWorkoutDraftV1,
} from './strength-workout';
import { normalizeTrainingLocalDate, normalizeTrainingScheduleMutationId } from './training-plans';

export const WORKOUT_LIBRARY_COLLECTION_ID = 'workoutLibrary';
export const WORKOUT_LIBRARY_SCHEMA_VERSION = 1 as const;
export const WORKOUT_LIBRARY_MAX_ITEMS = 200;
export const WORKOUT_LIBRARY_MAX_PLACEMENTS = 100;

export interface WorkoutLibraryItemV1 {
  schemaVersion: typeof WORKOUT_LIBRARY_SCHEMA_VERSION;
  id: string;
  title: string;
  structure: WorkoutStructureV1;
  strength?: StrengthWorkoutDraftV1;
  status: 'active' | 'archived';
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export type WorkoutLibraryMutationOperationV1 =
  | { kind: 'create'; itemId: string; title: string; structure: WorkoutStructureV1; strength?: StrengthWorkoutDraftV1 }
  | { kind: 'copy'; itemId: string; sourceItemId: string; expectedSourceRevision: number }
  | { kind: 'save-workout'; itemId: string; sourceWorkoutId: string; expectedSourceRevision: number }
  | { kind: 'update'; itemId: string; expectedRevision: number; title: string;
      structure: WorkoutStructureV1; strength?: StrengthWorkoutDraftV1 }
  | { kind: 'set-status'; itemId: string; expectedRevision: number; status: 'active' | 'archived' }
  | { kind: 'delete'; itemId: string; expectedRevision: number; confirmDeletion: true };

export interface MutateWorkoutLibraryRequestV1 {
  mutationId: string;
  operation: WorkoutLibraryMutationOperationV1;
}

export interface MutateWorkoutLibraryResponseV1 {
  mutationId: string;
  item: WorkoutLibraryItemV1 | null;
}

export interface PlaceWorkoutLibraryRequestV1 {
  mutationId: string;
  itemId: string;
  expectedTemplateRevision: number;
  expectedStateRevision: number;
  planId: string | null;
  expectedPlanRevision: number | null;
  dates: string[];
  confirmPlanRangeExtension: boolean;
}

export interface PlaceWorkoutLibraryResponseV1 {
  mutationId: string;
  workoutIds: string[];
  dates: string[];
  stateRevision: number;
  planRevision: number | null;
}

export class WorkoutLibraryContractError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'WorkoutLibraryContractError';
  }
}

function record(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkoutLibraryContractError(path, 'Expected an object.');
  }
  const parsed = value as Record<string, unknown>;
  const unexpected = Object.keys(parsed).find(key => !fields.includes(key));
  if (unexpected) throw new WorkoutLibraryContractError(`${path}.${unexpected}`, 'Unknown field.');
  return parsed;
}

export function parseWorkoutLibraryId(value: unknown, path = '$.id'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new WorkoutLibraryContractError(path, 'Expected a safe ID of at most 128 characters.');
  }
  return value;
}

export function parseWorkoutLibraryTitle(value: unknown, path = '$.title'): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
    throw new WorkoutLibraryContractError(path, 'Expected 1 to 120 characters.');
  }
  return value.trim();
}

function positiveRevision(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new WorkoutLibraryContractError(path, 'Expected a positive revision.');
  }
  return value as number;
}

function timestamp(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new WorkoutLibraryContractError(path, 'Expected a non-negative timestamp.');
  }
  return value as number;
}

export function parseWorkoutLibraryPrescription(
  titleValue: unknown,
  structureValue: unknown,
  strengthValue: unknown,
): Pick<WorkoutLibraryItemV1, 'title' | 'structure' | 'strength'> {
  const title = parseWorkoutLibraryTitle(titleValue);
  const structure = parseWorkoutStructureV1(structureValue);
  if (structure.sport !== ActivityTypes.StrengthTraining) {
    if (strengthValue !== undefined) {
      throw new WorkoutLibraryContractError('$.strength', 'Strength details require Strength Training.');
    }
    return { title, structure };
  }
  if (strengthValue === undefined) {
    throw new WorkoutLibraryContractError('$.strength', 'Strength Training needs its full exercise prescription.');
  }
  const strength = parseStrengthWorkoutDraftV1(strengthValue);
  const projected = projectStrengthWorkoutToV1({
    version: strength.version,
    workoutId: 'template',
    revision: 1,
    exercises: strength.exercises,
  });
  if (JSON.stringify(projected) !== JSON.stringify(structure)) {
    throw new WorkoutLibraryContractError('$.structure', 'Strength summary differs from its exercises.');
  }
  return { title, structure, strength };
}

export function parseWorkoutLibraryItemV1(value: unknown): WorkoutLibraryItemV1 {
  const item = record(value, '$', [
    'schemaVersion', 'id', 'title', 'structure', 'strength', 'status', 'revision', 'createdAtMs', 'updatedAtMs',
  ]);
  if (item.schemaVersion !== WORKOUT_LIBRARY_SCHEMA_VERSION) {
    throw new WorkoutLibraryContractError('$.schemaVersion', 'Unsupported workout library version.');
  }
  if (item.status !== 'active' && item.status !== 'archived') {
    throw new WorkoutLibraryContractError('$.status', 'Expected active or archived.');
  }
  const createdAtMs = timestamp(item.createdAtMs, '$.createdAtMs');
  const updatedAtMs = timestamp(item.updatedAtMs, '$.updatedAtMs');
  if (updatedAtMs < createdAtMs) {
    throw new WorkoutLibraryContractError('$.updatedAtMs', 'Update cannot precede creation.');
  }
  return {
    schemaVersion: WORKOUT_LIBRARY_SCHEMA_VERSION,
    id: parseWorkoutLibraryId(item.id),
    ...parseWorkoutLibraryPrescription(item.title, item.structure, item.strength),
    status: item.status,
    revision: positiveRevision(item.revision, '$.revision'),
    createdAtMs,
    updatedAtMs,
  };
}

export function parseMutateWorkoutLibraryRequestV1(value: unknown): MutateWorkoutLibraryRequestV1 {
  const root = record(value, '$', ['mutationId', 'operation']);
  const operation = record(root.operation, '$.operation', [
    'kind', 'itemId', 'title', 'structure', 'strength', 'sourceWorkoutId', 'expectedSourceRevision',
    'sourceItemId', 'expectedRevision', 'status', 'confirmDeletion',
  ]);
  const itemId = parseWorkoutLibraryId(operation.itemId, '$.operation.itemId');
  const mutationId = normalizeTrainingScheduleMutationId(root.mutationId);
  switch (operation.kind) {
    case 'create':
    case 'update': {
      const allowed = operation.kind === 'create'
        ? ['kind', 'itemId', 'title', 'structure', 'strength']
        : ['kind', 'itemId', 'expectedRevision', 'title', 'structure', 'strength'];
      record(root.operation, '$.operation', allowed);
      const prescription = parseWorkoutLibraryPrescription(operation.title, operation.structure, operation.strength);
      return { mutationId, operation: operation.kind === 'create'
        ? { kind: 'create', itemId, ...prescription }
        : { kind: 'update', itemId, expectedRevision: positiveRevision(operation.expectedRevision,
          '$.operation.expectedRevision'), ...prescription } };
    }
    case 'save-workout':
      record(root.operation, '$.operation', ['kind', 'itemId', 'sourceWorkoutId', 'expectedSourceRevision']);
      return { mutationId, operation: { kind: 'save-workout', itemId,
        sourceWorkoutId: parseWorkoutLibraryId(operation.sourceWorkoutId, '$.operation.sourceWorkoutId'),
        expectedSourceRevision: positiveRevision(operation.expectedSourceRevision, '$.operation.expectedSourceRevision') } };
    case 'copy':
      record(root.operation, '$.operation', ['kind', 'itemId', 'sourceItemId', 'expectedSourceRevision']);
      return { mutationId, operation: { kind: 'copy', itemId,
        sourceItemId: parseWorkoutLibraryId(operation.sourceItemId, '$.operation.sourceItemId'),
        expectedSourceRevision: positiveRevision(operation.expectedSourceRevision, '$.operation.expectedSourceRevision') } };
    case 'set-status':
      record(root.operation, '$.operation', ['kind', 'itemId', 'expectedRevision', 'status']);
      if (operation.status !== 'active' && operation.status !== 'archived') {
        throw new WorkoutLibraryContractError('$.operation.status', 'Expected active or archived.');
      }
      return { mutationId, operation: { kind: 'set-status', itemId,
        expectedRevision: positiveRevision(operation.expectedRevision, '$.operation.expectedRevision'),
        status: operation.status } };
    case 'delete':
      record(root.operation, '$.operation', ['kind', 'itemId', 'expectedRevision', 'confirmDeletion']);
      if (operation.confirmDeletion !== true) {
        throw new WorkoutLibraryContractError('$.operation.confirmDeletion', 'Explicit confirmation is required.');
      }
      return { mutationId, operation: { kind: 'delete', itemId,
        expectedRevision: positiveRevision(operation.expectedRevision, '$.operation.expectedRevision'),
        confirmDeletion: true } };
    default:
      throw new WorkoutLibraryContractError('$.operation.kind', 'Unknown library action.');
  }
}

export function parsePlaceWorkoutLibraryRequestV1(value: unknown): PlaceWorkoutLibraryRequestV1 {
  const root = record(value, '$', ['mutationId', 'itemId', 'expectedTemplateRevision', 'expectedStateRevision',
    'planId', 'expectedPlanRevision', 'dates', 'confirmPlanRangeExtension']);
  const planId = root.planId === null ? null : parseWorkoutLibraryId(root.planId, '$.planId');
  const expectedPlanRevision = root.expectedPlanRevision === null ? null
    : positiveRevision(root.expectedPlanRevision, '$.expectedPlanRevision');
  if ((planId === null) !== (expectedPlanRevision === null)) {
    throw new WorkoutLibraryContractError('$.expectedPlanRevision', 'Plan revision must match the destination.');
  }
  if (!Number.isSafeInteger(root.expectedStateRevision) || (root.expectedStateRevision as number) < 0) {
    throw new WorkoutLibraryContractError('$.expectedStateRevision', 'Expected a non-negative revision.');
  }
  if (!Array.isArray(root.dates) || root.dates.length < 1 || root.dates.length > WORKOUT_LIBRARY_MAX_PLACEMENTS) {
    throw new WorkoutLibraryContractError('$.dates', 'Choose 1 to 100 dates.');
  }
  const dates = root.dates.map((date, index) => normalizeTrainingLocalDate(date, `$.dates[${index}]`));
  if (new Set(dates).size !== dates.length || dates.some((date, index) => index > 0 && date < dates[index - 1])) {
    throw new WorkoutLibraryContractError('$.dates', 'Dates must be unique and sorted.');
  }
  if (typeof root.confirmPlanRangeExtension !== 'boolean') {
    throw new WorkoutLibraryContractError('$.confirmPlanRangeExtension', 'Expected a boolean.');
  }
  return { mutationId: normalizeTrainingScheduleMutationId(root.mutationId),
    itemId: parseWorkoutLibraryId(root.itemId, '$.itemId'),
    expectedTemplateRevision: positiveRevision(root.expectedTemplateRevision, '$.expectedTemplateRevision'),
    expectedStateRevision: root.expectedStateRevision as number,
    planId, expectedPlanRevision, dates, confirmPlanRangeExtension: root.confirmPlanRangeExtension };
}
