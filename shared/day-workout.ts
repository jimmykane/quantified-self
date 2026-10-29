import { ActivityTypes } from '@sports-alliance/sports-lib';
import { MANUAL_WORKOUT_EDITOR_SPORTS_V1, type WorkoutStructureV1 } from './planned-workout';
import { STRENGTH_WORKOUT_SPORT_ALIASES_V1, isStrengthWorkoutSportV1, type StrengthWorkoutDraftV1 } from './strength-workout';
import { normalizeTrainingLocalDate } from './training-plans';

/** First-party generation only. These controls are neither stored workout fields nor MCP grants. */
export const DAY_WORKOUT_SPORTS = [...MANUAL_WORKOUT_EDITOR_SPORTS_V1,
  ActivityTypes.StrengthTraining, ...STRENGTH_WORKOUT_SPORT_ALIASES_V1] as const;
export const DAY_WORKOUT_EQUIPMENT = ['bodyweight', 'dumbbells', 'barbell', 'kettlebell', 'bands', 'machines'] as const;
export type DayWorkoutEquipment = typeof DAY_WORKOUT_EQUIPMENT[number];
export type DayWorkoutPurpose = 'suggest' | 'recovery' | 'endurance' | 'intervals' | 'general-strength' | 'muscle-building' | 'muscular-endurance';
export type DayWorkoutTarget = 'auto' | 'heart-rate' | 'power' | 'speed' | 'none';
export interface DayWorkoutControls {
  localDate: string;
  timeZone: string;
  sport: ActivityTypes;
  minutes: number;
  purpose: DayWorkoutPurpose;
  timing: 'approximate' | 'strict';
  target: DayWorkoutTarget;
  structure: 'auto' | 'simple';
  destinationPlanId: string | null;
  equipment: DayWorkoutEquipment[];
  strengthFocus: 'full-body' | 'upper-body' | 'lower-body' | 'core';
  usePreviousWeights: boolean;
  trainingContext: boolean;
  timelineContext: boolean;
}
export interface GenerateDayWorkoutRequest { requestId: string; controls: DayWorkoutControls }
export interface DayWorkoutLoadSource { exerciseId: string; localDate: string }
export interface DayWorkoutDraft {
  title: string;
  structure: WorkoutStructureV1;
  strength?: StrengthWorkoutDraftV1;
  /** AI planning estimate only; never enters canonical analysis or persisted recipes. */
  estimatedMinutes?: { minimum: number; maximum: number };
}
export interface GenerateDayWorkoutResponse {
  requestId: string;
  observedAt: string;
  kind: 'workout' | 'rest';
  rationale: string;
  draft: DayWorkoutDraft | null;
  usedContext: string[];
  missingContext: string[];
  previousLoads: DayWorkoutLoadSource[];
}

export function dayWorkoutLocalDate(now: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function dayWorkoutDateOffset(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
export function dayWorkoutPurposes(sport: ActivityTypes): DayWorkoutPurpose[] {
  return isStrengthWorkoutSportV1(sport) ? ['suggest', 'general-strength', 'muscle-building', 'muscular-endurance']
    : ['suggest', 'recovery', 'endurance', 'intervals'];
}
export function dayWorkoutTargets(sport: ActivityTypes): DayWorkoutTarget[] {
  if (isStrengthWorkoutSportV1(sport)) return ['none'];
  return ['auto', 'heart-rate', ...(/swim|walk|hik|trek/i.test(sport) ? [] : ['power'] as const), 'speed', 'none'];
}
export function defaultDayWorkoutControls(localDate: string, timeZone: string, sport: ActivityTypes = ActivityTypes.Running): DayWorkoutControls {
  return { localDate, timeZone, sport, minutes: 30, purpose: 'suggest', timing: 'approximate',
    target: isStrengthWorkoutSportV1(sport) ? 'none' : 'auto', structure: 'auto', destinationPlanId: null,
    equipment: ['bodyweight'], strengthFocus: 'full-body', usePreviousWeights: true,
    trainingContext: true, timelineContext: true };
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid workout generation controls.');
  return value as Record<string, unknown>;
}
export function parseGenerateDayWorkoutRequest(value: unknown, now = new Date()): GenerateDayWorkoutRequest {
  const request = object(value, ['requestId', 'controls']);
  if (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(request.requestId)) throw new Error('Invalid request identifier.');
  const c = object(request.controls, Object.keys(defaultDayWorkoutControls('2000-01-01', 'UTC')));
  if (typeof c.timeZone !== 'string' || c.timeZone.length > 100) throw new Error('Choose a valid time zone.');
  const today = dayWorkoutLocalDate(now, c.timeZone);
  const localDate = normalizeTrainingLocalDate(c.localDate);
  if (localDate < today || localDate > dayWorkoutDateOffset(today, 365)) throw new Error('Choose today or a date within the next year.');
  const sport = DAY_WORKOUT_SPORTS.find(sport => sport === c.sport);
  if (!sport || !dayWorkoutPurposes(sport).includes(c.purpose as DayWorkoutPurpose)
    || !dayWorkoutTargets(sport).includes(c.target as DayWorkoutTarget)) throw new Error('Choose supported sport options.');
  if (!Number.isSafeInteger(c.minutes) || Number(c.minutes) < 5 || Number(c.minutes) > 240) throw new Error('Choose 5 to 240 minutes.');
  if (!['approximate', 'strict'].includes(String(c.timing)) || (isStrengthWorkoutSportV1(sport) && c.timing !== 'approximate')
    || !['auto', 'simple'].includes(String(c.structure))
    || !['full-body', 'upper-body', 'lower-body', 'core'].includes(String(c.strengthFocus))) throw new Error('Choose supported workout options.');
  if (c.destinationPlanId !== null && (typeof c.destinationPlanId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(c.destinationPlanId))) throw new Error('Choose a valid destination.');
  if (!Array.isArray(c.equipment) || c.equipment.length < 1 || c.equipment.length > DAY_WORKOUT_EQUIPMENT.length
    || new Set(c.equipment).size !== c.equipment.length
    || c.equipment.some(item => !DAY_WORKOUT_EQUIPMENT.includes(item))) throw new Error('Choose the available equipment.');
  for (const key of ['usePreviousWeights', 'trainingContext', 'timelineContext']) {
    if (typeof c[key] !== 'boolean') throw new Error('Explicit context choices are required.');
  }
  // Construct an allowlisted, stable-key object for request fingerprinting.
  return { requestId: request.requestId, controls: {
    localDate, timeZone: c.timeZone, sport, minutes: c.minutes as number, purpose: c.purpose as DayWorkoutPurpose,
    timing: c.timing as DayWorkoutControls['timing'], target: c.target as DayWorkoutTarget,
    structure: c.structure as DayWorkoutControls['structure'], destinationPlanId: c.destinationPlanId as string | null,
    equipment: [...c.equipment].sort(), strengthFocus: c.strengthFocus as DayWorkoutControls['strengthFocus'],
    usePreviousWeights: c.usePreviousWeights as boolean, trainingContext: c.trainingContext as boolean,
    timelineContext: c.timelineContext as boolean,
  } };
}
