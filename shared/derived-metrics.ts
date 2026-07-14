import {
  POWER_CAPACITY_DISCIPLINES,
  TRAINING_DISCIPLINES,
  isTrainingDiscipline,
  type PowerCapacityDiscipline,
  type TrainingDiscipline,
} from './training-disciplines';
import type { SleepProvider } from './sleep';

export const DERIVED_METRIC_KINDS = {
  Form: 'form',
  RecoveryNow: 'recovery_now',
  Acwr: 'acwr',
  RampRate: 'ramp_rate',
  MonotonyStrain: 'monotony_strain',
  FormNow: 'form_now',
  FormPlus7d: 'form_plus_7d',
  EasyPercent: 'easy_percent',
  HardPercent: 'hard_percent',
  EfficiencyDelta4w: 'efficiency_delta_4w',
  FreshnessForecast: 'freshness_forecast',
  IntensityDistribution: 'intensity_distribution',
  EfficiencyTrend: 'efficiency_trend',
  TrainingSummary: 'training_summary',
  TrainingCapacity: 'training_capacity',
  PowerCurve: 'power_curve',
  TrainingBuildComparison: 'training_build_comparison',
  TrainingSwimPerformance: 'training_swim_performance',
} as const;

export type DerivedMetricKind = typeof DERIVED_METRIC_KINDS[keyof typeof DERIVED_METRIC_KINDS];

export const DEFAULT_DERIVED_METRIC_KINDS: DerivedMetricKind[] = [
  DERIVED_METRIC_KINDS.Form,
  DERIVED_METRIC_KINDS.RecoveryNow,
  DERIVED_METRIC_KINDS.Acwr,
  DERIVED_METRIC_KINDS.RampRate,
  DERIVED_METRIC_KINDS.MonotonyStrain,
  DERIVED_METRIC_KINDS.FormNow,
  DERIVED_METRIC_KINDS.FormPlus7d,
  DERIVED_METRIC_KINDS.EasyPercent,
  DERIVED_METRIC_KINDS.HardPercent,
  DERIVED_METRIC_KINDS.EfficiencyDelta4w,
  DERIVED_METRIC_KINDS.FreshnessForecast,
  DERIVED_METRIC_KINDS.IntensityDistribution,
  DERIVED_METRIC_KINDS.EfficiencyTrend,
  DERIVED_METRIC_KINDS.TrainingSummary,
  DERIVED_METRIC_KINDS.TrainingCapacity,
  DERIVED_METRIC_KINDS.PowerCurve,
  DERIVED_METRIC_KINDS.TrainingBuildComparison,
  DERIVED_METRIC_KINDS.TrainingSwimPerformance,
];

export const PROJECTION_SENSITIVE_DERIVED_METRIC_KINDS: DerivedMetricKind[] = [
  DERIVED_METRIC_KINDS.Acwr,
  DERIVED_METRIC_KINDS.RampRate,
  DERIVED_METRIC_KINDS.MonotonyStrain,
  DERIVED_METRIC_KINDS.FormNow,
  DERIVED_METRIC_KINDS.FormPlus7d,
  DERIVED_METRIC_KINDS.FreshnessForecast,
  DERIVED_METRIC_KINDS.PowerCurve,
];

// These metrics change as the UTC day changes, even if no event is written.
// Activity-backed Training metrics remain out of the projection-only list because
// they need normalized activities joined to their parent event metadata.
export const CALENDAR_SENSITIVE_DERIVED_METRIC_KINDS: DerivedMetricKind[] = [
  ...PROJECTION_SENSITIVE_DERIVED_METRIC_KINDS,
  DERIVED_METRIC_KINDS.TrainingSummary,
  DERIVED_METRIC_KINDS.TrainingCapacity,
  DERIVED_METRIC_KINDS.TrainingBuildComparison,
  DERIVED_METRIC_KINDS.TrainingSwimPerformance,
];

export const DERIVED_METRICS_COLLECTION_ID = 'derivedMetrics';
export const DERIVED_METRICS_COORDINATOR_DOC_ID = 'coordinator';
export const DERIVED_METRIC_SCHEMA_VERSION = 10;
export const DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS = 14 * 24 * 60 * 60;
export const DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS = 2 * 24 * 60 * 60;
export const DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS =
  DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS + DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS;

