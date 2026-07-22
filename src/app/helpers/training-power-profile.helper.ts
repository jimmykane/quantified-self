import {
  comparePowerCurveWindows,
  DEFAULT_POWER_CURVE_MAXIMUM_BRACKET_DURATION_RATIO,
} from '@sports-alliance/sports-lib';
import type { DashboardPowerCurveContext, DashboardPowerCurveSeries } from './dashboard-power-curve.helper';

export type TrainingPowerProfileDeltaTone = 'positive' | 'negative' | 'neutral';
export interface TrainingPowerProfileAnchorViewModel {
  durationSeconds: number;
  durationLabel: string;
  retentionText: string;
  deltaTone: TrainingPowerProfileDeltaTone;
}
export interface TrainingPowerProfileViewModel {
  activityCountText: string;
  conclusionText: string;
  evidenceText: string;
  nextStepText: string | null;
  strongestText: string | null;
  clearestGapText: string | null;
  anchors: TrainingPowerProfileAnchorViewModel[];
}

const PROFILE_DURATIONS_SECONDS = [5, 60, 300, 1200, 3600];

export function buildTrainingPowerProfileViewModel(
  recentContext: DashboardPowerCurveContext | null | undefined,
  yearContext: DashboardPowerCurveContext | null | undefined,
): TrainingPowerProfileViewModel {
  const recentPoints = resolveBestPoints(recentContext);
  const yearPoints = resolveBestPoints(yearContext);
  const comparisons = comparePowerCurveWindows(
    recentPoints,
    yearPoints,
    PROFILE_DURATIONS_SECONDS,
    { maximumBracketDurationRatio: DEFAULT_POWER_CURVE_MAXIMUM_BRACKET_DURATION_RATIO },
  ).filter(item => item.retentionPercent !== null && item.deltaPercent !== null);
  const strongest = [...comparisons].sort((left, right) => (
    (right.retentionPercent as number) - (left.retentionPercent as number)
  ))[0];
  const clearestGap = [...comparisons].sort((left, right) => (
    Math.abs(right.deltaPercent as number) - Math.abs(left.deltaPercent as number)
  ))[0];
  const recentWorkoutCount = recentContext?.matchedEventCount || 0;
  const yearWorkoutCount = yearContext?.matchedEventCount || 0;
  return {
    activityCountText: `${recentWorkoutCount} power ${recentWorkoutCount === 1 ? 'workout' : 'workouts'} in 90 days · ${yearWorkoutCount} in 1 year`,
    conclusionText: buildConclusion(strongest, clearestGap),
    evidenceText: buildEvidenceText(recentWorkoutCount, yearWorkoutCount, comparisons.length),
    nextStepText: clearestGap && (clearestGap.deltaPercent as number) < -0.05
      ? `Look at the ${formatDuration(clearestGap.durationSeconds)} curve point to distinguish a recent focus gap from missing maximal effort.`
      : null,
    strongestText: strongest
      ? `${formatDuration(strongest.durationSeconds)} is closest to its one-year best`
      : null,
    clearestGapText: clearestGap
      ? formatGap(clearestGap.durationSeconds, clearestGap.deltaPercent as number)
      : null,
    anchors: comparisons.map(item => ({
      durationSeconds: item.durationSeconds,
      durationLabel: formatDuration(item.durationSeconds),
      retentionText: formatPercent(item.retentionPercent as number),
      deltaTone: resolveTone(item.deltaPercent as number),
    })),
  };
}

function buildConclusion(
  strongest: ReturnType<typeof comparePowerCurveWindows>[number] | undefined,
  clearestGap: ReturnType<typeof comparePowerCurveWindows>[number] | undefined,
): string {
  if (!strongest || !clearestGap) {
    return 'There are not enough safely comparable recent and annual power points for a conclusion yet.';
  }
  if ((clearestGap.deltaPercent as number) < -0.05) {
    return `Your recent ${formatDuration(clearestGap.durationSeconds)} power is furthest below its one-year best.`;
  }
  if ((clearestGap.deltaPercent as number) > 0.05) {
    return `Your recent ${formatDuration(clearestGap.durationSeconds)} power is above its previous one-year best.`;
  }
  return `Your recent ${formatDuration(strongest.durationSeconds)} power is closest to its one-year best.`;
}

function buildEvidenceText(recentWorkoutCount: number, yearWorkoutCount: number, comparablePointCount: number): string {
  if (recentWorkoutCount === 0 || yearWorkoutCount === 0) {
    return 'Evidence quality: unavailable — a recent and an annual power history are both required.';
  }
  const quality = recentWorkoutCount >= 3 && comparablePointCount >= 2 ? 'usable' : 'limited';
  return `Evidence quality: ${quality} — ${recentWorkoutCount} recent and ${yearWorkoutCount} annual power workouts produced ${comparablePointCount} comparable duration points.`;
}

function resolveBestPoints(context: DashboardPowerCurveContext | null | undefined): DashboardPowerCurveSeries['points'] {
  return context?.series.find(series => series.seriesKey === 'best' || series.seriesKey === 'latestAndBest')?.points || [];
}
function formatGap(durationSeconds: number, deltaPercent: number): string {
  if (Math.abs(deltaPercent) < 0.05) return `${formatDuration(durationSeconds)} matches the one-year best`;
  return `${formatDuration(durationSeconds)} is furthest ${deltaPercent > 0 ? 'above' : 'below'} the one-year best`;
}
function formatPercent(value: number): string { return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`; }
function formatDuration(seconds: number): string { return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${seconds / 60}m` : `${seconds / 3600}h`; }
function resolveTone(deltaPercent: number): TrainingPowerProfileDeltaTone { return deltaPercent > 0.05 ? 'positive' : deltaPercent < -0.05 ? 'negative' : 'neutral'; }
