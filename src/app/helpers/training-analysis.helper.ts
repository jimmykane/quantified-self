import type { DashboardTrainingDisciplineSummary } from './dashboard-derived-metrics.helper';
import {
  isDerivedMetricPendingStatus,
  type DashboardDerivedMetricStatus,
} from './derived-metric-status.helper';
import {
  resolveTrainingStateClassification,
  type TrainingStateClassification,
  type TrainingStateSignalInput,
} from './training-state.helper';

export interface TrainingWindowComparison {
  current: number;
  baseline: number;
  delta: number;
  deltaPercent: number | null;
}

export interface TrainingAnalysisInsight {
  title: string;
  description: string;
}

export interface TrainingAnalysis {
  state: TrainingStateClassification;
  duration: TrainingWindowComparison;
  activities: TrainingWindowComparison;
  insights: TrainingAnalysisInsight[];
}

export interface TrainingAnalysisInput {
  stateSignals: TrainingStateSignalInput;
  disciplines: readonly DashboardTrainingDisciplineSummary[];
}

export type TrainingComparisonState =
  | 'preparing'
  | 'updating'
  | 'unavailable'
  | 'empty'
  | 'building-baseline'
  | 'ready';

const MEANINGFUL_VOLUME_CHANGE_PERCENT = 10;
const MEANINGFUL_SESSION_CHANGE = 2;
const MEANINGFUL_INTENSITY_CHANGE_POINTS = 5;
const MAX_INSIGHTS = 3;

function buildComparison(current: number, baseline: number): TrainingWindowComparison {
  return {
    current,
    baseline,
    delta: current - baseline,
    deltaPercent: baseline > 0 ? ((current - baseline) / baseline) * 100 : null,
  };
}

function formatAbsolute(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.abs(value));
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.abs(value));
}

function resolveIntensityInsight(
  currentEasySeconds: number,
  currentModerateSeconds: number,
  currentHardSeconds: number,
  baselineEasySeconds: number,
  baselineModerateSeconds: number,
  baselineHardSeconds: number,
): TrainingAnalysisInsight | null {
  const currentTotal = currentEasySeconds + currentModerateSeconds + currentHardSeconds;
  const baselineTotal = baselineEasySeconds + baselineModerateSeconds + baselineHardSeconds;
  if (currentTotal <= 0 || baselineTotal <= 0) {
    return null;
  }

  const currentHardPercent = (currentHardSeconds / currentTotal) * 100;
  const baselineHardPercent = (baselineHardSeconds / baselineTotal) * 100;
  const deltaPoints = currentHardPercent - baselineHardPercent;
  if (Math.abs(deltaPoints) < MEANINGFUL_INTENSITY_CHANGE_POINTS) {
    return null;
  }

  const direction = deltaPoints > 0 ? 'more' : 'less';
  return {
    title: 'Intensity mix',
    description: `Hard work is ${formatPercent(deltaPoints)} percentage points ${direction} prominent than in your usual 28 days.`,
  };
}

export function resolveTrainingComparisonState(
  status: DashboardDerivedMetricStatus,
  hasTrainingSummary: boolean,
  currentActivityCount: number,
  baselineActivityCount: number,
): TrainingComparisonState {
  if (status === 'failed') {
    return 'unavailable';
  }
  if (!hasTrainingSummary && (status === 'missing' || isDerivedMetricPendingStatus(status))) {
    return 'preparing';
  }
  if (!hasTrainingSummary) {
    return 'unavailable';
  }
  if (isDerivedMetricPendingStatus(status)) {
    return 'updating';
  }
  if (currentActivityCount <= 0) {
    return 'empty';
  }
  if (baselineActivityCount <= 0) {
    return 'building-baseline';
  }
  return 'ready';
}

export function buildTrainingAnalysis({ stateSignals, disciplines }: TrainingAnalysisInput): TrainingAnalysis {
  let currentDurationSeconds = 0;
  let baselineDurationSeconds = 0;
  let currentActivityCount = 0;
  let baselineActivityCount = 0;
  let currentEasySeconds = 0;
  let currentModerateSeconds = 0;
  let currentHardSeconds = 0;
  let baselineEasySeconds = 0;
  let baselineModerateSeconds = 0;
  let baselineHardSeconds = 0;

  disciplines.forEach((discipline) => {
    currentDurationSeconds += discipline.current28d.durationSeconds;
    baselineDurationSeconds += discipline.baseline28d.durationSeconds;
    currentActivityCount += discipline.current28d.activityCount;
    baselineActivityCount += discipline.baseline28d.activityCount;
    currentEasySeconds += discipline.current28d.easySeconds;
    currentModerateSeconds += discipline.current28d.moderateSeconds;
    currentHardSeconds += discipline.current28d.hardSeconds;
    baselineEasySeconds += discipline.baseline28d.easySeconds;
    baselineModerateSeconds += discipline.baseline28d.moderateSeconds;
    baselineHardSeconds += discipline.baseline28d.hardSeconds;
  });

  const duration = buildComparison(currentDurationSeconds, baselineDurationSeconds);
  const activities = buildComparison(currentActivityCount, baselineActivityCount);
  const insights: TrainingAnalysisInsight[] = [];

  if (duration.deltaPercent !== null && Math.abs(duration.deltaPercent) >= MEANINGFUL_VOLUME_CHANGE_PERCENT) {
    const direction = duration.deltaPercent > 0 ? 'more' : 'less';
    insights.push({
      title: 'Volume',
      description: `You trained ${formatPercent(duration.deltaPercent)}% ${direction} time than in your usual 28 days.`,
    });
  }

  if (Math.abs(activities.delta) >= MEANINGFUL_SESSION_CHANGE) {
    const direction = activities.delta > 0 ? 'more' : 'fewer';
    insights.push({
      title: 'Workouts',
      description: `You logged ${formatAbsolute(activities.delta)} ${direction} workouts than in your usual 28 days.`,
    });
  }

  const intensityInsight = resolveIntensityInsight(
    currentEasySeconds,
    currentModerateSeconds,
    currentHardSeconds,
    baselineEasySeconds,
    baselineModerateSeconds,
    baselineHardSeconds,
  );
  if (intensityInsight) {
    insights.push(intensityInsight);
  }

  return {
    state: resolveTrainingStateClassification(stateSignals),
    duration,
    activities,
    insights: insights.slice(0, MAX_INSIGHTS),
  };
}
