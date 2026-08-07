import {
  ASSISTANT_MAX_CHART_POINTS_PER_SERIES,
  ASSISTANT_MAX_CHART_SERIES,
  ASSISTANT_MAX_MAP_MARKERS,
  ASSISTANT_MAX_MAP_PATH_POINTS,
  ASSISTANT_MAX_VISUAL_BYTES_PER_MESSAGE,
  type AssistantChartPoint,
  type AssistantChartSeries,
  type AssistantChartType,
  type AssistantChartVisual,
  type AssistantMapMarker,
  type AssistantMapMarkerKind,
  type AssistantMapPosition,
  type AssistantMapVisual,
  type AssistantVisual,
} from '../../../shared/assistant.types';
import {
  ChartDataCategoryTypes,
  DataJumpDistanceMax,
  DataJumpHangTimeMax,
  DataJumpHeightMax,
  DataJumpRotationsMax,
  DataJumpScoreMax,
  DataJumpSpeedMax,
} from '@sports-alliance/sports-lib';
import {
  TRAINING_LOAD_DAY_MS,
  buildTrainingLoadPoints,
} from '../../../shared/training-load';
import { MCP_ACTIVITY_CHART_METRICS } from '../mcp/activity-chart.service';
import { MCP_SLEEP_VITAL_DESCRIPTORS } from '../mcp/sleep-vitals';
import { getMcpTrainingMetricDescriptors } from '../mcp/training-metric-catalog';
import type { AssistantMcpToolName } from './mcp-session';

const MAX_TITLE_CHARS = 160;
const MAX_LABEL_CHARS = 120;
const MAX_UNIT_CHARS = 80;
const MAX_ASSISTANT_TRAINING_CHART_DAYS = 366 * 20;
type AssistantJumpMetricField =
  | 'distanceMeters'
  | 'heightMeters'
  | 'hangTimeSeconds'
  | 'speedMetersPerSecond'
  | 'rotations'
  | 'score';
const JUMP_RANKING_FIELD_BY_METRIC = new Map<string, AssistantJumpMetricField>([
  [DataJumpDistanceMax.type, 'distanceMeters'],
  [DataJumpHeightMax.type, 'heightMeters'],
  [DataJumpHangTimeMax.type, 'hangTimeSeconds'],
  [DataJumpSpeedMax.type, 'speedMetersPerSecond'],
  [DataJumpRotationsMax.type, 'rotations'],
  [DataJumpScoreMax.type, 'score'],
]);
const ACTIVITY_CHART_METRIC_BY_ID: ReadonlyMap<
  string,
  typeof MCP_ACTIVITY_CHART_METRICS[number]
> = new Map(
  MCP_ACTIVITY_CHART_METRICS.map(metric => [metric.id, metric]),
);
const SLEEP_VITAL_BY_TYPE = new Map(
  MCP_SLEEP_VITAL_DESCRIPTORS.map(descriptor => [descriptor.type, descriptor]),
);
const TRAINING_METRIC_BY_KIND: ReadonlyMap<
  string,
  ReturnType<typeof getMcpTrainingMetricDescriptors>[number]
> = new Map(
  getMcpTrainingMetricDescriptors().map(descriptor => [descriptor.metricKind, descriptor]),
);

export interface AssistantVisualChartCandidate {
  title: string;
  xAxis: AssistantChartVisual['xAxis'];
  defaultChartType: AssistantChartType;
  series: Array<AssistantChartSeries & { key: string }>;
}

export interface AssistantVisualMapCandidate {
  title: string;
  markers: AssistantMapMarker[];
  path: AssistantMapPosition[];
  jumpSelection?: {
    activityRef: string;
    records: Array<{
      marker: AssistantMapMarker | null;
      values: Record<AssistantJumpMetricField, number | null>;
    }>;
  };
}

export interface AssistantVisualSourceDescriptor {
  sourceId: string;
  chart: {
    title: string;
    defaultChartType: AssistantChartType;
    availableSeries: Array<{
      key: string;
      label: string;
      unit: string | null;
    }>;
  } | null;
  map: {
    title: string;
    markerCount: number;
    pathPointCount: number;
  } | null;
}

export interface AssistantVisualSource {
  descriptor: AssistantVisualSourceDescriptor;
  chart: AssistantVisualChartCandidate | null;
  map: AssistantVisualMapCandidate | null;
  jumpRanking?: {
    activityRef: string;
    metricField: AssistantJumpMetricField;
    value: number;
  };
}

export interface AssistantVisualRequest {
  chart: {
    sourceId: string;
    seriesKeys: string[];
    chartType: AssistantChartType;
  } | null;
  map: {
    sourceId: string;
  } | null;
}

interface SeriesDefinition {
  key: string;
  label: string;
  unit: string | null;
  read: (record: Record<string, unknown>) => unknown;
}

