import { normalizeTrainingLocalDate } from './training-plans';
import { dayWorkoutLocalDate, parseGenerateDayWorkoutRequest, type DayWorkoutControls, type GenerateDayWorkoutResponse, type GenerateDayWorkoutRequest } from './day-workout';

/** Private first-party preferences; never a Training recipe or an MCP permission. */
export interface DailyWorkoutSuggestionPreferences {
  enabled: boolean;
  followRoutine: boolean;
  controls: DayWorkoutControls;
}
export type DailyWorkoutSuggestionRequest = ({ mode: 'daily-suggestion'; action: 'status' | 'prepare' }
  | { mode: 'daily-suggestion'; action: 'dismiss' | 'use-available-data'; localDate: string }) & { resultVersion?: 2 };
export interface RegenerateDailyWorkoutSuggestionRequest {
  mode: 'daily-suggestion'; action: 'regenerate'; expectedRequestId: string; request: GenerateDayWorkoutRequest;
}
export interface DailyWorkoutEventAdviceV1 {
  version: 1;
  kind: 'event-advice';
  requestId: string;
  observedAt: string;
  rationale: string;
  events: Array<{ name: string; localDate: string }>;
  usedContext: string[];
  missingContext: string[];
  draft: null;
  previousLoads: [];
}
export type DailyWorkoutSuggestionResult = GenerateDayWorkoutResponse | DailyWorkoutEventAdviceV1;
export type DailyWorkoutFailureReason = 'temporary-service' | 'invalid-output' | 'unknown';
export function isDailyWorkoutFailureReason(value: unknown): value is DailyWorkoutFailureReason {
  return value === 'temporary-service' || value === 'invalid-output' || value === 'unknown';
}
export interface DailyWorkoutSuggestionStatus {
  localDate: string;
  state: 'off' | 'waiting' | 'waiting-sleep' | 'waiting-import' | 'preparing' | 'ready' | 'dismissed' | 'failed' | 'planned' | 'completed' | 'rest-day';
  controls?: DayWorkoutControls;
  result?: DailyWorkoutSuggestionResult;
  /** Fixed first-party failure category; never model output or provider error text. */
  failureReason?: DailyWorkoutFailureReason;
}
function validAdviceDate(value: unknown): boolean {
  try { normalizeTrainingLocalDate(value); return true; } catch { return false; }
}
export function isDailyWorkoutEventAdvice(value: unknown): value is DailyWorkoutEventAdviceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every(key => ['version', 'kind', 'requestId', 'observedAt', 'rationale', 'events', 'usedContext', 'missingContext', 'draft', 'previousLoads'].includes(key))
    && v.version === 1 && v.kind === 'event-advice' && typeof v.requestId === 'string' && v.requestId.length > 0 && v.requestId.length <= 100
    && typeof v.observedAt === 'string' && Number.isFinite(Date.parse(v.observedAt))
    && typeof v.rationale === 'string' && v.rationale.trim().length > 0 && v.rationale.length <= 3000
    && v.draft === null && Array.isArray(v.previousLoads) && v.previousLoads.length === 0
    && [v.usedContext, v.missingContext].every(items => Array.isArray(items) && items.length <= 100
      && items.every(item => typeof item === 'string' && item.length <= 2000))
    && Array.isArray(v.events) && v.events.length >= 1 && v.events.length <= 200
    && v.events.every(event => event && typeof event === 'object' && Object.keys(event).every(key => ['name', 'localDate'].includes(key))
      && typeof event.name === 'string' && event.name.trim().length > 0 && event.name.length <= 120
      && validAdviceDate(event.localDate));
}
export function parseDailyWorkoutSuggestionPreferences(value: unknown, now = new Date()): DailyWorkoutSuggestionPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose daily workout preferences.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['enabled', 'followRoutine', 'controls'].includes(key))
    || typeof input.enabled !== 'boolean' || typeof input.followRoutine !== 'boolean'
    || !input.controls || typeof input.controls !== 'object' || Array.isArray(input.controls)) throw new Error('Invalid daily preferences.');
  const saved = input.controls as Record<string, unknown>;
  if (typeof saved.timeZone !== 'string') throw new Error('Choose a time zone.');
  const localDate = dayWorkoutLocalDate(now, saved.timeZone);
  const controls = parseGenerateDayWorkoutRequest({ requestId: 'daily-preferences', controls: { ...saved, localDate } }, now).controls;
  if (controls.destinationPlanId !== null || !controls.trainingContext || controls.activityContext === false) {
    throw new Error('Daily suggestions require Training plans and Recent activities to check whether today is already covered.');
  }
  return { enabled: input.enabled, followRoutine: input.followRoutine, controls };
}
