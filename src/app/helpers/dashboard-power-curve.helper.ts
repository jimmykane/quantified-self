import type {
  DerivedPowerCurveMetricPayload,
  DerivedPowerCurvePointSeries,
  DerivedPowerCurveRange,
  DerivedPowerCurveRangeSnapshot,
  DerivedPowerCurveScope,
} from '@shared/derived-metrics';
import type { PowerCurvePoint } from '@shared/power-curve';
import type { AppDashboardPowerCurveCompareMode } from '../models/app-user.interface';

export interface DashboardPowerCurveSeries {
  seriesKey: 'best' | 'latest' | 'comparisonBest' | 'latestAndBest';
  label: string;
  colorKey: string;
  points: PowerCurvePoint[];
  eventId?: string | null;
  eventStartMs?: number | null;
}

export interface DashboardPowerCurveSummaryPoint {
  duration: number;
  power: number;
  wattsPerKg?: number;
}

export interface DashboardPowerCurveContext {
  matchedEventCount: number;
  sourceEventCount: number;
  latestEventId: string | null;
  latestEventStartMs: number | null;
  latestSeriesLabel: string;
  compareMode: AppDashboardPowerCurveCompareMode;
  comparisonSeriesLabel: string;
  comparisonEventCount: number;
  series: DashboardPowerCurveSeries[];
  summaryPoints: DashboardPowerCurveSummaryPoint[];
}

export interface DashboardPowerCurveSnapshotContextOptions {
  scope: DerivedPowerCurveScope;
  range: DerivedPowerCurveRange;
  startOfWeek?: number | null;
  latestSeriesLabel?: string;
  compareMode?: AppDashboardPowerCurveCompareMode | null;
}

const SUMMARY_DURATIONS_SECONDS = [5, 60, 300, 1200, 3600];

export const DASHBOARD_POWER_CURVE_DEFAULT_COMPARE_MODE: AppDashboardPowerCurveCompareMode = 'latest';

export interface DashboardPowerCurveCompareModeOption {
  mode: AppDashboardPowerCurveCompareMode;
  label: string;
  shortLabel: string;
  menuLabel: string;
  windowDays?: number;
}

export const DASHBOARD_POWER_CURVE_COMPARE_MODE_OPTIONS: ReadonlyArray<DashboardPowerCurveCompareModeOption> = [
  {
    mode: 'latest',
    label: 'Latest',
    shortLabel: 'Latest',
    menuLabel: 'Latest activity',
  },
  {
    mode: 'best30d',
    label: '30d',
    shortLabel: '30d',
    menuLabel: 'Best last 30d',
    windowDays: 30,
  },
  {
    mode: 'best90d',
    label: '90d',
    shortLabel: '90d',
    menuLabel: 'Best last 90d',
    windowDays: 90,
  },
];

const DASHBOARD_POWER_CURVE_COMPARE_MODES = new Set<AppDashboardPowerCurveCompareMode>(
  DASHBOARD_POWER_CURVE_COMPARE_MODE_OPTIONS.map(option => option.mode),
);

export function normalizeDashboardPowerCurveCompareMode(value: unknown): AppDashboardPowerCurveCompareMode {
  const stringValue = `${value || ''}`;
  return DASHBOARD_POWER_CURVE_COMPARE_MODES.has(stringValue as AppDashboardPowerCurveCompareMode)
    ? stringValue as AppDashboardPowerCurveCompareMode
    : DASHBOARD_POWER_CURVE_DEFAULT_COMPARE_MODE;
}

export function resolveDashboardPowerCurveComparisonLabel(
  mode: AppDashboardPowerCurveCompareMode,
  latestSeriesLabel: string,
): string {
  const normalizedMode = normalizeDashboardPowerCurveCompareMode(mode);
  if (normalizedMode === 'latest') {
    return latestSeriesLabel;
  }
  return DASHBOARD_POWER_CURVE_COMPARE_MODE_OPTIONS
    .find(option => option.mode === normalizedMode)?.menuLabel || latestSeriesLabel;
}

