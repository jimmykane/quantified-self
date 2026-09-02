import {
  ActivityTypes,
  ActivityTypesHelper,
  DataCadence,
  DataDistance,
  DataDuration,
  DataHeartRate,
  DataPace,
  DataPower,
  DataPowerWork,
  DataSpeed,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import {
  resolveUnitAwareDisplayFromValue,
  type UnitAwareStatDisplay,
} from './unit-aware-display';

export const WORKOUT_STRUCTURE_VERSION = 1 as const;
export const WORKOUT_STRUCTURE_MAX_NODES = 100;
export const WORKOUT_STRUCTURE_MAX_REPEAT_COUNT = 100;
export const WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP = 2;

const WORKOUT_NODE_ID_MAX_LENGTH = 128;
const WORKOUT_NOTE_MAX_LENGTH = 500;
const WORKOUT_NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const WORKOUT_STEP_PURPOSES = [
  'warmup',
  'work',
  'recovery',
  'cooldown',
  'rest',
  'other',
] as const;
export type WorkoutStepPurposeV1 = typeof WORKOUT_STEP_PURPOSES[number];

export const WORKOUT_ENDING_KINDS = [
  'time',
  'distance',
  'kilojoules',
  'repetitions',
  'manual',
] as const;
export type WorkoutEndingKindV1 = typeof WORKOUT_ENDING_KINDS[number];

export const WORKOUT_TARGET_KINDS = [
  'heart-rate',
  'power',
  'speed',
  'cadence',
] as const;
export type WorkoutTargetKindV1 = typeof WORKOUT_TARGET_KINDS[number];
export type WorkoutTargetModeV1 = 'absolute' | 'relative';
export type WorkoutSpeedPresentationV1 = 'pace' | 'speed';

export interface WorkoutTimeEndingV1 {
  kind: 'time';
  seconds: number;
}

export interface WorkoutDistanceEndingV1 {
  kind: 'distance';
  meters: number;
}

export interface WorkoutKilojoulesEndingV1 {
  kind: 'kilojoules';
  kilojoules: number;
}

export interface WorkoutRepetitionsEndingV1 {
  kind: 'repetitions';
  repetitions: number;
}

export interface WorkoutManualEndingV1 {
  kind: 'manual';
}

export type WorkoutEndingV1 =
  | WorkoutTimeEndingV1
  | WorkoutDistanceEndingV1
  | WorkoutKilojoulesEndingV1
  | WorkoutRepetitionsEndingV1
  | WorkoutManualEndingV1;

export interface WorkoutAbsoluteHeartRateTargetV1 {
  kind: 'heart-rate';
  mode: 'absolute';
  minimumBpm: number;
  maximumBpm: number;
}

export interface WorkoutRelativeHeartRateTargetV1 {
  kind: 'heart-rate';
  mode: 'relative';
  minimumPercent: number;
  maximumPercent: number;
  reference: {
    kind: 'max-heart-rate' | 'threshold-heart-rate';
    bpm: number;
  };
}

export interface WorkoutAbsolutePowerTargetV1 {
  kind: 'power';
  mode: 'absolute';
  minimumWatts: number;
  maximumWatts: number;
}

export interface WorkoutRelativePowerTargetV1 {
  kind: 'power';
  mode: 'relative';
  minimumPercent: number;
  maximumPercent: number;
  reference: {
    kind: 'functional-threshold-power' | 'critical-power';
    watts: number;
  };
}

export interface WorkoutAbsoluteSpeedTargetV1 {
  kind: 'speed';
  mode: 'absolute';
  minimumMetersPerSecond: number;
  maximumMetersPerSecond: number;
  presentation: WorkoutSpeedPresentationV1;
}

export interface WorkoutRelativeSpeedTargetV1 {
  kind: 'speed';
  mode: 'relative';
  minimumPercent: number;
  maximumPercent: number;
  presentation: WorkoutSpeedPresentationV1;
  reference: {
    kind: 'threshold-speed';
    metersPerSecond: number;
  };
}

export interface WorkoutAbsoluteCadenceTargetV1 {
  kind: 'cadence';
  mode: 'absolute';
  minimumRpm: number;
  maximumRpm: number;
}

export interface WorkoutRelativeCadenceTargetV1 {
  kind: 'cadence';
  mode: 'relative';
  minimumPercent: number;
  maximumPercent: number;
  reference: {
    kind: 'preferred-cadence';
    rpm: number;
  };
}

export type WorkoutTargetV1 =
  | WorkoutAbsoluteHeartRateTargetV1
  | WorkoutRelativeHeartRateTargetV1
  | WorkoutAbsolutePowerTargetV1
  | WorkoutRelativePowerTargetV1
  | WorkoutAbsoluteSpeedTargetV1
  | WorkoutRelativeSpeedTargetV1
  | WorkoutAbsoluteCadenceTargetV1
  | WorkoutRelativeCadenceTargetV1;

export interface WorkoutStepV1 {
  kind: 'step';
  id: string;
  purpose: WorkoutStepPurposeV1;
  ending: WorkoutEndingV1;
  targets: WorkoutTargetV1[];
  note?: string;
}

export interface WorkoutRepeatV1 {
  kind: 'repeat';
  id: string;
  count: number;
  steps: WorkoutStepV1[];
}

export type WorkoutNodeV1 = WorkoutStepV1 | WorkoutRepeatV1;

export interface WorkoutStructureV1 {
  version: typeof WORKOUT_STRUCTURE_VERSION;
  sport: ActivityTypes;
  nodes: WorkoutNodeV1[];
}

export interface WorkoutStructureValidationIssue {
  code:
    | 'invalid_type'
    | 'invalid_value'
    | 'unsupported_version'
    | 'unknown_field'
    | 'unknown_discriminant'
    | 'duplicate_id'
    | 'limit_exceeded'
    | 'inverted_range';
  path: string;
  message: string;
}

export class WorkoutStructureValidationError extends Error {
  readonly issues: WorkoutStructureValidationIssue[];

  constructor(issues: WorkoutStructureValidationIssue[]) {
    super(issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'WorkoutStructureValidationError';
    this.issues = issues;
  }
}

export interface WorkoutCompatibilityProfileV1 {
  sports?: readonly ActivityTypes[];
  endingKinds: readonly WorkoutEndingKindV1[];
  targetKinds: readonly WorkoutTargetKindV1[];
  supportsRepeats: boolean;
  supportsRelativeTargets: boolean;
  maxNodes?: number;
  maxRepeatCount?: number;
  maxTargetsPerStep?: number;
}

export interface WorkoutCompatibilityIssueV1 {
  code:
    | 'unsupported_sport'
    | 'unsupported_repeat'
    | 'unsupported_ending'
    | 'unsupported_target'
    | 'unsupported_relative_target'
    | 'provider_limit_exceeded';
  path: string;
  message: string;
}

export interface WorkoutCompatibilityResultV1 {
  compatible: boolean;
  issues: WorkoutCompatibilityIssueV1[];
}

export const INITIAL_MANUAL_WORKOUT_EDITOR_PROFILE_V1: WorkoutCompatibilityProfileV1 = {
  sports: [ActivityTypes.Running, ActivityTypes.Cycling],
  endingKinds: ['time', 'distance'],
  targetKinds: ['heart-rate', 'power', 'speed'],
  supportsRepeats: true,
  supportsRelativeTargets: false,
  maxNodes: WORKOUT_STRUCTURE_MAX_NODES,
  maxRepeatCount: WORKOUT_STRUCTURE_MAX_REPEAT_COUNT,
  maxTargetsPerStep: 1,
};

interface ParseContext {
  issues: WorkoutStructureValidationIssue[];
  ids: Set<string>;
  nodeCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushIssue(
  context: ParseContext,
  code: WorkoutStructureValidationIssue['code'],
  path: string,
  message: string,
): void {
  context.issues.push({ code, path, message });
}

function readRecord(value: unknown, path: string, context: ParseContext): Record<string, unknown> | null {
  if (!isRecord(value)) {
    pushIssue(context, 'invalid_type', path, 'Expected an object.');
    return null;
  }
  return value;
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowedFields: readonly string[],
  path: string,
  context: ParseContext,
): void {
  for (const field of Object.keys(value)) {
    if (!allowedFields.includes(field)) {
      pushIssue(context, 'unknown_field', `${path}.${field}`, 'Unknown field.');
    }
  }
}

function readEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  path: string,
  context: ParseContext,
): T | null {
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
    pushIssue(context, 'unknown_discriminant', path, `Expected one of: ${allowedValues.join(', ')}.`);
    return null;
  }
  return value as T;
}

function readPositiveNumber(
  value: unknown,
  path: string,
  context: ParseContext,
  validate?: (candidate: number) => boolean,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || validate?.(value) === false) {
    pushIssue(context, 'invalid_value', path, 'Expected a finite positive number.');
    return null;
  }
  return value;
}