export const DERIVED_METRICS_ENTRY_TYPES = {
  Coordinator: 'coordinator',
  Snapshot: 'snapshot',
} as const;

export type DerivedMetricsEntryType = typeof DERIVED_METRICS_ENTRY_TYPES[keyof typeof DERIVED_METRICS_ENTRY_TYPES];

export type DerivedMetricsCoordinatorStatus =
  | 'idle'
  | 'queued'
  | 'processing'
  | 'failed';

export interface DerivedMetricsCoordinator {
  entryType: typeof DERIVED_METRICS_ENTRY_TYPES.Coordinator;
  status: DerivedMetricsCoordinatorStatus;
  generation: number;
  eventMutationVersion: number;
  dirtyMetricKinds: DerivedMetricKind[];
  requestedAtMs: number | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  updatedAtMs: number;
  lastError?: string | null;
}

export type DerivedMetricSnapshotStatus =
  | 'ready'
  | 'building'
  | 'failed'
  | 'stale';

export interface DerivedFormDailyLoadEntry {
  dayMs: number;
  load: number;
}

export type LegacyDerivedFormDailyLoadEntry = readonly [number, number];

export interface DerivedMetricSnapshotBase<TPayload> {
  entryType: typeof DERIVED_METRICS_ENTRY_TYPES.Snapshot;
  metricKind: DerivedMetricKind;
  schemaVersion: number;
  status: DerivedMetricSnapshotStatus;
  updatedAtMs: number;
  builtFromEventMutationVersion?: number | null;
  sourceEventCount: number;
  payload: TPayload | null;
  lastError?: string | null;
}

export interface DerivedFormMetricPayload {
  dayBoundary: 'UTC';
  rangeStartDayMs: number | null;
  rangeEndDayMs: number | null;
  dailyLoads: DerivedFormDailyLoadEntry[];
  excludesMergedEvents: boolean;
}

export interface DerivedRecoveryNowSegment {
  totalSeconds: number;
  endTimeMs: number;
}

export interface DerivedRecoveryNowMetricPayload {
  totalSeconds: number;
  endTimeMs: number;
  segments: DerivedRecoveryNowSegment[];
  excludesMergedEvents: boolean;
  latestWorkoutSeconds?: number | null;
  latestWorkoutEndTimeMs?: number | null;
  maxSupportedRecoverySeconds?: number;
  lookbackWindowSeconds?: number;
}

export interface DerivedAcwrTrendPoint {
  weekStartMs: number;
  ratio: number | null;
}

export interface DerivedAcwrMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number | null;
  latestDayMs: number | null;
  acuteLoad7: number;
  chronicLoad28: number;
  ratio: number | null;
  trend8Weeks: DerivedAcwrTrendPoint[];
}

export interface DerivedRampRateTrendPoint {
  weekStartMs: number;
  rampRate: number | null;
}

export interface DerivedRampRateMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number | null;
  latestDayMs: number | null;
  ctlToday: number | null;
  ctl7DaysAgo: number | null;
  rampRate: number | null;
  trend8Weeks: DerivedRampRateTrendPoint[];
}

export interface DerivedMonotonyStrainTrendPoint {
  weekStartMs: number;
  strain: number | null;
}

export interface DerivedMonotonyStrainMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number | null;
  latestDayMs: number | null;
  weeklyLoad7: number;
  monotony: number | null;
  strain: number | null;
  trend8Weeks: DerivedMonotonyStrainTrendPoint[];
}

export interface DerivedKpiTrendPoint {
  weekStartMs: number;
  value: number | null;
}

export interface DerivedFormNowMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number | null;
  latestDayMs: number | null;
  value: number | null;
  trend8Weeks: DerivedKpiTrendPoint[];
}

export interface DerivedFormPlus7dMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number | null;
  latestDayMs: number | null;
  projectedDayMs: number | null;
  value: number | null;
  trend8Weeks: DerivedKpiTrendPoint[];
}

export interface DerivedEasyPercentMetricPayload {
  dayBoundary: 'UTC';
  latestWeekStartMs: number | null;
  value: number | null;
  trend8Weeks: DerivedKpiTrendPoint[];
}

