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
  return {
    activityCountText: `${recentContext?.matchedEventCount || 0} activities in 90 days · ${yearContext?.matchedEventCount || 0} activities in 1 year`,
    strongestText: strongest
      ? `${formatDuration(strongest.durationSeconds)} is strongest retained at ${formatPercent(strongest.retentionPercent as number)} of the 1-year best`
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

function resolveBestPoints(context: DashboardPowerCurveContext | null | undefined): DashboardPowerCurveSeries['points'] {
  return context?.series.find(series => series.seriesKey === 'best' || series.seriesKey === 'latestAndBest')?.points || [];
}
function formatGap(durationSeconds: number, deltaPercent: number): string {
  if (Math.abs(deltaPercent) < 0.05) return `${formatDuration(durationSeconds)} matches the 1-year best`;
  return `${formatDuration(durationSeconds)} is the clearest gap at ${formatPercent(Math.abs(deltaPercent))} ${deltaPercent > 0 ? 'above' : 'below'} the 1-year best`;
}
function formatPercent(value: number): string { return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`; }
function formatDuration(seconds: number): string { return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${seconds / 60}m` : `${seconds / 3600}h`; }
function resolveTone(deltaPercent: number): TrainingPowerProfileDeltaTone { return deltaPercent > 0.05 ? 'positive' : deltaPercent < -0.05 ? 'negative' : 'neutral'; }