function readNonNegativeNumber(
  value: unknown,
  path: string,
  context: ParseContext,
  validate?: (candidate: number) => boolean,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || validate?.(value) === false) {
    pushIssue(context, 'invalid_value', path, 'Expected a finite non-negative number.');
    return null;
  }
  return value;
}

function readPositiveInteger(
  value: unknown,
  path: string,
  context: ParseContext,
  maximum?: number,
): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    pushIssue(context, 'invalid_value', path, 'Expected a positive integer.');
    return null;
  }
  if (maximum !== undefined && value > maximum) {
    pushIssue(context, 'limit_exceeded', path, `Must be at most ${maximum}.`);
    return null;
  }
  return value;
}

function sportsLibScalarValidator<T extends { isValueTypeValid(value: unknown): boolean }>(
  DataType: new (value: number) => T,
): (candidate: number) => boolean {
  return candidate => {
    try {
      const instance = new DataType(candidate);
      return instance.isValueTypeValid(candidate);
    } catch {
      return false;
    }
  };
}

const validDuration = sportsLibScalarValidator(DataDuration);
const validDistance = sportsLibScalarValidator(DataDistance);
const validHeartRate = sportsLibScalarValidator(DataHeartRate);
const validPower = sportsLibScalarValidator(DataPower);
const validSpeed = sportsLibScalarValidator(DataSpeed);
const validCadence = sportsLibScalarValidator(DataCadence);
const validPowerWork = sportsLibScalarValidator(DataPowerWork);

