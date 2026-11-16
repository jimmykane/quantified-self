import type { DailyWorkoutSuggestionPreferences } from '../../../shared/daily-workout-suggestion';
import { collectDayWorkoutContext, dayWorkoutTrainingMetricKinds, DayWorkoutTrainingNotReadyError, readDayWorkoutTrainingContext } from './day-workout-context';
import { withWorkoutPowerContext } from './day-workout-power';
import { selectDailyWorkoutSuggestionSport } from './daily-workout-suggestion-routine';
import { createAssistantMcpSession, type AssistantMcpSession } from './mcp-session';

/** Prepare sport-independent Training evidence before scanning the recorded weekday routine. */
export async function collectDailyWorkoutSuggestionContext(uid: string, preferences: DailyWorkoutSuggestionPreferences,
  now: Date, useAvailable: boolean) {
  const session = await createAssistantMcpSession(uid, 'https://quantified-self.io', undefined, 'coordinate_free',
    preferences.controls.timelineContext, preferences.controls.trainingContext);
  try {
    const metricKinds = dayWorkoutTrainingMetricKinds(preferences.controls);
    let preparation: Awaited<ReturnType<AssistantMcpSession['callTool']>> | undefined;
    if (!useAvailable && metricKinds.length) {
      try { preparation = await session.callTool('prepare_training_metrics', { metricKinds }); }
      catch { throw new DayWorkoutTrainingNotReadyError(); }
      if (preparation.structuredContent.status !== 'ready') throw new DayWorkoutTrainingNotReadyError();
    }
    const controls = await selectDailyWorkoutSuggestionSport(preferences, now, session);
    // Reuse this session's preparation and its MCP ready-kind guard; never pass readiness to a new session.
    const preparedSession: Pick<AssistantMcpSession, 'callTool'> = {
      callTool: (name, input) => name === 'prepare_training_metrics' && preparation
        ? Promise.resolve(preparation) : session.callTool(name, input),
    };
    const context = await collectDayWorkoutContext(controls, now, preparedSession,
      () => readDayWorkoutTrainingContext(uid, controls, now),
      { allowEventAdvice: true, deferUntilTrainingReady: !useAvailable });
    return { controls, evidence: await withWorkoutPowerContext(uid, controls, now, context) };
  } finally { await session.close(); }
}
