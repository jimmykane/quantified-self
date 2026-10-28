import { DataDuration, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { DayWorkoutDraft } from '@shared/day-workout';
import { formatWorkoutEndingV1, formatWorkoutStepV1 } from '@shared/planned-workout';
import { formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { formatStrengthLoadKg } from '@shared/strength-workout';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';

export function dayWorkoutReview(draft: DayWorkoutDraft, units?: UserUnitSettingsInterface | null) {
  const duration = (seconds: number) => resolveUnitAwareDisplayFromValue(DataDuration.type, seconds, units)?.text ?? '';
  return {
    summary: formatWorkoutPrescriptionSummaryV1(draft.structure, units, draft.structure.sport),
    estimate: draft.estimatedMinutes
      ? `AI planning estimate: ${duration(draft.estimatedMinutes.minimum * 60)}–${duration(draft.estimatedMinutes.maximum * 60)}. Repetition and transition time varies.` : null,
    exercises: draft.strength?.exercises.map(exercise => ({ id: exercise.id, name: exercise.name,
      sets: exercise.sets.map((set, index) => `Set ${index + 1}: ${formatWorkoutEndingV1(set.ending, units, undefined, draft.structure.sport)}`
        + (set.externalLoadKg === undefined ? ' · load unspecified' : ` · ${formatStrengthLoadKg(set.externalLoadKg, units)}`)
        + (set.restAfterSeconds === undefined ? '' : ` · rest ${duration(set.restAfterSeconds)}`)),
    })) ?? [],
    intervals: draft.strength ? [] : draft.structure.nodes.map(node => ({ id: node.id,
      repeat: node.kind === 'repeat' ? `${node.count} passes` : null,
      steps: (node.kind === 'step' ? [node] : node.steps).map(step => formatWorkoutStepV1(step, units, undefined, draft.structure.sport)),
    })),
  };
}
