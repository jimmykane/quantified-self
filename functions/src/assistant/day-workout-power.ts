import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { trainingLoadTimeMs } from '../../../shared/training-load-source';
import { dayWorkoutLocalDate, type DayWorkoutControls } from '../../../shared/day-workout';
import { WORKOUT_POWER_SPORTS, parseWorkoutPowerSettingsV1, sharedWorkoutFtpReference, importedWorkoutFtpReference, workoutFtpFamily, type WorkoutPowerProfileV1, type WorkoutPowerReferenceV1 } from '../../../shared/workout-power-settings';
import type { WorkoutTargetV1 } from '../../../shared/planned-workout';
import type { ValidatedDaySuggestion } from './day-workout-validation';
import { DAY_WORKOUT_CONTEXT_MAX_CHARACTERS, type DayWorkoutContext } from './day-workout-context';

/** Resolve an explicit override, shared dated FTP or recent imported FTP after the final sport selection. No provider calls or writes. */
export async function withWorkoutPowerContext(uid: string, controls: DayWorkoutControls, now: Date,
  context: DayWorkoutContext, db: FirebaseFirestore.Firestore = admin.firestore()): Promise<DayWorkoutContext> {
  // Strip unverified power references on every path, including unsupported sports and explicit non-power preferences.
  const references: WorkoutTargetV1[] = context.references.filter(target => target.kind !== 'power');
  const evidence: DayWorkoutContext['evidence'] = { ...context.evidence, references };
  const result = { ...context, evidence, references };
  delete evidence.powerReference;
  delete result.powerReference;
  if (!['auto', 'power'].includes(controls.target) || !WORKOUT_POWER_SPORTS.includes(controls.sport as WorkoutPowerProfileV1['sport'])) return result;
  let profile: WorkoutPowerReferenceV1 | undefined;
  let missing = 'Power targets: no verified shared FTP, explicit override or recent imported FTP for this sport. Review Settings → Workout power.';
  try {
    const settings = await db.doc(`users/${uid}/config/settings`).get();
    profile = parseWorkoutPowerSettingsV1(settings.get('workoutPower')).profiles.find(item => item.sport === controls.sport);
    if (profile && profile.referenceDate > dayWorkoutLocalDate(now, controls.timeZone)) {
      throw Error('The explicit override is future dated.');
    }
    // An existing profile is an explicit override, including CP. Never silently replace an invalid override.
    const family = workoutFtpFamily(controls.sport);
    if (!profile && family) {
      const ref = db.doc(`users/${uid}/trainingLoadPolicies/${family}`);
      let policy = (await ref.get()).data();
      // A concurrent save after generation began belongs to the next request. Resolve the prior immutable revision.
      const effective = trainingLoadTimeMs(policy?.effectiveAt);
      if (effective > now.getTime()) {
        policy = (await ref.collection('revisions').where('effectiveAt', '<=', Timestamp.fromMillis(now.getTime()))
          .orderBy('effectiveAt', 'desc').limit(1).get()).docs[0]?.data();
      }
      profile = sharedWorkoutFtpReference(controls.sport, policy, now.getTime()) ?? undefined;
      if (!profile && policy?.functionalThresholdPower !== undefined) throw Error('The shared FTP could not be verified.');
      if (!profile) {
        const capacity = await db.doc(`users/${uid}/derivedMetrics/training_capacity`).get();
        profile = importedWorkoutFtpReference(controls.sport, capacity.data(), now.getTime()) ?? undefined;
      }
    }
  } catch {
    profile = undefined;
    missing = 'Power targets: saved source settings could not be verified. No power reference was inferred.';
  }
  if (profile) {
    references.push({ kind: 'power', mode: 'relative', minimumPercent: 100, maximumPercent: 100, reference: profile.reference });
    evidence.powerReference = profile;
    result.powerReference = profile;
  }
  if (JSON.stringify(evidence).length > DAY_WORKOUT_CONTEXT_MAX_CHARACTERS) throw Error('Power context exceeds the generation limit.');
  return { ...result,
    usedContext: [...context.usedContext, ...(profile ? ['kind' in profile ? profile.kind === 'imported-ftp' ? 'Recent imported FTP for the selected sport (last observed in activity data, not a new FTP test)' : 'Shared dated FTP for the selected sport' : 'Explicit power-source override for the selected sport'] : [])],
    missingContext: [...context.missingContext, ...(profile ? [] : [missing])] };
}

/** Provenance belongs to an actual prescribed power target, not merely an available model input. */
export function dayWorkoutPowerReferenceUsed(suggestion: ValidatedDaySuggestion,
  profile: WorkoutPowerReferenceV1 | undefined): WorkoutPowerReferenceV1 | undefined {
  if (!profile || !suggestion.draft || suggestion.draft.structure.sport !== profile.sport) return undefined;
  const used = suggestion.draft.structure.nodes.some(node => (node.kind === 'step' ? [node] : node.steps).some(step =>
    step.targets.some(target => target.kind === 'power' && target.mode === 'relative'
      && target.reference.kind === profile.reference.kind && target.reference.watts === profile.reference.watts)));
  return used ? profile : undefined;
}
