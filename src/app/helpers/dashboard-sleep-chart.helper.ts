import {
  SleepProvider,
  SleepSession,
  SleepStageDurationsSeconds,
  SLEEP_PROVIDERS,
  SLEEP_STAGES,
} from '@shared/sleep';

export interface DashboardSleepTrendPoint {
  id: string;
  sleepDate: string;
  provider: SleepProvider;
  providerLabel: string;
  categoryLabel: string;
  startTimeMs: number;
  endTimeMs: number;
  totalSeconds: number;
  deepSeconds: number;
  lightSeconds: number;
  remSeconds: number;
  awakeSeconds: number;
  unknownSeconds: number;
  score: number | null;
  averageHeartRateBpm: number | null;
  averageHrvMs: number | null;
  maxSpo2Percent: number | null;
}

export interface DashboardSleepTrendContext {
  points: DashboardSleepTrendPoint[];
  latestPoint: DashboardSleepTrendPoint | null;
}

function providerLabel(provider: SleepProvider): string {
  switch (provider) {
    case SLEEP_PROVIDERS.GarminAPI:
      return 'Garmin';
    case SLEEP_PROVIDERS.SuuntoApp:
      return 'Suunto';
    case SLEEP_PROVIDERS.COROSAPI:
      return 'COROS';
    default:
      return `${provider}`;
  }
}

function finiteSeconds(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
}

function stageSeconds(stageDurations: SleepStageDurationsSeconds | null | undefined, stage: string): number {
  return finiteSeconds((stageDurations || {})[stage as keyof SleepStageDurationsSeconds]);
}

function toMetric(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function dateLabel(sleepDate: string): string {
  const parsed = Date.parse(`${sleepDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) {
    return sleepDate || 'Sleep';
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(parsed));
}

function buildPoint(session: SleepSession): DashboardSleepTrendPoint | null {
  const provider = session.source?.provider;
  if (!provider) {
    return null;
  }
  const startTimeMs = Number(session.startTimeMs);
  const endTimeMs = Number(session.endTimeMs);
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || endTimeMs <= startTimeMs) {
    return null;
  }

  const totalSeconds = finiteSeconds(session.durationSeconds) || Math.max(0, Math.round((endTimeMs - startTimeMs) / 1000));
  const deepSeconds = stageSeconds(session.stageDurationsSeconds, SLEEP_STAGES.Deep);
  const lightSeconds = stageSeconds(session.stageDurationsSeconds, SLEEP_STAGES.Light);
  const remSeconds = stageSeconds(session.stageDurationsSeconds, SLEEP_STAGES.Rem);
  const awakeSeconds = stageSeconds(session.stageDurationsSeconds, SLEEP_STAGES.Awake);
  const explicitUnknownSeconds = stageSeconds(session.stageDurationsSeconds, SLEEP_STAGES.Unknown)
    + stageSeconds(session.stageDurationsSeconds, SLEEP_STAGES.Unmeasurable);
  const displayedStageSeconds = deepSeconds + lightSeconds + remSeconds + awakeSeconds;
  const unknownSeconds = explicitUnknownSeconds || Math.max(0, totalSeconds - displayedStageSeconds);
  const label = providerLabel(provider);
  const resolvedSleepDate = session.sleepDate || new Date(endTimeMs).toISOString().slice(0, 10);

  return {
    id: session.id || `${provider}:${session.source?.sourceSessionKey || startTimeMs}`,
    sleepDate: resolvedSleepDate,
    provider,
    providerLabel: label,
    categoryLabel: dateLabel(resolvedSleepDate),
    startTimeMs,
    endTimeMs,
    totalSeconds,
    deepSeconds,
    lightSeconds,
    remSeconds,
    awakeSeconds,
    unknownSeconds,
    score: toMetric(session.score?.value),
    averageHeartRateBpm: toMetric(session.vitals?.averageHeartRateBpm),
    averageHrvMs: toMetric(session.vitals?.averageHrvMs ?? session.vitals?.overnightHrvMs),
    maxSpo2Percent: toMetric(session.vitals?.maxSpo2Percent),
  };
}

function resolveCategoryLabels(points: DashboardSleepTrendPoint[]): DashboardSleepTrendPoint[] {
  const providerCount = new Set(points.map(point => point.provider)).size;
  if (providerCount <= 1) {
    return points;
  }

  return points.map(point => ({
    ...point,
    categoryLabel: `${dateLabel(point.sleepDate)}\n${point.providerLabel}`,
  }));
}

function compareSleepRecency(left: DashboardSleepTrendPoint, right: DashboardSleepTrendPoint): number {
  if (left.endTimeMs !== right.endTimeMs) {
    return left.endTimeMs - right.endTimeMs;
  }
  return left.startTimeMs - right.startTimeMs;
}

export function buildDashboardSleepTrendContext(sessions: readonly SleepSession[] | null | undefined): DashboardSleepTrendContext {
  const points = resolveCategoryLabels([...(sessions || [])]
    .map(buildPoint)
    .filter((point): point is DashboardSleepTrendPoint => point !== null)
    .sort((left, right) => {
      if (left.sleepDate !== right.sleepDate) {
        return left.sleepDate.localeCompare(right.sleepDate);
      }
      if (left.providerLabel !== right.providerLabel) {
        return left.providerLabel.localeCompare(right.providerLabel);
      }
      return left.startTimeMs - right.startTimeMs;
    }));
  const latestPoint = points.reduce<DashboardSleepTrendPoint | null>((latest, point) => {
    if (!latest || compareSleepRecency(latest, point) < 0) {
      return point;
    }
    return latest;
  }, null);

  return {
    points,
    latestPoint,
  };
}

export function formatSleepDuration(seconds: number | null | undefined): string {
  const totalSeconds = finiteSeconds(seconds);
  if (totalSeconds <= 0) {
    return '--';
  }
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}
