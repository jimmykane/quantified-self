import {
  getTrainingBuildBenchmarkSelectionKey,
  normalizeTrainingVisibleDisciplines,
  TRAINING_VISIBLE_DISCIPLINES,
  type TrainingSettings,
  type TrainingVisibleDiscipline,
} from '@shared/derived-metrics';
import {
  getTrainingSportDefinition,
  isTrainingDiscipline,
  TRAINING_SPORT_DEFINITIONS,
  type TrainingDestinationId,
} from '@shared/training-disciplines';
import type { DashboardTrainingSummaryContext } from './dashboard-derived-metrics.helper';

export interface TrainingSportVisibilityResolution {
  disciplines: TrainingVisibleDiscipline[];
  isAutomatic: boolean;
}

export type TrainingSportShortcutsPreference = TrainingVisibleDiscipline[] | null;

export interface TrainingSportShortcutsResolution extends TrainingSportVisibilityResolution {
  source: 'saved' | 'legacy' | 'automatic';
}

export const TRAINING_SPORT_SHORTCUT_LIMIT = 4;

interface TrainingVisibleDisciplinePresentation {
  label: string;
  details: string;
}

function requireSportDefinition(discipline: TrainingVisibleDiscipline) {
  const definition = getTrainingSportDefinition(discipline);
  if (!definition) {
    throw new Error(`Missing Training sport definition: ${discipline}`);
  }
  return definition;
}

export const TRAINING_VISIBLE_DISCIPLINE_OPTIONS: readonly (TrainingVisibleDisciplinePresentation & {
  discipline: TrainingVisibleDiscipline;
})[] = TRAINING_SPORT_DEFINITIONS.map(definition => ({
  discipline: definition.id,
  label: definition.label,
  details: definition.details,
}));

/**
 * Normalizes the client-owned shortcut preference while preserving the
 * difference between automatic (`null`) and missing or malformed (`undefined`).
 */
export function normalizeTrainingSportShortcuts(
  value: unknown,
): TrainingSportShortcutsPreference | undefined {
  if (value === null) {
    return null;
  }
  const normalized = normalizeTrainingVisibleDisciplines(value);
  return normalized?.slice(0, TRAINING_SPORT_SHORTCUT_LIMIT);
}

function resolveAutomaticTrainingSportShortcuts(
  summary: DashboardTrainingSummaryContext | null,
  hasUsableSummary: boolean,
  buildBenchmarks: TrainingSettings['buildBenchmarks'],
): TrainingVisibleDiscipline[] {
  return TRAINING_VISIBLE_DISCIPLINES.map((discipline, registryIndex) => {
    const current = hasUsableSummary && summary
      ? summary.disciplines.find(item => item.discipline === discipline)?.current28d
      : null;
    return {
      discipline,
      registryIndex,
      durationSeconds: current?.durationSeconds || 0,
      activityCount: current?.activityCount || 0,
      hasSavedBenchmark: !!getTrainingBuildBenchmarkSelectionKey(buildBenchmarks?.[discipline]),
    };
  })
    .filter(item => item.activityCount > 0 || item.hasSavedBenchmark)
    .sort((left, right) => (
      right.durationSeconds - left.durationSeconds
      || right.activityCount - left.activityCount
      || Number(right.hasSavedBenchmark) - Number(left.hasSavedBenchmark)
      || left.registryIndex - right.registryIndex
    ))
    .slice(0, TRAINING_SPORT_SHORTCUT_LIMIT)
    .map(item => item.discipline);
}

export function resolveTrainingSportShortcuts(
  preference: unknown,
  legacyPreference: unknown,
  summary: DashboardTrainingSummaryContext | null,
  hasUsableSummary: boolean,
  buildBenchmarks: TrainingSettings['buildBenchmarks'],
): TrainingSportShortcutsResolution {
  const normalizedPreference = normalizeTrainingSportShortcuts(preference);
  if (normalizedPreference !== undefined && normalizedPreference !== null) {
    return { disciplines: normalizedPreference, isAutomatic: false, source: 'saved' };
  }
  if (normalizedPreference === undefined) {
    const legacy = normalizeTrainingVisibleDisciplines(legacyPreference);
    if (legacy) {
      return {
        disciplines: legacy.slice(0, TRAINING_SPORT_SHORTCUT_LIMIT),
        isAutomatic: false,
        source: 'legacy',
      };
    }
  }
  return {
    disciplines: resolveAutomaticTrainingSportShortcuts(
      summary,
      hasUsableSummary,
      buildBenchmarks,
    ),
    isAutomatic: true,
    source: 'automatic',
  };
}

