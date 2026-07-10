import type {
  DashboardTrainingCapacityMetric,
  DashboardTrainingDisciplineSummary,
} from './dashboard-derived-metrics.helper';
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

function resolveCapacityInsight(disciplines: readonly DashboardTrainingDisciplineSummary[]): TrainingAnalysisInsight | null {
  const metrics: Array<{ label: string; metric: DashboardTrainingCapacityMetric }> = [];
  disciplines.forEach((discipline) => {
    if (discipline.vo2Max) {
      metrics.push({ label: 'Device VO2 Max', metric: discipline.vo2Max });
    }
    if (discipline.ftp) {
      metrics.push({ label: 'FTP', metric: discipline.ftp });
    }
    if (discipline.criticalPower) {
      metrics.push({ label: 'Critical power', metric: discipline.criticalPower });
    }
  });

  const trendingMetric = metrics.find(({ metric }) => metric.sourceKey && metric.trend);
  if (trendingMetric) {
    const direction = trendingMetric.metric.trend === 'improving'
      ? 'is improving'
      : trendingMetric.metric.trend === 'declining'
        ? 'is declining'
        : 'is stable';
    return {
      title: 'Capacity evidence',
      description: `${trendingMetric.label} ${direction} in readings from ${trendingMetric.metric.sourceKey}.`,
    };
  }

  if (metrics.some(({ metric }) => metric.latestValue !== null && !metric.sourceKey)) {
    return {
      title: 'Capacity evidence',
      description: 'Latest capacity values are available, but a trend needs repeated readings from one named device.',
    };
  }

  return null;
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
      title: 'Sessions',
      description: `You logged ${formatAbsolute(activities.delta)} ${direction} sessions than in your usual 28 days.`,
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

  const capacityInsight = resolveCapacityInsight(disciplines);
  if (capacityInsight) {
    insights.push(capacityInsight);
  }

  return {
    state: resolveTrainingStateClassification(stateSignals),
    duration,
    activities,
    insights: insights.slice(0, MAX_INSIGHTS),
  };
}
