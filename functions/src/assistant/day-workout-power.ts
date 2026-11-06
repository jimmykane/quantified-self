import * as admin from 'firebase-admin';
import { dayWorkoutLocalDate, type DayWorkoutControls } from '../../../shared/day-workout';
import { WORKOUT_POWER_SPORTS, parseWorkoutPowerSettingsV1, type WorkoutPowerProfileV1 } from '../../../shared/workout-power-settings';
import type { WorkoutTargetV1 } from '../../../shared/planned-workout';
import type { ValidatedDaySuggestion } from './day-workout-validation';
import { DAY_WORKOUT_CONTEXT_MAX_CHARACTERS, type DayWorkoutContext } from './day-workout-context';

/** One private settings read, after the final sport is selected; no provider/history lookup or write. */
export async function withWorkoutPowerContext(uid: string, controls: DayWorkoutControls, now: Date,
  context: DayWorkoutContext, db: FirebaseFirestore.Firestore = admin.firestore()): Promise<DayWorkoutContext> {
  // Strip unverified power references on every path, including unsupported sports and explicit non-power preferences.
  const references: WorkoutTargetV1[] = context.references.filter(target => target.kind !== 'power');
  const evidence: DayWorkoutContext['evidence'] = { ...context.evidence, references };
  const result = { ...context, evidence, references };
  delete evidence.powerReference;
  delete result.powerReference;
  if (!['auto', 'power'].includes(controls.target) || !WORKOUT_POWER_SPORTS.includes(controls.sport as WorkoutPowerProfileV1['sport'])) return result;
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
  if (profile) {
    references.push({ kind: 'power', mode: 'relative', minimumPercent: 100, maximumPercent: 100, reference: profile.reference });
    evidence.powerReference = profile;
    result.powerReference = profile;
  }
  if (JSON.stringify(evidence).length > DAY_WORKOUT_CONTEXT_MAX_CHARACTERS) throw Error('Power context exceeds the generation limit.');
  return { ...result,
    usedContext: [...context.usedContext, ...(profile ? ['Manually confirmed power reference for the selected sport'] : [])],
    missingContext: [...context.missingContext, ...(profile ? [] : [missing])] };
}

/** Provenance belongs to an actual prescribed power target, not merely an available model input. */
export function dayWorkoutPowerReferenceUsed(suggestion: ValidatedDaySuggestion,
  profile: WorkoutPowerProfileV1 | undefined): WorkoutPowerProfileV1 | undefined {
  if (!profile || !suggestion.draft || suggestion.draft.structure.sport !== profile.sport) return undefined;
  const used = suggestion.draft.structure.nodes.some(node => (node.kind === 'step' ? [node] : node.steps).some(step =>
    step.targets.some(target => target.kind === 'power' && target.mode === 'relative'
      && target.reference.kind === profile.reference.kind && target.reference.watts === profile.reference.watts)));
  return used ? profile : undefined;
}