export function resolveTrainingShortcutDestinations(
  shortcuts: readonly TrainingVisibleDiscipline[],
  selectedDestination: TrainingDestinationId,
): TrainingVisibleDiscipline[] {
  if (!isTrainingDiscipline(selectedDestination) || shortcuts.includes(selectedDestination)) {
    return [...shortcuts].slice(0, TRAINING_SPORT_SHORTCUT_LIMIT);
  }
  return [selectedDestination, ...shortcuts]
    .slice(0, TRAINING_SPORT_SHORTCUT_LIMIT);
}

/**
 * Reconciles a newly resolved shortcut set without moving destinations that
 * are already visible. Derived snapshots can hydrate independently, so the
 * automatic set may change several times during one refresh. Keeping retained
 * destinations in their existing slots prevents the selected control from
 * moving under the user while new destinations fill the available gaps.
 */
export function resolveStableTrainingShortcutDestinations(
  previousDestinations: readonly TrainingVisibleDiscipline[],
  shortcuts: readonly TrainingVisibleDiscipline[],
  selectedDestination: TrainingDestinationId,
): TrainingVisibleDiscipline[] {
  const nextDestinations = resolveTrainingShortcutDestinations(shortcuts, selectedDestination);
  if (previousDestinations.length === 0 || nextDestinations.length === 0) {
    return nextDestinations;
  }

  const remainingDestinations = new Set(nextDestinations);
  const slots: Array<TrainingVisibleDiscipline | undefined> = Array.from(
    { length: nextDestinations.length },
  );
  previousDestinations.slice(0, slots.length).forEach((destination, index) => {
    if (remainingDestinations.delete(destination)) {
      slots[index] = destination;
    }
  });
  const additions = nextDestinations.filter(destination => remainingDestinations.has(destination));
  let additionIndex = 0;
  return slots.map(destination => destination ?? additions[additionIndex++]!);
}

export function resolveTrainingSportVisibility(
  preference: unknown,
  summary: DashboardTrainingSummaryContext | null,
  hasUsableSummary: boolean,
  buildBenchmarks: TrainingSettings['buildBenchmarks'],
): TrainingSportVisibilityResolution {
  const resolution = resolveTrainingSportShortcuts(
    preference,
    undefined,
    summary,
    hasUsableSummary,
    buildBenchmarks,
  );
  return { disciplines: resolution.disciplines, isAutomatic: resolution.isAutomatic };
}

export function trainingSportVisibilitySelectionKey(
  disciplines: readonly TrainingVisibleDiscipline[] | null | undefined,
): string {
  return disciplines?.join('|') || '';
}

export function formatTrainingVisibleDisciplinesLabel(
  disciplines: readonly TrainingVisibleDiscipline[],
): string {
  return disciplines.map(discipline => requireSportDefinition(discipline).label).join(' + ');
}

export function formatTrainingVisibleDisciplinesScopeLabel(
  disciplines: readonly TrainingVisibleDiscipline[],
): string {
  const labels = disciplines.map(discipline => requireSportDefinition(discipline).scopeLabel);
  if (labels.length <= 1) {
    return labels[0] || 'No sport-specific';
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export function formatTrainingVisibleDisciplinesCompactLabel(
  disciplines: readonly TrainingVisibleDiscipline[],
): string {
  if (disciplines.length === TRAINING_VISIBLE_DISCIPLINES.length) {
    return 'All sports';
  }
  if (disciplines.length === 0) {
    return 'No sports';
  }
  if (disciplines.length === 1) {
    return requireSportDefinition(disciplines[0]).label;
  }
  return `${disciplines.length} sports`;
}

export function formatTrainingVisibleDisciplinesAccessibleLabel(
  disciplines: readonly TrainingVisibleDiscipline[],
  isAutomatic: boolean,
): string {
  const selection = disciplines.length
    ? formatTrainingVisibleDisciplinesLabel(disciplines)
    : 'no sport-specific cards';
  return `Choose sports shown. ${isAutomatic ? 'Automatic' : 'Fixed'} selection: ${selection}.`;
}

export function formatTrainingVisibleDisciplinesActivityLabel(
  disciplines: readonly TrainingVisibleDiscipline[],
): string {
  const labels = disciplines.map(
    discipline => requireSportDefinition(discipline).label.toLowerCase(),
  );
  if (labels.length <= 1) {
    return `${labels[0] || 'sport'} workouts`;
  }
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]} workouts`;
}
