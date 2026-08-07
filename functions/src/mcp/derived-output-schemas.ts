import { z } from 'zod';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_TRAINING_BUILD_COMPARISON_RECOVERY_VERSION,
  DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS,
  DERIVED_TRAINING_POWER_SYSTEMS_POLICY_VERSION,
  DERIVED_TRAINING_POWER_SYSTEMS_WINDOW_DAYS,
  DerivedMetricKind,
  TRAINING_BUILD_DURATION_WEEKS,
} from '../../../shared/derived-metrics';
import { READINESS_FORMULA_VERSION } from '../../../shared/readiness';
import {
  POWER_CAPACITY_DISCIPLINES,
  PUBLIC_TRAINING_DISCIPLINES,
} from '../../../shared/training-disciplines';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';

const number = z.number();
const nullableNumber = number.nullable();
const nonNegativeNumber = number.nonnegative();
const nullableNonNegativeNumber = nonNegativeNumber.nullable();
const count = z.number().int().nonnegative();
const nullableTimestampMs = z.number().int().nonnegative().nullable();
const timestampMs = z.number().int().nonnegative();
const utcBoundary = z.literal('UTC');
const boundedString = z.string().max(200);
const nullableBoundedString = boundedString.nullable();

/**
 * Frozen wire version for get_training_metric. Internal derived snapshots can
 * advance independently because Training-only additions are projected out
 * before this public contract is validated.
 */
export const MCP_TRAINING_METRIC_SCHEMA_VERSION = 15 as const;

const trainingDiscipline = z.enum(PUBLIC_TRAINING_DISCIPLINES);
const powerCapacityDiscipline = z.enum(POWER_CAPACITY_DISCIPLINES);
const buildDurationWeeks = z.union(
  TRAINING_BUILD_DURATION_WEEKS.map(value => z.literal(value)) as [
    z.ZodLiteral<8>,
    z.ZodLiteral<10>,
    z.ZodLiteral<12>,
  ],
);
const sleepProvider = z.enum([
  SLEEP_PROVIDERS.GarminAPI,
  SLEEP_PROVIDERS.SuuntoApp,
  SLEEP_PROVIDERS.COROSAPI,
]);

const dailyLoad = z.strictObject({
  dayMs: timestampMs,
  load: number,
}).meta({ title: 'McpDerivedDailyLoad' });

const recoverySegment = z.strictObject({
  totalSeconds: nonNegativeNumber,
  endTimeMs: timestampMs,
}).meta({ title: 'McpDerivedRecoverySegment' });

const acwrTrendPoint = z.strictObject({
  weekStartMs: timestampMs,
  ratio: nullableNumber,
}).meta({ title: 'McpDerivedAcwrTrendPoint' });

const rampRateTrendPoint = z.strictObject({
  weekStartMs: timestampMs,
  rampRate: nullableNumber,
}).meta({ title: 'McpDerivedRampRateTrendPoint' });

const monotonyStrainTrendPoint = z.strictObject({
  weekStartMs: timestampMs,
  strain: nullableNumber,
}).meta({ title: 'McpDerivedMonotonyStrainTrendPoint' });

const kpiTrendPoint = z.strictObject({
  weekStartMs: timestampMs,
  value: nullableNumber,
}).meta({ title: 'McpDerivedKpiTrendPoint' });

const formPayload = z.strictObject({
  dayBoundary: utcBoundary,
  rangeStartDayMs: nullableTimestampMs,
  rangeEndDayMs: nullableTimestampMs,
  dailyLoads: z.array(dailyLoad),
  excludesMergedEvents: z.boolean(),
}).meta({ title: 'McpDerivedFormPayload' });

const recoveryNowPayload = z.strictObject({
  totalSeconds: nonNegativeNumber,
  endTimeMs: timestampMs,
  segments: z.array(recoverySegment),
  excludesMergedEvents: z.boolean(),
  latestWorkoutSeconds: nullableNonNegativeNumber.optional(),
  latestWorkoutEndTimeMs: nullableTimestampMs.optional(),
  maxSupportedRecoverySeconds: nonNegativeNumber.optional(),
  lookbackWindowSeconds: nonNegativeNumber.optional(),
}).meta({ title: 'McpDerivedRecoveryNowPayload' });

const acwrPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: nullableTimestampMs,
  latestDayMs: nullableTimestampMs,
  acuteLoad7: nonNegativeNumber,
  chronicLoad28: nonNegativeNumber,
  ratio: nullableNumber,
  trend8Weeks: z.array(acwrTrendPoint),
}).meta({ title: 'McpDerivedAcwrPayload' });

const rampRatePayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: nullableTimestampMs,
  latestDayMs: nullableTimestampMs,
  ctlToday: nullableNumber,
  ctl7DaysAgo: nullableNumber,
  rampRate: nullableNumber,
  trend8Weeks: z.array(rampRateTrendPoint),
}).meta({ title: 'McpDerivedRampRatePayload' });

const monotonyStrainPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: nullableTimestampMs,
  latestDayMs: nullableTimestampMs,
  weeklyLoad7: nonNegativeNumber,
  monotony: nullableNumber,
  strain: nullableNumber,
  trend8Weeks: z.array(monotonyStrainTrendPoint),
}).meta({ title: 'McpDerivedMonotonyStrainPayload' });

const formNowPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: nullableTimestampMs,
  latestDayMs: nullableTimestampMs,
  value: nullableNumber,
  trend8Weeks: z.array(kpiTrendPoint),
}).meta({ title: 'McpDerivedFormNowPayload' });

const formPlus7dPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: nullableTimestampMs,
  latestDayMs: nullableTimestampMs,
  projectedDayMs: nullableTimestampMs,
  value: nullableNumber,
  trend8Weeks: z.array(kpiTrendPoint),
}).meta({ title: 'McpDerivedFormPlus7dPayload' });

const easyPercentPayload = z.strictObject({
  dayBoundary: utcBoundary,
  latestWeekStartMs: nullableTimestampMs,
  value: nullableNumber,
  trend8Weeks: z.array(kpiTrendPoint),
}).meta({ title: 'McpDerivedEasyPercentPayload' });

const hardPercentPayload = z.strictObject({
  dayBoundary: utcBoundary,
  latestWeekStartMs: nullableTimestampMs,
  value: nullableNumber,
  trend8Weeks: z.array(kpiTrendPoint),
}).meta({ title: 'McpDerivedHardPercentPayload' });

const efficiencyDelta4wPayload = z.strictObject({
  dayBoundary: utcBoundary,
  latestWeekStartMs: nullableTimestampMs,
  latestValue: nullableNumber,
  baselineValue: nullableNumber,
  baselineWeekCount: count,
  deltaAbs: nullableNumber,
  deltaPct: nullableNumber,
  trend8Weeks: z.array(kpiTrendPoint),
}).meta({ title: 'McpDerivedEfficiencyDelta4wPayload' });

const freshnessForecastPoint = z.strictObject({
  dayMs: timestampMs,
  trainingStressScore: nonNegativeNumber,
  ctl: number,
  atl: number,
  formSameDay: number,
  formPriorDay: nullableNumber,
  isForecast: z.boolean(),
}).meta({ title: 'McpDerivedFreshnessForecastPoint' });

const freshnessForecastPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: nullableTimestampMs,
  generatedAtMs: timestampMs,
  points: z.array(freshnessForecastPoint),
}).meta({ title: 'McpDerivedFreshnessForecastPayload' });

const intensityDistributionWeek = z.strictObject({
  weekStartMs: timestampMs,
  easySeconds: nonNegativeNumber,
  moderateSeconds: nonNegativeNumber,
  hardSeconds: nonNegativeNumber,
  source: z.enum(['power', 'heart-rate']),
}).meta({ title: 'McpDerivedIntensityDistributionWeek' });

const intensityDistributionPayload = z.strictObject({
  dayBoundary: utcBoundary,
  weeks: z.array(intensityDistributionWeek),
  latestWeekStartMs: nullableTimestampMs,
  latestEasyPercent: nullableNumber,
  latestModeratePercent: nullableNumber,
  latestHardPercent: nullableNumber,
}).meta({ title: 'McpDerivedIntensityDistributionPayload' });

const efficiencyTrendPoint = z.strictObject({
  weekStartMs: timestampMs,
  value: number,
  sampleCount: count,
  totalDurationSeconds: nonNegativeNumber,
}).meta({ title: 'McpDerivedEfficiencyTrendPoint' });

const efficiencyTrendPayload = z.strictObject({
  dayBoundary: utcBoundary,
  points: z.array(efficiencyTrendPoint),
  latestWeekStartMs: nullableTimestampMs,
  latestValue: nullableNumber,
}).meta({ title: 'McpDerivedEfficiencyTrendPayload' });