function sleepVitalSeriesDefinition(
  key: string,
  type: typeof MCP_SLEEP_VITAL_DESCRIPTORS[number]['type'],
  read: SeriesDefinition['read'],
): SeriesDefinition {
  const descriptor = SLEEP_VITAL_BY_TYPE.get(type);
  return {
    key,
    label: descriptor?.label ?? humanize(type, key),
    unit: descriptor?.unit ?? null,
    read,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteTimestamp(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 && Number.isFinite(new Date(number).getTime())
    ? number
    : null;
}

function boundedText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function humanize(value: unknown, fallback: string): string {
  const source = boundedText(value, fallback, MAX_LABEL_CHARS)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return source.replace(/\b\w/g, character => character.toUpperCase());
}

function normalizeUnit(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const normalized = value.trim().slice(0, MAX_UNIT_CHARS);
  const aliases: Record<string, string> = {
    beats_per_minute: 'bpm',
    breaths_per_minute: 'brpm',
    kilograms: 'kg',
    meters: 'm',
    milliseconds: 'ms',
    percent: '%',
    seconds: 's',
    watts: 'W',
  };
  return aliases[normalized] ?? normalized;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }
  const timestamp = finiteTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

function resolveTimeZone(value: unknown, fallback = 'UTC'): string {
  for (const candidate of [value, fallback, 'UTC']) {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      continue;
    }
    const normalized = candidate.trim().slice(0, 80);
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(0);
      return normalized;
    } catch {
      // Continue to the server-owned fallback.
    }
  }
  return 'UTC';
}

function coordinate(value: unknown): AssistantMapPosition | null {
  if (!isRecord(value)) {
    return null;
  }
  const latitudeDegrees = finiteNumber(value.latitudeDegrees);
  const longitudeDegrees = finiteNumber(value.longitudeDegrees);
  if (latitudeDegrees === null
    || longitudeDegrees === null
    || latitudeDegrees < -90
    || latitudeDegrees > 90
    || longitudeDegrees < -180
    || longitudeDegrees > 180) {
    return null;
  }
  return { latitudeDegrees, longitudeDegrees };
}

function marker(
  value: unknown,
  kind: AssistantMapMarkerKind,
  label: string,
): AssistantMapMarker | null {
  const position = coordinate(value);
  return position ? {
    ...position,
    kind,
    label: boundedText(label, 'Location', MAX_LABEL_CHARS),
  } : null;
}

