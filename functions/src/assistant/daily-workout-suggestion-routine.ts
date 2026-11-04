import { DAY_WORKOUT_SPORTS, dayWorkoutDateOffset, dayWorkoutLocalDate, dayWorkoutPurposes, dayWorkoutTargets } from '../../../shared/day-workout';
import { isStrengthWorkoutSportV1 } from '../../../shared/strength-workout';
import type { DailyWorkoutSuggestionPreferences } from '../../../shared/daily-workout-suggestion';
import { buildDayWorkoutRoutine } from './day-workout-routine';
import { createAssistantMcpSession } from './mcp-session';

/** Exact recorded weekday sport, only with two distinct days and an unambiguous winner. Saved sport is the fallback. */
export function dailyWorkoutSuggestionRoutineSport(preferences: DailyWorkoutSuggestionPreferences, now: Date, activities: unknown[]) {
  const candidates = DAY_WORKOUT_SPORTS.map(sport => buildDayWorkoutRoutine({ ...preferences.controls, sport }, now, activities))
    .filter(item => {
      const sport = DAY_WORKOUT_SPORTS.find(sport => sport === item.sport)!;
      return item.status === 'available' && dayWorkoutPurposes(sport).includes(preferences.controls.purpose)
        && !(preferences.controls.timing === 'strict' && isStrengthWorkoutSportV1(sport));
    })
    .sort((a, b) => b.recordedDayCount - a.recordedDayCount);
  // Strength/Weight are one explicit family and must not manufacture a tie with themselves.
  const unique = candidates.filter((item, index) => !candidates.slice(0, index).some(other =>
    ['Strength Training', 'Weight Training'].includes(item.sport) && ['Strength Training', 'Weight Training'].includes(other.sport)));
  return unique.length && (!unique[1] || unique[0].recordedDayCount > unique[1].recordedDayCount)
    ? DAY_WORKOUT_SPORTS.find(sport => sport === unique[0].sport)! : preferences.controls.sport;
}
export async function selectDailyWorkoutSuggestionSport(uid: string, preferences: DailyWorkoutSuggestionPreferences, now: Date) {
  const saved = preferences.controls;
  if (!preferences.followRoutine || saved.routineContext === false || saved.activityContext === false) return saved;
  const session = await createAssistantMcpSession(uid, 'https://quantified-self.io', undefined, 'coordinate_free', false, false);
  try {
    const today = dayWorkoutLocalDate(now, saved.timeZone);
    const activities: unknown[] = []; let cursor: string | undefined;
    for (let page = 0; page < 2; page++) {
      const result = (await session.callTool('query_activities', { start: dayWorkoutDateOffset(today, -29) + 'T00:00:00Z',
        end: now.toISOString(), limit: 100, ...(cursor ? { cursor } : {}) })).structuredContent;
      if (!Array.isArray(result.activities) || result.activities.length > 100) return saved;
      activities.push(...result.activities);
      if (result.scanComplete === true && !result.nextCursor) {
        const selected = dailyWorkoutSuggestionRoutineSport(preferences, now, activities);
        const sport = dayWorkoutTargets(selected).includes(saved.target) || saved.target === 'auto' ? selected : saved.sport;
        return { ...saved, sport, purpose: dayWorkoutPurposes(sport).includes(saved.purpose) ? saved.purpose : 'suggest' as const,
          target: dayWorkoutTargets(sport).includes(saved.target) ? saved.target : dayWorkoutTargets(sport)[0],
          timing: saved.timing };
      }
      if (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor === cursor) return saved;
      cursor = result.nextCursor;
    }
  } catch { /* A partial/failed scan never establishes a habit. */ }
  finally { await session.close(); }
  return saved;
}