export interface DerivedHardPercentMetricPayload {
  dayBoundary: 'UTC';
  latestWeekStartMs: number | null;
  value: number | null;
  trend8Weeks: DerivedKpiTrendPoint[];
}

export interface DerivedEfficiencyDelta4wMetricPayload {
  dayBoundary: 'UTC';
  latestWeekStartMs: number | null;
  latestValue: number | null;
  baselineValue: number | null;
  baselineWeekCount: number;
  deltaAbs: number | null;
  deltaPct: number | null;
  trend8Weeks: DerivedKpiTrendPoint[];
}

export interface DerivedFreshnessForecastPoint {
  dayMs: number;
  trainingStressScore: number;
  ctl: number;
  atl: number;
  formSameDay: number;
  formPriorDay: number | null;
  isForecast: boolean;
}

export interface DerivedFreshnessForecastMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number | null;
  generatedAtMs: number;
  points: DerivedFreshnessForecastPoint[];
}

export type DerivedIntensityDistributionSource = 'power' | 'heart-rate';

export interface DerivedIntensityDistributionWeek {
  weekStartMs: number;
  easySeconds: number;
  moderateSeconds: number;
  hardSeconds: number;
  source: DerivedIntensityDistributionSource;
}

export interface DerivedIntensityDistributionMetricPayload {
  dayBoundary: 'UTC';
  weeks: DerivedIntensityDistributionWeek[];
  latestWeekStartMs: number | null;
  latestEasyPercent: number | null;
  latestModeratePercent: number | null;
  latestHardPercent: number | null;
}

export interface DerivedEfficiencyTrendPoint {
  weekStartMs: number;
  value: number;
  sampleCount: number;
  totalDurationSeconds: number;
}

export interface DerivedEfficiencyTrendMetricPayload {
  dayBoundary: 'UTC';
  points: DerivedEfficiencyTrendPoint[];
  latestWeekStartMs: number | null;
  latestValue: number | null;
}

export type DerivedTrainingDiscipline = TrainingDiscipline;
export type DerivedPowerCapacityDiscipline = PowerCapacityDiscipline;

/** Sports whose curated Training modules can currently be shown or hidden. */
export const TRAINING_VISIBLE_DISCIPLINES = TRAINING_DISCIPLINES;
export type TrainingVisibleDiscipline = typeof TRAINING_VISIBLE_DISCIPLINES[number];

export function isTrainingVisibleDiscipline(value: unknown): value is TrainingVisibleDiscipline {
  return isTrainingDiscipline(value);
}

export const TRAINING_BUILD_DURATION_WEEKS = [8, 10, 12] as const;
export type TrainingBuildDurationWeeks = typeof TRAINING_BUILD_DURATION_WEEKS[number];

export type TrainingBuildBenchmarkSelection =
  | {
    mode: 'event';
    durationWeeks: TrainingBuildDurationWeeks;
    eventId: string;
  }
  | {
    mode: 'period';
    durationWeeks: TrainingBuildDurationWeeks;
    endDayMs: number;
  };

export interface TrainingSettings {
  visibleDisciplines?: TrainingVisibleDiscipline[];
  buildBenchmarks?: Partial<Record<DerivedTrainingDiscipline, TrainingBuildBenchmarkSelection>>;
}

export interface SetTrainingVisibleDisciplinesRequest {
  /** A null selection restores automatic visibility based on recent training. */
  visibleDisciplines: TrainingVisibleDiscipline[] | null;
}

export interface SetTrainingVisibleDisciplinesResponse {
  accepted: true;
  visibleDisciplines: TrainingVisibleDiscipline[] | null;
}

/**
 * Treats persisted visibility as untrusted input and returns a canonical order.
 * Invalid or empty values resolve to null so readers can safely use automatic mode.
 */
export function normalizeTrainingVisibleDisciplines(value: unknown): TrainingVisibleDiscipline[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  if (value.some(item => !isTrainingVisibleDiscipline(item))) {
    return null;
  }
  const disciplines = value as TrainingVisibleDiscipline[];
  if (new Set(disciplines).size !== disciplines.length) {
    return null;
  }
  const selected = new Set(disciplines);
  return TRAINING_VISIBLE_DISCIPLINES.filter(discipline => selected.has(discipline));
}