function readNodeId(value: unknown, path: string, context: ParseContext): string | null {
  if (
    typeof value !== 'string'
    || value.length > WORKOUT_NODE_ID_MAX_LENGTH
    || !WORKOUT_NODE_ID_PATTERN.test(value)
  ) {
    pushIssue(
      context,
      'invalid_value',
      path,
      `Expected ${WORKOUT_NODE_ID_PATTERN.source} and at most ${WORKOUT_NODE_ID_MAX_LENGTH} characters.`,
    );
    return null;
  }

  if (context.ids.has(value)) {
    pushIssue(context, 'duplicate_id', path, `Duplicate node ID "${value}".`);
    return null;
  }

  context.ids.add(value);
  return value;
}

function readRange(
  minimum: number | null,
  maximum: number | null,
  minimumPath: string,
  maximumPath: string,
  context: ParseContext,
): boolean {
  if (minimum === null || maximum === null) {
    return false;
  }
  if (minimum > maximum) {
    pushIssue(
      context,
      'inverted_range',
      maximumPath,
      `Must be greater than or equal to ${minimumPath}.`,
    );
    return false;
  }
  return true;
}

function parseEnding(value: unknown, path: string, context: ParseContext): WorkoutEndingV1 | null {
  const record = readRecord(value, path, context);
  if (!record) return null;
  const kind = readEnum(record.kind, WORKOUT_ENDING_KINDS, `${path}.kind`, context);
  if (!kind) return null;

  switch (kind) {
    case 'time': {
      rejectUnknownFields(record, ['kind', 'seconds'], path, context);
      const seconds = readPositiveNumber(record.seconds, `${path}.seconds`, context, validDuration);
      return seconds === null ? null : { kind, seconds };
    }
    case 'distance': {
      rejectUnknownFields(record, ['kind', 'meters'], path, context);
      const meters = readPositiveNumber(record.meters, `${path}.meters`, context, validDistance);
      return meters === null ? null : { kind, meters };
    }
    case 'kilojoules': {
      rejectUnknownFields(record, ['kind', 'kilojoules'], path, context);
      const kilojoules = readPositiveNumber(record.kilojoules, `${path}.kilojoules`, context, validPowerWork);
      return kilojoules === null ? null : { kind, kilojoules };
    }
    case 'repetitions': {
      rejectUnknownFields(record, ['kind', 'repetitions'], path, context);
      const repetitions = readPositiveInteger(record.repetitions, `${path}.repetitions`, context);
      return repetitions === null ? null : { kind, repetitions };
    }
    case 'manual':
      rejectUnknownFields(record, ['kind'], path, context);
      return { kind };
  }
}

function parseRelativeRange(
  record: Record<string, unknown>,
  path: string,
  context: ParseContext,
): { minimumPercent: number; maximumPercent: number } | null {
  const minimumPercent = readNonNegativeNumber(record.minimumPercent, `${path}.minimumPercent`, context);
  const maximumPercent = readNonNegativeNumber(record.maximumPercent, `${path}.maximumPercent`, context);
  return readRange(
    minimumPercent,
    maximumPercent,
    `${path}.minimumPercent`,
    `${path}.maximumPercent`,
    context,
  ) ? { minimumPercent: minimumPercent!, maximumPercent: maximumPercent! } : null;
}

