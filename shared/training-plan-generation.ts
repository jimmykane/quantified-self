import { ASSISTANT_MAX_MESSAGE_CHARS } from './assistant.types';
import { DAY_WORKOUT_SPORTS, dayWorkoutDateOffset } from './day-workout';
import { normalizeTrainingLocalDate } from './training-plans';

export interface PlanAssistantRequest { prompt: string; timelineNotesEnabled: boolean }
export interface PlanGenerationOptions {
  startLocalDate: string; weeks: number; sport: string | null; days: number[] | null;
  minutes: number | null; goalNames: string[]; timelineNotesEnabled: boolean; instructions: string;
}
export const PLAN_WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];
export function nextPlanMonday(today: string): string {
  normalizeTrainingLocalDate(today);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return dayWorkoutDateOffset(today, (8 - weekday) % 7 || 7);
}
export function buildPlanAssistantRequest(options: PlanGenerationOptions, today: string): PlanAssistantRequest {
  const start = normalizeTrainingLocalDate(options.startLocalDate);
  if (start < today || start > dayWorkoutDateOffset(today, 365)) throw Error('Choose a start date within the next year.');
  if (!Number.isInteger(options.weeks) || options.weeks < 1 || options.weeks > 8) throw Error('Choose 1–8 weeks.');
  if (options.sport !== null && !DAY_WORKOUT_SPORTS.some(sport => sport === options.sport)) throw Error('Choose a supported sport.');
  if (options.days !== null && (!options.days.length || new Set(options.days).size !== options.days.length
    || options.days.some(day => !Number.isInteger(day) || day < 0 || day > 6))) throw Error('Choose at least one training day.');
  if (options.minutes !== null && (!Number.isInteger(options.minutes) || options.minutes < 5 || options.minutes > 240)) {
    throw Error('Choose 5–240 whole minutes per session.');
  }
  if (options.instructions.length > 200 || options.goalNames.some(name => !name.trim() || name.length > 120)) {
    throw Error('Shorten the additional instructions or goal names.');
  }
  const end = dayWorkoutDateOffset(start, options.weeks * 7 - 1);
  const prompt = [
    `Create a new training plan for ${start} through ${end}. Sport: ${options.sport ?? 'suggest from my goals and recorded routine'}.`,
    options.days === null ? 'Suggest training days from my last 28 days of recorded routine.'
      : `Training days: ${PLAN_WEEKDAYS.filter(day => options.days!.includes(day.value)).map(day => day.label).join(', ')}.`,
    options.minutes === null ? 'Use my usual session duration; ask if history is insufficient.' : `Session limit: ${options.minutes} minutes.`,
    options.goalNames.length ? `Focus on these saved goals; read their details and priorities: ${options.goalNames.map(name => JSON.stringify(name)).join(', ')}.`
      : 'Goal focus: none. Goal creation is outside this request.',
    'Use recent training/load and available sleep, HRV and readiness. Recovery informs the first sessions, not a forecast.',
    options.timelineNotesEnabled ? 'Consider relevant Timeline notes.' : 'Do not use Timeline notes.',
    'Preserve existing workouts and rest days. Preview a paused plan with workouts and rest days; ask before activation. Review changes before saving, in batches if needed.',
    options.instructions.trim(),
  ].filter(Boolean).join('\n');
  if (prompt.length > ASSISTANT_MAX_MESSAGE_CHARS) throw Error('Select fewer goals or shorten the additional instructions.');
  return { prompt, timelineNotesEnabled: options.timelineNotesEnabled };
}
