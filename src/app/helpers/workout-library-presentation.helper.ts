import { ActivityTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { formatWorkoutEndingV1, formatWorkoutStepV1 } from '@shared/planned-workout';
import { formatStrengthLoadKg } from '@shared/strength-workout';
import type { WorkoutLibraryItemV1 } from '@shared/workout-library';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { workoutStructureToManualEditor } from './planned-workout-editor.helper';

export type LibraryStatusFilter = 'active' | 'archived' | 'all';

export function filterWorkoutLibrary(
  items: WorkoutLibraryItemV1[], search: string, sport: ActivityTypes | null, status: LibraryStatusFilter,
): WorkoutLibraryItemV1[] {
  const query = search.trim().toLocaleLowerCase();
  return items.filter(item => (status === 'all' || item.status === status)
    && (!sport || item.structure.sport === sport)
    && (!query || item.title.toLocaleLowerCase().includes(query)));
}

/** Presentation only: never convert this preview back into a placement prescription. */
export function presentWorkoutLibraryItem(
  item: WorkoutLibraryItemV1, settings?: UserUnitSettingsInterface | null, locale?: string,
) {
  const stepText = (step: Parameters<typeof formatWorkoutStepV1>[0]) =>
    [formatWorkoutStepV1(step, settings, locale, item.structure.sport), step.note].filter(Boolean).join(' · ');
  const details = item.strength
    ? item.strength.exercises.flatMap(exercise => exercise.sets.map((set, index) => [
      `${exercise.name} · Set ${index + 1}`,
      formatWorkoutEndingV1(set.ending, settings, locale, item.structure.sport),
      set.externalLoadKg === undefined ? null : formatStrengthLoadKg(set.externalLoadKg, settings),
      set.restAfterSeconds === undefined ? null
        : `Rest ${formatWorkoutEndingV1({ kind: 'time', seconds: set.restAfterSeconds }, settings, locale)}`,
    ].filter(Boolean).join(' · ')))
    : [
      ...(item.structure.poolLength ? [`Pool · ${formatWorkoutEndingV1(
        { kind: 'distance', meters: item.structure.poolLength.meters }, settings, locale, item.structure.sport)}`] : []),
      ...item.structure.nodes.map(node => node.kind === 'step' ? stepText(node)
        : `${node.count}× (${node.steps.map(stepText).join('; ')})`),
    ];
  let editable = !!item.strength;
  if (!item.strength) {
    try {
      workoutStructureToManualEditor(item.title, '2000-01-01', item.structure, normalizeUserUnitSettings(settings));
      editable = true;
    } catch { /* A valid canonical recipe can exceed the manual editor's supported vocabulary. */ }
  }
  return { item, details, summary: details.slice(0, 2), editable };
}