function parseTarget(value: unknown, path: string, context: ParseContext): WorkoutTargetV1 | null {
  const record = readRecord(value, path, context);
  if (!record) return null;
  const kind = readEnum(record.kind, WORKOUT_TARGET_KINDS, `${path}.kind`, context);
  const mode = readEnum(record.mode, ['absolute', 'relative'], `${path}.mode`, context);
  if (!kind || !mode) return null;

  if (kind === 'heart-rate' && mode === 'absolute') {
    rejectUnknownFields(record, ['kind', 'mode', 'minimumBpm', 'maximumBpm'], path, context);
    const minimumBpm = readNonNegativeNumber(record.minimumBpm, `${path}.minimumBpm`, context, validHeartRate);
    const maximumBpm = readNonNegativeNumber(record.maximumBpm, `${path}.maximumBpm`, context, validHeartRate);
    return readRange(minimumBpm, maximumBpm, `${path}.minimumBpm`, `${path}.maximumBpm`, context)
      ? { kind, mode, minimumBpm: minimumBpm!, maximumBpm: maximumBpm! }
      : null;
  }

  if (kind === 'power' && mode === 'absolute') {
    rejectUnknownFields(record, ['kind', 'mode', 'minimumWatts', 'maximumWatts'], path, context);
    const minimumWatts = readNonNegativeNumber(record.minimumWatts, `${path}.minimumWatts`, context, validPower);
    const maximumWatts = readNonNegativeNumber(record.maximumWatts, `${path}.maximumWatts`, context, validPower);
    return readRange(minimumWatts, maximumWatts, `${path}.minimumWatts`, `${path}.maximumWatts`, context)
      ? { kind, mode, minimumWatts: minimumWatts!, maximumWatts: maximumWatts! }
      : null;
  }

  if (kind === 'speed' && mode === 'absolute') {
    rejectUnknownFields(
      record,
      ['kind', 'mode', 'minimumMetersPerSecond', 'maximumMetersPerSecond', 'presentation'],
      path,
      context,
    );
    const minimumMetersPerSecond = readNonNegativeNumber(
      record.minimumMetersPerSecond,
      `${path}.minimumMetersPerSecond`,
      context,
      validSpeed,
    );
    const maximumMetersPerSecond = readNonNegativeNumber(
      record.maximumMetersPerSecond,
      `${path}.maximumMetersPerSecond`,
      context,
      validSpeed,
    );
    const presentation = readEnum(record.presentation, ['pace', 'speed'], `${path}.presentation`, context);
    const rangeIsValid = readRange(
      minimumMetersPerSecond,
      maximumMetersPerSecond,
      `${path}.minimumMetersPerSecond`,
      `${path}.maximumMetersPerSecond`,
      context,
    );
    if (presentation === 'pace' && (minimumMetersPerSecond === 0 || maximumMetersPerSecond === 0)) {
      pushIssue(context, 'invalid_value', path, 'Pace targets require positive speed bounds.');
      return null;
    }
    return presentation && rangeIsValid
      ? { kind, mode, minimumMetersPerSecond: minimumMetersPerSecond!, maximumMetersPerSecond: maximumMetersPerSecond!, presentation }
      : null;
  }

  if (kind === 'cadence' && mode === 'absolute') {
    rejectUnknownFields(record, ['kind', 'mode', 'minimumRpm', 'maximumRpm'], path, context);
    const minimumRpm = readNonNegativeNumber(record.minimumRpm, `${path}.minimumRpm`, context, validCadence);
    const maximumRpm = readNonNegativeNumber(record.maximumRpm, `${path}.maximumRpm`, context, validCadence);
    return readRange(minimumRpm, maximumRpm, `${path}.minimumRpm`, `${path}.maximumRpm`, context)
      ? { kind, mode, minimumRpm: minimumRpm!, maximumRpm: maximumRpm! }
      : null;
  }

  const relativeRange = parseRelativeRange(record, path, context);
  const reference = readRecord(record.reference, `${path}.reference`, context);
  if (mode !== 'relative' || !relativeRange || !reference) return null;

  if (kind === 'heart-rate') {
    rejectUnknownFields(record, ['kind', 'mode', 'minimumPercent', 'maximumPercent', 'reference'], path, context);
    rejectUnknownFields(reference, ['kind', 'bpm'], `${path}.reference`, context);
    const referenceKind = readEnum(
      reference.kind,
      ['max-heart-rate', 'threshold-heart-rate'],
      `${path}.reference.kind`,
      context,
    );
    const bpm = readPositiveNumber(reference.bpm, `${path}.reference.bpm`, context, validHeartRate);
    return referenceKind && bpm !== null
      ? { kind, mode: 'relative', ...relativeRange, reference: { kind: referenceKind, bpm } }
      : null;
  }

  if (kind === 'power') {
    rejectUnknownFields(record, ['kind', 'mode', 'minimumPercent', 'maximumPercent', 'reference'], path, context);
    rejectUnknownFields(reference, ['kind', 'watts'], `${path}.reference`, context);
    const referenceKind = readEnum(
      reference.kind,
      ['functional-threshold-power', 'critical-power'],
      `${path}.reference.kind`,
      context,
    );
    const watts = readPositiveNumber(reference.watts, `${path}.reference.watts`, context, validPower);
    return referenceKind && watts !== null
      ? { kind, mode: 'relative', ...relativeRange, reference: { kind: referenceKind, watts } }
      : null;
  }

  if (kind === 'speed') {
    rejectUnknownFields(
      record,
      ['kind', 'mode', 'minimumPercent', 'maximumPercent', 'presentation', 'reference'],
      path,
      context,
    );
    rejectUnknownFields(reference, ['kind', 'metersPerSecond'], `${path}.reference`, context);
    const presentation = readEnum(record.presentation, ['pace', 'speed'], `${path}.presentation`, context);
    const referenceKind = readEnum(reference.kind, ['threshold-speed'], `${path}.reference.kind`, context);
    const metersPerSecond = readPositiveNumber(
      reference.metersPerSecond,
      `${path}.reference.metersPerSecond`,
      context,
      validSpeed,
    );
    return presentation && referenceKind && metersPerSecond !== null
      ? { kind, mode: 'relative', ...relativeRange, presentation, reference: { kind: referenceKind, metersPerSecond } }
      : null;
  }

  rejectUnknownFields(record, ['kind', 'mode', 'minimumPercent', 'maximumPercent', 'reference'], path, context);
  rejectUnknownFields(reference, ['kind', 'rpm'], `${path}.reference`, context);
  const referenceKind = readEnum(reference.kind, ['preferred-cadence'], `${path}.reference.kind`, context);
  const rpm = readPositiveNumber(reference.rpm, `${path}.reference.rpm`, context, validCadence);
  return referenceKind && rpm !== null
    ? { kind, mode: 'relative', ...relativeRange, reference: { kind: referenceKind, rpm } }
    : null;
}

