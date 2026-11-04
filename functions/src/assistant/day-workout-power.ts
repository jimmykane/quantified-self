import * as admin from 'firebase-admin';
import { dayWorkoutLocalDate, type DayWorkoutControls } from '../../../shared/day-workout';
import { WORKOUT_POWER_SPORTS, parseWorkoutPowerSettingsV1, type WorkoutPowerProfileV1 } from '../../../shared/workout-power-settings';
import type { WorkoutTargetV1 } from '../../../shared/planned-workout';
import { DAY_WORKOUT_CONTEXT_MAX_CHARACTERS, type DayWorkoutContext } from './day-workout-context';

/** One private settings read, after the final sport is selected; no provider/history lookup or write. */
export async function withWorkoutPowerContext(uid: string, controls: DayWorkoutControls, now: Date,
  context: DayWorkoutContext, db: FirebaseFirestore.Firestore = admin.firestore()): Promise<DayWorkoutContext> {
  if (!['auto', 'power'].includes(controls.target) || !WORKOUT_POWER_SPORTS.includes(controls.sport as WorkoutPowerProfileV1['sport'])) return context;
  let profile: WorkoutPowerProfileV1 | undefined;
  let missing = 'Power targets: no confirmed source for this sport. Set a power reference in Settings → Workout power.';
  try {
    const settings = await db.doc(`users/${uid}/config/settings`).get();
    profile = parseWorkoutPowerSettingsV1(settings.get('workoutPower')).profiles.find(item => item.sport === controls.sport);
    if (profile && profile.referenceDate > dayWorkoutLocalDate(now, controls.timeZone)) {
      profile = undefined; missing = 'Power targets: the saved reference date is in the future. Check Workout power settings.';
    }
  } catch {
    missing = 'Power targets: saved source settings could not be verified. No power reference was inferred.';
  }
  // A nearby prescription carries watts, but cannot identify the athlete's current power source.
  const references: WorkoutTargetV1[] = context.references.filter(target => target.kind !== 'power');
  if (profile) references.push({ kind: 'power', mode: 'relative', minimumPercent: 100, maximumPercent: 100, reference: profile.reference });
  const { powerReference: _oldEvidence, ...baseEvidence } = context.evidence;
  const { powerReference: _oldProfile, ...baseContext } = context;
  const evidence = { ...baseEvidence, references, ...(profile ? { powerReference: profile } : {}) };
  if (JSON.stringify(evidence).length > DAY_WORKOUT_CONTEXT_MAX_CHARACTERS) throw Error('Power context exceeds the generation limit.');
  return { ...baseContext, evidence, references, ...(profile ? { powerReference: profile } : {}),
    usedContext: [...context.usedContext, ...(profile ? ['Manually confirmed power reference for the selected sport'] : [])],
    missingContext: [...context.missingContext, ...(profile ? [] : [missing])] };
}
