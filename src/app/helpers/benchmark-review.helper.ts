import { DataAltitude, DataHeartRate } from '@sports-alliance/sports-lib';
import { BenchmarkResult, BenchmarkStreamMetrics } from '@shared/app-event.interface';
import {
  EVENT_TAG_LIMIT,
  EVENT_TAG_MAX_LENGTH,
  normalizeEventTags,
} from '@shared/event-tags';

export const BENCHMARK_REVIEW_TAG_LIMIT = EVENT_TAG_LIMIT;
export const BENCHMARK_REVIEW_TAG_MAX_LENGTH = EVENT_TAG_MAX_LENGTH;

export interface BenchmarkAtAGlanceItem {
  key: string;
  label: string;
  value: string;
  detail?: string;
}

export interface BenchmarkReviewerSummary {
  title: string;
  lines: string[];
  text: string;
  atAGlanceItems: BenchmarkAtAGlanceItem[];
}

export function normalizeBenchmarkReviewTags(value: unknown): string[] {
  return normalizeEventTags(value);
}

export function buildBenchmarkReviewerSummary(
  result: BenchmarkResult | null | undefined,
  tags: string[] = [],
): BenchmarkReviewerSummary {
  if (!result) {
    return {
      title: 'Benchmark summary',
      lines: ['No benchmark report is available.'],
      text: 'Benchmark summary\n- No benchmark report is available.',
      atAGlanceItems: [],
    };
  }

  const normalizedTags = normalizeBenchmarkReviewTags(tags);
  const pairLabel = formatBenchmarkPair(result);
  const overallLabel = `${formatGradeLabel(resolveOverallGrade(result))} agreement`;
  const gnss = result.metrics?.gnss;
  const streamMetrics = result.metrics?.streamMetrics || {};
  const heartRate = resolveBenchmarkStreamMetrics(streamMetrics, DataHeartRate.type, ['HeartRate', 'Heart Rate', 'Average Heart Rate']);
  const altitude = resolveBenchmarkStreamMetrics(streamMetrics, DataAltitude.type, ['Altitude', 'Average Altitude']);
  const heartRateMeanDeviation = resolveBenchmarkStreamMeanDeviation(heartRate);
  const altitudeMeanDeviation = resolveBenchmarkStreamMeanDeviation(altitude);
  const qualityIssueCount = Array.isArray(result.qualityIssues) ? result.qualityIssues.length : 0;

  const atAGlanceItems: BenchmarkAtAGlanceItem[] = [
    { key: 'overall', label: 'Overall', value: overallLabel },
    {
      key: 'pair',
      label: 'Pair',
      value: pairLabel,
    },
    {
      key: 'gnss',
      label: 'GNSS',
      value: `CEP50 ${formatNumber(gnss?.cep50, 'm', 1)}`,
      detail: `RMSE ${formatNumber(gnss?.rmse, 'm', 1)} · MAE ${formatNumber(gnss?.meanAbsoluteError, 'm', 1)}`,
    },
    {
      key: 'heart-rate',
      label: 'HR',
      value: `MD ${formatNumber(heartRateMeanDeviation, 'bpm', 0, true)}`,
      detail: `MAE ${formatNumber(heartRate?.meanAbsoluteError, 'bpm', 0)} · Corr ${formatCorrelation(heartRate?.pearsonCorrelation)}`,
    },
    {
      key: 'altitude',
      label: 'Alt',
      value: `MD ${formatNumber(altitudeMeanDeviation, 'm', 1, true)}`,
      detail: `MAE ${formatNumber(altitude?.meanAbsoluteError, 'm', 1)} · Corr ${formatCorrelation(altitude?.pearsonCorrelation)}`,
    },
    {
      key: 'quality',
      label: 'Quality',
      value: qualityIssueCount === 0 ? 'No issues' : `${qualityIssueCount} issue${qualityIssueCount === 1 ? '' : 's'}`,
      detail: result.timeOffsetSeconds === undefined ? 'No time offset' : `Offset ${result.timeOffsetSeconds}s`,
    },
  ];

  if (normalizedTags.length > 0) {
    atAGlanceItems.push({
      key: 'tags',
      label: 'Tags',
      value: normalizedTags.join(', '),
    });
  }

  const lines = [
    `Pair: ${pairLabel}`,
    `Overall: ${overallLabel}`,
    `GNSS: CEP50 ${formatNumber(gnss?.cep50, 'm', 1)}, RMSE ${formatNumber(gnss?.rmse, 'm', 1)}, MAE ${formatNumber(gnss?.meanAbsoluteError, 'm', 1)}`,
    `HR: MD ${formatNumber(heartRateMeanDeviation, 'bpm', 0, true)}, MAE ${formatNumber(heartRate?.meanAbsoluteError, 'bpm', 0)}, correlation ${formatCorrelation(heartRate?.pearsonCorrelation)}`,
    `Alt: MD ${formatNumber(altitudeMeanDeviation, 'm', 1, true)}, MAE ${formatNumber(altitude?.meanAbsoluteError, 'm', 1)}, correlation ${formatCorrelation(altitude?.pearsonCorrelation)}`,
    `Quality: ${qualityIssueCount === 0 ? 'No issues' : `${qualityIssueCount} issue${qualityIssueCount === 1 ? '' : 's'}`}${result.timeOffsetSeconds === undefined ? '' : `, offset ${result.timeOffsetSeconds}s`}`,
    normalizedTags.length > 0 ? `Tags: ${normalizedTags.join(', ')}` : '',
  ].filter(Boolean);

  const title = `Benchmark summary: ${pairLabel}`;

  return {
    title,
    lines,
    text: `${title}\n${lines.map(line => `- ${line}`).join('\n')}`,
    atAGlanceItems,
  };
}