function parseStep(value: unknown, path: string, context: ParseContext): WorkoutStepV1 | null {
  const record = readRecord(value, path, context);
  if (!record) return null;
  rejectUnknownFields(record, ['kind', 'id', 'purpose', 'ending', 'targets', 'note'], path, context);
  if (record.kind !== 'step') {
    pushIssue(context, 'unknown_discriminant', `${path}.kind`, 'Expected step. Nested repeats are not supported.');
    return null;
  }

  context.nodeCount += 1;
  const id = readNodeId(record.id, `${path}.id`, context);
  const purpose = readEnum(record.purpose, WORKOUT_STEP_PURPOSES, `${path}.purpose`, context);
  const ending = parseEnding(record.ending, `${path}.ending`, context);

  let targets: WorkoutTargetV1[] | null = null;
  let expectedTargetCount: number | null = null;
  if (!Array.isArray(record.targets)) {
    pushIssue(context, 'invalid_type', `${path}.targets`, 'Expected an array.');
  } else if (record.targets.length > WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP) {
    pushIssue(
      context,
      'limit_exceeded',
      `${path}.targets`,
      `A step may contain at most ${WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP} targets.`,
    );
  } else {
    expectedTargetCount = record.targets.length;
    targets = record.targets
      .map((target, index) => parseTarget(target, `${path}.targets[${index}]`, context))
      .filter((target): target is WorkoutTargetV1 => target !== null);
    const uniqueKinds = new Set(targets.map(target => target.kind));
    if (uniqueKinds.size !== targets.length) {
      pushIssue(context, 'invalid_value', `${path}.targets`, 'Target kinds must be unique within a step.');
    }
  }

  let note: string | undefined;
  if (record.note !== undefined) {
    if (typeof record.note !== 'string' || record.note.trim().length === 0 || record.note.length > WORKOUT_NOTE_MAX_LENGTH) {
      pushIssue(
        context,
        'invalid_value',
        `${path}.note`,
        `Expected a non-empty string of at most ${WORKOUT_NOTE_MAX_LENGTH} characters.`,
      );
    } else {
      note = record.note.trim();
    }
  }

  if (!id || !purpose || !ending || !targets || targets.length !== expectedTargetCount) {
    return null;
  }

  return note === undefined
    ? { kind: 'step', id, purpose, ending, targets }
    : { kind: 'step', id, purpose, ending, targets, note };
}