const trainingSummaryWindowFields = {
  periodDays: count,
  windowStartDayMs: timestampMs,
  windowEndDayMs: timestampMs,
  durationSeconds: nonNegativeNumber,
  easySeconds: nonNegativeNumber,
  moderateSeconds: nonNegativeNumber,
  hardSeconds: nonNegativeNumber,
};

const trainingSummaryCurrentWindow = z.strictObject({
  ...trainingSummaryWindowFields,
  activityCount: count,
}).meta({ title: 'McpDerivedTrainingSummaryCurrentWindow' });

const trainingSummaryBaselineWindow = z.strictObject({
  ...trainingSummaryWindowFields,
  // The usual window is normalized from 84 days into a 28-day equivalent,
  // so its activity count can be fractional (for example, 2 / 3).
  activityCount: nonNegativeNumber,
}).meta({ title: 'McpDerivedTrainingSummaryBaselineWindow' });

const trainingDisciplineSummary = z.strictObject({
  discipline: trainingDiscipline,
  current28d: trainingSummaryCurrentWindow,
  baseline28d: trainingSummaryBaselineWindow,
}).meta({ title: 'McpDerivedTrainingDisciplineSummary' });

const trainingSummaryPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: timestampMs,
  currentWindowDays: count,
  baselineWindowDays: count,
  disciplines: z.array(trainingDisciplineSummary),
  excludesMergedEvents: z.boolean(),
}).meta({ title: 'McpDerivedTrainingSummaryPayload' });

// Device/provider source keys are intentionally absent from the public metric.
const trainingCapacityImportedMetric = z.strictObject({
  kind: z.enum(['ftp-setting', 'vo2-max']),
  value: number,
  provenance: z.literal('imported-activity-stat'),
  firstSeenAtMs: timestampMs,
  lastSeenAtMs: timestampMs,
  observationCount: count,
  previousValue: nullableNumber,
  previousAtMs: nullableTimestampMs,
  changePct: nullableNumber,
}).meta({ title: 'McpDerivedTrainingCapacityImportedMetric' });

const trainingCapacityDiscipline = z.strictObject({
  discipline: powerCapacityDiscipline,
  ftpSetting: trainingCapacityImportedMetric.nullable(),
  importedVo2Max: trainingCapacityImportedMetric.nullable(),
}).meta({ title: 'McpDerivedTrainingCapacityDiscipline' });

const trainingCapacityPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: timestampMs,
  excludesMergedEvents: z.boolean(),
  disciplines: z.array(trainingCapacityDiscipline),
}).meta({ title: 'McpDerivedTrainingCapacityPayload' });

const powerSystemsStatus = z.enum([
  'ready',
  'partial',
  'insufficient-evidence',
  'poor-fit',
  'unstable',
  'invalid-input',
]);
const powerSystemsComponentStatus = z.enum([
  'ready',
  'insufficient-evidence',
  'poor-fit',
  'unstable',
  'invalid-input',
]);
const powerSystemsReason = z.enum([
  'no-evidence',
  'invalid-effective-date',
  'invalid-source',
  'duplicate-source',
  'invalid-date',
  'future-evidence',
  'invalid-activity-type',
  'mixed-activity-types',
  'invalid-power-curve',
  'insufficient-history',
  'insufficient-critical-power-range',
  'insufficient-maximum-power-range',
  'poor-critical-power-fit',
  'unstable-critical-power-fit',
  'unstable-w-prime-fit',
  'poor-maximum-power-fit',
  'unstable-maximum-power-fit',
]);

const powerSystemsComponent = z.strictObject({
  status: powerSystemsComponentStatus,
  reason: powerSystemsReason.nullable(),
  value: nullableNumber,
}).meta({ title: 'McpDerivedPowerSystemsComponent' });

const powerSystemsDiagnostics = z.strictObject({
  sourceCount: count,
  historyStartDayMs: nullableTimestampMs,
  historyEndDayMs: nullableTimestampMs,
  historySpanDays: count,
  rejectedPointCount: count,
  rejectedShortPowerSpikePointCount: count,
  criticalPowerAnchorCount: count,
  earlyCriticalPowerAnchorCount: count,
  longCriticalPowerAnchorCount: count,
  criticalPowerContributingSourceCount: count,
  maximumPowerAnchorCount: count,
  maximumPowerContributingSourceCount: count,
  criticalPowerNormalizedRmse: nullableNumber,
  criticalPowerSpreadRatio: nullableNumber,
  wPrimeSpreadRatio: nullableNumber,
  wPrimeCandidateCount: count,
  wPrimeCandidateMinimumJoules: nullableNumber,
  wPrimeCandidateMaximumJoules: nullableNumber,
  criticalPowerLeaveOneOutSpreadRatio: nullableNumber,
  wPrimeLeaveOneOutSpreadRatio: nullableNumber,
  criticalPowerSourceRemovalFitCount: count,
  criticalPowerSourceRemovalFailureCount: count,
  criticalPowerSourceRemovalMaximumChangeRatio: nullableNumber,
  wPrimeSourceRemovalMaximumChangeRatio: nullableNumber,
  maximumPowerNormalizedRmse: nullableNumber,
  maximumPowerLeaveOneOutSpreadRatio: nullableNumber,
}).meta({ title: 'McpDerivedPowerSystemsDiagnostics' });

