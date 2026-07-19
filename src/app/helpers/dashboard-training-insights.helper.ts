import type { DerivedTrainingDurabilityMetricPayload } from '@shared/derived-metrics';
import {
  buildReadinessSignals,
  READINESS_SLEEP_LOOKBACK_MS,
  READINESS_SLEEP_MAX_AGE_MS,
  type ReadinessConfidence,
  type ReadinessSleepEvidencePoint,
} from '@shared/readiness';
import type {
  DashboardFormNowContext,
  DashboardRampRateContext,
  DashboardTrainingCapacityContext,
} from './dashboard-derived-metrics.helper';
import type { DashboardSleepTrendContext, DashboardSleepTrendPoint } from './dashboard-sleep-chart.helper';

export interface DashboardInsightTrendPoint {
  time: number;
  value: number | null;
}

export interface DashboardAerobicCapacityContext {
  value: number;
  discipline: 'running' | 'cycling';
  sourceKey: string | null;
  sourceLabel: string | null;
  observationCount: number;
  changePct: number | null;
  lastSeenAtMs: number;
  trend: DashboardInsightTrendPoint[];
}

export interface DashboardAerobicDurabilityContext {
  value: number;
  metric: 'decoupling' | 'pace-retention';
  scopeLabel: string;
  contextLabel: string;
  sampleCount: number;
  eligibilityRatio: number | null;
  trend: DashboardInsightTrendPoint[];
}

export type DashboardReadinessConfidence = ReadinessConfidence;

export interface DashboardReadinessSignalsContext {
  score: number;
  label: 'Ready' | 'Mixed' | 'Recover';
  confidence: DashboardReadinessConfidence;
  availableSignalCount: number;
  baselineEvidenceCount: number;
  totalSignalCount: 4;
  form: number | null;
  rampRate: number | null;
  sleepScore: number | null;
  latestSleepAtMs: number | null;
  hrvRatio: number | null;
  averageHeartRateRatio: number | null;
  minimumHeartRateRatio: number | null;
  overnightHeartRateRatio: number | null;
  loadAtMs?: number | null;
  trend: DashboardInsightTrendPoint[];
}

export const DASHBOARD_READINESS_SLEEP_LOOKBACK_MS = READINESS_SLEEP_LOOKBACK_MS;
export const DASHBOARD_READINESS_SLEEP_QUERY_END_MS = Number.MAX_SAFE_INTEGER;
export const DASHBOARD_READINESS_SLEEP_MAX_AGE_MS = READINESS_SLEEP_MAX_AGE_MS;

export function buildDashboardReadinessSleepQueryWindow(nowMs = Date.now()): {
  startMs: number;
  endMs: number;
} {
  const safeNowMs = toFiniteNumber(nowMs) ?? Date.now();
  return {
    startMs: Math.max(0, safeNowMs - DASHBOARD_READINESS_SLEEP_LOOKBACK_MS),
    endMs: DASHBOARD_READINESS_SLEEP_QUERY_END_MS,
  };
}

const READINESS_MAX_TIMER_DELAY_MS = 2_147_000_000;

export function resolveDashboardReadinessSleepRefreshAtMs(
  sleepTrend: DashboardSleepTrendContext | null | undefined,
  nowMs = Date.now(),
): number | null {
  const safeNowMs = toFiniteNumber(nowMs) ?? Date.now();
  const sleepEndTimes = (sleepTrend?.points || [])
    .filter(point => point.isPlaceholder !== true && point.isNap !== true)
    .map(resolveSleepPointTime)
    .filter(pointTime => pointTime > 0);
  const completedSleepEndTimes = sleepEndTimes.filter(pointTime => (
    pointTime <= safeNowMs
    && pointTime >= safeNowMs - DASHBOARD_READINESS_SLEEP_LOOKBACK_MS
  ));
  const futureRefreshTimes = sleepEndTimes.filter(pointTime => pointTime > safeNowMs);
  const baselineExpiryTimes = completedSleepEndTimes
    .map(pointTime => pointTime + DASHBOARD_READINESS_SLEEP_LOOKBACK_MS + 1)
    .filter(refreshAtMs => refreshAtMs > safeNowMs);
  const latestCompletedSleepEndMs = completedSleepEndTimes.length
    ? Math.max(...completedSleepEndTimes)
    : null;
  const latestSleepExpiryAtMs = latestCompletedSleepEndMs === null
    ? null
    : latestCompletedSleepEndMs + DASHBOARD_READINESS_SLEEP_MAX_AGE_MS + 1;
  const refreshTimes = [
    ...futureRefreshTimes,
    ...baselineExpiryTimes,
    latestSleepExpiryAtMs,
  ].filter((refreshAtMs): refreshAtMs is number => (
    refreshAtMs !== null
    && Number.isFinite(refreshAtMs)
    && refreshAtMs > safeNowMs
  ));
  if (!refreshTimes.length) {
    return null;
  }
  return Math.min(
    Math.min(...refreshTimes),
    safeNowMs + READINESS_MAX_TIMER_DELAY_MS,
  );
}