function parseNode(value: unknown, path: string, context: ParseContext): WorkoutNodeV1 | null {
  const record = readRecord(value, path, context);
  if (!record) return null;

  if (record.kind === 'step') {
    return parseStep(record, path, context);
  }
  if (record.kind !== 'repeat') {
    pushIssue(context, 'unknown_discriminant', `${path}.kind`, 'Expected step or repeat.');
    return null;
  }

  rejectUnknownFields(record, ['kind', 'id', 'count', 'steps'], path, context);
  context.nodeCount += 1;
  const id = readNodeId(record.id, `${path}.id`, context);
  const count = readPositiveInteger(record.count, `${path}.count`, context, WORKOUT_STRUCTURE_MAX_REPEAT_COUNT);
  let steps: WorkoutStepV1[] | null = null;
  let expectedStepCount: number | null = null;
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    pushIssue(context, 'invalid_type', `${path}.steps`, 'Expected a non-empty array of steps.');
  } else {
    expectedStepCount = record.steps.length;
    steps = record.steps
      .map((step, index) => parseStep(step, `${path}.steps[${index}]`, context))
      .filter((step): step is WorkoutStepV1 => step !== null);
  }

  return id && count !== null && steps && steps.length === expectedStepCount
    ? { kind: 'repeat', id, count, steps }
    : null;
}

export function parseWorkoutStructureV1(value: unknown): WorkoutStructureV1 {
  const context: ParseContext = { issues: [], ids: new Set(), nodeCount: 0 };
  const record = readRecord(value, '$', context);
  if (!record) throw new WorkoutStructureValidationError(context.issues);
  rejectUnknownFields(record, ['version', 'sport', 'nodes'], '$', context);

  if (record.version !== WORKOUT_STRUCTURE_VERSION) {
    pushIssue(
      context,
      'unsupported_version',
      '$.version',
      `Only workout structure version ${WORKOUT_STRUCTURE_VERSION} is supported.`,
    );
  }

  const sport = ActivityTypesHelper.resolveActivityType(record.sport);
  if (!sport || sport === ActivityTypes.unknown) {
    pushIssue(context, 'invalid_value', '$.sport', 'Expected a supported canonical activity type or alias.');
  }

  let nodes: WorkoutNodeV1[] = [];
  let expectedNodeCount: number | null = null;
  if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
    pushIssue(context, 'invalid_type', '$.nodes', 'Expected a non-empty array.');
  } else {
    expectedNodeCount = record.nodes.length;
    nodes = record.nodes
      .map((node, index) => parseNode(node, `$.nodes[${index}]`, context))
      .filter((node): node is WorkoutNodeV1 => node !== null);
  }

  if (context.nodeCount > WORKOUT_STRUCTURE_MAX_NODES) {
    pushIssue(
      context,
      'limit_exceeded',
      '$.nodes',
      `Workout structures may contain at most ${WORKOUT_STRUCTURE_MAX_NODES} nodes including repeated steps.`,
    );
  }

  if (context.issues.length > 0 || !sport || nodes.length !== expectedNodeCount) {
    throw new WorkoutStructureValidationError(context.issues);
  }

  return { version: WORKOUT_STRUCTURE_VERSION, sport, nodes };
}

export function normalizeWorkoutStructureV1(value: unknown): WorkoutStructureV1 {
  return parseWorkoutStructureV1(value);
}

export function serializeWorkoutStructureV1(value: unknown): string {
  return JSON.stringify(parseWorkoutStructureV1(value));
}

export function deserializeWorkoutStructureV1(value: string): WorkoutStructureV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new WorkoutStructureValidationError([{
      code: 'invalid_type',
      path: '$',
      message: 'Expected valid JSON.',
    }]);
  }
  return parseWorkoutStructureV1(parsed);
}

export function toFirestoreWorkoutStructureV1(value: unknown): WorkoutStructureV1 {
  return JSON.parse(serializeWorkoutStructureV1(value)) as WorkoutStructureV1;
}

export function countWorkoutStructureNodesV1(structure: WorkoutStructureV1): number {
  return structure.nodes.reduce((total, node) => total + (node.kind === 'repeat' ? 1 + node.steps.length : 1), 0);
}

