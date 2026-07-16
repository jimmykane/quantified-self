import type { DerivedTrainingDurabilityMetricPayload } from '@shared/derived-metrics';
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

export type DashboardReadinessConfidence = 'high' | 'medium' | 'low';

export interface DashboardReadinessSignalsContext {
  score: number;
  label: 'Ready' | 'Mixed' | 'Recover';
  confidence: DashboardReadinessConfidence;
  availableSignalCount: number;
  totalSignalCount: 4;
  form: number | null;
  rampRate: number | null;
  sleepScore: number | null;
  latestSleepAtMs: number | null;
  hrvRatio: number | null;
  minimumHeartRateRatio: number | null;
  trend: DashboardInsightTrendPoint[];
}

interface WeightedReadinessSignal {
  score: number;
  weight: number;
}

const READINESS_TOTAL_SIGNAL_COUNT = 4 as const;
export const DASHBOARD_READINESS_SLEEP_MAX_AGE_MS = 48 * 60 * 60 * 1000;

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
  const nowMs = toFiniteNumber(input.nowMs) ?? Date.now();
  const sleepPoints = (input.sleepTrend?.points || [])
    .filter(point => point.isPlaceholder !== true && point.isNap !== true)
    .filter((point) => {
      const pointTime = resolveSleepPointTime(point);
      return pointTime > 0 && pointTime <= nowMs;
    })
    .sort((left, right) => resolveSleepPointTime(left) - resolveSleepPointTime(right));
  const latestSleepCandidate = sleepPoints[sleepPoints.length - 1] || null;
  const latestSleepAgeMs = latestSleepCandidate
    ? nowMs - resolveSleepPointTime(latestSleepCandidate)
    : Number.POSITIVE_INFINITY;
  const latestSleep = latestSleepCandidate
    && latestSleepAgeMs >= 0
    && latestSleepAgeMs <= DASHBOARD_READINESS_SLEEP_MAX_AGE_MS
    ? latestSleepCandidate
    : null;
  const baselineSleep = latestSleep
    ? sleepPoints.filter(point => (
      point.id !== latestSleep.id
      && point.sleepDate !== latestSleep.sleepDate
      && point.provider === latestSleep.provider
    )).slice(-14)
    : [];

  const form = toFiniteNumber(input.formNow?.value);
  const rampRate = toFiniteNumber(input.rampRate?.rampRate);
  const sleepScore = resolveSleepScore(latestSleep);
  const hrvRatio = resolveRatioToMedian(
    latestSleep?.averageHrvMs,
    baselineSleep.map(point => point.averageHrvMs),
  );
  const minimumHeartRateRatio = resolveRatioToMedian(
    latestSleep?.minimumHeartRateBpm,
    baselineSleep.map(point => point.minimumHeartRateBpm),
  );
  const signals: WeightedReadinessSignal[] = [];

  const loadScore = resolveLoadReadinessScore(form, rampRate);
  if (loadScore !== null) {
    signals.push({ score: loadScore, weight: 40 });
  }
  if (sleepScore !== null) {
    signals.push({ score: sleepScore, weight: 25 });
  }
  if (hrvRatio !== null) {
    signals.push({ score: clamp(50 + ((hrvRatio - 1) * 100), 0, 100), weight: 20 });
  }
  if (minimumHeartRateRatio !== null) {
    signals.push({ score: clamp(50 + ((1 - minimumHeartRateRatio) * 100), 0, 100), weight: 15 });
  }
  if (!signals.length) {
    return null;
  }

  const availableWeight = signals.reduce((total, signal) => total + signal.weight, 0);
  const score = Math.round(
    signals.reduce((total, signal) => total + (signal.score * signal.weight), 0) / availableWeight,
  );
  const baselineEvidenceCount = baselineSleep.filter(point => (
    point.averageHrvMs !== null || point.minimumHeartRateBpm !== null
  )).length;
  const confidence = resolveReadinessConfidence(availableWeight, baselineEvidenceCount);

  return {
    score,
    label: score >= 75 ? 'Ready' : score >= 55 ? 'Mixed' : 'Recover',
    confidence,
    availableSignalCount: signals.length,
    totalSignalCount: READINESS_TOTAL_SIGNAL_COUNT,
    form,
    rampRate,
    sleepScore,
    latestSleepAtMs: latestSleep ? resolveSleepPointTime(latestSleep) : null,
    hrvRatio,
    minimumHeartRateRatio,
    trend: [],
  };
}

function resolveLoadReadinessScore(form: number | null, rampRate: number | null): number | null {
  if (form === null && rampRate === null) {
    return null;
  }
  let score = form === null
    ? 65
    : form <= -30 ? 10
      : form <= -20 ? 25
        : form <= -10 ? 45
          : form < 8 ? 65
            : form <= 20 ? 90
              : 75;
  if (rampRate !== null && rampRate >= 5) {
    score -= 15;
  } else if (rampRate !== null && rampRate >= 2) {
    score -= 7;
  }
  return clamp(score, 0, 100);
}

function resolveSleepScore(point: DashboardSleepTrendPoint | null): number | null {
  const recordedScore = toFiniteNumber(point?.score);
  if (recordedScore !== null) {
    return clamp(recordedScore, 0, 100);
  }
  const totalSeconds = toFiniteNumber(point?.totalSeconds);
  if (totalSeconds === null || totalSeconds <= 0) {
    return null;
  }
  const hours = totalSeconds / 3600;
  return clamp(100 - (Math.abs(hours - 8) * 20), 0, 100);
}

function resolveSleepPointTime(point: DashboardSleepTrendPoint): number {
  const endTimeMs = toFiniteNumber(point.endTimeMs);
  return endTimeMs ?? toFiniteNumber(point.startTimeMs) ?? 0;
}

function resolveRatioToMedian(value: unknown, baselineValues: readonly unknown[]): number | null {
  const current = toFiniteNumber(value);
  const baseline = baselineValues
    .map(toFiniteNumber)
    .filter((candidate): candidate is number => candidate !== null && candidate > 0)
    .sort((left, right) => left - right);
  if (current === null || current <= 0 || baseline.length < 3) {
    return null;
  }
  const middle = Math.floor(baseline.length / 2);
  const median = baseline.length % 2
    ? baseline[middle]
    : (baseline[middle - 1] + baseline[middle]) / 2;
  return median > 0 ? current / median : null;
}

function resolveReadinessConfidence(
  availableWeight: number,
  baselineEvidenceCount: number,
): DashboardReadinessConfidence {
  if (availableWeight >= 85 && baselineEvidenceCount >= 5) {
    return 'high';
  }
  if (availableWeight >= 60) {
    return 'medium';
  }
  return 'low';
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}
