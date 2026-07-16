import {
  normalizeSleepProvider,
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
  minimumHeartRateBpm: number | null;
  averageHrvMs: number | null;
  maxSpo2Percent: number | null;
  isNap: boolean;
  napSeconds: number;
  napCount: number;
  napAverageHrvMs: number | null;
  napAverageHeartRateBpm: number | null;
  napStartTimeMs: number | null;
  napEndTimeMs: number | null;
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
const MAX_TIMEZONE_OFFSET_SECONDS = 18 * 60 * 60;

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

function toPositiveMetric(value: unknown): number | null {
  const metric = toMetric(value);
  return metric !== null && metric > 0 ? metric : null;
}

function toSpo2Percent(value: unknown): number | null {
  const metric = toMetric(value);
  if (metric === null) {
    return null;
  }
  return metric <= 1 ? metric * 100 : metric;
}

function maxSpo2SamplePercent(values: ReadonlyArray<unknown>): number | null {
  const finiteValues = values
    .map(toSpo2Percent)
    .filter((value): value is number => Number.isFinite(value));
  return finiteValues.length ? Math.max(...finiteValues) : null;
}

function resolveMaxSpo2Percent(session: SleepSession): number | null {
  return toSpo2Percent(session.vitals?.maxSpo2Percent)
    ?? maxSpo2SamplePercent((session.spo2Samples || []).map(sample => sample?.value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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

function parseDateTimeOffsetSeconds(value: unknown): number | null {
  const stringValue = asString(value);
  if (!stringValue) {
    return null;
  }
  if (/z$/i.test(stringValue)) {
    return 0;
  }
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(stringValue);
  if (!match) {
    return null;
  }
  const [, sign, hours, minutes] = match;
  const numericHours = Number(hours);
  const numericMinutes = Number(minutes);
  const totalSeconds = ((numericHours * 60) + numericMinutes) * 60;
  return Number.isFinite(totalSeconds)
    && numericMinutes < 60
    && totalSeconds <= MAX_TIMEZONE_OFFSET_SECONDS
    ? (sign === '-' ? -totalSeconds : totalSeconds)
    : null;
}

function localDateKeyFromMs(timestampMs: number, offsetSeconds: number | null): string | null {
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
  const localMs = offsetSeconds === null ? timestampMs : timestampMs + (offsetSeconds * 1000);
  const localDate = new Date(localMs);
  return Number.isFinite(localDate.getTime()) ? localDate.toISOString().slice(0, 10) : null;
}

function resolveSessionTimezoneOffsetSeconds(session: SleepSession): number | null {
  const explicitOffsetSeconds = session.timezoneOffsetSeconds === null
    || session.timezoneOffsetSeconds === undefined
    ? null
    : Number(session.timezoneOffsetSeconds);
  if (
    explicitOffsetSeconds !== null
    && Number.isFinite(explicitOffsetSeconds)
    && Math.abs(explicitOffsetSeconds) <= MAX_TIMEZONE_OFFSET_SECONDS
  ) {
    return explicitOffsetSeconds;
  }
  const suuntoFields = asRecord(session.providerFields?.suunto);
  return parseDateTimeOffsetSeconds(suuntoFields.timestamp);
}

function resolveDisplaySleepDate(session: SleepSession, startTimeMs: number, endTimeMs: number): string {
  const provider = session.source?.provider;
  const fallbackSleepDate = session.sleepDate || new Date(endTimeMs).toISOString().slice(0, 10);
  if (provider !== SLEEP_PROVIDERS.SuuntoApp) {
    return fallbackSleepDate;
  }

  const dateTimeMs = session.isNap === true ? startTimeMs : endTimeMs;
  return localDateKeyFromMs(dateTimeMs, resolveSessionTimezoneOffsetSeconds(session)) || fallbackSleepDate;
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
    minimumHeartRateBpm: null,
    averageHrvMs: null,
    maxSpo2Percent: null,
    isNap: false,
    napSeconds: 0,
    napCount: 0,
    napAverageHrvMs: null,
    napAverageHeartRateBpm: null,
    napStartTimeMs: null,
    napEndTimeMs: null,
    isPlaceholder: true,
  };
}

function buildPoint(session: SleepSession): DashboardSleepTrendPoint | null {
  const provider = normalizeSleepProvider(session.source?.provider);
  if (!provider) {
    return null;
  }
  const startTimeMs = Number(session.startTimeMs);
  const endTimeMs = Number(session.endTimeMs);
  if (
    !Number.isFinite(startTimeMs)
    || !Number.isFinite(endTimeMs)
    || !Number.isFinite(new Date(startTimeMs).getTime())
    || !Number.isFinite(new Date(endTimeMs).getTime())
    || endTimeMs <= startTimeMs
  ) {
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
  const resolvedSleepDate = resolveDisplaySleepDate(session, startTimeMs, endTimeMs);

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
    averageHeartRateBpm: toPositiveMetric(session.vitals?.averageHeartRateBpm),
    minimumHeartRateBpm: toPositiveMetric(session.vitals?.minimumHeartRateBpm),
    averageHrvMs: toPositiveMetric(session.vitals?.averageHrvMs ?? session.vitals?.overnightHrvMs),
    maxSpo2Percent: resolveMaxSpo2Percent(session),
    isNap: session.isNap === true,
    napSeconds: 0,
    napCount: 0,
    napAverageHrvMs: null,
    napAverageHeartRateBpm: null,
    napStartTimeMs: null,
    napEndTimeMs: null,
  };
}

function resolveCategoryLabels(points: DashboardSleepTrendPoint[]): DashboardSleepTrendPoint[] {
  const realPoints = points.filter(point => !point.isPlaceholder && point.provider);
  const providerCount = new Set(realPoints.map(point => point.provider)).size;

  return points.map(point => {
    const baseLabel = dateLabel(point.sleepDate);
    if (point.isPlaceholder) {
      return { ...point, categoryLabel: baseLabel };
    }

    if (providerCount <= 1) {
      return { ...point, categoryLabel: baseLabel };
    }

    return {
      ...point,
      categoryLabel: `${baseLabel}\n${point.providerLabel}`,
    };
  });
}

function aggregateFiniteMetrics(values: ReadonlyArray<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => Number.isFinite(value) && (value as number) > 0);
  if (!finiteValues.length) {
    return null;
  }
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function minFiniteMetric(values: ReadonlyArray<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => Number.isFinite(value) && (value as number) > 0);
  return finiteValues.length ? Math.min(...finiteValues) : null;
}

function maxFiniteMetric(values: ReadonlyArray<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => Number.isFinite(value));
  return finiteValues.length ? Math.max(...finiteValues) : null;
}

function sumPointSeconds(points: readonly DashboardSleepTrendPoint[], key: keyof Pick<
  DashboardSleepTrendPoint,
  'totalSeconds' | 'deepSeconds' | 'lightSeconds' | 'remSeconds' | 'awakeSeconds' | 'unknownSeconds'
>): number {
  return points.reduce((sum, point) => sum + finiteSeconds(point[key]), 0);
}

function compareSleepRecency(left: DashboardSleepTrendPoint, right: DashboardSleepTrendPoint): number {
  if (left.endTimeMs !== right.endTimeMs) {
    return left.endTimeMs - right.endTimeMs;
  }
  return left.startTimeMs - right.startTimeMs || left.id.localeCompare(right.id);
}

function aggregatePointGroup(points: readonly DashboardSleepTrendPoint[]): DashboardSleepTrendPoint {
  if (points.length <= 1) {
    return points[0];
  }

  const sleepPoints = points.filter(point => !point.isNap);
  const napPoints = points.filter(point => point.isNap);
  const primaryPoints = sleepPoints.length ? sleepPoints : points;
  const latestPrimaryPoint = primaryPoints.reduce((latest, point) => compareSleepRecency(latest, point) < 0 ? point : latest);
  const sortedPrimaryPoints = [...primaryPoints].sort((left, right) => left.startTimeMs - right.startTimeMs);
  const napSeconds = sumPointSeconds(napPoints, 'totalSeconds');

  return {
    ...latestPrimaryPoint,
    id: [...points].sort(compareSleepRecency).map(point => point.id).join('|'),
    startTimeMs: sortedPrimaryPoints[0]?.startTimeMs ?? latestPrimaryPoint.startTimeMs,
    endTimeMs: Math.max(...primaryPoints.map(point => point.endTimeMs)),
    totalSeconds: sumPointSeconds(primaryPoints, 'totalSeconds'),
    deepSeconds: sumPointSeconds(primaryPoints, 'deepSeconds'),
    lightSeconds: sumPointSeconds(primaryPoints, 'lightSeconds'),
    remSeconds: sumPointSeconds(primaryPoints, 'remSeconds'),
    awakeSeconds: sumPointSeconds(primaryPoints, 'awakeSeconds'),
    unknownSeconds: sumPointSeconds(primaryPoints, 'unknownSeconds'),
    averageHeartRateBpm: aggregateFiniteMetrics(primaryPoints.map(point => point.averageHeartRateBpm)),
    minimumHeartRateBpm: minFiniteMetric(primaryPoints.map(point => point.minimumHeartRateBpm)),
    averageHrvMs: aggregateFiniteMetrics(primaryPoints.map(point => point.averageHrvMs)),
    maxSpo2Percent: maxFiniteMetric(primaryPoints.map(point => point.maxSpo2Percent)),
    isNap: sleepPoints.length === 0 && napPoints.length > 0,
    napSeconds: sleepPoints.length ? napSeconds : 0,
    napCount: sleepPoints.length ? napPoints.length : 0,
    napAverageHrvMs: sleepPoints.length ? aggregateFiniteMetrics(napPoints.map(point => point.averageHrvMs)) : null,
    napAverageHeartRateBpm: sleepPoints.length ? aggregateFiniteMetrics(napPoints.map(point => point.averageHeartRateBpm)) : null,
    napStartTimeMs: sleepPoints.length && napPoints.length ? Math.min(...napPoints.map(point => point.startTimeMs)) : null,
    napEndTimeMs: sleepPoints.length && napPoints.length ? Math.max(...napPoints.map(point => point.endTimeMs)) : null,
  };
}

function aggregateSameProviderDatePoints(points: readonly DashboardSleepTrendPoint[]): DashboardSleepTrendPoint[] {
  const groupedPoints = new Map<string, DashboardSleepTrendPoint[]>();
  for (const point of points) {
    const key = point.isPlaceholder ? point.id : `${point.sleepDate}:${point.provider}`;
    const group = groupedPoints.get(key) || [];
    group.push(point);
    groupedPoints.set(key, group);
  }

  return [...groupedPoints.values()].map(aggregatePointGroup);
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

  const points = resolveCategoryLabels(aggregateSameProviderDatePoints([...realPoints, ...placeholderPoints])
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