export function evaluateWorkoutCompatibilityV1(
  value: unknown,
  profile: WorkoutCompatibilityProfileV1,
): WorkoutCompatibilityResultV1 {
  const structure = parseWorkoutStructureV1(value);
  const issues: WorkoutCompatibilityIssueV1[] = [];
  const maxNodes = profile.maxNodes ?? WORKOUT_STRUCTURE_MAX_NODES;
  const maxRepeatCount = profile.maxRepeatCount ?? WORKOUT_STRUCTURE_MAX_REPEAT_COUNT;
  const maxTargetsPerStep = profile.maxTargetsPerStep ?? WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP;

  if (profile.sports && !profile.sports.includes(structure.sport)) {
    issues.push({
      code: 'unsupported_sport',
      path: '$.sport',
      message: `${structure.sport} is not supported by this capability profile.`,
    });
  }

  if (countWorkoutStructureNodesV1(structure) > maxNodes) {
    issues.push({
      code: 'provider_limit_exceeded',
      path: '$.nodes',
      message: `This capability profile supports at most ${maxNodes} nodes.`,
    });
  }

  const checkStep = (step: WorkoutStepV1, path: string): void => {
    if (!profile.endingKinds.includes(step.ending.kind)) {
      issues.push({
        code: 'unsupported_ending',
        path: `${path}.ending`,
        message: `${step.ending.kind} endings are not supported by this capability profile.`,
      });
    }
    if (step.targets.length > maxTargetsPerStep) {
      issues.push({
        code: 'provider_limit_exceeded',
        path: `${path}.targets`,
        message: `This capability profile supports at most ${maxTargetsPerStep} targets per step.`,
      });
    }
    step.targets.forEach((target, targetIndex) => {
      if (!profile.targetKinds.includes(target.kind)) {
        issues.push({
          code: 'unsupported_target',
          path: `${path}.targets[${targetIndex}]`,
          message: `${target.kind} targets are not supported by this capability profile.`,
        });
      }
      if (target.mode === 'relative' && !profile.supportsRelativeTargets) {
        issues.push({
          code: 'unsupported_relative_target',
          path: `${path}.targets[${targetIndex}]`,
          message: 'Relative targets are not supported by this capability profile.',
        });
      }
    });
  };

  structure.nodes.forEach((node, nodeIndex) => {
    const path = `$.nodes[${nodeIndex}]`;
    if (node.kind === 'step') {
      checkStep(node, path);
      return;
    }
    if (!profile.supportsRepeats) {
      issues.push({ code: 'unsupported_repeat', path, message: 'Repeats are not supported by this capability profile.' });
    }
    if (node.count > maxRepeatCount) {
      issues.push({
        code: 'provider_limit_exceeded',
        path: `${path}.count`,
        message: `This capability profile supports repeat counts up to ${maxRepeatCount}.`,
      });
    }
    node.steps.forEach((step, stepIndex) => checkStep(step, `${path}.steps[${stepIndex}]`));
  });

  return { compatible: issues.length === 0, issues };
}

function formatRange(minimum: string, maximum: string): string {
  return minimum === maximum ? minimum : `${minimum}–${maximum}`;
}

function formatDisplayRange(
  minimum: UnitAwareStatDisplay | null,
  maximum: UnitAwareStatDisplay | null,
): string | null {
  if (!minimum || !maximum) return null;
  if (minimum.unit === maximum.unit) {
    return `${formatRange(minimum.value, maximum.value)}${minimum.unit ? ` ${minimum.unit}` : ''}`;
  }
  return formatRange(minimum.text, maximum.text);
}

function formatSpeedValue(
  metersPerSecond: number,
  presentation: WorkoutSpeedPresentationV1,
  unitSettings?: UserUnitSettingsInterface | null,
): UnitAwareStatDisplay | null {
  const paceSecondsPerKilometer = Math.round((1000 / metersPerSecond) * 1000) / 1000;
  return presentation === 'pace'
    ? resolveUnitAwareDisplayFromValue(DataPace.type, paceSecondsPerKilometer, unitSettings)
    : resolveUnitAwareDisplayFromValue(DataSpeed.type, metersPerSecond, unitSettings);
}