export interface SetTrainingBuildBenchmarkRequest {
  discipline: DerivedTrainingDiscipline;
  selection: TrainingBuildBenchmarkSelection | null;
}

export interface SetTrainingBuildBenchmarkResponse {
  accepted: boolean;
  queued: boolean;
  generation: number | null;
}

/**
 * Normalizes an event document ID before it is persisted as a benchmark reference.
 * Keeping this aligned with Firestore's document-ID constraints means a malformed
 * callable payload cannot turn into an invalid document path during validation.
 */
export function normalizeTrainingBuildEventId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const eventId = value.trim();
  if (
    !eventId
    || eventId === '.'
    || eventId === '..'
    || /^__.*__$/.test(eventId)
    || eventId.includes('/')
    || new TextEncoder().encode(eventId).byteLength > 1_500
  ) {
    return null;
  }
  return eventId;
}

/**
 * Normalizes a manual benchmark end date to its UTC calendar-day boundary.
 * The value is shared by the callable, worker, and frontend matching logic so
 * a valid calendar date always has one stable benchmark key.
 */
export function normalizeTrainingBuildPeriodEndDayMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const endDayMs = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(endDayMs)) {
    return null;
  }
  const date = new Date(endDayMs);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  const utcDayStartMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Number.isFinite(utcDayStartMs) ? utcDayStartMs : null;
}

export function getTrainingBuildBenchmarkSelectionKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const selection = value as Partial<TrainingBuildBenchmarkSelection>;
  const durationWeeks = Number(selection.durationWeeks);
  if (!TRAINING_BUILD_DURATION_WEEKS.includes(durationWeeks as TrainingBuildDurationWeeks)) {
    return null;
  }
  if (selection.mode === 'event') {
    const eventId = normalizeTrainingBuildEventId(selection.eventId);
    return eventId ? `event:${durationWeeks}:${eventId}` : null;
  }
  if (selection.mode === 'period') {
    const endDayMs = normalizeTrainingBuildPeriodEndDayMs(selection.endDayMs);
    return endDayMs === null ? null : `period:${durationWeeks}:${endDayMs}`;
  }
  return null;
}

export interface DerivedTrainingSummaryWindow {
  periodDays: number;
  windowStartDayMs: number;
  windowEndDayMs: number;
  activityCount: number;
  durationSeconds: number;
  easySeconds: number;
  moderateSeconds: number;
  hardSeconds: number;
}

export interface DerivedTrainingDisciplineSummary {
  discipline: DerivedTrainingDiscipline;
  current28d: DerivedTrainingSummaryWindow;
  baseline28d: DerivedTrainingSummaryWindow;
}

export interface DerivedTrainingSummaryMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number;
  currentWindowDays: number;
  baselineWindowDays: number;
  disciplines: DerivedTrainingDisciplineSummary[];
  excludesMergedEvents: boolean;
}

export type DerivedTrainingCapacityImportedMetricKind = 'ftp-setting' | 'vo2-max';

export interface DerivedTrainingCapacityImportedMetric {
  kind: DerivedTrainingCapacityImportedMetricKind;
  value: number;
  sourceKey: string | null;
  provenance: 'imported-activity-stat';
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  observationCount: number;
  previousValue: number | null;
  previousAtMs: number | null;
  previousSourceKey: string | null;
  changePct: number | null;
}

export type DerivedModeledCriticalPowerStatus = 'ready' | 'insufficient-evidence' | 'poor-fit';
export type DerivedModeledCriticalPowerConfidence = 'high' | 'medium' | 'low' | null;

export interface DerivedModeledCriticalPower {
  status: DerivedModeledCriticalPowerStatus;
  valueWatts: number | null;
  valueWattsPerKg: number | null;
  wPrimeJoules: number | null;
  confidence: DerivedModeledCriticalPowerConfidence;
  windowDays: 90;
  sourceEventCount: number;
  anchorPointCount: number;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  rSquared: number | null;
  normalizedRmse: number | null;
}

export interface DerivedTrainingCapacityDiscipline {
  discipline: DerivedPowerCapacityDiscipline;
  ftpSetting: DerivedTrainingCapacityImportedMetric | null;
  importedVo2Max: DerivedTrainingCapacityImportedMetric | null;
  modeledCriticalPower: DerivedModeledCriticalPower;
}

export interface DerivedTrainingCapacityMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number;
  excludesMergedEvents: boolean;
  disciplines: DerivedTrainingCapacityDiscipline[];
}

export interface DerivedTrainingBuildEventSuggestion {
  eventId: string;
  startDayMs: number;
  label: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  trainingStressScore: number | null;
}

export interface DerivedTrainingBuildRaceSuggestion extends DerivedTrainingBuildEventSuggestion {}

export type DerivedTrainingBuildBenchmarkReference = TrainingBuildBenchmarkSelection & {
  selectionKey: string;
  windowStartDayMs: number;
  windowEndDayMs: number;
  label: string | null;
};

export interface DerivedTrainingBuildWindow {
  periodWeeks: TrainingBuildDurationWeeks;
  windowStartDayMs: number;
  windowEndDayMs: number;
  activityCount: number;
  durationSeconds: number;
  distanceMeters: number | null;
  distanceEventCount: number;
  trainingStressScore: number | null;
  trainingStressScoreEventCount: number;
  activeWeekCount: number;
  longestActivityDurationSeconds: number | null;
  easySeconds: number | null;
  moderateSeconds: number | null;
  hardSeconds: number | null;
  intensitySourceEventCount: number;
  efficiency: number | null;
  efficiencySampleCount: number;
  poolAveragePaceSecondsPer100m: number | null;
  poolPaceActivityCount: number;
  openWaterAveragePaceSecondsPer100m: number | null;
  openWaterPaceActivityCount: number;
}

export type DerivedTrainingRecoveryCoverage = 'none' | 'limited' | 'sufficient';

export interface DerivedTrainingRecoveryWindow {
  periodDays: number;
  windowStartDayMs: number;
  windowEndDayMs: number;
  provider: SleepProvider | null;
  recordedNightCount: number;
  expectedNightCount: number;
  coverage: DerivedTrainingRecoveryCoverage;
  averageSleepSeconds: number | null;
  bedtimeVariationMinutes: number | null;
  medianOvernightHrvMs: number | null;
  overnightHrvNightCount: number;
}

export interface DerivedTrainingRecoveryComparison {
  current: DerivedTrainingRecoveryWindow;
  reference: DerivedTrainingRecoveryWindow;
  sameProvider: boolean;
  isComparable: boolean;
}

export type DerivedTrainingBuildComparisonStatus =
  | 'not-configured'
  | 'invalid-selection'
  | 'ready';

export interface DerivedTrainingBuildComparisonDiscipline {
  discipline: DerivedTrainingDiscipline;
  status: DerivedTrainingBuildComparisonStatus;
  selection: DerivedTrainingBuildBenchmarkReference | null;
  current: DerivedTrainingBuildWindow | null;
  benchmark: DerivedTrainingBuildWindow | null;
  recovery: DerivedTrainingRecoveryComparison | null;
  suggestedRaces: DerivedTrainingBuildRaceSuggestion[];
  // Bounded historical events without an exact Race tag; tagged races are prioritized above.
  suggestedEvents: DerivedTrainingBuildEventSuggestion[];
}

export interface DerivedTrainingBuildComparisonMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number;
  excludesMergedEvents: boolean;
  recovery: DerivedTrainingRecoveryComparison;
  disciplines: DerivedTrainingBuildComparisonDiscipline[];
}

export type DerivedPowerCurveScope = DerivedPowerCapacityDiscipline;

export type DerivedTrainingSwimEnvironment = 'pool' | 'open-water';

export interface DerivedTrainingSwimWeek {
  weekStartMs: number;
  environment: DerivedTrainingSwimEnvironment;
  activityCount: number;
  distanceMeters: number;
  averagePaceSecondsPer100m: number | null;
  paceActivityCount: number;
  swolf: number | null;
  swolfLengthCount: number;
}

export interface DerivedTrainingSwolfContext {
  stroke: string;
  poolLengthMeters: number;
}

export interface DerivedTrainingSwimPerformanceMetricPayload {
  dayBoundary: 'UTC';
  asOfDayMs: number;
  weekCount: 12;
  excludesMergedEvents: boolean;
  swolfContext: DerivedTrainingSwolfContext | null;
  weeks: DerivedTrainingSwimWeek[];
}