function formatBenchmarkPair(result: BenchmarkResult): string {
  const reference = normalizeLabel(result.referenceName) || normalizeLabel(result.referenceId) || 'Reference';
  const test = normalizeLabel(result.testName) || normalizeLabel(result.testId) || 'Test';
  return `${reference} -> ${test}`;
}

export function resolveBenchmarkStreamMetrics(
  streamMetrics: Record<string, BenchmarkStreamMetrics>,
  primaryType: string,
  aliases: string[],
): BenchmarkStreamMetrics | undefined {
  const direct = streamMetrics[primaryType] || aliases.map(alias => streamMetrics[alias]).find(Boolean);
  if (direct) {
    return direct;
  }

  const normalizedTargets = new Set([primaryType, ...aliases].map(normalizeMetricKey));
  return Object.entries(streamMetrics).find(([key]) => normalizedTargets.has(normalizeMetricKey(key)))?.[1];
}

function normalizeMetricKey(value: string): string {
  return value.trim().replace(/[_\s-]+/g, '').toLowerCase();
}

export function resolveBenchmarkStreamMeanDeviation(metrics: BenchmarkStreamMetrics | undefined): number | undefined {
  if (!metrics) {
    return undefined;
  }
  if (typeof metrics.meanDeviation === 'number' && Number.isFinite(metrics.meanDeviation)) {
    return metrics.meanDeviation;
  }
  if (
    typeof metrics.sourceA_mean === 'number'
    && Number.isFinite(metrics.sourceA_mean)
    && typeof metrics.sourceB_mean === 'number'
    && Number.isFinite(metrics.sourceB_mean)
  ) {
    return metrics.sourceB_mean - metrics.sourceA_mean;
  }
  return undefined;
}

function normalizeLabel(value: unknown): string {
  return `${value ?? ''}`.trim().replace(/\s+/g, ' ');
}

function formatNumber(value: unknown, unit: string, decimals: number, signed = false): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  const roundedValue = Number(value.toFixed(decimals));
  const prefix = signed && roundedValue > 0 ? '+' : '';
  return `${prefix}${roundedValue} ${unit}`;
}

function formatCorrelation(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  return `${(value * 100).toFixed(1)}%`;
}

function resolveOverallGrade(result: BenchmarkResult): 'excellent' | 'good' | 'fair' | 'poor' {
  const scoreMap = { excellent: 3, good: 2, fair: 1, poor: 0 };
  const grades = [
    resolveGnssGrade(result.metrics?.gnss?.cep50),
    ...Object.values(result.metrics?.streamMetrics || {}).map(metrics => resolveCorrelationGrade(metrics.pearsonCorrelation)),
  ];
  const average = grades.reduce((total, grade) => total + scoreMap[grade], 0) / grades.length;

  if (average >= 2.5) {
    return 'excellent';
  }
  if (average >= 1.5) {
    return 'good';
  }
  if (average >= 0.5) {
    return 'fair';
  }
  return 'poor';
}

function resolveGnssGrade(cep50: unknown): 'excellent' | 'good' | 'fair' | 'poor' {
  if (typeof cep50 !== 'number' || !Number.isFinite(cep50)) {
    return 'poor';
  }
  if (cep50 <= 2) {
    return 'excellent';
  }
  if (cep50 <= 5) {
    return 'good';
  }
  if (cep50 <= 10) {
    return 'fair';
  }
  return 'poor';
}

function resolveCorrelationGrade(correlation: unknown): 'excellent' | 'good' | 'fair' | 'poor' {
  if (typeof correlation !== 'number' || !Number.isFinite(correlation)) {
    return 'poor';
  }
  if (correlation >= 0.98) {
    return 'excellent';
  }
  if (correlation >= 0.95) {
    return 'good';
  }
  if (correlation >= 0.90) {
    return 'fair';
  }
  return 'poor';
}

function formatGradeLabel(grade: string): string {
  return grade.charAt(0).toUpperCase() + grade.slice(1);
}