// sourceFingerprint is intentionally absent from this public snapshot.
const powerSystemsSnapshot = z.strictObject({
  effectiveDayMs: timestampMs,
  status: powerSystemsStatus,
  reason: powerSystemsReason.nullable(),
  activityType: boundedString,
  criticalPower: powerSystemsComponent,
  wPrime: powerSystemsComponent,
  maximumPower: powerSystemsComponent,
  diagnostics: powerSystemsDiagnostics,
}).meta({ title: 'McpDerivedPowerSystemsSnapshot' });

const powerSystemsHistoryPoint = z.strictObject({
  effectiveDayMs: timestampMs,
  status: powerSystemsStatus,
  reason: powerSystemsReason.nullable(),
  criticalPowerStatus: powerSystemsComponentStatus,
  criticalPowerWatts: nullableNumber,
  wPrimeStatus: powerSystemsComponentStatus,
  wPrimeJoules: nullableNumber,
  maximumPowerStatus: powerSystemsComponentStatus,
  maximumPowerWatts: nullableNumber,
}).meta({ title: 'McpDerivedPowerSystemsHistoryPoint' });

const powerSystemsEvidenceCounts = z.strictObject({
  candidateActivityCount: count,
  usableCurveActivityCount: count,
  excludedActivityCount: count,
}).meta({ title: 'McpDerivedPowerSystemsEvidenceCounts' });

const powerSystemsActivityType = z.strictObject({
  activityType: boundedString,
  current: powerSystemsSnapshot,
  history: z.array(powerSystemsHistoryPoint),
  evidenceCounts: powerSystemsEvidenceCounts,
}).meta({ title: 'McpDerivedPowerSystemsActivityType' });

const trainingPowerSystemsPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: timestampMs,
  policyVersion: z.literal(DERIVED_TRAINING_POWER_SYSTEMS_POLICY_VERSION),
  windowDays: z.literal(DERIVED_TRAINING_POWER_SYSTEMS_WINDOW_DAYS),
  historyDays: z.literal(DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS),
  cadence: z.literal('workout-date'),
  excludesEffectiveDay: z.literal(true),
  excludesMergedEvents: z.literal(true),
  activityTypes: z.array(powerSystemsActivityType),
}).meta({ title: 'McpDerivedTrainingPowerSystemsPayload' });

const explanationLoadCoverage = z.strictObject({
  totalCount: count,
  loadedCount: count,
  classifiedCount: count,
  unclassifiedCount: count,
  ratio: nonNegativeNumber,
}).meta({ title: 'McpDerivedExplanationLoadCoverage' });

const explanationSport = z.enum([
  ...PUBLIC_TRAINING_DISCIPLINES,
  'other',
  'unclassified',
]);

const explanationSportLoad = z.strictObject({
  sport: explanationSport,
  label: boundedString,
  activityCount: count,
  loadActivityCount: count,
  trainingStressScore: nullableNumber,
  loadSharePercent: nullableNumber,
}).meta({ title: 'McpDerivedExplanationSportLoad' });

const redactedContributorSportLoad = z.strictObject({
  sport: explanationSport,
  activityCount: count,
  loadActivityCount: count,
  trainingStressScore: nullableNumber,
  loadSharePercent: nullableNumber,
}).meta({ title: 'McpDerivedRedactedContributorSportLoad' });

const explanationRhythm = z.strictObject({
  discipline: trainingDiscipline,
  sessionCount: count,
  activeDayCount: count,
  activeWeekCount: count,
  longestInactivityGapDays: count,
  longestSessionDurationSeconds: nullableNonNegativeNumber,
}).meta({ title: 'McpDerivedExplanationRhythm' });

