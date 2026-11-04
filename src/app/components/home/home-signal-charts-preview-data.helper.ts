import { DataDuration, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib/metrics';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import type { TrainingSummaryMetric } from '../shared/training-summary/training-summary.models';
import { buildDashboardFormPointsFromDailyLoads } from '../../helpers/dashboard-form.helper';

export * from '../../helpers/dashboard-chart-example-signals.helper';

const DAY_MS = 86_400_000;
// Fictional cycling week shared by the chart and volume card. Never an account export.
const HERO_LATEST_WEEK = [
  { load: 38, minutes: 45 },
  { load: 112, minutes: 90 },
  { load: 64, minutes: 65 },
  { load: 0, minutes: 0 },
  { load: 94, minutes: 85 },
  { load: 186, minutes: 170 },
  { load: 78, minutes: 80 },
];

export function buildHomeHeroPreviewData(timestampMs: number) {
  const day = new Date(timestampMs);
  const endDayMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  // Sixteen earlier weeks establish fitness before the visible twelve-week window.
  // Build blocks, easier weeks and varied ride/rest days make the three signals distinct.
  const weeklyLoads = [
    ...Array.from({ length: 16 }, (_, index) => [320, 370, 410, 300][index % 4]),
    410, 480, 565, 640, 300, 450, 550, 660, 730, 360, 500,
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
    { id: 'recovery', label: 'Recovery left', valueText: duration(60300), detailText: 'Example post-workout estimate' },
  ];
}
