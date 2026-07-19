import {
  getTrainingBuildBenchmarkSelectionKey,
  normalizeTrainingVisibleDisciplines,
  TRAINING_VISIBLE_DISCIPLINES,
  type TrainingSettings,
  type TrainingVisibleDiscipline,
} from '@shared/derived-metrics';
import type { DashboardTrainingSummaryContext } from './dashboard-derived-metrics.helper';

export interface TrainingSportVisibilityResolution {
  disciplines: TrainingVisibleDiscipline[];
  isAutomatic: boolean;
}

interface TrainingVisibleDisciplinePresentation {
  label: string;
  details: string;
}

const TRAINING_VISIBLE_DISCIPLINE_PRESENTATION: Record<TrainingVisibleDiscipline, TrainingVisibleDisciplinePresentation> = {
  running: { label: 'Running', details: 'Build, training mix, capacity, and power curve' },
  cycling: { label: 'Cycling', details: 'Road, indoor, virtual, e-bike, and mountain biking' },
  swimming: { label: 'Swimming', details: 'Pool and open-water build, pace, and comparable SWOLF' },
};

const TRAINING_VISIBLE_DISCIPLINE_SCOPE_LABELS: Record<TrainingVisibleDiscipline, string> = {
  running: 'Running',
  cycling: 'Cycling/MTB',
  swimming: 'Swimming',
};

export const TRAINING_VISIBLE_DISCIPLINE_OPTIONS: readonly (TrainingVisibleDisciplinePresentation & {
  discipline: TrainingVisibleDiscipline;
})[] = TRAINING_VISIBLE_DISCIPLINES.map(discipline => ({
  discipline,
  ...TRAINING_VISIBLE_DISCIPLINE_PRESENTATION[discipline],
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
  if (!isSummaryReady || !summary) {
    return { disciplines: [...TRAINING_VISIBLE_DISCIPLINES], isAutomatic: true };
  }

  const disciplines = TRAINING_VISIBLE_DISCIPLINES.filter((discipline) => {
    const currentActivityCount = summary.disciplines
      .find(item => item.discipline === discipline)
      ?.current28d.activityCount || 0;
    const hasSavedBenchmark = !!getTrainingBuildBenchmarkSelectionKey(buildBenchmarks?.[discipline]);
    return currentActivityCount > 0 || hasSavedBenchmark;
  });

  return {
    disciplines: disciplines.length ? disciplines : [...TRAINING_VISIBLE_DISCIPLINES],
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
  return disciplines.map(discipline => TRAINING_VISIBLE_DISCIPLINE_PRESENTATION[discipline].label).join(' + ');
}

export function formatTrainingVisibleDisciplinesScopeLabel(
  disciplines: readonly TrainingVisibleDiscipline[],
): string {
  const labels = disciplines.map(discipline => TRAINING_VISIBLE_DISCIPLINE_SCOPE_LABELS[discipline]);
  if (labels.length <= 1) {
    return labels[0] || 'Selected sports';
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
    return 'All 3';
  }
  if (disciplines.length === 1) {
    return TRAINING_VISIBLE_DISCIPLINE_PRESENTATION[disciplines[0]].label;
  }
  return `${disciplines.length} sports`;
}

export function formatTrainingVisibleDisciplinesAccessibleLabel(
  disciplines: readonly TrainingVisibleDiscipline[],
  isAutomatic: boolean,
): string {
  return `Choose sports shown. ${isAutomatic ? 'Automatic' : 'Fixed'} selection: ${formatTrainingVisibleDisciplinesLabel(disciplines)}.`;
}

export function formatTrainingVisibleDisciplinesActivityLabel(
  disciplines: readonly TrainingVisibleDiscipline[],
): string {
  const labels = disciplines.map(
    discipline => TRAINING_VISIBLE_DISCIPLINE_PRESENTATION[discipline].label.toLowerCase(),
  );
  if (labels.length <= 1) {
    return `${labels[0] || 'sport'} sessions`;
  }
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]} sessions`;
}
