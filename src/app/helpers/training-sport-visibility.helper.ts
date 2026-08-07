import {
  getTrainingBuildBenchmarkSelectionKey,
  normalizeTrainingVisibleDisciplines,
  TRAINING_VISIBLE_DISCIPLINES,
  type TrainingSettings,
  type TrainingVisibleDiscipline,
} from '@shared/derived-metrics';
import {
  getTrainingSportDefinition,
  TRAINING_SPORT_DEFINITIONS,
} from '@shared/training-disciplines';
import type { DashboardTrainingSummaryContext } from './dashboard-derived-metrics.helper';

export interface TrainingSportVisibilityResolution {
  disciplines: TrainingVisibleDiscipline[];
  isAutomatic: boolean;
}

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

export function resolveTrainingSportVisibility(
  preference: unknown,
  summary: DashboardTrainingSummaryContext | null,
  isSummaryReady: boolean,
  buildBenchmarks: TrainingSettings['buildBenchmarks'],
): TrainingSportVisibilityResolution {
  const explicitDisciplines = normalizeTrainingVisibleDisciplines(preference);
  if (explicitDisciplines) {
    return { disciplines: explicitDisciplines, isAutomatic: false };
  }
  const disciplines = TRAINING_VISIBLE_DISCIPLINES.filter((discipline) => {
    const currentActivityCount = isSummaryReady && summary
      ? summary.disciplines
        .find(item => item.discipline === discipline)
        ?.current28d.activityCount || 0
      : 0;
    const hasSavedBenchmark = !!getTrainingBuildBenchmarkSelectionKey(buildBenchmarks?.[discipline]);
    return currentActivityCount > 0 || hasSavedBenchmark;
  });

  return {
    disciplines,
    isAutomatic: true,
  };
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