function uniqueMarkers(markers: Array<AssistantMapMarker | null>): AssistantMapMarker[] {
  const seen = new Set<string>();
  const result: AssistantMapMarker[] = [];
  for (const candidate of markers) {
    if (!candidate || result.length >= ASSISTANT_MAX_MAP_MARKERS) {
      continue;
    }
    const key = `${candidate.kind}:${candidate.latitudeDegrees}:${candidate.longitudeDegrees}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }
  return result;
}

function downsamplePath(
  points: AssistantMapPosition[],
  limit = ASSISTANT_MAX_MAP_PATH_POINTS,
): AssistantMapPosition[] {
  if (points.length <= limit) {
    return points;
  }
  return Array.from({ length: limit }, (_, index) => (
    points[Math.round(index * (points.length - 1) / (limit - 1))]
  ));
}

/**
 * Deterministic min/max bucket downsampling. It retains both endpoints and
 * local extrema without allowing the model to rewrite the data series.
 */
export function downsampleAssistantChartPoints(
  points: AssistantChartPoint[],
  limit = ASSISTANT_MAX_CHART_POINTS_PER_SERIES,
): AssistantChartPoint[] {
  if (points.length <= limit) {
    return points.slice(0, limit);
  }
  if (limit <= 1) {
    return points.slice(0, 1);
  }
  if (limit === 2) {
    return [points[0], points[points.length - 1]];
  }
  const interiorBudget = limit - 2;
  const gapIndexes: number[] = [];
  for (let index = 0; index < points.length;) {
    if (points[index].y !== null) {
      index += 1;
      continue;
    }
    const runStart = index;
    while (index + 1 < points.length && points[index + 1].y === null) {
      index += 1;
    }
    const runEnd = index;
    if (runStart > 0 && runEnd < points.length - 1) {
      gapIndexes.push(Math.floor((runStart + runEnd) / 2));
    }
    index += 1;
  }
  const retainedGapIndexes = gapIndexes.length <= interiorBudget
    ? gapIndexes
    : Array.from({ length: interiorBudget }, (_, index) => gapIndexes[
        interiorBudget === 1
          ? Math.floor((gapIndexes.length - 1) / 2)
          : Math.round(index * (gapIndexes.length - 1) / (interiorBudget - 1))
      ]);
  const selectedIndexes = new Set<number>([
    0,
    points.length - 1,
    ...retainedGapIndexes,
  ]);
  const extremaBudget = interiorBudget - retainedGapIndexes.length;
  if (extremaBudget <= 0) {
    return [...selectedIndexes]
      .sort((left, right) => left - right)
      .map(index => points[index]);
  }

  const interior = points.slice(1, -1);
  const bucketCount = Math.max(1, Math.floor(extremaBudget / 2));
  const bucketSize = interior.length / bucketCount;
  const extremaIndexes: number[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(interior.length, Math.floor((bucket + 1) * bucketSize));
    const entries = interior.slice(start, Math.max(start + 1, end));
    let minimumIndex = entries.findIndex(point => point.y !== null);
    let maximumIndex = minimumIndex;
    if (minimumIndex < 0) {
      continue;
    }
    for (let index = minimumIndex + 1; index < entries.length; index += 1) {
      const current = entries[index].y;
      const minimum = entries[minimumIndex].y;
      const maximum = entries[maximumIndex].y;
      if (current !== null && (minimum === null || current < minimum)) {
        minimumIndex = index;
      }
      if (current !== null && (maximum === null || current > maximum)) {
        maximumIndex = index;
      }
    }
    const indices = minimumIndex === maximumIndex
      ? [minimumIndex]
      : [minimumIndex, maximumIndex].sort((left, right) => left - right);
    indices.forEach(index => extremaIndexes.push(start + index + 1));
  }
  extremaIndexes
    .filter(index => !selectedIndexes.has(index))
    .slice(0, extremaBudget)
    .forEach(index => selectedIndexes.add(index));
  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .map(index => points[index]);
}

function timeSeries(
  records: Record<string, unknown>[],
  timestamp: (record: Record<string, unknown>) => unknown,
  definitions: SeriesDefinition[],
): Array<AssistantChartSeries & { key: string }> {
  return definitions.flatMap((definition) => {
    const points = records.flatMap((record) => {
      const x = isoTimestamp(timestamp(record));
      if (!x) {
        return [];
      }
      const rawValue = definition.read(record);
      const y = rawValue === null || rawValue === undefined
        ? null
        : finiteNumber(rawValue);
      return y === null && rawValue !== null && rawValue !== undefined
        ? []
        : [{ x, y }];
    });
    if (points.length === 0 || points.every(point => point.y === null)) {
      return [];
    }
    return [{
      key: definition.key,
      label: boundedText(definition.label, definition.key, MAX_LABEL_CHARS),
      unit: normalizeUnit(definition.unit),
      points: downsampleAssistantChartPoints(points),
    }];
  });
}

function linearSeries(
  records: Record<string, unknown>[],
  xValue: (record: Record<string, unknown>) => unknown,
  definitions: SeriesDefinition[],
  xScale = 1,
): Array<AssistantChartSeries & { key: string }> {
  return definitions.flatMap((definition) => {
    const points = records.flatMap((record) => {
      const x = finiteNumber(xValue(record));
      if (x === null) {
        return [];
      }
      const rawValue = definition.read(record);
      const y = rawValue === null || rawValue === undefined
        ? null
        : finiteNumber(rawValue);
      return y === null && rawValue !== null && rawValue !== undefined
        ? []
        : [{ x: x / xScale, y }];
    });
    if (points.length === 0 || points.every(point => point.y === null)) {
      return [];
    }
    return [{
      key: definition.key,
      label: boundedText(definition.label, definition.key, MAX_LABEL_CHARS),
      unit: normalizeUnit(definition.unit),
      points: downsampleAssistantChartPoints(points),
    }];
  });
}

function buildMeasurementChart(
  output: Record<string, unknown>,
  defaultTimeZone: string,
): AssistantVisualChartCandidate | null {
  const descriptor = isRecord(output.measurementType) ? output.measurementType : {};
  const metric = isRecord(descriptor.canonicalMetric) ? descriptor.canonicalMetric : {};
  const label = boundedText(descriptor.displayName, 'Measurement', MAX_LABEL_CHARS);
  const series = timeSeries(asRecords(output.points), point => point.bucketStartTimeMs, [{
    key: 'value',
    label,
    unit: normalizeUnit(metric.unit),
    read: point => point.value,
  }]);
  return series.length ? {
    title: `${label} trend`.slice(0, MAX_TITLE_CHARS),
    xAxis: {
      type: 'time',
      label: 'Date',
      unit: null,
      timeZone: resolveTimeZone(output.timeZone, defaultTimeZone),
    },
    defaultChartType: 'line',
    series,
  } : null;
}

function buildMetricSeries(
  result: Record<string, unknown>,
  index: number,
): (AssistantChartSeries & { key: string }) | null {
  const metric = isRecord(result.metric) ? result.metric : {};
  const aggregation = isRecord(result.aggregation) ? result.aggregation : {};
  const metricLabel = boundedText(
    metric.displayType,
    humanize(metric.type, `Metric ${index + 1}`),
    MAX_LABEL_CHARS,
  );
  const aggregationLabel = typeof aggregation.valueType === 'string'
    ? humanize(aggregation.valueType, 'Value')
    : null;
  const label = boundedText(
    aggregationLabel ? `${metricLabel} (${aggregationLabel})` : metricLabel,
    metricLabel,
    MAX_LABEL_CHARS,
  );
  const categoryType = aggregation.categoryType;
  if (categoryType !== ChartDataCategoryTypes.DateType
    && categoryType !== ChartDataCategoryTypes.ActivityType) {
    return null;
  }
  const points: AssistantChartPoint[] = asRecords(aggregation.buckets).flatMap((bucket) => {
    const timestamp = categoryType === ChartDataCategoryTypes.DateType
      ? isoTimestamp(bucket.time ?? (
          typeof bucket.bucketKey === 'number' ? bucket.bucketKey : null
        ))
      : null;
    const category = categoryType === ChartDataCategoryTypes.ActivityType
      ? typeof bucket.bucketKey === 'string'
        ? boundedText(bucket.bucketKey, 'Period', MAX_LABEL_CHARS)
        : typeof bucket.bucketKey === 'number'
          ? bucket.bucketKey
          : null
      : null;
    const value = finiteNumber(bucket.aggregateValue);
    return value === null || (timestamp === null && category === null)
      ? []
      : [{ x: timestamp ?? category!, y: value }];
  });
  return points.length ? {
    key: `metric_${index}`,
    label,
    unit: normalizeUnit(metric.unit),
    points: downsampleAssistantChartPoints(points),
  } : null;
}

function metricChartAxisType(
  result: Record<string, unknown>,
): AssistantChartVisual['xAxis']['type'] | null {
  const aggregation = isRecord(result.aggregation) ? result.aggregation : {};
  if (aggregation.categoryType === ChartDataCategoryTypes.DateType) {
    return 'time';
  }
  return aggregation.categoryType === ChartDataCategoryTypes.ActivityType
    ? 'category'
    : null;
}

function buildMetricChart(
  output: Record<string, unknown>,
  timeZone: string,
): AssistantVisualChartCandidate | null {
  const axisType = metricChartAxisType(output);
  const result = buildMetricSeries(output, 0);
  if (!result || !axisType) {
    return null;
  }
  return {
    title: `${result.label} trend`.slice(0, MAX_TITLE_CHARS),
    xAxis: {
      type: axisType,
      label: 'Period',
      unit: null,
      timeZone: axisType === 'time' ? resolveTimeZone(timeZone) : null,
    },
    defaultChartType: 'line',
    series: [result],
  };
}

function buildMultiMetricChart(
  output: Record<string, unknown>,
  timeZone: string,
): AssistantVisualChartCandidate | null {
  const results = asRecords(output.results);
  const axisTypes = results.map(metricChartAxisType);
  const axisType = axisTypes[0] ?? null;
  if (!axisType || axisTypes.some(candidate => candidate !== axisType)) {
    return null;
  }
  const series = results
    .map(buildMetricSeries)
    .filter((value): value is AssistantChartSeries & { key: string } => value !== null)
    .slice(0, ASSISTANT_MAX_CHART_SERIES);
  if (!series.length) {
    return null;
  }
  return {
    title: 'Metric comparison',
    xAxis: {
      type: axisType,
      label: 'Period',
      unit: null,
      timeZone: axisType === 'time' ? resolveTimeZone(timeZone) : null,
    },
    defaultChartType: 'line',
    series,
  };
}

function buildSleepChart(
  output: Record<string, unknown>,
  defaultTimeZone: string,
): AssistantVisualChartCandidate | null {
  const records = asRecords(output.buckets);
  const series = timeSeries(records, bucket => bucket.bucketStartMs, [{
    key: 'sleep_duration', label: 'Sleep duration', unit: 'hours',
    read: bucket => finiteNumber(bucket.averageDurationSeconds) === null
      ? null
      : finiteNumber(bucket.averageDurationSeconds)! / 3_600,
  }, {
    key: 'sleep_score', label: 'Sleep score', unit: 'score',
    read: bucket => bucket.averageScore,
  }, sleepVitalSeriesDefinition(
    'average_hrv',
    'averageHrvMs',
    bucket => isRecord(bucket.averageVitals)
      ? bucket.averageVitals.averageHrvMs
      : null,
  ), sleepVitalSeriesDefinition(
    'overnight_hrv',
    'overnightHrvMs',
    bucket => isRecord(bucket.averageVitals)
      ? bucket.averageVitals.overnightHrvMs
      : null,
  ), sleepVitalSeriesDefinition(
    'average_heart_rate',
    'averageHeartRateBpm',
    bucket => isRecord(bucket.averageVitals)
      ? bucket.averageVitals.averageHeartRateBpm
      : null,
  ), sleepVitalSeriesDefinition(
    'minimum_heart_rate',
    'minimumHeartRateBpm',
    bucket => isRecord(bucket.averageVitals)
      ? bucket.averageVitals.minimumHeartRateBpm
      : null,
  ), sleepVitalSeriesDefinition(
    'spo2',
    'maxSpo2Percent',
    bucket => isRecord(bucket.averageVitals)
      ? bucket.averageVitals.maxSpo2Percent
      : null,
  ), sleepVitalSeriesDefinition(
    'respiration',
    'averageRespirationBrpm',
    bucket => isRecord(bucket.averageVitals)
      ? bucket.averageVitals.averageRespirationBrpm
      : null,
  )]);
  return series.length ? {
    title: 'Sleep and recovery trend',
    xAxis: {
      type: 'time',
      label: 'Date',
      unit: null,
      timeZone: resolveTimeZone(output.timeZone, defaultTimeZone),
    },
    defaultChartType: 'line',
    series,
  } : null;
}

function buildTrainingChart(
  output: Record<string, unknown>,
  defaultTimeZone: string,
): AssistantVisualChartCandidate | null {
  const payload = isRecord(output.payload) ? output.payload : {};
  const metricKind = boundedText(output.metricKind, 'Training metric', MAX_LABEL_CHARS);
  const metricTitle = TRAINING_METRIC_BY_KIND.get(metricKind)?.title
    ?? humanize(metricKind, 'Training metric');
  const chartTitle = /(?:forecast|history|trend)$/i.test(metricTitle)
    ? metricTitle
    : `${metricTitle} trend`;
  const formDailyLoads = asRecords(payload.dailyLoads).flatMap((record) => {
    const dayMs = finiteTimestamp(record.dayMs);
    const load = finiteNumber(record.load);
    return dayMs === null
      || !Number.isSafeInteger(dayMs)
      || dayMs % TRAINING_LOAD_DAY_MS !== 0
      || load === null
      || load < 0
      ? []
      : [{ dayMs, load }];
  });
  const requestedFormEndMs = finiteTimestamp(payload.rangeEndDayMs);
  let firstFormDayMs: number | null = null;
  let lastFormDayMs: number | null = null;
  for (const point of formDailyLoads) {
    firstFormDayMs = firstFormDayMs === null
      ? point.dayMs
      : Math.min(firstFormDayMs, point.dayMs);
    lastFormDayMs = lastFormDayMs === null
      ? point.dayMs
      : Math.max(lastFormDayMs, point.dayMs);
  }
  const effectiveFormEndMs = lastFormDayMs === null
    ? null
    : Math.max(lastFormDayMs, requestedFormEndMs ?? lastFormDayMs);
  const formSpanIsBounded = firstFormDayMs !== null
    && effectiveFormEndMs !== null
    && effectiveFormEndMs - firstFormDayMs
      <= MAX_ASSISTANT_TRAINING_CHART_DAYS * TRAINING_LOAD_DAY_MS;
  const formPoints = formSpanIsBounded
    ? buildTrainingLoadPoints(formDailyLoads, effectiveFormEndMs)
    : [];
  const candidates: Array<{
    records: Record<string, unknown>[];
    timestampKey: string;
    definitions: SeriesDefinition[];
  }> = [{
    records: formPoints.map(point => ({
      dayMs: point.dayMs,
      load: point.load,
      ctl: point.ctl,
      atl: point.atl,
      formSameDay: point.formSameDay,
      formPriorDay: point.formPriorDay,
    })),
    timestampKey: 'dayMs',
    definitions: [
      { key: 'load', label: 'Training load', unit: 'load', read: record => record.load },
      { key: 'ctl', label: 'Fitness', unit: 'load', read: record => record.ctl },
      { key: 'atl', label: 'Fatigue', unit: 'load', read: record => record.atl },
      { key: 'form', label: 'Form', unit: 'load', read: record => record.formSameDay ?? record.formPriorDay },
    ],
  }, {
    records: asRecords(payload.trend8Weeks),
    timestampKey: 'weekStartMs',
    definitions: [
      { key: 'value', label: humanize(metricKind, 'Training metric'), unit: null, read: record => record.value },
      { key: 'ratio', label: 'Acute-to-chronic ratio', unit: 'ratio', read: record => record.ratio },
      { key: 'ramp_rate', label: 'Ramp rate', unit: 'load/week', read: record => record.rampRate },
      { key: 'strain', label: 'Training strain', unit: 'strain', read: record => record.strain },
    ],
  }, {
    records: asRecords(payload.points),
    timestampKey: asRecords(payload.points)[0]?.weekStartMs !== undefined
      ? 'weekStartMs'
      : 'dayMs',
    definitions: [
      { key: 'score', label: 'Readiness', unit: 'score', read: record => record.score },
      { key: 'weight', label: 'Body weight', unit: 'kg', read: record => record.weightKg },
      { key: 'efficiency', label: 'Efficiency', unit: null, read: record => record.value },
      { key: 'ctl', label: 'Fitness', unit: 'load', read: record => record.ctl },
      { key: 'atl', label: 'Fatigue', unit: 'load', read: record => record.atl },
      { key: 'form', label: 'Form', unit: 'load', read: record => record.formSameDay ?? record.formPriorDay },
    ],
  }, {
    records: asRecords(payload.weeks),
    timestampKey: 'weekStartMs',
    definitions: [
      { key: 'easy_seconds', label: 'Easy time', unit: 's', read: record => record.easySeconds },
      { key: 'moderate_seconds', label: 'Moderate time', unit: 's', read: record => record.moderateSeconds },
      { key: 'hard_seconds', label: 'Hard time', unit: 's', read: record => record.hardSeconds },
      { key: 'swim_distance', label: 'Swim distance', unit: 'm', read: record => record.distanceMeters },
      { key: 'swim_pace', label: 'Swim pace per 100 m', unit: 's', read: record => record.averagePaceSecondsPer100m },
      { key: 'swolf', label: 'SWOLF', unit: 'score', read: record => record.swolf },
    ],
  }];
  for (const candidate of candidates) {
    if (!candidate.records.length) {
      continue;
    }
    const series = timeSeries(
      candidate.records,
      record => record[candidate.timestampKey],
      candidate.definitions,
    );
    if (series.length) {
      return {
        title: chartTitle.slice(0, MAX_TITLE_CHARS),
        xAxis: {
          type: 'time',
          label: 'Date',
          unit: null,
          timeZone: resolveTimeZone(
            payload.dayBoundary === 'UTC' ? 'UTC' : defaultTimeZone,
          ),
        },
        defaultChartType: 'line',
        series,
      };
    }
  }
  return null;
}

function buildRankingChart(
  output: Record<string, unknown>,
  timeZone: string,
): AssistantVisualChartCandidate | null {
  const metric = isRecord(output.metric) ? output.metric : {};
  const label = boundedText(metric.displayType, humanize(metric.type, 'Activity metric'), MAX_LABEL_CHARS);
  const series = timeSeries(asRecords(output.activities), activity => activity.startTime, [{
    key: 'ranked_value', label, unit: normalizeUnit(metric.unit), read: activity => activity.value,
  }]);
  return series.length ? {
    title: `${label} by activity`.slice(0, MAX_TITLE_CHARS),
    xAxis: {
      type: 'time',
      label: 'Activity date',
      unit: null,
      timeZone: resolveTimeZone(timeZone),
    },
    defaultChartType: 'bar',
    series,
  } : null;
}

function buildActivityChart(output: Record<string, unknown>): AssistantVisualChartCandidate | null {
  const xAxis = output.xAxis === 'distance' ? 'distance' : 'elapsed_time';
  const series = asRecords(output.series).flatMap((record, index) => {
    const metric = typeof record.metric === 'string'
      ? ACTIVITY_CHART_METRIC_BY_ID.get(record.metric)
      : undefined;
    const xValues = Array.isArray(record.xValues) ? record.xValues : [];
    const values = Array.isArray(record.values) ? record.values : [];
    const points = xValues.flatMap((x, pointIndex) => {
      const xValue = finiteNumber(x);
      const y = finiteNumber(values[pointIndex]);
      return xValue === null || y === null ? [] : [{ x: xValue, y }];
    });
    return points.length ? [{
      key: `series_${index}`,
      label: metric?.label ?? humanize(record.metric, `Series ${index + 1}`),
      unit: normalizeUnit(metric?.unit ?? record.canonicalUnit),
      points: downsampleAssistantChartPoints(points),
    }] : [];
  }).slice(0, ASSISTANT_MAX_CHART_SERIES);
  return series.length ? {
    title: `${boundedText(output.activityType, 'Activity', MAX_LABEL_CHARS)} chart`
      .slice(0, MAX_TITLE_CHARS),
    xAxis: {
      type: 'linear',
      label: xAxis === 'distance' ? 'Distance' : 'Elapsed time',
      unit: xAxis === 'distance' ? 'm' : 's',
      timeZone: null,
    },
    defaultChartType: 'line',
    series,
  } : null;
}

function buildJumpChart(output: Record<string, unknown>): AssistantVisualChartCandidate | null {
  const series = linearSeries(asRecords(output.items), jump => jump.timestampMs, [{
    key: 'distance', label: 'Jump distance', unit: 'm', read: jump => jump.distanceMeters,
  }, {
    key: 'height', label: 'Jump height', unit: 'm', read: jump => jump.heightMeters,
  }, {
    key: 'hang_time', label: 'Hang time', unit: 's', read: jump => jump.hangTimeSeconds,
  }, {
    key: 'speed', label: 'Jump speed', unit: 'm/s', read: jump => jump.speedMetersPerSecond,
  }], 1_000);
  return series.length ? {
    title: 'Jump details',
    xAxis: {
      type: 'linear',
      label: 'Activity time',
      unit: 's',
      timeZone: null,
    },
    defaultChartType: 'bar',
    series,
  } : null;
}

function buildActivityMap(output: Record<string, unknown>): AssistantVisualMapCandidate | null {
  const markers = uniqueMarkers(asRecords(output.activities).flatMap((activity, index) => {
    const activityLabel = boundedText(
      activity.activityType,
      `Activity ${index + 1}`,
      MAX_LABEL_CHARS - 6,
    );
    return [
      marker(activity.startPosition, 'start', `${activityLabel} start`),
      marker(activity.endPosition, 'end', `${activityLabel} end`),
    ];
  }));
  return markers.length ? { title: 'Activity locations', markers, path: [] } : null;
}

function buildNearbyActivityMap(output: Record<string, unknown>): AssistantVisualMapCandidate | null {
  const location = isRecord(output.location) ? output.location : null;
  const searchMarker = marker(location, 'search', location
    ? boundedText(location.resolvedLabel, 'Search location', MAX_LABEL_CHARS)
    : 'Search location');
  const activityMarkers = asRecords(output.activities).flatMap((activity, index) => {
    const label = boundedText(activity.activityType, `Activity ${index + 1}`, MAX_LABEL_CHARS - 8);
    return [
      marker(activity.nearestPosition, 'nearby', `${label} nearest`),
      marker(activity.startPosition, 'start', `${label} start`),
      marker(activity.endPosition, 'end', `${label} end`),
    ];
  });
  const markers = uniqueMarkers([searchMarker, ...activityMarkers]);
  return markers.length ? { title: 'Nearby activities', markers, path: [] } : null;
}

function buildJumpMap(
  output: Record<string, unknown>,
  toolInput: Record<string, unknown>,
): AssistantVisualMapCandidate | null {
  const records = asRecords(output.items).map((jump, index) => {
    const sourceIndex = finiteNumber(jump.index);
    return {
      marker: marker(
        jump,
        'jump',
        `Jump ${sourceIndex === null ? index + 1 : sourceIndex + 1}`,
      ),
      values: {
        distanceMeters: finiteNumber(jump.distanceMeters),
        heightMeters: finiteNumber(jump.heightMeters),
        hangTimeSeconds: finiteNumber(jump.hangTimeSeconds),
        speedMetersPerSecond: finiteNumber(jump.speedMetersPerSecond),
        rotations: finiteNumber(jump.rotations),
        score: finiteNumber(jump.score),
      },
    };
  });
  const markers = uniqueMarkers(records.map(record => record.marker));
  if (!markers.length) {
    return null;
  }
  const activityRef = typeof toolInput.activityRef === 'string'
    && toolInput.activityRef.length > 0
    ? toolInput.activityRef
    : null;
  return {
    title: 'Jump locations',
    markers,
    path: [],
    ...(activityRef ? {
      jumpSelection: { activityRef, records },
    } : {}),
  };
}

function buildChartLocationMap(output: Record<string, unknown>): AssistantVisualMapCandidate | null {
  const location = isRecord(output.location) ? output.location : null;
  if (!location) {
    return null;
  }
  const latitudes = Array.isArray(location.latitudeDegrees) ? location.latitudeDegrees : [];
  const longitudes = Array.isArray(location.longitudeDegrees) ? location.longitudeDegrees : [];
  const path = downsamplePath(latitudes.flatMap((latitude, index) => {
    const candidate = coordinate({
      latitudeDegrees: latitude,
      longitudeDegrees: longitudes[index],
    });
    return candidate ? [candidate] : [];
  }));
  if (path.length < 2) {
    return null;
  }
  return {
    title: `${boundedText(output.activityType, 'Activity', MAX_LABEL_CHARS)} route`
      .slice(0, MAX_TITLE_CHARS),
    markers: uniqueMarkers([
      marker(path[0], 'start', 'Start'),
      marker(path[path.length - 1], 'end', 'End'),
    ]),
    path,
  };
}

function buildCandidates(
  toolName: AssistantMcpToolName,
  output: Record<string, unknown>,
  timeZone: string,
  toolInput: Record<string, unknown>,
): { chart: AssistantVisualChartCandidate | null; map: AssistantVisualMapCandidate | null } {
  switch (toolName) {
    case 'query_measurements':
      return { chart: buildMeasurementChart(output, timeZone), map: null };
    case 'query_metric':
      return { chart: buildMetricChart(output, timeZone), map: null };
    case 'query_metrics':
      return { chart: buildMultiMetricChart(output, timeZone), map: null };
    case 'get_sleep_trend':
      return { chart: buildSleepChart(output, timeZone), map: null };
    case 'get_training_metric':
      return { chart: buildTrainingChart(output, timeZone), map: null };
    case 'rank_activities_by_metric':
      return { chart: buildRankingChart(output, timeZone), map: null };
    case 'get_activity_chart_data':
      return { chart: buildActivityChart(output), map: buildChartLocationMap(output) };
    case 'list_activity_jumps':
      return { chart: buildJumpChart(output), map: buildJumpMap(output, toolInput) };
    case 'query_activities':
      return { chart: null, map: buildActivityMap(output) };
    case 'search_activities_near_location':
      return { chart: null, map: buildNearbyActivityMap(output) };
    default:
      return { chart: null, map: null };
  }
}

function buildJumpRankingSelection(output: Record<string, unknown>) {
  const metric = isRecord(output.metric) ? output.metric : null;
  const metricField = typeof metric?.type === 'string'
    ? JUMP_RANKING_FIELD_BY_METRIC.get(metric.type)
    : undefined;
  const activities = asRecords(output.activities);
  const topActivity = activities.find(activity => activity.rank === 1) ?? activities[0];
  const activityRef = typeof topActivity?.activityRef === 'string'
    ? topActivity.activityRef
    : null;
  const value = finiteNumber(topActivity?.value);
  return metricField && activityRef && value !== null
    ? { activityRef, metricField, value }
    : null;
}

function withUniqueSeriesLabels(
  series: Array<AssistantChartSeries & { key: string }>,
): Array<AssistantChartSeries & { key: string }> {
  const usedLabels = new Set<string>();
  const nextSuffixByBase = new Map<string, number>();
  return series.map((candidate) => {
    const base = boundedText(candidate.label, candidate.key, MAX_LABEL_CHARS);
    let label = base;
    let suffix = nextSuffixByBase.get(base) ?? 2;
    while (usedLabels.has(label)) {
      const suffixText = ` (${suffix})`;
      label = `${base.slice(0, MAX_LABEL_CHARS - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    nextSuffixByBase.set(base, suffix);
    usedLabels.add(label);
    return { ...candidate, label };
  });
}

export function createAssistantVisualSource(
  toolName: AssistantMcpToolName,
  output: Record<string, unknown>,
  sourceId: string,
  timeZone = 'UTC',
  toolInput: Record<string, unknown> = {},
): AssistantVisualSource | null {
  const candidates = buildCandidates(
    toolName,
    output,
    resolveTimeZone(timeZone),
    toolInput,
  );
  if (!candidates.chart && !candidates.map) {
    return null;
  }
  const chart = candidates.chart ? {
    ...candidates.chart,
    series: withUniqueSeriesLabels(candidates.chart.series),
  } : null;
  const jumpRanking = toolName === 'rank_activities_by_metric'
    ? buildJumpRankingSelection(output)
    : null;
  return {
    descriptor: {
      sourceId,
      chart: chart ? {
        title: chart.title,
        defaultChartType: chart.defaultChartType,
        availableSeries: chart.series.map(series => ({
          key: series.key,
          label: series.label,
          unit: series.unit,
        })),
      } : null,
      map: candidates.map ? {
        title: candidates.map.title,
        markerCount: candidates.map.markers.length,
        pathPointCount: candidates.map.path.length,
      } : null,
    },
    chart,
    map: candidates.map,
    ...(jumpRanking ? { jumpRanking } : {}),
  };
}

function visualBytes(visuals: AssistantVisual[]): number {
  return Buffer.byteLength(JSON.stringify(visuals), 'utf8');
}

function fitVisualsToBudget(visuals: AssistantVisual[]): AssistantVisual[] {
  let fitted = visuals;
  while (visualBytes(fitted) > ASSISTANT_MAX_VISUAL_BYTES_PER_MESSAGE) {
    const map = fitted.find((visual): visual is AssistantMapVisual => visual.kind === 'map');
    if (map && map.path.length > 2) {
      map.path = downsamplePath(map.path, Math.max(2, Math.floor(map.path.length * 0.75)));
      continue;
    }
    const chart = fitted.find((visual): visual is AssistantChartVisual => visual.kind === 'chart');
    const largestSeries = chart?.series.reduce<AssistantChartSeries | null>(
      (largest, series) => !largest || series.points.length > largest.points.length ? series : largest,
      null,
    );
    if (largestSeries && largestSeries.points.length > 3) {
      largestSeries.points = downsampleAssistantChartPoints(
        largestSeries.points,
        Math.max(3, Math.floor(largestSeries.points.length * 0.75)),
      );
      continue;
    }
    if (map && fitted.length > 1) {
      fitted = fitted.filter(visual => visual !== map);
      continue;
    }
    return [];
  }
  return fitted;
}

export function resolveAssistantVisuals(
  sources: readonly AssistantVisualSource[],
  request: AssistantVisualRequest,
): AssistantVisual[] {
  const sourceById = new Map(sources.map(source => [source.descriptor.sourceId, source]));
  const visuals: AssistantVisual[] = [];
  if (request.chart) {
    const source = sourceById.get(request.chart.sourceId);
    if (source?.chart) {
      const requestedKeys = new Set(request.chart.seriesKeys);
      const series = source.chart.series
        .filter(candidate => requestedKeys.has(candidate.key))
        .slice(0, ASSISTANT_MAX_CHART_SERIES)
        .map(candidate => ({
          label: candidate.label,
          unit: candidate.unit,
          points: downsampleAssistantChartPoints(candidate.points),
        }));
      if (series.length) {
        visuals.push({
          kind: 'chart',
          title: source.chart.title,
          chartType: request.chart.chartType,
          xAxis: source.chart.xAxis,
          series,
        });
      }
    }
  }
  if (request.map) {
    const source = sourceById.get(request.map.sourceId);
    if (source?.map) {
      const jumpSelection = source.map.jumpSelection;
      const matchingRanking = jumpSelection
        ? [...sources]
            .reverse()
            .map(candidate => candidate.jumpRanking)
            .find(ranking => ranking?.activityRef === jumpSelection.activityRef)
        : undefined;
      const selectedJumpMarkers = matchingRanking && jumpSelection
        ? uniqueMarkers(jumpSelection.records.flatMap((record) => {
            const candidate = record.values[matchingRanking.metricField];
            if (candidate === null) {
              return [];
            }
            const tolerance = Math.max(
              1e-9,
              Math.max(Math.abs(candidate), Math.abs(matchingRanking.value)) * 1e-9,
            );
            return Math.abs(candidate - matchingRanking.value) <= tolerance
              ? [record.marker]
              : [];
          }))
        : null;
      const markers = selectedJumpMarkers ?? source.map.markers;
      if (markers.length) {
        visuals.push({
          kind: 'map',
          title: selectedJumpMarkers
            ? `Record jump location${selectedJumpMarkers.length === 1 ? '' : 's'}`
            : source.map.title,
          style: 'satellite',
          markers: markers.slice(0, ASSISTANT_MAX_MAP_MARKERS),
          path: downsamplePath(source.map.path),
        });
      }
    }
  }
  return fitVisualsToBudget(visuals);
}
