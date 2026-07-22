import type {
  DashboardTrainingBuildComparisonDiscipline,
  DashboardTrainingDisciplineSummary,
} from './dashboard-derived-metrics.helper';
import { formatSleepDuration } from './dashboard-sleep-chart.helper';

export interface TrainingCardGuidanceViewModel {
  conclusionText: string;
  evidenceText: string;
  nextStepText: string | null;
}

export function buildTrainingBuildGuidance(
  source: DashboardTrainingBuildComparisonDiscipline | null | undefined,
): TrainingCardGuidanceViewModel | null {
  const current = source?.current;
  const benchmark = source?.benchmark;
  if (!current || !benchmark) {
    return null;
  }

  const conclusionText = buildBuildConclusion(current.durationSeconds, benchmark.durationSeconds);
  const evidenceText = buildBuildEvidence(
    current.activityCount,
    benchmark.activityCount,
    current.trainingStressScoreEventCount,
    benchmark.trainingStressScoreEventCount,
  );
  const hasComparableIntensity = current.intensitySourceEventCount >= 3
    && benchmark.intensitySourceEventCount >= 3;
  const timeDifferenceRatio = benchmark.durationSeconds > 0
    ? Math.abs(current.durationSeconds - benchmark.durationSeconds) / benchmark.durationSeconds
    : 0;

  return {
    conclusionText,
    evidenceText,
    nextStepText: hasComparableIntensity && timeDifferenceRatio >= 0.15
      ? 'Look at intensity mix to see whether the difference in training time also changed how hard the build was.'
      : null,
  };
}

export function buildTrainingMixGuidance(
  summary: DashboardTrainingDisciplineSummary,
  label: string,
): TrainingCardGuidanceViewModel {
  const currentTotal = resolveZoneSeconds(summary.current28d);
  const baselineTotal = resolveZoneSeconds(summary.baseline28d);
  if (currentTotal <= 0 || baselineTotal <= 0) {
    return {
      conclusionText: `There is not enough recorded zone time to compare ${label.toLowerCase()} intensity with your usual mix.`,
      evidenceText: 'Evidence quality: limited — workouts without usable intensity zones are left out.',
      nextStepText: null,
    };
  }

  const currentHard = summary.current28d.hardSeconds / currentTotal;
  const baselineHard = summary.baseline28d.hardSeconds / baselineTotal;
  const hardDifference = currentHard - baselineHard;
  const currentEasy = summary.current28d.easySeconds / currentTotal;
  const baselineEasy = summary.baseline28d.easySeconds / baselineTotal;
  const easyDifference = currentEasy - baselineEasy;
  const largestDifference = Math.abs(hardDifference) >= Math.abs(easyDifference)
    ? { label: 'hard', value: hardDifference }
    : { label: 'easy', value: easyDifference };
  const isMeaningfullyDifferent = Math.abs(largestDifference.value) >= 0.08;

  return {
    conclusionText: !isMeaningfullyDifferent
      ? `Your ${label.toLowerCase()} intensity mix is close to your usual balance.`
      : `${capitalize(largestDifference.label)} work makes up ${largestDifference.value > 0 ? 'more' : 'less'} of your ${label.toLowerCase()} training than usual.`,
    evidenceText: 'Evidence quality: recorded zone time only; workouts without usable zones are not inferred.',
    nextStepText: isMeaningfullyDifferent
      ? 'Look at the weekly distribution to see whether this shift is sustained or concentrated in a few weeks.'
      : null,
  };
}

export function buildTrainingLoadGuidance(
  form: number | null,
  forecastForm: number | null,
): TrainingCardGuidanceViewModel {
  const conclusionText = form === null
    ? 'Your load trend is still being calculated from TSS-backed workouts.'
    : form > 0
      ? 'Recent fatigue is currently below your longer-term fitness level.'
      : form < 0
        ? 'Recent fatigue is currently higher than your longer-term fitness level.'
        : 'Recent fatigue and longer-term fitness are currently balanced.';
  const hasForecast = forecastForm !== null;

  return {
    conclusionText,
    evidenceText: 'Evidence quality: TSS-backed workouts only; workouts without TSS are left out of this model.',
    nextStepText: hasForecast
      ? 'Compare today with the no-workout forecast to understand the model’s recovery scenario.'
      : null,
  };
}

function buildBuildConclusion(currentSeconds: number, benchmarkSeconds: number): string {
  if (benchmarkSeconds <= 0) {
    return `This build contains ${formatSleepDuration(currentSeconds)} of recorded training time.`;
  }
  const ratio = currentSeconds / benchmarkSeconds;
  if (Math.abs(ratio - 1) < 0.05) {
    return `This build has a similar amount of training time to the historical reference.`;
  }
  return ratio > 1
    ? `This build is longer so far: ${formatSleepDuration(currentSeconds)} of training versus ${formatSleepDuration(benchmarkSeconds)} in the reference.`
    : `This build is shorter so far: ${formatSleepDuration(currentSeconds)} of training versus ${formatSleepDuration(benchmarkSeconds)} in the reference.`;
}

function buildBuildEvidence(
  currentWorkoutCount: number,
  benchmarkWorkoutCount: number,
  currentTssWorkoutCount: number,
  benchmarkTssWorkoutCount: number,
): string {
  const workoutText = `${formatCount(currentWorkoutCount, 'current')} and ${formatCount(benchmarkWorkoutCount, 'reference')}`;
  if (currentTssWorkoutCount === 0 && benchmarkTssWorkoutCount === 0) {
    return `Evidence quality: ${workoutText}; neither window has recorded TSS.`;
  }
  return `Evidence quality: ${workoutText}; TSS is available for ${formatCount(currentTssWorkoutCount, 'current')} and ${formatCount(benchmarkTssWorkoutCount, 'reference')}.`;
}

function resolveZoneSeconds(window: DashboardTrainingDisciplineSummary['current28d']): number {
  return window.easySeconds + window.moderateSeconds + window.hardSeconds;
}

function formatCount(count: number, label: 'current' | 'reference'): string {
  return `${count} ${label} ${count === 1 ? 'workout' : 'workouts'}`;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