const explanationWindowMetricsShape = {
  parentEventCount: count,
  parentLoadEventCount: count,
  parentTrainingStressScore: nullableNumber,
  parentLoadCoverage: explanationLoadCoverage,
  childActivityCount: count,
  childLoadActivityCount: count,
  childTrainingStressScore: nullableNumber,
  childLoadCoverage: explanationLoadCoverage,
  sportLoads: z.array(explanationSportLoad),
  rhythms: z.array(explanationRhythm),
};
const explanationWindowMetrics = z.strictObject({
  ...explanationWindowMetricsShape,
}).meta({ title: 'McpDerivedExplanationWindowMetrics' });
const explanationWindow = z.strictObject({
  ...explanationWindowMetricsShape,
  periodDays: z.literal(28),
  windowStartDayMs: timestampMs,
  windowEndDayMs: timestampMs,
}).meta({ title: 'McpDerivedExplanationWindow' });

const explanationContributor = z.strictObject({
  startDayMs: timestampMs,
  trainingStressScore: nonNegativeNumber,
  loadSharePercent: nonNegativeNumber,
  childComposition: z.array(redactedContributorSportLoad),
}).meta({ title: 'McpDerivedExplanationContributor' });

const trainingExplanationPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: timestampMs,
  currentWindowDays: z.literal(28),
  baselineBlockCount: z.literal(3),
  excludesMergedEvents: z.literal(true),
  excludesMissingDates: z.literal(true),
  excludesFutureEvents: z.literal(true),
  current: explanationWindow,
  baselineBlocks: z.array(explanationWindow),
  baselineMedian: explanationWindowMetrics,
  topContributors: z.array(explanationContributor),
}).meta({ title: 'McpDerivedTrainingExplanationPayload' });

const durabilityScope = z.enum([
  'running',
  'cycling',
  'pool-swimming',
  'open-water-swimming',
]);
const durabilityContext = z.strictObject({
  contextKey: boundedString,
  scope: durabilityScope,
  outputSource: boundedString,
  outputUnit: boundedString,
  poolLengthMeters: nullableNonNegativeNumber,
  stroke: nullableBoundedString,
}).meta({ title: 'McpDerivedDurabilityContext' });
const durabilityContextSummary = z.strictObject({
  context: durabilityContext,
  sampleCount: count,
  medianDurationSeconds: nullableNonNegativeNumber,
  medianCoverageRatio: nullableNumber,
  medianDecouplingPercent: nullableNumber,
  medianOutputRetentionPercent: nullableNumber,
  medianHeartRateDriftBpm: nullableNumber,
  medianPaceRetentionPercent: nullableNumber,
  medianSwolfChange: nullableNumber,
}).meta({ title: 'McpDerivedDurabilityContextSummary' });
const durabilityExclusionCount = z.strictObject({
  reason: boundedString,
  activityCount: count,
}).meta({ title: 'McpDerivedDurabilityExclusionCount' });
const durabilityCoverage = z.strictObject({
  candidateActivityCount: count,
  evidenceActivityCount: count,
  eligibleActivityCount: count,
  missingEvidenceActivityCount: count,
  excludedActivityCount: count,
  eligibilityRatio: nullableNumber,
  exclusions: z.array(durabilityExclusionCount),
}).meta({ title: 'McpDerivedDurabilityCoverage' });
const durabilityWindowMetricsShape = {
  coverage: durabilityCoverage,
  summaries: z.array(durabilityContextSummary),
};
const durabilityWindowMetrics = z.strictObject({
  ...durabilityWindowMetricsShape,
}).meta({ title: 'McpDerivedDurabilityWindowMetrics' });
const durabilityWindow = z.strictObject({
  ...durabilityWindowMetricsShape,
  periodDays: z.union([z.literal(28), z.literal(7)]),
  windowStartDayMs: timestampMs,
  windowEndDayMs: timestampMs,
}).meta({ title: 'McpDerivedDurabilityWindow' });
const durabilitySupportingEvent = z.strictObject({
  startDayMs: timestampMs,
  contextKey: boundedString,
  decouplingPercent: nullableNumber,
  outputRetentionPercent: nullableNumber,
  heartRateDriftBpm: nullableNumber,
  paceRetentionPercent: nullableNumber,
  swolfChange: nullableNumber,
}).meta({ title: 'McpDerivedDurabilitySupportingEvent' });
const durabilityScopeComparison = z.strictObject({
  scope: durabilityScope,
  current: durabilityWindow,
  baselineBlocks: z.array(durabilityWindow),
  usual: durabilityWindowMetrics,
  weeks: z.array(durabilityWindow),
  recentSupportingEvents: z.array(durabilitySupportingEvent),
}).meta({ title: 'McpDerivedDurabilityScopeComparison' });
const trainingDurabilityPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: timestampMs,
  currentWindowDays: z.literal(28),
  baselineBlockCount: z.literal(3),
  weeklyPointCount: z.literal(12),
  excludesMergedEvents: z.literal(true),
  excludesFutureEvents: z.literal(true),
  evidenceSource: z.literal('persisted-activity-stat'),
  scopes: z.array(durabilityScopeComparison),
}).meta({ title: 'McpDerivedTrainingDurabilityPayload' });