export type DerivedPowerCurveRange =
  | 'thisWeek'
  | 'thisMonth'
  | '14d'
  | '30d'
  | '90d'
  | '1y'
  | '2y'
  | '3y'
  | '4y'
  | 'all';

// Firestore does not allow nested arrays, so every point series is stored as
// flat [duration, power, wattsPerKgOrZero] triples.
export type DerivedPowerCurvePointSeries = number[];

export interface DerivedPowerCurveLatestActivity {
  eventId: string | null;
  startMs: number;
  points: DerivedPowerCurvePointSeries;
}

export interface DerivedPowerCurveRangeSnapshot {
  sourceEventCount: number;
  matchedEventCount: number;
  latestActivity: DerivedPowerCurveLatestActivity | null;
  bestPoints: DerivedPowerCurvePointSeries;
  best30dPoints: DerivedPowerCurvePointSeries;
  best30dEventCount: number;
  best90dPoints: DerivedPowerCurvePointSeries;
  best90dEventCount: number;
}

export interface DerivedPowerCurveScopeSnapshot {
  ranges: Record<Exclude<DerivedPowerCurveRange, 'thisWeek'>, DerivedPowerCurveRangeSnapshot>;
  thisWeekByStartDay: Record<string, DerivedPowerCurveRangeSnapshot>;
}

export interface DerivedPowerCurveMetricPayload {
  asOfDayMs: number;
  excludesMergedEvents: boolean;
  pointSamplingVersion: 1;
  scopes: Record<DerivedPowerCurveScope, DerivedPowerCurveScopeSnapshot>;
}

export type DerivedFormMetricSnapshot = DerivedMetricSnapshotBase<DerivedFormMetricPayload>;
export type DerivedRecoveryNowMetricSnapshot = DerivedMetricSnapshotBase<DerivedRecoveryNowMetricPayload>;
export type DerivedAcwrMetricSnapshot = DerivedMetricSnapshotBase<DerivedAcwrMetricPayload>;
export type DerivedRampRateMetricSnapshot = DerivedMetricSnapshotBase<DerivedRampRateMetricPayload>;
export type DerivedMonotonyStrainMetricSnapshot = DerivedMetricSnapshotBase<DerivedMonotonyStrainMetricPayload>;
export type DerivedFormNowMetricSnapshot = DerivedMetricSnapshotBase<DerivedFormNowMetricPayload>;
export type DerivedFormPlus7dMetricSnapshot = DerivedMetricSnapshotBase<DerivedFormPlus7dMetricPayload>;
export type DerivedEasyPercentMetricSnapshot = DerivedMetricSnapshotBase<DerivedEasyPercentMetricPayload>;
export type DerivedHardPercentMetricSnapshot = DerivedMetricSnapshotBase<DerivedHardPercentMetricPayload>;
export type DerivedEfficiencyDelta4wMetricSnapshot = DerivedMetricSnapshotBase<DerivedEfficiencyDelta4wMetricPayload>;
export type DerivedFreshnessForecastMetricSnapshot = DerivedMetricSnapshotBase<DerivedFreshnessForecastMetricPayload>;
export type DerivedIntensityDistributionMetricSnapshot = DerivedMetricSnapshotBase<DerivedIntensityDistributionMetricPayload>;
export type DerivedEfficiencyTrendMetricSnapshot = DerivedMetricSnapshotBase<DerivedEfficiencyTrendMetricPayload>;
export type DerivedTrainingSummaryMetricSnapshot = DerivedMetricSnapshotBase<DerivedTrainingSummaryMetricPayload>;
export type DerivedTrainingCapacityMetricSnapshot = DerivedMetricSnapshotBase<DerivedTrainingCapacityMetricPayload>;
export type DerivedPowerCurveMetricSnapshot = DerivedMetricSnapshotBase<DerivedPowerCurveMetricPayload>;
export type DerivedTrainingBuildComparisonMetricSnapshot = DerivedMetricSnapshotBase<DerivedTrainingBuildComparisonMetricPayload>;
export type DerivedTrainingSwimPerformanceMetricSnapshot = DerivedMetricSnapshotBase<DerivedTrainingSwimPerformanceMetricPayload>;
export type DerivedMetricSnapshot =
  | DerivedFormMetricSnapshot
  | DerivedRecoveryNowMetricSnapshot
  | DerivedAcwrMetricSnapshot
  | DerivedRampRateMetricSnapshot
  | DerivedMonotonyStrainMetricSnapshot
  | DerivedFormNowMetricSnapshot
  | DerivedFormPlus7dMetricSnapshot
  | DerivedEasyPercentMetricSnapshot
  | DerivedHardPercentMetricSnapshot
  | DerivedEfficiencyDelta4wMetricSnapshot
  | DerivedFreshnessForecastMetricSnapshot
  | DerivedIntensityDistributionMetricSnapshot
  | DerivedEfficiencyTrendMetricSnapshot
  | DerivedTrainingSummaryMetricSnapshot
  | DerivedTrainingCapacityMetricSnapshot
  | DerivedPowerCurveMetricSnapshot
  | DerivedTrainingBuildComparisonMetricSnapshot
  | DerivedTrainingSwimPerformanceMetricSnapshot;

