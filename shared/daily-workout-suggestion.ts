import { dayWorkoutLocalDate, parseGenerateDayWorkoutRequest, type DayWorkoutControls, type GenerateDayWorkoutResponse } from './day-workout';

/** Private first-party preferences; never a Training recipe or an MCP permission. */
export interface DailyWorkoutSuggestionPreferences {
  enabled: boolean;
  followRoutine: boolean;
  controls: DayWorkoutControls;
}
export type DailyWorkoutSuggestionRequest = { mode: 'daily-suggestion'; action: 'status' | 'prepare' }
  | { mode: 'daily-suggestion'; action: 'dismiss' | 'use-available-data'; localDate: string };
export interface DailyWorkoutSuggestionStatus {
  localDate: string;
  state: 'off' | 'waiting' | 'waiting-sleep' | 'preparing' | 'ready' | 'dismissed' | 'failed' | 'planned' | 'completed' | 'rest-day';
  controls?: DayWorkoutControls;
  result?: GenerateDayWorkoutResponse;
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