const buildSuggestion = z.strictObject({
  startDayMs: timestampMs,
  distanceMeters: nullableNonNegativeNumber,
  durationSeconds: nullableNonNegativeNumber,
  trainingStressScore: nullableNumber,
}).meta({ title: 'McpDerivedBuildSuggestion' });

const buildBenchmarkReference = z.union([
  z.strictObject({
    mode: z.literal('event'),
    durationWeeks: buildDurationWeeks,
    windowStartDayMs: timestampMs,
    windowEndDayMs: timestampMs,
  }),
  z.strictObject({
    mode: z.literal('period'),
    durationWeeks: buildDurationWeeks,
    endDayMs: timestampMs,
    windowStartDayMs: timestampMs,
    windowEndDayMs: timestampMs,
    label: nullableBoundedString,
  }),
]).meta({ title: 'McpDerivedBuildBenchmarkReference' });

const buildWindow = z.strictObject({
  periodWeeks: buildDurationWeeks,
  windowStartDayMs: timestampMs,
  windowEndDayMs: timestampMs,
  activityCount: count,
  durationSeconds: nonNegativeNumber,
  distanceMeters: nullableNonNegativeNumber,
  distanceEventCount: count,
  trainingStressScore: nullableNumber,
  trainingStressScoreEventCount: count,
  activeWeekCount: count,
  longestActivityDurationSeconds: nullableNonNegativeNumber,
  easySeconds: nullableNonNegativeNumber,
  moderateSeconds: nullableNonNegativeNumber,
  hardSeconds: nullableNonNegativeNumber,
  intensitySourceEventCount: count,
  durability: durabilityWindowMetrics.nullable(),
  poolAveragePaceSecondsPer100m: nullableNonNegativeNumber,
  poolPaceActivityCount: count,
  openWaterAveragePaceSecondsPer100m: nullableNonNegativeNumber,
  openWaterPaceActivityCount: count,
}).meta({ title: 'McpDerivedBuildWindow' });

const trainingRecoveryCoverage = z.enum(['none', 'limited', 'sufficient']);
const trainingRecoveryWindow = z.strictObject({
  periodDays: count,
  windowStartDayMs: timestampMs,
  windowEndDayMs: timestampMs,
  provider: sleepProvider.nullable(),
  recordedNightCount: count,
  expectedNightCount: count,
  coverage: trainingRecoveryCoverage,
  averageSleepSeconds: nullableNonNegativeNumber,
  typicalLocalStartMinutes: nullableNumber,
  typicalLocalEndMinutes: nullableNumber,
  bedtimeVariationMinutes: nullableNonNegativeNumber,
  medianOvernightHrvMs: nullableNonNegativeNumber,
  overnightHrvNightCount: count,
}).meta({ title: 'McpDerivedTrainingRecoveryWindow' });
const trainingRecoveryComparison = z.strictObject({
  current: trainingRecoveryWindow,
  reference: trainingRecoveryWindow,
  sameProvider: z.boolean(),
  isComparable: z.boolean(),
}).meta({ title: 'McpDerivedTrainingRecoveryComparison' });
const buildDurabilityComparison = z.strictObject({
  context: durabilityContext,
  current: durabilityContextSummary.nullable(),
  benchmark: durabilityContextSummary.nullable(),
  isComparable: z.boolean(),
}).meta({ title: 'McpDerivedBuildDurabilityComparison' });
const buildComparisonDiscipline = z.strictObject({
  discipline: trainingDiscipline,
  status: z.enum(['not-configured', 'invalid-selection', 'ready']),
  selection: buildBenchmarkReference.nullable(),
  current: buildWindow.nullable(),
  benchmark: buildWindow.nullable(),
  recovery: trainingRecoveryComparison.nullable(),
  durabilityComparisons: z.array(buildDurabilityComparison),
  suggestedRaces: z.array(buildSuggestion),
  suggestedEvents: z.array(buildSuggestion),
}).meta({ title: 'McpDerivedBuildComparisonDiscipline' });
const trainingBuildComparisonPayload = z.strictObject({
  recoveryVersion: z.literal(
    DERIVED_TRAINING_BUILD_COMPARISON_RECOVERY_VERSION,
  ),
  dayBoundary: utcBoundary,
  asOfDayMs: timestampMs,
  excludesMergedEvents: z.boolean(),
  recovery: trainingRecoveryComparison,
  disciplines: z.array(buildComparisonDiscipline),
}).meta({ title: 'McpDerivedTrainingBuildComparisonPayload' });

