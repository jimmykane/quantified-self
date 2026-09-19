import { z } from 'zod';
import { TRAINING_WRITE_INPUTS } from './training-plans.schemas';

/**
 * Temporary incident probe for the external Training write loop reported on 2026-09-19.
 * It records schema shape only, never authored values, opaque references, dates, titles,
 * notes, recipe values, JSON-RPC IDs, bearer tokens, or connection/user identifiers.
 */
export const TEMPORARY_TRAINING_DIAGNOSTICS_EXPIRES_AT_MS = Date.parse('2026-09-22T00:00:00Z');

const TRAINING_WRITE_TOOL_NAMES = new Set([
  'preview_create_planned_workout',
  'preview_training_changes',
  'apply_training_changes',
]);
const TRAINING_CHANGE_KINDS = new Set([
  'create-plan',
  'rename-plan',
  'set-plan-color',
  'set-plan-lifecycle',
  'shift-plan',
  'create-workout',
  'update-workout',
  'move-workout',
  'copy-workout',
  'set-workout-lifecycle',
  'delete-workout',
  'provider-delivery',
]);
const SAFE_KIND_ALIASES = new Set([
  'add-workout',
  'create',
  'create-planned-workout',
  'createWorkout',
  'create_planned_workout',
  'create_workout',
  'schedule-workout',
  'workout-create',
]);
const SAFE_VALIDATION_PATH_SEGMENTS = new Set([
  'expectedScheduleRevision',
  'changes',
  'kind',
  'localKey',
  'name',
  'color',
  'startDate',
  'endDate',
  'activate',
  'plan',
  'planRef',
  'lifecycle',
  'days',
  'localDate',
  'title',
  'structure',
  'version',
  'sport',
  'nodes',
  'id',
  'purpose',
  'ending',
  'seconds',
  'meters',
  'kilojoules',
  'repetitions',
  'targets',
  'note',
  'mode',
  'minimumPercent',
  'maximumPercent',
  'minimumBpm',
  'maximumBpm',
  'minimumWatts',
  'maximumWatts',
  'presentation',
  'minimumMetersPerSecond',
  'maximumMetersPerSecond',
  'minimumRpm',
  'maximumRpm',
  'reference',
  'bpm',
  'watts',
  'metersPerSecond',
  'rpm',
  'count',
  'steps',
  'workout',
  'sourceWorkout',
  'targetType',
  'target',
  'providers',
  'action',
  'timeZone',
  'proposalRef',
  'permissionMode',
]);

type SafeValidationIssue = {
  code: string;
  path: Array<string | number>;
};

export type TemporaryTrainingRequestDiagnostic = {
  toolName: 'preview_create_planned_workout' | 'preview_training_changes' | 'apply_training_changes';
  inputValid: boolean;
  argumentsShape: 'object' | 'missing_or_invalid';
  validationIssues: SafeValidationIssue[];
  presentFields?: string[];
  structureShape?: 'object' | 'missing_or_invalid';
  structureFields?: string[];
  nodeCount?: number;
  firstNodeShape?: 'object' | 'missing_or_invalid';
  firstNodeKind?: 'step' | 'repeat' | 'missing_or_invalid';
  changeCount?: number;
  changeKinds?: string[];
  firstChangeFields?: string[];
  permissionMode?: 'schedule' | 'delivery' | 'combined' | 'missing_or_invalid';
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safePresentFields(value: Record<string, unknown> | null): string[] {
  if (!value) return [];
  return Object.keys(value)
    .filter(key => SAFE_VALIDATION_PATH_SEGMENTS.has(key))
    .sort()
    .slice(0, 40);
}

function validationIssues(error: z.ZodError): SafeValidationIssue[] {
  return error.issues.slice(0, 12).map(issue => ({
    code: issue.code,
    path: issue.path.slice(0, 10).map((part): string | number => {
      if (typeof part === 'number') return part >= 0 && part <= 100 ? part : -1;
      return typeof part === 'string' && SAFE_VALIDATION_PATH_SEGMENTS.has(part)
        ? part
        : '<field>';
    }),
  }));
}

function safeChangeKind(value: unknown): string {
  if (typeof value !== 'string') return '<missing_or_invalid>';
  if (TRAINING_CHANGE_KINDS.has(value)) return value;
  if (SAFE_KIND_ALIASES.has(value)) return `alias:${value}`;
  return '<unrecognized>';
}

export function temporaryTrainingDiagnosticsEnabled(nowMs = Date.now()): boolean {
  return nowMs < TEMPORARY_TRAINING_DIAGNOSTICS_EXPIRES_AT_MS;
}

export function buildTemporaryTrainingRequestDiagnostic(
  body: unknown,
  nowMs = Date.now(),
): TemporaryTrainingRequestDiagnostic | null {
  if (!temporaryTrainingDiagnosticsEnabled(nowMs)) return null;
  const envelope = asRecord(body);
  if (envelope?.method !== 'tools/call') return null;
  const params = asRecord(envelope.params);
  const toolName = typeof params?.name === 'string' ? params.name : '';
  if (!TRAINING_WRITE_TOOL_NAMES.has(toolName)) return null;
  const args = asRecord(params?.arguments);
  const schema = toolName === 'preview_create_planned_workout'
    ? TRAINING_WRITE_INPUTS.preview_create_planned_workout
    : toolName === 'preview_training_changes'
      ? TRAINING_WRITE_INPUTS.preview_training_changes
      : TRAINING_WRITE_INPUTS.apply_training_changes;
  const parsed = schema.safeParse(args ?? {});
  const base = {
    toolName: toolName as TemporaryTrainingRequestDiagnostic['toolName'],
    inputValid: parsed.success,
    argumentsShape: args ? 'object' as const : 'missing_or_invalid' as const,
    validationIssues: parsed.success ? [] : validationIssues(parsed.error),
    presentFields: safePresentFields(args),
  };

  if (toolName === 'apply_training_changes') {
    const permissionMode = args?.permissionMode;
    return {
      ...base,
      permissionMode: permissionMode === 'schedule'
        || permissionMode === 'delivery'
        || permissionMode === 'combined'
        ? permissionMode
        : 'missing_or_invalid',
    };
  }

  if (toolName === 'preview_create_planned_workout') {
    const structure = asRecord(args?.structure);
    const nodes = Array.isArray(structure?.nodes) ? structure.nodes : null;
    const firstNode = nodes?.length ? asRecord(nodes[0]) : null;
    return {
      ...base,
      structureShape: structure ? 'object' : 'missing_or_invalid',
      structureFields: safePresentFields(structure),
      ...(nodes ? { nodeCount: Math.min(nodes.length, 101) } : {}),
      firstNodeShape: firstNode ? 'object' : 'missing_or_invalid',
      firstNodeKind: firstNode?.kind === 'step' || firstNode?.kind === 'repeat'
        ? firstNode.kind
        : 'missing_or_invalid',
    };
  }

  const changes = Array.isArray(args?.changes) ? args.changes : null;
  const firstChange = changes?.length ? asRecord(changes[0]) : null;
  return {
    ...base,
    ...(changes ? {
      changeCount: Math.min(changes.length, 26),
      changeKinds: changes.slice(0, 25).map(change => safeChangeKind(asRecord(change)?.kind)),
      firstChangeFields: safePresentFields(firstChange),
    } : {}),
  };
}
