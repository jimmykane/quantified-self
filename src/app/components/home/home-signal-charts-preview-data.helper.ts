import { DataDuration, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib/metrics';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import type { TrainingSummaryMetric } from '../shared/training-summary/training-summary.models';
import { buildDashboardFormPointsFromDailyLoads } from '../../helpers/dashboard-form.helper';

export * from '../../helpers/dashboard-chart-example-signals.helper';

const DAY_MS = 86_400_000;
// Fictional cycling week shared by the chart and volume card. Never an account export.
const HERO_LATEST_WEEK = [
  { load: 62, minutes: 55 },
  { load: 96, minutes: 80 },
  { load: 41, minutes: 50 },
  { load: 0, minutes: 0 },
  { load: 88, minutes: 85 },
  { load: 174, minutes: 160 },
  { load: 56, minutes: 70 },
];

export function buildHomeHeroPreviewData(timestampMs: number) {
  const day = new Date(timestampMs);
  const endDayMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  // Sixteen earlier weeks establish fitness before the visible twelve-week window.
  // Build blocks, easier weeks and varied ride/rest days make the three signals distinct.
  const weeklyLoads = [
    ...Array.from({ length: 16 }, (_, index) => [400, 450, 510, 330][index % 4]),
    490, 570, 680, 320, 560, 650, 740, 390, 520, 610, 240,
  ];
  const dailyWeights = [
    [0, 18, 12, 21, 7, 30, 12],
    [10, 21, 0, 14, 17, 27, 11],
    [0, 15, 19, 8, 0, 38, 20],
    [8, 0, 23, 12, 16, 0, 41],
  ];
  const loads = weeklyLoads.flatMap((weeklyLoad, index) =>
    dailyWeights[index % dailyWeights.length].map(weight => Math.round(weeklyLoad * weight / 100)));
  loads.push(...HERO_LATEST_WEEK.map(ride => ride.load));
  const formTimeline = buildDashboardFormPointsFromDailyLoads(loads.map((load, index) => ({
    dayMs: endDayMs - (loads.length - 1 - index) * DAY_MS,
    load,
    activityCount: load > 0 ? 1 : 0,
  })));
  return { formTimeline, latestFormPoint: formTimeline.at(-1) ?? null };
}

// Duration and the example imported recovery estimate are independent of the TSS model.
export function buildHomeHeroSummaryMetrics(unitSettings: UserUnitSettingsInterface | null = null): TrainingSummaryMetric[] {
  const duration = (seconds: number) => formatUnitAwareDataValue(DataDuration.type, seconds, unitSettings,
    { compactDuration: true, stripRepeatedUnit: true }) ?? '--';
  return [
    { id: 'volume', label: 'Training volume', valueText: duration(HERO_LATEST_WEEK.reduce((sum, ride) => sum + ride.minutes * 60, 0)), detailText: 'Last 7 days' },
    { id: 'recovery', label: 'Recovery left', valueText: duration(52200), detailText: 'Example post-workout estimate' },
  ];
}