const readinessHistoryPoint = z.strictObject({
  dayMs: timestampMs,
  score: nullableNumber,
  label: z.enum(['Ready', 'Mixed', 'Recover']).nullable(),
  confidence: z.enum(['high', 'medium', 'low']).nullable(),
  availableSignalCount: count,
  baselineEvidenceCount: count,
  totalSignalCount: z.literal(4),
  form: nullableNumber,
  rampRate: nullableNumber,
  sleepScore: nullableNumber,
  latestSleepAtMs: nullableTimestampMs,
  hrvRatio: nullableNumber,
  averageHeartRateRatio: nullableNumber,
  minimumHeartRateRatio: nullableNumber,
  overnightHeartRateRatio: nullableNumber,
}).meta({ title: 'McpDerivedReadinessHistoryPoint' });
const trainingReadinessPayload = z.strictObject({
  formulaVersion: z.literal(READINESS_FORMULA_VERSION),
  dayBoundary: utcBoundary,
  asOfDayMs: timestampMs,
  generatedAtMs: timestampMs,
  historyDays: z.literal(14),
  points: z.array(readinessHistoryPoint),
}).meta({ title: 'McpDerivedTrainingReadinessPayload' });

const bodyWeightTrendPoint = z.strictObject({
  dayMs: timestampMs,
  weightKg: nullableNumber,
}).meta({ title: 'McpDerivedBodyWeightTrendPoint' });
const bodyWeightTrendPayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: timestampMs,
  trendDays: z.literal(28),
  comparisonWindowDays: z.literal(7),
  minimumComparableDayCount: z.literal(3),
  latestWeightKg: nullableNumber,
  latestWeightDayMs: nullableTimestampMs,
  median7dKg: nullableNumber,
  median28dKg: nullableNumber,
  change7dKg: nullableNumber,
  change7dPercent: nullableNumber,
  change28dKg: nullableNumber,
  change28dPercent: nullableNumber,
  recordedDayCount7d: count,
  recordedDayCount28d: count,
  points: z.array(bodyWeightTrendPoint),
}).meta({ title: 'McpDerivedBodyWeightTrendPayload' });

const trainingSwimWeek = z.strictObject({
  weekStartMs: timestampMs,
  environment: z.enum(['pool', 'open-water']),
  activityCount: count,
  distanceMeters: nonNegativeNumber,
  averagePaceSecondsPer100m: nullableNonNegativeNumber,
  paceActivityCount: count,
  swolf: nullableNumber,
  swolfLengthCount: count,
}).meta({ title: 'McpDerivedTrainingSwimWeek' });
const trainingSwolfContext = z.strictObject({
  stroke: boundedString,
  poolLengthMeters: nonNegativeNumber,
}).meta({ title: 'McpDerivedTrainingSwolfContext' });
const trainingSwimPerformancePayload = z.strictObject({
  dayBoundary: utcBoundary,
  asOfDayMs: timestampMs,
  weekCount: z.literal(12),
  excludesMergedEvents: z.boolean(),
  swolfContext: trainingSwolfContext.nullable(),
  weeks: z.array(trainingSwimWeek),
}).meta({ title: 'McpDerivedTrainingSwimPerformancePayload' });

const powerCurvePointSeries = z.array(nonNegativeNumber)
  .superRefine((values, context) => {
    if (values.length % 3 !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Power Curve points must be flat duration, power, W/kg triples.',
      });
    }
  })
  .meta({
    description: 'Flat duration-seconds, power-watts, watts-per-kilogram triples.',
  });
