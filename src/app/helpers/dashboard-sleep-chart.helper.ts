import {
  SleepProvider,
  SleepSession,
  SleepStageDurationsSeconds,
  SLEEP_PROVIDERS,
  SLEEP_STAGES,
} from '@shared/sleep';
import type { AppDashboardSleepTrendRange } from '../models/app-user.interface';
import { dashboardSleepTrendRangeDays } from './dashboard-sleep-range.helper';

export interface DashboardSleepTrendPoint {
  id: string;
  sleepDate: string;
  provider: SleepProvider | null;
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
  isPlaceholder?: boolean;
}

export interface DashboardSleepTrendWindow {
  range?: AppDashboardSleepTrendRange | null;
  startMs: number;
  endMs: number;
}

export interface DashboardSleepTrendContextOptions {
  sleepWindow?: DashboardSleepTrendWindow | null;
  nowMs?: number;
}

export interface DashboardSleepTrendContext {
  points: DashboardSleepTrendPoint[];
  latestPoint: DashboardSleepTrendPoint | null;
  hasRealPoints?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

function toLocalDateKey(timestampMs: number): string | null {
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateKeyToUtcDayMs(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const timestampMs = Date.UTC(year, monthIndex, day);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function utcDayMsToDateKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function buildSleepWindowDateKeys(window: DashboardSleepTrendWindow | null | undefined): string[] {
  if (!window) {
    return [];
  }

  const endDateKey = toLocalDateKey(Number(window.endMs));
  if (!endDateKey) {
    return [];
  }

  const endDayMs = dateKeyToUtcDayMs(endDateKey);
  if (endDayMs === null) {
    return [];
  }

  const rangeDays = window.range ? dashboardSleepTrendRangeDays(window.range) : null;
  const startDateKey = toLocalDateKey(Number(window.startMs));
  const fallbackStartDayMs = startDateKey ? dateKeyToUtcDayMs(startDateKey) : null;
  const startDayMs = rangeDays
    ? endDayMs - ((rangeDays - 1) * DAY_MS)
    : fallbackStartDayMs;
  if (startDayMs === null || startDayMs > endDayMs) {
    return [];
  }

  const dates: string[] = [];
  for (let dayMs = startDayMs; dayMs <= endDayMs; dayMs += DAY_MS) {
    dates.push(utcDayMsToDateKey(dayMs));
  }
  return dates;
}

function buildPlaceholderPoint(sleepDate: string): DashboardSleepTrendPoint {
  return {
    id: `sleep-placeholder:${sleepDate}`,
    sleepDate,
    provider: null,
    providerLabel: '',
    categoryLabel: dateLabel(sleepDate),
    startTimeMs: 0,
    endTimeMs: 0,
    totalSeconds: 0,
    deepSeconds: 0,
    lightSeconds: 0,
    remSeconds: 0,
    awakeSeconds: 0,
    unknownSeconds: 0,
    score: null,
    averageHeartRateBpm: null,
    averageHrvMs: null,
    maxSpo2Percent: null,
    isPlaceholder: true,
  };
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
  const providerCount = new Set(points
    .filter(point => !point.isPlaceholder && point.provider)
    .map(point => point.provider)).size;
  if (providerCount <= 1) {
    return points;
  }

  return points.map(point => point.isPlaceholder
    ? { ...point, categoryLabel: dateLabel(point.sleepDate) }
    : {
      ...point,
      categoryLabel: `${dateLabel(point.sleepDate)}\n${point.providerLabel}`,
    });
}

function compareSleepRecency(left: DashboardSleepTrendPoint, right: DashboardSleepTrendPoint): number {
  if (left.endTimeMs !== right.endTimeMs) {
    return left.endTimeMs - right.endTimeMs;
  }
  return left.startTimeMs - right.startTimeMs;
}

export function buildDashboardSleepTrendContext(
  sessions: readonly SleepSession[] | null | undefined,
  options: DashboardSleepTrendContextOptions = {},
): DashboardSleepTrendContext {
  const realPoints = [...(sessions || [])]
    .map(buildPoint)
    .filter((point): point is DashboardSleepTrendPoint => point !== null)
    .map(point => ({ ...point, isPlaceholder: false }));
  const realSleepDates = new Set(realPoints.map(point => point.sleepDate));
  const todayDateKey = toLocalDateKey(Number(options.nowMs ?? Date.now()));
  const placeholderPoints = buildSleepWindowDateKeys(options.sleepWindow)
    .filter(sleepDate => !realSleepDates.has(sleepDate) && sleepDate !== todayDateKey)
    .map(buildPlaceholderPoint);

  const points = resolveCategoryLabels([...realPoints, ...placeholderPoints]
    .sort((left, right) => {
      if (left.sleepDate !== right.sleepDate) {
        return left.sleepDate.localeCompare(right.sleepDate);
      }
      if (left.isPlaceholder !== right.isPlaceholder) {
        return left.isPlaceholder ? -1 : 1;
      }
      if (left.providerLabel !== right.providerLabel) {
        return left.providerLabel.localeCompare(right.providerLabel);
      }
      return left.startTimeMs - right.startTimeMs;
    }));
  const latestPoint = realPoints.reduce<DashboardSleepTrendPoint | null>((latest, point) => {
    if (!latest || compareSleepRecency(latest, point) < 0) {
      return point;
    }
    return latest;
  }, null);

  return {
    points,
    latestPoint,
    hasRealPoints: realPoints.length > 0,
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