export function buildDashboardAerobicCapacityContext(
  capacity: DashboardTrainingCapacityContext | null | undefined,
): DashboardAerobicCapacityContext | null {
  const latest = (capacity?.disciplines || [])
    .flatMap(discipline => discipline.importedVo2Max
      ? [{ discipline: discipline.discipline, metric: discipline.importedVo2Max }]
      : [])
    .sort((left, right) => right.metric.lastSeenAtMs - left.metric.lastSeenAtMs)[0];
  if (!latest) {
    return null;
  }

  const hasSameSourcePreviousValue = latest.metric.sourceKey !== null
    && latest.metric.previousSourceKey === latest.metric.sourceKey
    && latest.metric.previousValue !== null
    && latest.metric.previousAtMs !== null;
  const trend: DashboardInsightTrendPoint[] = [];
  if (hasSameSourcePreviousValue) {
    trend.push({ time: latest.metric.previousAtMs, value: latest.metric.previousValue });
  }
  trend.push({ time: latest.metric.lastSeenAtMs, value: latest.metric.value });

  return {
    value: latest.metric.value,
    discipline: latest.discipline,
    sourceKey: latest.metric.sourceKey,
    sourceLabel: formatCapacitySource(latest.metric.sourceKey),
    observationCount: latest.metric.observationCount,
    changePct: hasSameSourcePreviousValue ? latest.metric.changePct : null,
    lastSeenAtMs: latest.metric.lastSeenAtMs,
    trend,
  };
}

export function buildDashboardAerobicDurabilityContext(
  durability: DerivedTrainingDurabilityMetricPayload | null | undefined,
): DashboardAerobicDurabilityContext | null {
  const candidates = (durability?.scopes || []).flatMap((scope) => {
    const coverage = scope.current.coverage;
    return scope.current.summaries.flatMap((summary) => {
      const isPool = scope.scope === 'pool-swimming';
      const value = isPool
        ? toFiniteNumber(summary.medianPaceRetentionPercent)
        : toFiniteNumber(summary.medianDecouplingPercent);
      if (value === null || summary.sampleCount < 1) {
        return [];
      }
      return [{ scope, summary, value, isPool, coverage }];
    });
  });
  candidates.sort((left, right) => {
    const sampleDifference = right.summary.sampleCount - left.summary.sampleCount;
    if (sampleDifference) {
      return sampleDifference;
    }
    const eligibilityDifference = (toFiniteNumber(right.coverage.eligibilityRatio) ?? -1)
      - (toFiniteNumber(left.coverage.eligibilityRatio) ?? -1);
    if (eligibilityDifference) {
      return eligibilityDifference;
    }
    const scopeDifference = durabilityScopePriority(left.scope.scope)
      - durabilityScopePriority(right.scope.scope);
    return scopeDifference
      || left.summary.context.contextKey.localeCompare(right.summary.context.contextKey);
  });
  const selected = candidates[0];
  if (!selected) {
    return null;
  }

  const trend = [...selected.scope.weeks]
    .sort((left, right) => left.windowStartDayMs - right.windowStartDayMs)
    .map((week) => {
      const summary = week.summaries.find(candidate => (
        candidate.context.contextKey === selected.summary.context.contextKey
      ));
      return {
        time: week.windowStartDayMs,
        value: selected.isPool
          ? toFiniteNumber(summary?.medianPaceRetentionPercent)
          : toFiniteNumber(summary?.medianDecouplingPercent),
      };
    });

  return {
    value: selected.value,
    metric: selected.isPool ? 'pace-retention' : 'decoupling',
    scopeLabel: formatDurabilityScope(selected.scope.scope),
    contextLabel: formatDurabilityContext(selected.summary.context),
    sampleCount: selected.summary.sampleCount,
    eligibilityRatio: toFiniteNumber(selected.coverage.eligibilityRatio),
    trend,
  };
}

