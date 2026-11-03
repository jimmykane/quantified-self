import { ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { resolveActivityTypeGroup } from './activity-type-group.metadata';
import { normalizeTrainingLocalDate } from './training-plans';

export const TRAINING_GOALS_COLLECTION = 'trainingGoals';
export const TRAINING_GOAL_STATE_PATH = 'trainingGoalState/current';
export const TRAINING_GOALS_LIMIT = 200;
export const TRAINING_GOAL_KINDS = ['event', 'milestone', 'ongoing'] as const;
export const TRAINING_GOAL_PRIORITIES = ['high', 'normal', 'low'] as const;
export const TRAINING_GOAL_LIFECYCLES = ['active', 'paused', 'completed', 'archived'] as const;
export const TRAINING_GOAL_TARGETS = ['workouts', 'days', 'duration', 'distance'] as const;
export interface TrainingGoalFields {
  name: string;
  kind: typeof TRAINING_GOAL_KINDS[number];
  lifecycle: typeof TRAINING_GOAL_LIFECYCLES[number];
  priority: typeof TRAINING_GOAL_PRIORITIES[number];
  startLocalDate: string;
  targetLocalDate: string | null;
  sportScope: 'all' | 'sport' | 'family';
  sport: string | null;
  objective: string;
  planId: string | null;
  /** Canonical seconds/metres, or an integer count. Null means manual achievement. */
  weeklyTarget: { kind: typeof TRAINING_GOAL_TARGETS[number]; value: number } | null;
}
export interface TrainingGoalV1 extends TrainingGoalFields {
  schemaVersion: 1;
  id: string;
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
}
export const TRAINING_GOAL_FIELDS = ['name', 'kind', 'lifecycle', 'priority', 'startLocalDate', 'targetLocalDate',
  'sportScope', 'sport', 'objective', 'planId', 'weeklyTarget'] as const;
export const TRAINING_GOAL_STORED_FIELDS = [...TRAINING_GOAL_FIELDS, 'schemaVersion', 'id', 'revision', 'createdAtMs', 'updatedAtMs'];
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !fields.includes(key))) throw Error('Invalid goal fields.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error('Invalid goal text.');
  return value.trim();
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw Error('Invalid goal choice.');
  return value as T;
}
export function parseTrainingGoalFields(value: unknown): TrainingGoalFields {
  const v = object(value, TRAINING_GOAL_FIELDS);
  const kind = choice(v.kind, TRAINING_GOAL_KINDS);
  const startLocalDate = normalizeTrainingLocalDate(v.startLocalDate);
  const targetLocalDate = v.targetLocalDate === null ? null : normalizeTrainingLocalDate(v.targetLocalDate);
  if ((kind === 'ongoing') !== (targetLocalDate === null) || (targetLocalDate && targetLocalDate < startLocalDate)) {
    throw Error('Choose valid goal dates.');
  }
  const sportScope = choice(v.sportScope, ['all', 'sport', 'family']);
  const sport = v.sport === null ? null : text(v.sport, 100, true);
  if ((sportScope === 'all') !== (sport === null)
    || (sportScope === 'sport' && ActivityTypesHelper.resolveActivityType(sport!) !== sport)
    || (sportScope === 'family' && resolveActivityTypeGroup(sport) !== sport)) throw Error('Choose a supported sport or family.');
  if (v.planId !== null && (typeof v.planId !== 'string' || !idPattern.test(v.planId))) throw Error('Choose a valid plan.');
  let weeklyTarget: TrainingGoalFields['weeklyTarget'] = null;
  if (v.weeklyTarget !== null) {
    const target = object(v.weeklyTarget, ['kind', 'value']);
    const metric = choice(target.kind, TRAINING_GOAL_TARGETS);
    const max = { workouts: 100, days: 7, duration: 604800, distance: 10000000 }[metric];
    if (kind !== 'ongoing' || typeof target.value !== 'number' || !Number.isFinite(target.value)
      || target.value <= 0 || target.value > max || (['days', 'workouts'].includes(metric) && !Number.isSafeInteger(target.value))) {
      throw Error('Choose a valid weekly target.');
    }
    weeklyTarget = { kind: metric, value: target.value };
  }
  return { name: text(v.name, 120, true), kind, lifecycle: choice(v.lifecycle, TRAINING_GOAL_LIFECYCLES),
    priority: choice(v.priority, TRAINING_GOAL_PRIORITIES), startLocalDate, targetLocalDate, sportScope, sport,
    objective: text(v.objective, 2000), planId: v.planId as string | null, weeklyTarget };
}
export function parseTrainingGoalV1(value: unknown, documentId?: string): TrainingGoalV1 {
  const v = object(value, TRAINING_GOAL_STORED_FIELDS);
  if (v.schemaVersion !== 1 || typeof v.id !== 'string' || !idPattern.test(v.id) || (documentId && documentId !== v.id)
    || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1
    || !Number.isSafeInteger(v.createdAtMs) || Number(v.createdAtMs) < 0
    || !Number.isSafeInteger(v.updatedAtMs) || Number(v.updatedAtMs) < Number(v.createdAtMs)) throw Error('Invalid goal record.');
  const fields = Object.fromEntries(TRAINING_GOAL_FIELDS.map(key => [key, v[key]]));
  return { ...parseTrainingGoalFields(fields), schemaVersion: 1, id: v.id, revision: Number(v.revision),
    createdAtMs: Number(v.createdAtMs), updatedAtMs: Number(v.updatedAtMs) };
}
export function trainingGoalMatchesSport(goal: Pick<TrainingGoalFields, 'sport' | 'sportScope'>, sport: string): boolean {
  if (goal.sportScope === 'all') return true;
  const type = ActivityTypesHelper.resolveActivityType(sport);
  return !!type && (goal.sportScope === 'sport' ? type === goal.sport
    : ActivityTypesHelper.getActivityGroupForActivityType(type) === goal.sport);
}
export function trainingGoalMarkerDate(goal: TrainingGoalFields): string {
  return goal.targetLocalDate ?? goal.startLocalDate;
}
export interface TrainingGoalMarker { label: string; count: number; ariaLabel: string }
export function trainingGoalMarkers(goals: TrainingGoalV1[]): Record<string, TrainingGoalMarker> {
  const dates = new Map<string, TrainingGoalV1[]>();
  for (const goal of goals.filter(goal => goal.lifecycle !== 'archived')) {
    const date = trainingGoalMarkerDate(goal);
    dates.set(date, [...(dates.get(date) ?? []), goal]);
  }
  return Object.fromEntries([...dates].map(([date, goals]) => [date, { label: goals[0].name, count: goals.length,
    ariaLabel: `${goals.length} goal${goals.length === 1 ? '' : 's'}: ${goals.map(goal => goal.name).join(', ')}` }]));
}
export function relevantTrainingGoals(goals: TrainingGoalV1[], localDate: string, sport: string): TrainingGoalV1[] {
  return goals.filter(goal => goal.lifecycle === 'active' && goal.startLocalDate <= localDate
    && (!goal.targetLocalDate || goal.targetLocalDate >= localDate) && trainingGoalMatchesSport(goal, sport))
    .sort((a, b) => TRAINING_GOAL_PRIORITIES.indexOf(a.priority) - TRAINING_GOAL_PRIORITIES.indexOf(b.priority)
      || (a.targetLocalDate ?? '9999-12-31').localeCompare(b.targetLocalDate ?? '9999-12-31') || a.id.localeCompare(b.id));
}