const powerCurveLatestActivity = z.strictObject({
  startMs: timestampMs,
  points: powerCurvePointSeries,
}).meta({ title: 'McpDerivedPowerCurveLatestActivity' });
const powerCurveRangeSnapshot = z.strictObject({
  sourceEventCount: count,
  matchedEventCount: count,
  latestActivity: powerCurveLatestActivity.nullable(),
  bestPoints: powerCurvePointSeries,
  best30dPoints: powerCurvePointSeries,
  best30dEventCount: count,
  best90dPoints: powerCurvePointSeries,
  best90dEventCount: count,
}).meta({ title: 'McpDerivedPowerCurveRangeSnapshot' });
const powerCurveScopeSnapshot = z.strictObject({
  ranges: z.strictObject({
    thisMonth: powerCurveRangeSnapshot,
    '14d': powerCurveRangeSnapshot,
    '30d': powerCurveRangeSnapshot,
    '90d': powerCurveRangeSnapshot,
    '1y': powerCurveRangeSnapshot,
    '2y': powerCurveRangeSnapshot,
    '3y': powerCurveRangeSnapshot,
    '4y': powerCurveRangeSnapshot,
    all: powerCurveRangeSnapshot,
  }),
  thisWeekByStartDay: z.record(
    z.string().regex(/^\d+$/),
    powerCurveRangeSnapshot,
  ),
}).meta({ title: 'McpDerivedPowerCurveScopeSnapshot' });
const powerCurvePayload = z.strictObject({
  asOfDayMs: timestampMs,
  excludesMergedEvents: z.boolean(),
  pointSamplingVersion: z.literal(1),
  scopes: z.strictObject({
    running: powerCurveScopeSnapshot,
    cycling: powerCurveScopeSnapshot,
  }),
}).meta({ title: 'McpDerivedPowerCurvePayload' });

/**
 * Exact public payload contracts after MCP identity/provenance redaction.
 * The exhaustive key type makes a newly added derived kind fail compilation
 * until its safe wire schema is defined here.
 */
export const MCP_DERIVED_PAYLOAD_SCHEMAS = {
  [DERIVED_METRIC_KINDS.Form]: formPayload,
  [DERIVED_METRIC_KINDS.RecoveryNow]: recoveryNowPayload,
  [DERIVED_METRIC_KINDS.Acwr]: acwrPayload,
  [DERIVED_METRIC_KINDS.RampRate]: rampRatePayload,
  [DERIVED_METRIC_KINDS.MonotonyStrain]: monotonyStrainPayload,
  [DERIVED_METRIC_KINDS.FormNow]: formNowPayload,
  [DERIVED_METRIC_KINDS.FormPlus7d]: formPlus7dPayload,
  [DERIVED_METRIC_KINDS.EasyPercent]: easyPercentPayload,
  [DERIVED_METRIC_KINDS.HardPercent]: hardPercentPayload,
  [DERIVED_METRIC_KINDS.EfficiencyDelta4w]: efficiencyDelta4wPayload,
  [DERIVED_METRIC_KINDS.FreshnessForecast]: freshnessForecastPayload,
  [DERIVED_METRIC_KINDS.IntensityDistribution]: intensityDistributionPayload,
  [DERIVED_METRIC_KINDS.EfficiencyTrend]: efficiencyTrendPayload,
  [DERIVED_METRIC_KINDS.TrainingSummary]: trainingSummaryPayload,
  [DERIVED_METRIC_KINDS.TrainingCapacity]: trainingCapacityPayload,
  [DERIVED_METRIC_KINDS.TrainingPowerSystems]: trainingPowerSystemsPayload,
  [DERIVED_METRIC_KINDS.PowerCurve]: powerCurvePayload,
  [DERIVED_METRIC_KINDS.TrainingExplanation]: trainingExplanationPayload,
  [DERIVED_METRIC_KINDS.TrainingDurability]: trainingDurabilityPayload,
  [DERIVED_METRIC_KINDS.TrainingBuildComparison]:
    trainingBuildComparisonPayload,
  [DERIVED_METRIC_KINDS.TrainingReadiness]: trainingReadinessPayload,
  [DERIVED_METRIC_KINDS.BodyWeightTrend]: bodyWeightTrendPayload,
  [DERIVED_METRIC_KINDS.TrainingSwimPerformance]:
    trainingSwimPerformancePayload,
} as const satisfies Record<DerivedMetricKind, z.ZodType>;

export function validateMcpDerivedPayload(
  metricKind: DerivedMetricKind,
  payload: unknown,
): boolean {
  return MCP_DERIVED_PAYLOAD_SCHEMAS[metricKind].safeParse(payload).success;
}