export function resolveDashboardPowerCurveMetricPayload(value: unknown): DerivedPowerCurveMetricPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const asOfDayMs = toFiniteNumber(payload.asOfDayMs);
  const scopes = payload.scopes;
  if (
    asOfDayMs === null
    || payload.excludesMergedEvents !== true
    || payload.pointSamplingVersion !== 1
    || !scopes
    || typeof scopes !== 'object'
    || Array.isArray(scopes)
  ) {
    return null;
  }

  const normalizedScopes = (['cycling', 'running'] as const).reduce<Partial<DerivedPowerCurveMetricPayload['scopes']>>((result, scope) => {
    const normalizedScope = normalizeScopeSnapshot((scopes as Record<string, unknown>)[scope]);
    if (normalizedScope) {
      result[scope] = normalizedScope;
    }
    return result;
  }, {});
  if (!normalizedScopes.cycling || !normalizedScopes.running) {
    return null;
  }

  return {
    asOfDayMs,
    excludesMergedEvents: true,
    pointSamplingVersion: 1,
    scopes: normalizedScopes as DerivedPowerCurveMetricPayload['scopes'],
  };
}

export function buildDashboardPowerCurveContextFromSnapshot(
  payload: DerivedPowerCurveMetricPayload | null | undefined,
  options: DashboardPowerCurveSnapshotContextOptions,
): DashboardPowerCurveContext | null {
  const scopeSnapshot = payload?.scopes?.[options.scope];
  const snapshot = resolveRangeSnapshot(scopeSnapshot, options.range, options.startOfWeek);
  if (!snapshot) {
    return null;
  }

  const latestSeriesLabel = options.latestSeriesLabel || 'Latest power activity';
  const compareMode = normalizeDashboardPowerCurveCompareMode(options.compareMode);
  const comparisonSeriesLabel = resolveDashboardPowerCurveComparisonLabel(compareMode, latestSeriesLabel);
  const bestPoints = deserializePowerCurvePoints(snapshot.bestPoints);
  const latestPoints = deserializePowerCurvePoints(snapshot.latestActivity?.points || []);
  const comparisonPoints = compareMode === 'latest'
    ? latestPoints
    : deserializePowerCurvePoints(compareMode === 'best30d' ? snapshot.best30dPoints : snapshot.best90dPoints);
  const comparisonEventCount = compareMode === 'latest'
    ? (snapshot.latestActivity ? 1 : 0)
    : (compareMode === 'best30d' ? snapshot.best30dEventCount : snapshot.best90dEventCount);
  const latestActivity = snapshot.latestActivity;

  if (!snapshot.matchedEventCount || !bestPoints.length) {
    return createEmptyPowerCurveContext(snapshot, latestSeriesLabel, compareMode, comparisonSeriesLabel);
  }

  const comparisonSeries: DashboardPowerCurveSeries | null = comparisonPoints.length
    ? {
      seriesKey: compareMode === 'latest' ? 'latest' : 'comparisonBest',
      label: comparisonSeriesLabel,
      colorKey: 'latest',
      points: comparisonPoints,
      ...(compareMode === 'latest' ? {
        eventId: latestActivity?.eventId ?? null,
        eventStartMs: latestActivity?.startMs ?? null,
      } : {}),
    }
    : null;
  const comparisonEqualsBest = comparisonSeries !== null && powerCurvePointsEqual(comparisonSeries.points, bestPoints);
  const series = comparisonEqualsBest
    ? [{
      seriesKey: 'latestAndBest' as const,
      label: compareMode === 'latest' ? 'Latest and best' : `${comparisonSeriesLabel} and best`,
      colorKey: 'best',
      points: bestPoints,
      eventId: comparisonSeries.eventId,
      eventStartMs: comparisonSeries.eventStartMs,
    }]
    : [
      {
        seriesKey: 'best' as const,
        label: 'Best in range',
        colorKey: 'best',
        points: bestPoints,
      },
      ...(comparisonSeries ? [comparisonSeries] : []),
    ];

  return {
    matchedEventCount: snapshot.matchedEventCount,
    sourceEventCount: snapshot.sourceEventCount,
    latestEventId: latestActivity?.eventId ?? null,
    latestEventStartMs: latestActivity?.startMs ?? null,
    latestSeriesLabel,
    compareMode,
    comparisonSeriesLabel,
    comparisonEventCount,
    series,
    summaryPoints: buildDashboardPowerCurveSummaryPoints(bestPoints),
  };
}