export function formatWorkoutEndingV1(
  ending: WorkoutEndingV1,
  unitSettings?: UserUnitSettingsInterface | null,
  locale?: string,
): string {
  switch (ending.kind) {
    case 'time':
      return resolveUnitAwareDisplayFromValue(DataDuration.type, ending.seconds, unitSettings)?.text ?? `${ending.seconds} s`;
    case 'distance':
      return resolveUnitAwareDisplayFromValue(DataDistance.type, ending.meters, unitSettings)?.text ?? `${ending.meters} m`;
    case 'kilojoules':
      return resolveUnitAwareDisplayFromValue(DataPowerWork.type, ending.kilojoules, unitSettings)?.text
        ?? `${ending.kilojoules} kJ`;
    case 'repetitions':
      return `${new Intl.NumberFormat(locale).format(ending.repetitions)} rep${ending.repetitions === 1 ? '' : 's'}`;
    case 'manual':
      return 'Manual transition';
  }
}

function formatPercentRange(minimum: number, maximum: number, locale?: string): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return `${formatRange(formatter.format(minimum), formatter.format(maximum))}%`;
}

export function formatWorkoutTargetV1(
  target: WorkoutTargetV1,
  unitSettings?: UserUnitSettingsInterface | null,
  locale?: string,
): string {
  if (target.mode === 'absolute') {
    switch (target.kind) {
      case 'heart-rate':
        return formatDisplayRange(
          resolveUnitAwareDisplayFromValue(DataHeartRate.type, target.minimumBpm, unitSettings),
          resolveUnitAwareDisplayFromValue(DataHeartRate.type, target.maximumBpm, unitSettings),
        ) ?? `${target.minimumBpm}–${target.maximumBpm} bpm`;
      case 'power':
        return formatDisplayRange(
          resolveUnitAwareDisplayFromValue(DataPower.type, target.minimumWatts, unitSettings),
          resolveUnitAwareDisplayFromValue(DataPower.type, target.maximumWatts, unitSettings),
        ) ?? `${target.minimumWatts}–${target.maximumWatts} W`;
      case 'speed':
        return formatDisplayRange(
          formatSpeedValue(
            target.presentation === 'pace' ? target.maximumMetersPerSecond : target.minimumMetersPerSecond,
            target.presentation,
            unitSettings,
          ),
          formatSpeedValue(
            target.presentation === 'pace' ? target.minimumMetersPerSecond : target.maximumMetersPerSecond,
            target.presentation,
            unitSettings,
          ),
        ) ?? `${target.minimumMetersPerSecond}–${target.maximumMetersPerSecond} m/s`;
      case 'cadence':
        return formatDisplayRange(
          resolveUnitAwareDisplayFromValue(DataCadence.type, target.minimumRpm, unitSettings),
          resolveUnitAwareDisplayFromValue(DataCadence.type, target.maximumRpm, unitSettings),
        ) ?? `${target.minimumRpm}–${target.maximumRpm} rpm`;
    }
  }

  const percent = formatPercentRange(target.minimumPercent, target.maximumPercent, locale);
  switch (target.kind) {
    case 'heart-rate': {
      const reference = resolveUnitAwareDisplayFromValue(DataHeartRate.type, target.reference.bpm, unitSettings)?.text
        ?? `${target.reference.bpm} bpm`;
      const label = target.reference.kind === 'max-heart-rate' ? 'max HR' : 'threshold HR';
      return `${percent} of ${reference} ${label}`;
    }
    case 'power': {
      const reference = resolveUnitAwareDisplayFromValue(DataPower.type, target.reference.watts, unitSettings)?.text
        ?? `${target.reference.watts} W`;
      const label = target.reference.kind === 'functional-threshold-power' ? 'FTP' : 'critical power';
      return `${percent} of ${reference} ${label}`;
    }
    case 'speed': {
      const reference = formatSpeedValue(target.reference.metersPerSecond, target.presentation, unitSettings)?.text
        ?? `${target.reference.metersPerSecond} m/s`;
      return `${percent} of ${reference} threshold ${target.presentation}`;
    }
    case 'cadence': {
      const reference = resolveUnitAwareDisplayFromValue(DataCadence.type, target.reference.rpm, unitSettings)?.text
        ?? `${target.reference.rpm} rpm`;
      return `${percent} of ${reference} preferred cadence`;
    }
  }
}

export function formatWorkoutStepV1(
  step: WorkoutStepV1,
  unitSettings?: UserUnitSettingsInterface | null,
  locale?: string,
): string {
  const purpose = step.purpose === 'other'
    ? 'Step'
    : `${step.purpose.charAt(0).toUpperCase()}${step.purpose.slice(1)}`;
  const ending = formatWorkoutEndingV1(step.ending, unitSettings, locale);
  const targets = step.targets.map(target => formatWorkoutTargetV1(target, unitSettings, locale));
  return [purpose, ending, ...targets].join(' · ');
}
