import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { type DailyWorkoutSuggestionPreferences, type DailyWorkoutSuggestionStatus } from '../../../shared/daily-workout-suggestion';
import { normalizeTrainingLocalDate } from '../../../shared/training-plans';
import { dayWorkoutDateOffset, dayWorkoutLocalDate, type DayWorkoutControls, type GenerateDayWorkoutRequest } from '../../../shared/day-workout';
import { enforceAppCheck, getUserRoleAndGracePeriod } from '../utils';
import { assertAssistantLegalAccess } from './access';
import { createDailyWorkoutSuggestionStore, type DailyWorkoutSuggestionStore } from './daily-workout-suggestion-store';
import { dayWorkoutDependencies, generateDayWorkoutSuggestion, generateValidatedDayWorkout } from './day-workout-callable';
import type { DayWorkoutContext } from './day-workout-context';
import { selectDailyWorkoutSuggestionSport } from './daily-workout-suggestion-routine';
import { createAssistantMcpSession, type AssistantMcpSession } from './mcp-session';
import { readDailyWorkoutPlanContext } from './daily-workout-context';
import { ASSISTANT_MODEL_NAME } from './model';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
/** Recent completed sleep establishes an expectation, not a provider-sync promise. Missing reads remain unknown. */
export function dailyWorkoutSuggestionAwaitsSleep(controls: DayWorkoutControls, context: DayWorkoutContext, now: Date): boolean {
  if (controls.sleepContext === false) return false;
  const report = record(record(context.evidence.daily).dailyReport), sleep = record(report.sleep);
  if (sleep.status === 'no_completed_session' && sleep.latestSession === null) return false;
  const end = record(sleep.latestSession).endTimeMs;
  if (sleep.status !== 'available' || typeof end !== 'number' || !Number.isFinite(end) || end > now.getTime()
    || !Number.isFinite(new Date(end).getTime())) return true;
  const endedOn = dayWorkoutLocalDate(new Date(end), controls.timeZone);
  if (endedOn < dayWorkoutDateOffset(controls.localDate, -7)) return false;
  if (endedOn !== controls.localDate) return true;
  const driver = record(record(record(report.readiness).drivers).sleep);
  return driver.status !== 'available' || driver.latestSleepAtMs !== end;
}
export function dailyWorkoutSuggestionSkip(context: DayWorkoutContext): DailyWorkoutSuggestionStatus['state'] | null {
  const daily = record(context.evidence.daily), activities = record(daily.activitiesToday), planned = record(daily.plannedWorkouts);
  if (activities.scanComplete !== true || planned.scanComplete !== true || planned.completionChecked !== true
    || !Array.isArray(activities.activities) || !Array.isArray(planned.workouts)) throw new Error('Today could not be checked completely.');
  if (context.plannedRestDay || record(planned.restDayContext).status === 'rest') return 'rest-day';
  if (record(planned.restDayContext).status !== 'none') throw new Error('Rest-day context is unavailable.');
  if (activities.activities.length) return 'completed';
  if (planned.workouts.some(item => record(item).lifecycle === 'planned')) return 'planned';
  return null;
}
type DayCoverage = 'planned' | 'completed' | 'rest-day' | null;
/** Reads only today's activity summaries and the existing revision-bound schedule/rest projection. */
export async function collectDailyWorkoutSuggestionCoverage(controls: DayWorkoutControls,
  session: Pick<AssistantMcpSession, 'callTool'>): Promise<DayCoverage> {
  const activities = (await session.callTool('query_activities', { relativePeriod: 'today', timeZone: controls.timeZone, limit: 1 })).structuredContent;
  if (!Array.isArray(activities.activities)) throw Error('Today’s activities are unavailable.');
  // Positive existence is sufficient; a partial empty page cannot establish absence.
  if (activities.activities.length) return 'completed';
  if (activities.scanComplete !== true) throw Error('Today’s activities are incomplete.');
  const planned = await readDailyWorkoutPlanContext(controls.localDate, true, async (name, args) => {
    // Phase details cannot affect day coverage. Rest intent still uses the shared validated read.
    if (name === 'get_training_plan_phases') return {};
    return (await session.callTool(name, args)).structuredContent;
  });
  if (planned.restDayContext?.status === 'rest') return 'rest-day';
  if (planned.workouts.some(workout => workout.lifecycle === 'planned')) return 'planned';
  if (!planned.scanComplete || !planned.completionChecked || planned.restDayContext?.status !== 'none') {
    throw Error('Today’s schedule is incomplete.');
  }
  return null;
}
async function readDailyWorkoutSuggestionCoverage(uid: string, controls: DayWorkoutControls): Promise<DayCoverage> {
  const session = await createAssistantMcpSession(uid, 'https://quantified-self.io', undefined, 'coordinate_free', false, true);
  try { return await collectDailyWorkoutSuggestionCoverage(controls, session); }
  catch { throw new HttpsError('unavailable', 'Today’s schedule and recorded workouts could not be checked. Try again.'); }
  finally { await session.close(); }
}
export interface DailyWorkoutSuggestionDependencies {
  store: DailyWorkoutSuggestionStore;
  now(): Date;
  legal: typeof assertAssistantLegalAccess;
  pro(uid: string): Promise<boolean>;
  selectSport(uid: string, preferences: DailyWorkoutSuggestionPreferences, now: Date): Promise<DailyWorkoutSuggestionPreferences['controls']>;
  context: typeof dayWorkoutDependencies.context;
  coverage(uid: string, controls: DayWorkoutControls): Promise<DayCoverage>;
  generate: typeof generateDayWorkoutSuggestion;
  log(fields: RecordValue): void;
}
const defaults: DailyWorkoutSuggestionDependencies = {
  store: createDailyWorkoutSuggestionStore(), now: () => new Date(), legal: assertAssistantLegalAccess,
  pro: async uid => (await getUserRoleAndGracePeriod(uid)).role === 'pro',
  selectSport: selectDailyWorkoutSuggestionSport, coverage: readDailyWorkoutSuggestionCoverage, context: dayWorkoutDependencies.context, generate: generateDayWorkoutSuggestion,
  log: fields => logger.info('[DailyWorkoutSuggestion]', fields),
};
const coveredStates = ['planned', 'completed', 'rest-day'];
async function currentDailyWorkoutSuggestionStatus(uid: string, dependencies: DailyWorkoutSuggestionDependencies) {
  const initial = await dependencies.store.read(uid);
  if (!initial.preferences || !['waiting', 'waiting-sleep', 'ready', 'failed', ...coveredStates].includes(initial.status.state)) return initial;
  const coverage = await dependencies.coverage(uid, initial.preferences.controls);
  // Dismissal, disablement, deletion or a day/zone change during the read must supersede its result.
  const latest = await dependencies.store.read(uid);
  if (!latest.preferences) return latest;
  if (latest.preferences.controls.localDate !== initial.preferences.controls.localDate
    || latest.preferences.controls.timeZone !== initial.preferences.controls.timeZone) {
    throw new HttpsError('aborted', 'The day changed. Check today again.');
  }
  if (['dismissed', 'preparing', 'off'].includes(latest.status.state)) return latest;
  if (coverage) return { ...latest, status: { localDate: latest.status.localDate, state: coverage } };
  // A skipped day spent no model allowance. Removed workouts/rest intent can make it eligible again.
  return coveredStates.includes(latest.status.state)
    ? { ...latest, status: { localDate: latest.status.localDate, state: 'waiting' as const } } : latest;
}
export async function runDailyWorkoutSuggestion(value: unknown, context: { auth?: { uid: string } | null; app?: unknown },
  dependencies: DailyWorkoutSuggestionDependencies = defaults): Promise<DailyWorkoutSuggestionStatus> {
  if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to use daily suggestions.');
  enforceAppCheck(context);
  const input = record(value);
  const datedAction = input.action === 'dismiss' || input.action === 'use-available-data';
  const keys = datedAction ? ['mode', 'action', 'localDate'] : ['mode', 'action'];
  if (Object.keys(input).some(key => !keys.includes(key)) || input.mode !== 'daily-suggestion'
    || typeof input.action !== 'string' || !['status', 'prepare', 'dismiss', 'use-available-data'].includes(input.action)) throw new HttpsError('invalid-argument', 'Choose a daily action.');
  const uid = context.auth.uid;
  await dependencies.legal(uid);
  if (!await dependencies.pro(uid)) throw new HttpsError('permission-denied', 'Daily suggestions require Pro.');
  let expectedDate: string | undefined;
  if (datedAction) {
    try { expectedDate = normalizeTrainingLocalDate(input.localDate); }
    catch { throw new HttpsError('invalid-argument', 'Choose the displayed day.'); }
  }
  if (input.action === 'dismiss') return dependencies.store.dismiss(uid, expectedDate!);
  const { preferences, status } = await currentDailyWorkoutSuggestionStatus(uid, dependencies);
  if (expectedDate && preferences && expectedDate !== preferences.controls.localDate) {
    throw new HttpsError('aborted', 'The day changed. Review today before generating.');
  }
  if (input.action === 'status' || !preferences || !['waiting', 'waiting-sleep'].includes(status.state)) return status;
  const now = dependencies.now();
  const useAvailable = input.action === 'use-available-data';
  // The explicit fallback requires a previously deferred suggestion for this local date.
  if (useAvailable && status.state !== 'waiting-sleep') return status;
  const token = await dependencies.store.begin(uid, preferences);
  if (!token) return (await currentDailyWorkoutSuggestionStatus(uid, dependencies)).status;
  const date = preferences.controls.localDate;
  const assertActive = async () => {
    await dependencies.store.assertActive(uid, date, token);
    if (!await dependencies.pro(uid)) throw new HttpsError('permission-denied', 'Daily suggestions require Pro.');
  };
  let attempts = 0, meteredAttempts = 0, inputTokens = 0, outputTokens = 0, thoughtsTokens = 0;
  let outcome: DailyWorkoutSuggestionStatus['state'] = 'failed';
  try {
    const controls = await dependencies.selectSport(uid, preferences, now);
    const request: GenerateDayWorkoutRequest = { requestId: `daily-suggestion:${date}`, controls };
    const evidence = await dependencies.context(uid, request, now);
    const observedAt = dependencies.now();
    await assertActive();
    const skip = dailyWorkoutSuggestionSkip(evidence);
    if (skip) {
      outcome = skip;
      await dependencies.store.finish(uid, date, token, skip);
      return { localDate: date, state: skip };
    }
    const awaitingSleep = dailyWorkoutSuggestionAwaitsSleep(controls, evidence, observedAt);
    if (awaitingSleep && !useAvailable) {
      outcome = 'waiting-sleep';
      await dependencies.store.finish(uid, date, token, outcome);
      return { localDate: date, state: outcome };
    }
    if (awaitingSleep) {
      evidence.missingContext.push('Today’s completed sleep is not included. Treat older sleep and sleep-dependent readiness as dated history, not today’s recovery. You explicitly chose to use available data.');
    }
    // Separate daily allowance. Never reserve/finalize Assistant billing-period quota.
    await dependencies.store.charge(uid, date, token);
    const suggestion = await generateValidatedDayWorkout(request, evidence, async (request, evidence, correction) => {
      attempts++;
      return dependencies.generate(request, evidence, correction, usage => {
        if (usage.available) meteredAttempts++; inputTokens += usage.inputTokens; outputTokens += usage.outputTokens; thoughtsTokens += usage.thoughtsTokens;
      });
    }, assertActive);
    await assertActive();
    const result = { requestId: request.requestId, observedAt: observedAt.toISOString(), ...suggestion,
      usedContext: evidence.usedContext, missingContext: evidence.missingContext };
    await dependencies.store.finish(uid, date, token, 'ready', controls, result);
    outcome = 'ready';
    return (await currentDailyWorkoutSuggestionStatus(uid, dependencies)).status;
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