function normalizeScopeSnapshot(value: unknown): DerivedPowerCurveMetricPayload['scopes'][DerivedPowerCurveScope] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const rangesSource = source.ranges;
  const thisWeekSource = source.thisWeekByStartDay;
  if (!rangesSource || typeof rangesSource !== 'object' || Array.isArray(rangesSource)
    || !thisWeekSource || typeof thisWeekSource !== 'object' || Array.isArray(thisWeekSource)) {
    return null;
  }
  const rangeNames: Array<Exclude<DerivedPowerCurveRange, 'thisWeek'>> = [
    'thisMonth', '14d', '30d', '90d', '1y', '2y', '3y', '4y', 'all',
  ];
  const ranges = rangeNames.reduce<Partial<DerivedPowerCurveMetricPayload['scopes'][DerivedPowerCurveScope]['ranges']>>((result, range) => {
    const snapshot = normalizeRangeSnapshot((rangesSource as Record<string, unknown>)[range]);
    if (snapshot) {
      result[range] = snapshot;
    }
    return result;
  }, {});
  if (Object.keys(ranges).length !== rangeNames.length) {
    return null;
  }
  const thisWeekByStartDay = Object.entries(thisWeekSource as Record<string, unknown>)
    .reduce<Record<string, DerivedPowerCurveRangeSnapshot>>((result, [day, candidate]) => {
      const snapshot = normalizeRangeSnapshot(candidate);
      if (/^[0-6]$/.test(day) && snapshot) {
        result[day] = snapshot;
      }
      return result;
    }, {});
  if (Object.keys(thisWeekByStartDay).length !== 7) {
    return null;
  }
  return {
    ranges: ranges as DerivedPowerCurveMetricPayload['scopes'][DerivedPowerCurveScope]['ranges'],
    thisWeekByStartDay,
  };
}

function normalizeRangeSnapshot(value: unknown): DerivedPowerCurveRangeSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const snapshot = value as Record<string, unknown>;
  const sourceEventCount = toNonNegativeInteger(snapshot.sourceEventCount);
  const matchedEventCount = toNonNegativeInteger(snapshot.matchedEventCount);
  const best30dEventCount = toNonNegativeInteger(snapshot.best30dEventCount);
  const best90dEventCount = toNonNegativeInteger(snapshot.best90dEventCount);
  const bestPoints = normalizePowerCurvePointSeries(snapshot.bestPoints);
  const best30dPoints = normalizePowerCurvePointSeries(snapshot.best30dPoints);
  const best90dPoints = normalizePowerCurvePointSeries(snapshot.best90dPoints);
  if (sourceEventCount === null || matchedEventCount === null || best30dEventCount === null || best90dEventCount === null
    || bestPoints === null || best30dPoints === null || best90dPoints === null) {
    return null;
  }
  const latestActivity = normalizeLatestActivity(snapshot.latestActivity);
  if (snapshot.latestActivity !== null && snapshot.latestActivity !== undefined && latestActivity === null) {
    return null;
  }
  return {
    sourceEventCount,
    matchedEventCount,
    latestActivity,
    bestPoints,
    best30dPoints,
    best30dEventCount,
    best90dPoints,
    best90dEventCount,
  };
}