export { POWER_CAPACITY_DISCIPLINES };

export interface EnsureDerivedMetricsRequest {
  metricKinds?: DerivedMetricKind[];
}

export interface EnsureDerivedMetricsResponse {
  accepted: boolean;
  queued: boolean;
  generation: number | null;
  metricKinds: DerivedMetricKind[];
}

export function isDerivedMetricKind(value: unknown): value is DerivedMetricKind {
  return Object.values(DERIVED_METRIC_KINDS).includes(`${value}` as DerivedMetricKind);
}

export function normalizeDerivedMetricKindsStrict(metricKinds: readonly unknown[] | null | undefined): DerivedMetricKind[] {
  return Array.from(new Set(
    (metricKinds || [])
      .filter(isDerivedMetricKind)
      .map(metricKind => `${metricKind}` as DerivedMetricKind),
  ));
}

export function normalizeDerivedMetricKinds(metricKinds: readonly unknown[] | null | undefined): DerivedMetricKind[] {
  const normalizedKinds = normalizeDerivedMetricKindsStrict(metricKinds);

  return normalizedKinds.length ? normalizedKinds : [...DEFAULT_DERIVED_METRIC_KINDS];
}

export function getDerivedMetricDocId(metricKind: DerivedMetricKind): string {
  return metricKind;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeDerivedFormDailyLoadEntry(
  candidate: unknown,
): DerivedFormDailyLoadEntry | null {
  if (Array.isArray(candidate)) {
    const dayMs = toFiniteNumber(candidate[0]);
    const load = toFiniteNumber(candidate[1]);
    if (dayMs === null || dayMs < 0 || load === null || load < 0) {
      return null;
    }
    return {
      dayMs: Math.floor(dayMs),
      load,
    };
  }

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const entry = candidate as Record<string, unknown>;
  const dayMs = toFiniteNumber(entry.dayMs);
  const load = toFiniteNumber(entry.load);
  if (dayMs === null || dayMs < 0 || load === null || load < 0) {
    return null;
  }

  return {
    dayMs: Math.floor(dayMs),
    load,
  };
}

export function normalizeDerivedFormDailyLoads(
  dailyLoads: unknown,
): DerivedFormDailyLoadEntry[] {
  const entries = Array.isArray(dailyLoads) ? dailyLoads : [];
  const loadByDayMs = new Map<number, number>();

  entries.forEach((entry) => {
    const normalizedEntry = normalizeDerivedFormDailyLoadEntry(entry);
    if (!normalizedEntry) {
      return;
    }
    loadByDayMs.set(
      normalizedEntry.dayMs,
      (loadByDayMs.get(normalizedEntry.dayMs) || 0) + normalizedEntry.load,
    );
  });

  return [...loadByDayMs.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([dayMs, load]) => ({
      dayMs,
      load,
    }));
}

export function buildDerivedFormDailyLoads(
  loadByDayMs: ReadonlyMap<number, number>,
): DerivedFormDailyLoadEntry[] {
  return normalizeDerivedFormDailyLoads(
    [...loadByDayMs.entries()].map(([dayMs, load]) => ({ dayMs, load })),
  );
}
