import type { DayWorkoutControls } from '../../../shared/day-workout';
import { WORKOUT_STRUCTURE_MAX_NODES, WORKOUT_STRUCTURE_MAX_REPEAT_COUNT, WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP,
  type WorkoutEndingV1, type WorkoutStructureV1, type WorkoutTargetV1 } from '../../../shared/planned-workout';
import { PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1,
  type PlannedWorkoutProviderId } from '../../../shared/planned-workout-providers';
import { GARMIN_STRENGTH_EXERCISE_NAMES_V1 } from '../../../shared/garmin-strength-workout';
import { isStrengthWorkoutSportV1, projectStrengthWorkoutToV1, type StrengthWorkoutDetailsV1 } from '../../../shared/strength-workout';
import { requiresDeliveryMappingApproval, type DeliveryAssessment } from '../training-plans/delivery/contracts';
import { assessTrainingDeliveryMapping } from '../training-plans/delivery/mapping';
import { assessWahooDelivery } from '../training-plans/delivery/wahoo/mapping';
import { assessSuuntoGuide } from '../training-plans/delivery/suunto/mapping';
import type { ValidatedDaySuggestion } from './day-workout-validation';

/** Pure local recipe guidance. No provider authority, credentials, tokens, remote IDs or API calls. */
export function dayWorkoutProviderContext(controls: DayWorkoutControls, providers: readonly PlannedWorkoutProviderId[], references: readonly WorkoutTargetV1[]) {
  const strengthSport = isStrengthWorkoutSportV1(controls.sport);
  const needsReview = (assessment: DeliveryAssessment) => assessment.level === 'unsupported' || requiresDeliveryMappingApproval(assessment);
  const assessRecipe = (provider: PlannedWorkoutProviderId, structure: WorkoutStructureV1, strength: StrengthWorkoutDetailsV1 | null,
    title = 'Workout compatibility check') => {
    const workout = { schemaVersion: 1 as const, id: strength?.workoutId ?? 'provider-check', planId: null, localDate: controls.localDate,
      title, structure, lifecycle: 'planned' as const, revision: 1, createdAtMs: 0, updatedAtMs: 0 };
    // Public placeholders are sufficient for format guidance; admission still checks the real owner/connection later.
    try {
      return provider === 'wahoo' ? assessWahooDelivery(workout, 'provider-check', controls.timeZone, strength)
        : provider === 'suunto' ? assessSuuntoGuide(workout, 'provider-check', controls.timeZone, 'Quantified Self', strength)
        : assessTrainingDeliveryMapping(provider, workout, 'provider-check', controls.timeZone, strength);
    } catch {
      return { level: 'unsupported' as const, issues: ['Local format checking is unavailable. Review sync before sending.'],
        mappingVersion: 'unavailable', digest: '' };
    }
  };
  const probe = (ending: WorkoutEndingV1, target?: WorkoutTargetV1) => {
    const strength: StrengthWorkoutDetailsV1 | null = strengthSport ? { version: 1, workoutId: 'capability-probe', revision: 1,
      exercises: [{ id: 'probe', name: 'Plank', sets: [{ id: 'set', ending: ending as { kind: 'time'; seconds: number } | { kind: 'repetitions'; repetitions: number } }] }] } : null;
    const structure: WorkoutStructureV1 = strength ? projectStrengthWorkoutToV1(strength, controls.sport)
      : { version: 1, sport: controls.sport, nodes: [{ kind: 'step', id: 'probe', purpose: 'work', ending, targets: target ? [target] : [] }] };
    return { structure, strength };
  };
  const endings: WorkoutEndingV1[] = strengthSport ? [{ kind: 'time', seconds: 60 }, { kind: 'repetitions', repetitions: 8 }]
    : [{ kind: 'time', seconds: 300 }, { kind: 'distance', meters: 1000 }, { kind: 'manual' }];
  const uniqueReferences: WorkoutTargetV1[] = [];
  for (const target of references) {
    if (uniqueReferences.some(other => other.kind === target.kind)) continue;
    uniqueReferences.push(target); if (uniqueReferences.length === 4) break;
  }
  const guidance = providers.map(provider => {
    const capability = PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider];
    const assess = (ending: WorkoutEndingV1, target?: WorkoutTargetV1) => {
      const value = probe(ending, target);
      const result = assessRecipe(provider, value.structure, value.strength);
      return { level: result.level, requiresReview: needsReview(result), issues: result.issues.slice(0, 3) };
    };
    return { provider, label: capability.label,
      sportSupported: capability.profile?.sports?.includes(controls.sport) ?? false,
      limits: { supportsRepeats: capability.profile?.supportsRepeats ?? false,
        maxNodes: capability.profile?.maxNodes ?? WORKOUT_STRUCTURE_MAX_NODES, maxRepeatCount: capability.profile?.maxRepeatCount ?? WORKOUT_STRUCTURE_MAX_REPEAT_COUNT,
        maxTargetsPerStep: capability.profile?.maxTargetsPerStep ?? WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP },
      endings: endings.map(ending => ({ kind: ending.kind, ...assess(ending) })),
      timedTotals: [60, 61].map(seconds => ({ totalSeconds: seconds, ...assess({ kind: 'time', seconds }) })),
      targets: strengthSport ? [] : uniqueReferences.map(target => ({ kind: target.kind, ...assess({ kind: 'time', seconds: 300 }, target) })),
      ...(strengthSport && provider === 'garmin' ? { allowedExerciseNames: GARMIN_STRENGTH_EXERCISE_NAMES_V1 } : {}),
    };
  });
  const commonExactEndings = endings.filter(ending => guidance.every(provider => provider.endings.some(check => check.kind === ending.kind && check.level === 'exact'))).map(ending => ending.kind);
  const assessments = (suggestion: ValidatedDaySuggestion) => {
    if (!suggestion.draft) return [];
    const draft = suggestion.draft;
    const strength = draft.strength ? { ...draft.strength, workoutId: 'generated-provider-check', revision: 1 } : null;
    return providers.map(provider => ({ label: PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label,
      ...assessRecipe(provider, draft.structure, strength, draft.title) }));
  };
  return {
    evidence: { kind: 'local-recipe-capabilities', providers: guidance, commonExactEndings,
      notice: 'These are local format checks, not proof of provider availability, connection, successful sending or watch receipt. Keep the selected sport, purpose, equipment, recovery decision and explicit targets. Disclosed limitations with requiresReview:false are informational; do not change the prescription merely to make their level exact.' },
    correction(suggestion: ValidatedDaySuggestion): string | null {
      // A mapping-only retry must not discard an explicit target or chase an impossible native sport/profile.
      if (!commonExactEndings.length || !['auto', 'none'].includes(controls.target) || suggestion.previousLoads.length > 0) return null;
      const issues = assessments(suggestion).filter(needsReview);
      return issues.length ? 'Prefer a locally exact recipe for the selected delivery providers, using evidence.deliveryProviders. '
        + issues.map(result => `${result.label}: ${result.level}`).join('; ')
        + ' Keep the same selected sport, equipment, purpose and recovery choice. Do not replace a workout with rest to fit a provider, guess durations for repetitions or invent exercise/load substitutions.' : null;
    },
    limitations(suggestion: ValidatedDaySuggestion): string[] {
      return assessments(suggestion).filter(result => result.level !== 'exact')
        .map(result => `Delivery to ${result.label}${needsReview(result) ? ' needs Review sync' : ''}: ${result.issues.slice(0, 2).join(' ')}`);
    },
  };
}
