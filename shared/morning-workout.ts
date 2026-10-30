import { dayWorkoutLocalDate, parseGenerateDayWorkoutRequest, type DayWorkoutControls, type GenerateDayWorkoutResponse } from './day-workout';

/** Private first-party preferences; never a Training recipe or an MCP permission. */
export interface MorningWorkoutPreferences {
  enabled: boolean;
  followRoutine: boolean;
  controls: DayWorkoutControls;
}
export type MorningWorkoutRequest = { mode: 'morning'; action: 'status' | 'prepare' | 'dismiss' };
export interface MorningWorkoutStatus {
  localDate: string;
  state: 'off' | 'waiting' | 'preparing' | 'ready' | 'dismissed' | 'failed' | 'planned' | 'completed' | 'rest-day';
  controls?: DayWorkoutControls;
  result?: GenerateDayWorkoutResponse;
}
export function parseMorningWorkoutPreferences(value: unknown, now = new Date()): MorningWorkoutPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose morning workout preferences.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['enabled', 'followRoutine', 'controls'].includes(key))
    || typeof input.enabled !== 'boolean' || typeof input.followRoutine !== 'boolean'
    || !input.controls || typeof input.controls !== 'object' || Array.isArray(input.controls)) throw new Error('Invalid morning preferences.');
  const saved = input.controls as Record<string, unknown>;
  if (typeof saved.timeZone !== 'string') throw new Error('Choose a time zone.');
  const localDate = dayWorkoutLocalDate(now, saved.timeZone);
  const controls = parseGenerateDayWorkoutRequest({ requestId: 'morning-preferences', controls: { ...saved, localDate } }, now).controls;
  if (controls.destinationPlanId !== null || !controls.trainingContext || controls.activityContext === false) {
    throw new Error('Morning suggestions require Training plans and Recent activities to check whether today is already covered.');
  }
  return { enabled: input.enabled, followRoutine: input.followRoutine, controls };
}
export function isMorningWorkoutWindow(now: Date, timeZone: string): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour >= 5 && hour < 12;
}