function normalizeLatestActivity(value: unknown): DerivedPowerCurveRangeSnapshot['latestActivity'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const startMs = toFiniteNumber(source.startMs);
  const points = normalizePowerCurvePointSeries(source.points);
  if (startMs === null || points === null) {
    return null;
  }
  const eventId = typeof source.eventId === 'string' && source.eventId.trim().length ? source.eventId : null;
  return { eventId, startMs, points };
}

function normalizePowerCurvePointSeries(value: unknown): DerivedPowerCurvePointSeries | null {
  if (!Array.isArray(value) || value.length % 3 !== 0) {
    return null;
  }
  const points: number[] = [];
  for (let index = 0; index < value.length; index += 3) {
    const duration = toFinitePositiveNumber(value[index]);
    const power = toFinitePositiveNumber(value[index + 1]);
    const wattsPerKg = toFiniteNumber(value[index + 2]);
    if (duration === null || power === null || wattsPerKg === null || wattsPerKg < 0) {
      return null;
    }
    points.push(duration, power, wattsPerKg);
  }
  return points;
}

function resolveRangeSnapshot(
  scope: DerivedPowerCurveMetricPayload['scopes'][DerivedPowerCurveScope] | undefined,
  range: DerivedPowerCurveRange,
  startOfWeek: number | null | undefined,
): DerivedPowerCurveRangeSnapshot | null {
  if (!scope) {
    return null;
  }
  if (range === 'thisWeek') {
    const normalizedDay = Number.isFinite(startOfWeek) ? Math.max(0, Math.min(6, Math.floor(startOfWeek as number))) : 1;
    return scope.thisWeekByStartDay[`${normalizedDay}`] || null;
  }
  return scope.ranges[range] || null;
}

function createEmptyPowerCurveContext(
  snapshot: DerivedPowerCurveRangeSnapshot,
  latestSeriesLabel: string,
  compareMode: AppDashboardPowerCurveCompareMode,
  comparisonSeriesLabel: string,
): DashboardPowerCurveContext {
  return {
    matchedEventCount: 0,
    sourceEventCount: snapshot.sourceEventCount,
    latestEventId: null,
    latestEventStartMs: null,
    latestSeriesLabel,
    compareMode,
    comparisonSeriesLabel,
    comparisonEventCount: 0,
    series: [],
    summaryPoints: [],
  };
}

function deserializePowerCurvePoints(points: ReadonlyArray<number>): PowerCurvePoint[] {
  const result: PowerCurvePoint[] = [];
  for (let index = 0; index < points.length; index += 3) {
    const duration = points[index];
    const power = points[index + 1];
    const wattsPerKg = points[index + 2];
    result.push({
      duration,
      power,
      ...(wattsPerKg > 0 ? { wattsPerKg } : {}),
    });
  }
  return result;
}

function buildDashboardPowerCurveSummaryPoints(points: readonly PowerCurvePoint[]): DashboardPowerCurveSummaryPoint[] {
  return SUMMARY_DURATIONS_SECONDS
    .map(duration => points.find(point => point.duration === duration))
    .filter((point): point is PowerCurvePoint => !!point)
    .map(point => ({ ...point }));
}

function powerCurvePointsEqual(left: readonly PowerCurvePoint[], right: readonly PowerCurvePoint[]): boolean {
  return left.length === right.length && left.every((leftPoint, index) => {
    const rightPoint = right[index];
    return rightPoint
      && leftPoint.duration === rightPoint.duration
      && leftPoint.power === rightPoint.power
      && (leftPoint.wattsPerKg ?? null) === (rightPoint.wattsPerKg ?? null);
  });
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toFinitePositiveNumber(value: unknown): number | null {
  const numberValue = toFiniteNumber(value);
  return numberValue !== null && numberValue > 0 ? numberValue : null;
}

function toNonNegativeInteger(value: unknown): number | null {
  const numberValue = toFiniteNumber(value);
  return numberValue !== null && numberValue >= 0 ? Math.floor(numberValue) : null;
}
