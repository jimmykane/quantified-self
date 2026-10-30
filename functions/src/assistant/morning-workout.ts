import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { isMorningWorkoutWindow, type MorningWorkoutPreferences, type MorningWorkoutStatus } from '../../../shared/morning-workout';
import { type GenerateDayWorkoutRequest } from '../../../shared/day-workout';
import { enforceAppCheck, getUserRoleAndGracePeriod } from '../utils';
import { assertAssistantLegalAccess } from './access';
import { createMorningWorkoutStore, type MorningWorkoutStore } from './morning-workout-store';
import { dayWorkoutDependencies, generateDayWorkoutSuggestion, generateValidatedDayWorkout } from './day-workout-callable';
import type { DayWorkoutContext } from './day-workout-context';
import { selectMorningWorkoutSport } from './morning-workout-routine';
import { ASSISTANT_MODEL_NAME } from './model';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
export function morningWorkoutSkip(context: DayWorkoutContext): MorningWorkoutStatus['state'] | null {
  const daily = record(context.evidence.daily), activities = record(daily.activitiesToday), planned = record(daily.plannedWorkouts);
  if (activities.scanComplete !== true || planned.scanComplete !== true || planned.completionChecked !== true
    || !Array.isArray(activities.activities) || !Array.isArray(planned.workouts)) throw new Error('Today could not be checked completely.');
  if (context.plannedRestDay || record(planned.restDayContext).status === 'rest') return 'rest-day';
  if (record(planned.restDayContext).status !== 'none') throw new Error('Rest-day context is unavailable.');
  if (activities.activities.length) return 'completed';
  if (planned.workouts.some(item => record(item).lifecycle === 'planned')) return 'planned';
  return null;
}
export interface MorningWorkoutDependencies {
  store: MorningWorkoutStore;
  now(): Date;
  legal: typeof assertAssistantLegalAccess;
  pro(uid: string): Promise<boolean>;
  selectSport(uid: string, preferences: MorningWorkoutPreferences, now: Date): Promise<MorningWorkoutPreferences['controls']>;
  context: typeof dayWorkoutDependencies.context;
  generate: typeof generateDayWorkoutSuggestion;
  log(fields: RecordValue): void;
}
const defaults: MorningWorkoutDependencies = {
  store: createMorningWorkoutStore(), now: () => new Date(), legal: assertAssistantLegalAccess,
  pro: async uid => (await getUserRoleAndGracePeriod(uid)).role === 'pro',
  selectSport: selectMorningWorkoutSport, context: dayWorkoutDependencies.context, generate: generateDayWorkoutSuggestion,
  log: fields => logger.info('[MorningWorkout]', fields),
};
export async function runMorningWorkout(value: unknown, context: { auth?: { uid: string } | null; app?: unknown },
  dependencies: MorningWorkoutDependencies = defaults): Promise<MorningWorkoutStatus> {
  if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to use morning suggestions.');
  enforceAppCheck(context);
  const input = record(value);
  if (Object.keys(input).some(key => !['mode', 'action'].includes(key)) || input.mode !== 'morning'
    || !['status', 'prepare', 'dismiss'].includes(String(input.action))) throw new HttpsError('invalid-argument', 'Choose a morning action.');
  const uid = context.auth.uid;
  await dependencies.legal(uid);
  if (!await dependencies.pro(uid)) throw new HttpsError('permission-denied', 'Morning suggestions require Pro.');
  if (input.action === 'dismiss') return dependencies.store.dismiss(uid);
  const { preferences, status } = await dependencies.store.read(uid);
  if (input.action === 'status' || !preferences || status.state !== 'waiting') return status;
  const now = dependencies.now();
  if (!isMorningWorkoutWindow(now, preferences.controls.timeZone)) return status;
  const token = await dependencies.store.begin(uid, preferences);
  if (!token) return (await dependencies.store.read(uid)).status;
  const date = preferences.controls.localDate;
  const assertActive = async () => {
    await dependencies.store.assertActive(uid, date, token);
    if (!await dependencies.pro(uid)) throw new HttpsError('permission-denied', 'Morning suggestions require Pro.');
  };
  let attempts = 0, meteredAttempts = 0, inputTokens = 0, outputTokens = 0, thoughtsTokens = 0;
  let outcome: MorningWorkoutStatus['state'] = 'failed';
  try {
    const controls = await dependencies.selectSport(uid, preferences, now);
    const request: GenerateDayWorkoutRequest = { requestId: `morning:${date}`, controls };
    const evidence = await dependencies.context(uid, request, now);
    await assertActive();
    const skip = morningWorkoutSkip(evidence);
    if (skip) {
      outcome = skip;
      await dependencies.store.finish(uid, date, token, skip);
    } else {
      // Separate daily allowance. Never reserve/finalize Assistant billing-period quota.
      await dependencies.store.charge(uid, date, token);
      const suggestion = await generateValidatedDayWorkout(request, evidence, async (request, evidence, correction) => {
        attempts++;
        return dependencies.generate(request, evidence, correction, usage => {
          if (usage.available) meteredAttempts++; inputTokens += usage.inputTokens; outputTokens += usage.outputTokens; thoughtsTokens += usage.thoughtsTokens;
        });
      }, assertActive);
      await assertActive();
      const result = { requestId: request.requestId, observedAt: now.toISOString(), ...suggestion,
        usedContext: evidence.usedContext, missingContext: evidence.missingContext };
      await dependencies.store.finish(uid, date, token, 'ready', controls, result);
      outcome = 'ready';
    }
    return (await dependencies.store.read(uid)).status;
  } catch {
    await dependencies.store.finish(uid, date, token, 'failed').catch(() => undefined);
    throw new HttpsError('unavailable', 'Today’s suggestion could not finish. Check again to retrieve it, or use the manual generator.');
  } finally {
    // Aggregate counters only. Meter at the provider response boundary, including invalid JSON/correction attempts.
    // Missing usage is explicit; do not interpret unknown provider failures as a measured zero-dollar request.
    try { dependencies.log({ outcome, attempts, meteredAttempts, unmeteredAttempts: attempts - meteredAttempts,
      inputTokens, outputTokens, thoughtsTokens, model: ASSISTANT_MODEL_NAME,
      durationMs: Math.max(0, dependencies.now().getTime() - now.getTime()) }); } catch { /* Diagnostics are best effort. */ }
  }
}