export function buildDashboardReadinessSignalsContext(input: {
  formNow?: DashboardFormNowContext | null;
  rampRate?: DashboardRampRateContext | null;
  sleepTrend?: DashboardSleepTrendContext | null;
  nowMs?: number;
}): DashboardReadinessSignalsContext | null {
  const sleepPoints: ReadinessSleepEvidencePoint[] = (input.sleepTrend?.points || [])
    .filter(point => point.isPlaceholder !== true && point.isNap !== true)
    .map(point => ({
      id: point.id,
      sleepDate: point.sleepDate,
      provider: point.provider,
      startTimeMs: toFiniteNumber(point.startTimeMs),
      endTimeMs: toFiniteNumber(point.endTimeMs),
      totalSeconds: toFiniteNumber(point.totalSeconds),
      score: toFiniteNumber(point.score),
      averageHrvMs: toFiniteNumber(point.averageHrvMs),
      averageHeartRateBpm: toFiniteNumber(point.averageHeartRateBpm),
      minimumHeartRateBpm: toFiniteNumber(point.minimumHeartRateBpm),
    }));
  const context = buildReadinessSignals({
    form: input.formNow?.value,
    rampRate: input.rampRate?.rampRate,
    sleepPoints,
    nowMs: input.nowMs,
  });
  return context ? {
    ...context,
    loadAtMs: [input.formNow?.latestDayMs, input.rampRate?.latestDayMs]
      .map(toFiniteNumber)
      .filter((value): value is number => value !== null)
      .reduce<number | null>((earliest, value) => earliest === null ? value : Math.min(earliest, value), null),
    trend: [],
  } : null;
}

function resolveSleepPointTime(point: DashboardSleepTrendPoint): number {
  const endTimeMs = toFiniteNumber(point.endTimeMs);
  return endTimeMs ?? toFiniteNumber(point.startTimeMs) ?? 0;
}

function durabilityScopePriority(scope: DerivedTrainingDurabilityMetricPayload['scopes'][number]['scope']): number {
  return ({ running: 0, cycling: 1, 'open-water-swimming': 2, 'pool-swimming': 3 })[scope];
}

function formatDurabilityScope(scope: DerivedTrainingDurabilityMetricPayload['scopes'][number]['scope']): string {
  return ({
    running: 'Running',
    cycling: 'Cycling',
    'open-water-swimming': 'Open water',
    'pool-swimming': 'Pool',
  })[scope];
}

function formatCapacitySource(sourceKey: string | null): string | null {
  if (!sourceKey) {
    return null;
  }
  return sourceKey
    .split(/\s*(?:\/|:)\s*/u)
    .filter(Boolean)
    .map(segment => formatWords(segment))
    .join(' · ');
}

function formatDurabilityContext(
  context: DerivedTrainingDurabilityMetricPayload['scopes'][number]['current']['summaries'][number]['context'],
): string {
  if (context.scope === 'pool-swimming') {
    const poolLength = toFiniteNumber(context.poolLengthMeters);
    const lengthLabel = poolLength === null ? 'Pool' : `${poolLength} m`;
    return `${lengthLabel} · ${formatWords(context.stroke || 'mixed stroke')}`;
  }
  if (context.outputSource === 'grade-adjusted-speed') {
    return 'Grade-adjusted speed';
  }
  if (context.outputSource === 'power') {
    return 'Power';
  }
  if (context.outputSource === 'speed') {
    return 'Speed';
  }
  return context.outputSource ? formatWords(context.outputSource) : 'Recorded output';
}

function formatWords(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}
