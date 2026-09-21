import { ActivityTypes } from '@sports-alliance/sports-lib';
import { TRAINING_READ_EXTENSION_TOOLS, TRAINING_READ_TOOLS, TRAINING_WRITE_TOOLS,
  type TrainingReadTool } from './training-plans.schemas';
import { calculateReadinessScore as calculateCurrentReadinessScore, resolveReadinessConfidence } from '../../../shared/readiness';
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import Ajv, { AnySchema } from 'ajv';
import addFormats from 'ajv-formats';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DERIVED_METRIC_KINDS,
  DerivedMetricKind,
} from '../../../shared/derived-metrics';
import {
  MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS,
  MCP_ACTIVITY_CHART_DEFAULT_POINTS,
  MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS,
  MCP_ACTIVITY_CHART_MAX_POINTS,
  MCP_ACTIVITY_CHART_METRICS,
} from './activity-chart.service';
import { McpDataError } from './data.service';
import { getMcpHealthCatalog } from './health.service';
import {
  MCP_DERIVED_PAYLOAD_SCHEMAS,
  MCP_TRAINING_METRIC_SCHEMA_VERSION,
} from './derived-output-schemas';
import { MCP_OAUTH_SCOPES } from './oauth.service';
import { createMcpServer } from './server';
import { createMcpTransportHandler } from './transport';
import {
  createMcpOutputSchemaRegistry,
  PUBLIC_MCP_TOOL_NAMES,
  PublicMcpToolName,
} from './tool-output-schemas';

const DAY_MS = Date.parse('2026-07-01T00:00:00.000Z');
const NEXT_DAY_MS = DAY_MS + 86_400_000;
const PRE_EPOCH_DAY_MS = Date.parse('1969-12-30T00:00:00.000Z');
const ACTIVITY_REF = 'opaque-activity-reference';
const ROUTE_REF = 'opaque-route-reference';
const NEXT_CURSOR = 'opaque-next-cursor';
const APP_URL = 'https://quantified-self.io/user/user-1/event/event-1';
const ROUTE_APP_URL = 'https://quantified-self.io/user/user-1/route/route-1';

type InjectedDataService = NonNullable<
  Parameters<typeof createMcpServer>[2]
>;

const metricDescriptor = {
  type: 'Distance',
  displayType: 'Distance',
  unit: 'm',
  unitSystem: 'metric' as const,
};
const strokeRateMetricDescriptor = {
  type: 'Stroke Rate',
  displayType: 'Stroke Rate',
  unit: 'spm',
  unitSystem: 'metric' as const,
};
const runningFlightTimeMetricDescriptor = {
  type: 'Average Running Flight Time',
  displayType: 'Average Running Flight Time',
  unit: 'ms',
  unitSystem: 'metric' as const,
};
const activityStats = {
  durationSeconds: 3_600,
  distanceMeters: 10_000,
  ascentMeters: null,
  descentMeters: null,
  averageSpeedMetersPerSecond: null,
  maximumSpeedMetersPerSecond: null,
  averageHeartRateBpm: null,
  maximumHeartRateBpm: null,
  averagePowerWatts: null,
  maximumPowerWatts: null,
  averageCadenceRpm: null,
  maximumCadenceRpm: null,
  energyKilocalories: null,
};
const coordinate = {
  latitudeDegrees: 39.665,
  longitudeDegrees: 20.8537,
};
const bounds = {
  minLatitudeDegrees: 39.6,
  maxLatitudeDegrees: 39.7,
  minLongitudeDegrees: 20.8,
  maxLongitudeDegrees: 20.9,
};
const activitySummaryWithLocation = {
  activityRef: ACTIVITY_REF,
  appUrl: APP_URL,
  startTimeMs: DAY_MS,
  endTimeMs: DAY_MS + 3_600_000,
  activityType: 'Running',
  powerMeter: false,
  trainer: false,
  jumpCount: 1,
  supportedDetailKinds: ['laps', 'jumps', 'swim_lengths'],
  stats: activityStats,
  startPosition: coordinate,
  endPosition: null,
  locationRedacted: false as const,
};
const activitySummaryRedacted = {
  activityRef: ACTIVITY_REF,
  appUrl: APP_URL,
  startTimeMs: DAY_MS,
  endTimeMs: DAY_MS + 3_600_000,
  activityType: 'Running',
  powerMeter: false,
  trainer: false,
  jumpCount: 1,
  supportedDetailKinds: ['laps', 'jumps', 'swim_lengths'],
  stats: activityStats,
  locationRedacted: true as const,
};
const routeSummaryWithLocation = {
  routeRef: ROUTE_REF,
  appUrl: ROUTE_APP_URL,
  name: 'Ridge loop',
  createdAtMs: null,
  importedAtMs: DAY_MS,
  updatedAtMs: NEXT_DAY_MS,
  activityTypes: ['Cycling'],
  routeCount: 1,
  waypointCount: 1,
  pointCount: 2,
  stats: activityStats,
  bounds,
  locationRedacted: false as const,
};
const routeSummaryRedacted = {
  routeRef: ROUTE_REF,
  appUrl: ROUTE_APP_URL,
  name: 'Ridge loop',
  createdAtMs: null,
  importedAtMs: DAY_MS,
  updatedAtMs: NEXT_DAY_MS,
  activityTypes: ['Cycling'],
  routeCount: 1,
  waypointCount: 1,
  pointCount: 2,
  stats: activityStats,
  locationRedacted: true as const,
};

const explanationCoverage = {
  totalCount: 0,
  loadedCount: 0,
  classifiedCount: 0,
  unclassifiedCount: 0,
  ratio: 0,
};
const explanationWindowMetrics = {
  parentEventCount: 0,
  parentLoadEventCount: 0,
  parentTrainingStressScore: null,
  parentLoadCoverage: explanationCoverage,
  childActivityCount: 0,
  childLoadActivityCount: 0,
  childTrainingStressScore: null,
  childLoadCoverage: explanationCoverage,
  sportLoads: [],
  rhythms: [],
};
const explanationWindow = {
  ...explanationWindowMetrics,
  periodDays: 28 as const,
  windowStartDayMs: DAY_MS,
  windowEndDayMs: NEXT_DAY_MS,
};
const recoveryWindow = {
  periodDays: 28,
  windowStartDayMs: DAY_MS,
  windowEndDayMs: NEXT_DAY_MS,
  provider: null,
  recordedNightCount: 0,
  expectedNightCount: 28,
  coverage: 'none' as const,
  averageSleepSeconds: null,
  typicalLocalStartMinutes: null,
  typicalLocalEndMinutes: null,
  bedtimeVariationMinutes: null,
  medianOvernightHrvMs: null,
  overnightHrvNightCount: 0,
};
const recoveryComparison = {
  current: recoveryWindow,
  reference: recoveryWindow,
  sameProvider: true,
  isComparable: false,
};
const powerCurveRange = {
  sourceEventCount: 1,
  matchedEventCount: 1,
  latestActivity: {
    startMs: DAY_MS,
    points: [1, 500, 0],
  },
  bestPoints: [1, 500, 0],
  best30dPoints: [],
  best30dEventCount: 0,
  best90dPoints: [],
  best90dEventCount: 0,
};
const powerCurveScope = {
  ranges: {
    thisMonth: powerCurveRange,
    '14d': powerCurveRange,
    '30d': powerCurveRange,
    '90d': powerCurveRange,
    '1y': powerCurveRange,
    '2y': powerCurveRange,
    '3y': powerCurveRange,
    '4y': powerCurveRange,
    all: powerCurveRange,
  },
  thisWeekByStartDay: {},
};

const derivedPayloadFixtures = {
  [DERIVED_METRIC_KINDS.Form]: {
    dayBoundary: 'UTC',
    rangeStartDayMs: null,
    rangeEndDayMs: null,
    dailyLoads: [],
    excludesMergedEvents: true,
  },
  [DERIVED_METRIC_KINDS.RecoveryNow]: {
    totalSeconds: 0,
    endTimeMs: DAY_MS,
    segments: [],
    excludesMergedEvents: true,
    latestWorkoutSeconds: null,
  },
  [DERIVED_METRIC_KINDS.Acwr]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    latestDayMs: null,
    acuteLoad7: 0,
    chronicLoad28: 0,
    ratio: null,
    trend8Weeks: [],
  },
  [DERIVED_METRIC_KINDS.RampRate]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    latestDayMs: null,
    ctlToday: null,
    ctl7DaysAgo: null,
    rampRate: null,
    trend8Weeks: [],
  },
  [DERIVED_METRIC_KINDS.MonotonyStrain]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    latestDayMs: null,
    weeklyLoad7: 0,
    monotony: null,
    strain: null,
    trend8Weeks: [],
  },
  [DERIVED_METRIC_KINDS.FormNow]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    latestDayMs: null,
    value: null,
    trend8Weeks: [],
  },
  [DERIVED_METRIC_KINDS.FormPlus7d]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    latestDayMs: null,
    projectedDayMs: NEXT_DAY_MS,
    value: null,
    trend8Weeks: [],
  },
  [DERIVED_METRIC_KINDS.EasyPercent]: {
    dayBoundary: 'UTC',
    latestWeekStartMs: null,
    value: null,
    trend8Weeks: [],
  },
  [DERIVED_METRIC_KINDS.HardPercent]: {
    dayBoundary: 'UTC',
    latestWeekStartMs: null,
    value: null,
    trend8Weeks: [],
  },
  [DERIVED_METRIC_KINDS.EfficiencyDelta4w]: {
    dayBoundary: 'UTC',
    latestWeekStartMs: null,
    latestValue: null,
    baselineValue: null,
    baselineWeekCount: 0,
    deltaAbs: null,
    deltaPct: null,
    trend8Weeks: [],
  },
  [DERIVED_METRIC_KINDS.FreshnessForecast]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    generatedAtMs: DAY_MS,
    points: [],
  },
  [DERIVED_METRIC_KINDS.IntensityDistribution]: {
    dayBoundary: 'UTC',
    weeks: [],
    latestWeekStartMs: null,
    latestEasyPercent: null,
    latestModeratePercent: null,
    latestHardPercent: null,
  },
  [DERIVED_METRIC_KINDS.EfficiencyTrend]: {
    dayBoundary: 'UTC',
    points: [],
    latestWeekStartMs: null,
    latestValue: null,
  },
  [DERIVED_METRIC_KINDS.TrainingSummary]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    currentWindowDays: 28,
    baselineWindowDays: 28,
    disciplines: [],
    excludesMergedEvents: true,
  },
  [DERIVED_METRIC_KINDS.TrainingCapacity]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    excludesMergedEvents: true,
    disciplines: [{
      discipline: 'cycling',
      ftpSetting: {
        kind: 'ftp-setting',
        value: 250,
        provenance: 'imported-activity-stat',
        firstSeenAtMs: DAY_MS,
        lastSeenAtMs: DAY_MS,
        observationCount: 1,
        previousValue: null,
        previousAtMs: null,
        changePct: null,
      },
      importedVo2Max: null,
    }],
  },
  [DERIVED_METRIC_KINDS.TrainingPowerSystems]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    policyVersion: 1,
    windowDays: 42,
    historyDays: 84,
    cadence: 'workout-date',
    excludesEffectiveDay: true,
    excludesMergedEvents: true,
    activityTypes: [],
  },
  [DERIVED_METRIC_KINDS.PowerCurve]: {
    asOfDayMs: DAY_MS,
    excludesMergedEvents: true,
    pointSamplingVersion: 1,
    scopes: {
      running: powerCurveScope,
      cycling: powerCurveScope,
    },
  },
  [DERIVED_METRIC_KINDS.TrainingExplanation]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    currentWindowDays: 28,
    baselineBlockCount: 3,
    excludesMergedEvents: true,
    excludesMissingDates: true,
    excludesFutureEvents: true,
    current: explanationWindow,
    baselineBlocks: [],
    baselineMedian: explanationWindowMetrics,
    topContributors: [],
  },
  [DERIVED_METRIC_KINDS.TrainingDurability]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    currentWindowDays: 28,
    baselineBlockCount: 3,
    weeklyPointCount: 12,
    excludesMergedEvents: true,
    excludesFutureEvents: true,
    evidenceSource: 'persisted-activity-stat',
    scopes: [],
  },
  [DERIVED_METRIC_KINDS.TrainingBuildComparison]: {
    recoveryVersion: 3,
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    excludesMergedEvents: true,
    recovery: recoveryComparison,
    disciplines: [],
  },
  [DERIVED_METRIC_KINDS.TrainingReadiness]: {
    formulaVersion: 3,
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    generatedAtMs: DAY_MS,
    historyDays: 14,
    points: [],
  },
  [DERIVED_METRIC_KINDS.BodyWeightTrend]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    trendDays: 28,
    comparisonWindowDays: 7,
    minimumComparableDayCount: 3,
    latestWeightKg: null,
    latestWeightDayMs: null,
    median7dKg: null,
    median28dKg: null,
    change7dKg: null,
    change7dPercent: null,
    change28dKg: null,
    change28dPercent: null,
    recordedDayCount7d: 0,
    recordedDayCount28d: 0,
    points: [],
  },
  [DERIVED_METRIC_KINDS.TrainingSwimPerformance]: {
    dayBoundary: 'UTC',
    asOfDayMs: DAY_MS,
    weekCount: 12,
    excludesMergedEvents: true,
    swolfContext: null,
    weeks: [],
  },
} as const satisfies Record<DerivedMetricKind, unknown>;


const trainingReadFixtures = {
 list_training_plans: { scheduleRevision: 1, scanComplete: true, recordsScanned: 1, limitsReached: [], nextCursor: null, plans: [{ planRef: 'opaque-plan-reference', name: 'Autumn', lifecycle: 'active', startDate: '2026-07-01', endDate: '2026-07-02', revision: 1, currentWorkoutCount: 1, color: null, createdAtMs: 1, updatedAtMs: 1 }] },
 get_training_plan: { scheduleRevision: 1, plan: { planRef: 'opaque-plan-reference', name: 'Autumn', lifecycle: 'active', startDate: '2026-07-01', endDate: '2026-07-02', revision: 1, currentWorkoutCount: 1, color: null, createdAtMs: 1, updatedAtMs: 1 } },
 query_planned_workouts: { scheduleRevision: 1, scanComplete: true, recordsScanned: 1, limitsReached: [], nextCursor: null, startDate: '2026-07-01', endDate: '2026-07-02', scope: 'calendar', workouts: [{ workoutRef: 'opaque-workout-reference', planRef: null, title: 'Easy run', localDate: '2026-07-01', lifecycle: 'planned', revision: 1, createdAtMs: 1, updatedAtMs: 1 }] },
 query_planned_workouts_by_date: { scheduleRevision: 1, scanComplete: true, recordsScanned: 1, limitsReached: [], nextCursor: null, startDate: '2026-07-01', endDate: '2026-07-02', scope: 'calendar', workouts: [{ workoutRef: 'opaque-workout-reference', planRef: null, title: 'Easy run', localDate: '2026-07-01', lifecycle: 'planned', revision: 1, createdAtMs: 1, updatedAtMs: 1 }] },
 get_planned_workout: { scheduleRevision: 1, workout: { ...{ workoutRef: 'opaque-workout-reference', planRef: null, title: 'Easy run', localDate: '2026-07-01', lifecycle: 'planned', revision: 1, createdAtMs: 1, updatedAtMs: 1 }, structure: { version: 1, sport: ActivityTypes.Running, nodes: [{kind:'step', id:'step',purpose:'work',ending:{kind:'manual'},targets:[], note:'Untrusted text'}] }, displaySteps: [{nodeId:'step',text:'Work · Manual transition'}] } },
 get_training_sync_status: { scheduleRevision: 1, scope: 'plan', reference:'opaque-plan-reference',scanComplete:true,checkedAtMs:1,services:[] },
 get_planned_workout_completion: { scheduleRevision: 1, workoutRef: 'opaque-workout-reference', state: 'unlinked',
   provider: null, matchMethod: null, timing: null, scheduledDate: '2026-07-01', workoutRevision: 1,
   linkedWorkoutRevision: null, workoutChangedSinceCompletion: false, activityStartAtMs: null, linkedAtMs: null,
   activityRef: null },
 get_planned_workout_completions: { scheduleRevision: 1, completions: [{ workoutRef: 'opaque-workout-reference', state: 'unlinked',
   provider: null, matchMethod: null, timing: null, scheduledDate: '2026-07-01', workoutRevision: 1,
   linkedWorkoutRevision: null, workoutChangedSinceCompletion: false, activityStartAtMs: null, linkedAtMs: null,
   activityRef: null }] },
 assess_planned_workout_compatibility: { scheduleRevision: 1, workoutRef: 'opaque-workout-reference', assessments: [{
   provider: 'garmin', level: 'degraded', issues: [{ severity: 'degraded', code: 'sport_profile_degraded', field: '$.sport',
     message: 'Garmin receives the exact authored profile through its Cycling family.' }],
 }] },
};

const trainingPreviewFixture = { proposalRef: 'opaque-proposal-reference', expiresAtMs: DAY_MS + 60_000,
  permissionMode: 'schedule' as const, scheduleRevision: 1,
  summary: 'One Training change requires confirmation.', requiresConfirmation: true as const,
  changes: [{ index: 0, kind: 'rename-plan', summary: 'Rename the plan.' }], providerPreviews: [] };
const trainingApplyFixture = { proposalRef: 'opaque-proposal-reference', status: 'applied' as const,
  scheduleRevision: 2, changes: [{ index: 0, kind: 'rename-plan', status: 'applied' as const,
    message: 'Renamed the plan.' }], providers: [], createdReferences: [] };

function createFixtureDataService(
  options: {
    activityLocation?: boolean;
    routeLocation?: boolean;
  } = {},
): InjectedDataService {
  const activityLocation = options.activityLocation !== false;
  const routeLocation = options.routeLocation !== false;
  const service = {
    getHrvPersonalRange: vi.fn().mockResolvedValue({ startTimeMs: 0, endTimeMs: DAY_MS,
      baselineWindowDays: 60, baselineMinimumObservationDays: 14, currentWindowDays: 7, currentMinimumObservationDays: 3,
      recordsRead: 1, excludedValues: 0, series: [{ source: 'sleep', provider: 'SuuntoApp', accountNumber: 1,
        seriesNumber: 1, semanticVariant: 'sleep_session_average_hrv', aggregation: 'average', origin: 'provider_summary',
        recordingMethod: 'provider_calculated', unit: 'ms', status: 'building_baseline', currentAverage: null,
        currentAverageDisplay: null, normalRange: null, observationDayCount: 1,
        readings: [{ date: '1970-01-01', value: 42, display: { value: '42', unit: 'ms' }, status: 'building_baseline', normalRange: null }],
        rangePoints: [{ timeMs: 0, normalRange: null }, { timeMs: DAY_MS, normalRange: { min: 30, max: 50 } }],
      }] }),
    readTrainingPlans: vi.fn(async (input: { tool: TrainingReadTool }) => trainingReadFixtures[input.tool]),
    previewCreatePlannedWorkout: vi.fn().mockResolvedValue(trainingPreviewFixture),
    previewTrainingChanges: vi.fn().mockResolvedValue(trainingPreviewFixture),
    applyTrainingChanges: vi.fn().mockResolvedValue(trainingApplyFixture),
    getActivityDescription: vi.fn().mockResolvedValue({ activityRef: 'opaque-activity-ref', description: 'Easy run. Felt tired.\nKeep this as reported context.' }),
    queryTimelineNotes: vi.fn().mockResolvedValue({
      startDate: '2026-07-01', endDate: '2026-07-02',
      notes: [{ category: 'sickness', title: 'Reported context', details: 'Full text including personal context.',
        startDate: '2026-06-30', endDate: null, timeZone: 'Europe/Helsinki', effectiveEndDate: '2026-07-02' }],
      recordsScanned: 1, skippedRecords: 0, scanComplete: true, limitsReached: [], nextCursor: null,
    }),
    listHealthMetrics: vi.fn().mockResolvedValue(getMcpHealthCatalog()),
    queryHealthMetric: vi.fn().mockResolvedValue({
      metric: getMcpHealthCatalog().metrics.find(metric => metric.id === 'heart_rate'),
      startDate: '2026-07-01', endDate: '2026-07-02', mode: 'summaries', complete: true,
      limitsReached: [], recordsRead: 1, chunksRead: 0, samplesRead: 0,
      excludedValues: 0, sleepReferencesExcluded: 0, revisionMismatches: 0,
      measurementDays: [], series: [{
        seriesNumber: 1, provider: 'SuuntoApp', accountNumber: 1,
        normalizationStatus: 'canonical', unit: 'bpm',
        aggregation: 'average', semanticVariant: 'daily_average', origin: 'provider_summary',
        recordingMethod: 'provider_calculated', readingCount: 1, returnedPointCount: 1,
        downsampled: false, recordedDays: 1, partialDays: 0, unknownDays: 0,
        points: [{ date: '2026-07-01', timeMs: null, value: 60, display: { value: '60', unit: 'bpm' } }],
      }],
    }),
    listMeasurementTypes: vi.fn().mockResolvedValue({
      measurementTypes: [{
        id: 'body_weight',
        displayName: 'Body weight',
        description: 'Recorded body weight.',
        canonicalMetric: {
          type: 'Weight',
          displayType: 'Weight',
          unit: 'kg',
          unitSystem: 'metric',
        },
        defaultAggregation: 'median',
        supportedAggregations: [
          'median',
          'average',
          'minimum',
          'maximum',
          'latest',
        ],
        defaultInterval: 'day',
        supportedIntervals: ['day', 'week', 'month'],
        maximumRangeDays: 366,
        requiresExplicitIanaTimeZone: true,
        currentTrend: {
          tool: 'get_training_metric',
          metricKind: DERIVED_METRIC_KINDS.BodyWeightTrend,
          requiredScope: 'metrics:read',
          windowDays: 28,
          dayBoundaryTimeZone: 'UTC',
          readiness: 'ready_snapshot_required',
        },
      }],
    }),
    queryMeasurements: vi.fn().mockResolvedValue({
      measurementType: {
        id: 'body_weight',
        displayName: 'Body weight',
        description: 'Recorded body weight.',
        canonicalMetric: {
          type: 'Weight',
          displayType: 'Weight',
          unit: 'kg',
          unitSystem: 'metric',
        },
        defaultAggregation: 'median',
        supportedAggregations: ['median', 'average', 'minimum', 'maximum', 'latest'],
        defaultInterval: 'day',
        supportedIntervals: ['day', 'week', 'month'],
        maximumRangeDays: 366,
        requiresExplicitIanaTimeZone: true,
        currentTrend: {
          tool: 'get_training_metric',
          metricKind: DERIVED_METRIC_KINDS.BodyWeightTrend,
          requiredScope: 'metrics:read',
          windowDays: 28,
          dayBoundaryTimeZone: 'UTC',
          readiness: 'ready_snapshot_required',
        },
      },
      startTimeMs: DAY_MS,
      endTimeMs: NEXT_DAY_MS,
      timeZone: 'Europe/Helsinki',
      aggregation: 'median',
      interval: 'day',
      measurementCount: 2,
      points: [{
        bucketStartTimeMs: DAY_MS,
        value: 71.2,
        measurementCount: 2,
      }],
      summary: {
        firstPoint: {
          bucketStartTimeMs: DAY_MS,
          value: 71.2,
          measurementCount: 2,
        },
        latestPoint: {
          bucketStartTimeMs: DAY_MS,
          value: 71.2,
          measurementCount: 2,
        },
        absoluteChange: 0,
      },
    }),
    listMetrics: vi.fn().mockResolvedValue({
      eventMetrics: [
        metricDescriptor,
        strokeRateMetricDescriptor,
        runningFlightTimeMetricDescriptor,
      ],
      nextCursor: NEXT_CURSOR,
      scannedEventCount: 1,
      eventScanTruncated: false,
      derivedMetricKinds: Object.values(DERIVED_METRIC_KINDS),
      sleepCapabilities: {
        providers: ['GarminAPI', 'SuuntoApp', 'COROSAPI'],
        sessionSummaries: true,
        aggregateGroupings: ['day', 'week', 'month'],
      },
    }),
    queryMetric: vi.fn().mockResolvedValue({
      metric: metricDescriptor,
      matchedEventCount: 1,
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        resolvedTimeInterval: TimeIntervals.Daily,
        buckets: [{
          bucketKey: DAY_MS,
          time: DAY_MS,
          totalCount: 1,
          aggregateValue: 10_000,
          seriesValues: { Running: 10_000 },
          seriesCounts: { Running: 1 },
        }],
      },
    }),
    queryMetrics: vi.fn().mockResolvedValue({
      results: [{
        metric: metricDescriptor,
        matchedEventCount: 1,
        aggregation: {
          dataType: 'Distance',
          valueType: ChartDataValueTypes.Total,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Daily,
          buckets: [{
            bucketKey: DAY_MS,
            time: DAY_MS,
            totalCount: 1,
            aggregateValue: 10_000,
            seriesValues: { Running: 10_000 },
            seriesCounts: { Running: 1 },
          }],
        },
      }],
    }),
    listTrainingMetrics: vi.fn().mockResolvedValue({
      metrics: [{
        metricKind: DERIVED_METRIC_KINDS.Form,
        title: 'Fitness, fatigue, and Form history',
        description: 'Daily TSS-based fitness, fatigue, Form, and load history.',
        category: 'load',
        periodLabel: 'Available daily history',
        status: 'ready',
        updatedAtMs: DAY_MS,
        sourceEventCount: 1,
      }],
    }),
    getTrainingMetric: vi.fn().mockImplementation(
      async (_uid: string, metricKind: DerivedMetricKind) => ({
        metricKind,
        schemaVersion: MCP_TRAINING_METRIC_SCHEMA_VERSION,
        updatedAtMs: DAY_MS,
        sourceEventCount: 0,
        payload: derivedPayloadFixtures[metricKind],
      }),
    ),
    listSleepVitals: vi.fn().mockResolvedValue({
      matchedSessionCount: 1,
      vitals: [{
        type: 'overnightHrvMs',
        label: 'Overnight HRV',
        unit: 'milliseconds',
        sessionCount: 1,
      }],
    }),
    getSleepTrend: vi.fn().mockResolvedValue({
      rangeStartTimeMs: DAY_MS,
      rangeEndTimeMs: NEXT_DAY_MS,
      timeZone: 'Europe/Helsinki',
      groupBy: 'day',
      matchedSessionCount: 1,
      availableVitals: [{
        type: 'overnightHrvMs',
        label: 'Overnight HRV',
        unit: 'milliseconds',
        sessionCount: 1,
      }],
      buckets: [{
        bucketStartMs: DAY_MS,
        sessionCount: 1,
        providers: ['GarminAPI'],
        totalDurationSeconds: 28_800,
        averageDurationSeconds: 28_800,
        averageInBedDurationSeconds: null,
        averageScore: 80,
        stageDurationsSeconds: { deep: 3_600 },
        averageVitals: {
          overnightHrvMs: 55,
        },
      }],
    }),
    listSleepSessions: vi.fn().mockResolvedValue({
      sessions: [{
        provider: 'GarminAPI',
        sleepDate: '2026-07-01',
        startTimeMs: DAY_MS,
        endTimeMs: NEXT_DAY_MS,
        durationSeconds: 28_800,
        inBedDurationSeconds: null,
        isNap: false,
        stageDurationsSeconds: { deep: 3_600 },
        score: {
          value: 80,
          qualifier: null,
        },
        vitals: {
          averageHeartRateBpm: 50,
        },
      }],
      nextCursor: NEXT_CURSOR,
    }),
    querySleepSummary: vi.fn().mockResolvedValue({
      timeZone: 'Europe/Helsinki',
      groupBy: 'day',
      matchedSessionCount: 1,
      buckets: [{
        bucketStartMs: DAY_MS,
        sessionCount: 1,
        providers: ['GarminAPI'],
        totalDurationSeconds: 28_800,
        averageDurationSeconds: 28_800,
        averageInBedDurationSeconds: null,
        averageScore: 80,
        stageDurationsSeconds: { deep: 3_600 },
        averageVitals: {
          averageHeartRateBpm: 50,
        },
      }],
    }),
    getTodayReadiness: vi.fn().mockResolvedValue({
      asOfTimeMs: DAY_MS,
      timeZone: 'Europe/Helsinki',
      localDayStartTimeMs: DAY_MS,
      localDayEndTimeMs: NEXT_DAY_MS - 1,
      dayBoundary: 'UTC',
      asOfDayMs: DAY_MS,
      formulaVersion: 3,
      status: 'available',
      score: 76,
      label: 'Ready',
      confidence: 'high',
      availableSignalCount: 4,
      availableWeightPercent: 100,
      baselineEvidenceCount: 5,
      totalSignalCount: 4,
      drivers: {
        load: {
          status: 'available',
          weightPercent: 40,
          form: -2,
          rampRate: 1,
          asOfDayMs: DAY_MS,
          sourceUpdatedAtMs: DAY_MS,
        },
        sleep: {
          status: 'available',
          weightPercent: 25,
          score: 80,
          scoreSource: 'recorded',
          latestSleepAtMs: DAY_MS,
          sleepDate: '2026-07-01',
          durationSeconds: 28_800,
          recordedScore: 80,
        },
        hrv: {
          status: 'available',
          weightPercent: 20,
          latestMs: 55,
          baselineMedianMs: 50,
          baselineNightCount: 5,
          ratio: 1.1,
        },
        overnightHeartRate: {
          status: 'available',
          weightPercent: 15,
          combinedRatio: 0.95,
          average: {
            status: 'available',
            latestBpm: 49,
            baselineMedianBpm: 52,
            baselineNightCount: 5,
            ratio: 49 / 52,
          },
          minimum: {
            status: 'not_recorded',
            latestBpm: null,
            baselineMedianBpm: null,
            baselineNightCount: 0,
            ratio: null,
          },
        },
      },
    }),
    getDailyBriefing: vi.fn().mockResolvedValue({
      asOfTimeMs: DAY_MS,
      timeZone: 'Europe/Helsinki',
      localDayStartTimeMs: DAY_MS,
      localDayEndTimeMs: NEXT_DAY_MS - 1,
      sleep: {
        status: 'available',
        latestSession: {
          sleepDate: '2026-07-01',
          startTimeMs: DAY_MS,
          endTimeMs: NEXT_DAY_MS,
          durationSeconds: 28_800,
          inBedDurationSeconds: null,
          score: {
            value: 80,
            qualifier: null,
          },
        },
        comparison: {
          sameProviderNightCount: 3,
          averageDurationSeconds: 27_600,
          durationDeltaSeconds: 1_200,
        },
      },
      trainingReadiness: {
        status: 'available',
        dayBoundary: 'UTC',
        asOfDayMs: DAY_MS,
        generatedAtMs: DAY_MS,
        updatedAtMs: DAY_MS,
        score: 76,
        label: 'Ready',
        confidence: 'high',
        availableSignalCount: 4,
        baselineEvidenceCount: 14,
      },
      trainingSummary: {
        status: 'available',
        dayBoundary: 'UTC',
        asOfDayMs: DAY_MS,
        updatedAtMs: DAY_MS,
        baselineSourceWindowDays: 84,
        current28d: {
          equivalentPeriodDays: 28,
          activityCount: 11,
          durationSeconds: 28_800,
          intensitySeconds: {
            easy: 18_600,
            moderate: 6_900,
            hard: 3_300,
          },
        },
        usual28d: {
          equivalentPeriodDays: 28,
          activityCount: 8,
          durationSeconds: 21_200,
          intensitySeconds: {
            easy: 13_600,
            moderate: 5_100,
            hard: 2_500,
          },
        },
        disciplines: [{
          discipline: 'running',
          current28d: {
            equivalentPeriodDays: 28,
            activityCount: 6,
            durationSeconds: 14_400,
            intensitySeconds: {
              easy: 9_000,
              moderate: 3_600,
              hard: 1_800,
            },
          },
          usual28d: {
            equivalentPeriodDays: 28,
            activityCount: 4.67,
            durationSeconds: 11_200,
            intensitySeconds: {
              easy: 7_000,
              moderate: 2_800,
              hard: 1_400,
            },
          },
        }, {
          discipline: 'cycling',
          current28d: {
            equivalentPeriodDays: 28,
            activityCount: 3,
            durationSeconds: 10_800,
            intensitySeconds: {
              easy: 7_200,
              moderate: 2_400,
              hard: 1_200,
            },
          },
          usual28d: {
            equivalentPeriodDays: 28,
            activityCount: 2,
            durationSeconds: 7_200,
            intensitySeconds: {
              easy: 4_800,
              moderate: 1_600,
              hard: 800,
            },
          },
        }, {
          discipline: 'swimming',
          current28d: {
            equivalentPeriodDays: 28,
            activityCount: 2,
            durationSeconds: 3_600,
            intensitySeconds: {
              easy: 2_400,
              moderate: 900,
              hard: 300,
            },
          },
          usual28d: {
            equivalentPeriodDays: 28,
            activityCount: 1.33,
            durationSeconds: 2_800,
            intensitySeconds: {
              easy: 1_800,
              moderate: 700,
              hard: 300,
            },
          },
        }],
      },
    }),
    listActivityTypes: vi.fn().mockReturnValue({
      activityTypeCount: 2,
      activityTypes: [{
        activityType: 'Running',
        activityGroup: 'running_group',
        indoor: false,
      }, {
        activityType: 'Indoor Running',
        activityGroup: 'running_group',
        indoor: true,
      }],
    }),
    listActivities: vi.fn().mockResolvedValue({
      scannedActivityCount: 1,
      skippedActivityCount: 0,
      activities: [
        activityLocation
          ? activitySummaryWithLocation
          : activitySummaryRedacted,
      ],
      nextCursor: NEXT_CURSOR,
      scanComplete: false,
    }),
    queryActivitiesWithTags: vi.fn().mockResolvedValue({
      scannedActivityCount: 1,
      skippedActivityCount: 0,
      activities: [{
        ...activitySummaryRedacted,
        tags: ['Race', 'Long Run'],
      }],
      nextCursor: NEXT_CURSOR,
      scanComplete: false,
    }),
    findActivitiesNearLocation: vi.fn().mockResolvedValue({
      location: {
        source: 'coordinates',
        resolvedLabel: null,
        ...coordinate,
        radiusMeters: 1_000,
      },
      scannedActivityCount: 1,
      skippedActivityCount: 0,
      activities: [{
        ...activitySummaryWithLocation,
        nearestDistanceMeters: 25,
        nearestPosition: coordinate,
        nearestPositionKind: 'start',
        matchedPositionKinds: ['start'],
      }],
      nextCursor: null,
      scanComplete: true,
    }),
    listActivityLaps: vi.fn().mockResolvedValue({
      items: [{
        index: 0,
        lapNumber: null,
        type: null,
        startTimeMs: DAY_MS,
        endTimeMs: NEXT_DAY_MS,
        startSampleIndex: null,
        endSampleIndex: null,
        stats: activityStats,
      }],
      nextCursor: NEXT_CURSOR,
    }),
    listActivityJumps: vi.fn().mockResolvedValue({
      items: [{
        index: 0,
        timestampMs: DAY_MS,
        distanceMeters: 2,
        heightMeters: null,
        hangTimeSeconds: null,
        speedMetersPerSecond: null,
        rotations: null,
        score: 60,
        ...(activityLocation ? {
          latitudeDegrees: coordinate.latitudeDegrees,
          longitudeDegrees: coordinate.longitudeDegrees,
        } : {}),
        locationRedacted: !activityLocation,
      }],
      nextCursor: null,
    }),
    listActivitySwimLengths: vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
    }),
    listActivityChartMetrics: vi.fn().mockReturnValue({
      activityType: null,
      metrics: MCP_ACTIVITY_CHART_METRICS.map(metric => ({
        metric: metric.id,
        label: metric.label,
        canonicalUnit: metric.unit,
      })),
      xAxes: [
        { xAxis: 'elapsed_time', canonicalUnit: 'seconds' },
        { xAxis: 'distance', canonicalUnit: 'meters' },
      ],
      pointLimits: {
        defaultPerMetric: MCP_ACTIVITY_CHART_DEFAULT_POINTS,
        maximumPerMetric: MCP_ACTIVITY_CHART_MAX_POINTS,
        defaultLocation: MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS,
        maximumLocation: MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS,
      },
    }),
    getActivitySamples: vi.fn().mockResolvedValue({
      activityType: 'Running', sampling: 'all_available', timeUnit: 'seconds', sampleIntervalSeconds: 1,
      range: {startOffsetSeconds: 0, endOffsetSeconds: 3, totalSampleCount: 3},
      page: {startOffsetSeconds: 0, endOffsetSeconds: 2, returnedSampleCount: 2},
      elapsedTimeSeconds: [0, 1], series: [{metric: 'heart_rate', canonicalUnit: 'beats_per_minute', sourceSampleCount: 3, missingSampleCount: 1, values: [120, null]}], nextCursor: 'sample_cursor',
    }),
    getActivityChartData: vi.fn().mockImplementation(async (input: {
      xAxis: 'elapsed_time' | 'distance';
      includeLocation?: boolean;
    }) => ({
      activityType: 'Running',
      xAxis: input.xAxis,
      xAxisUnit: input.xAxis === 'elapsed_time' ? 'seconds' : 'meters',
      series: [{
        metric: 'heart_rate',
        canonicalUnit: 'beats_per_minute',
        xValues: [0, 1],
        values: [120, 125],
        sourceSampleCount: 2,
        returnedSampleCount: 2,
        missingSampleCount: 0,
      }],
      ...(input.includeLocation && activityLocation ? {
        location: {
          xValues: [0, 1],
          latitudeDegrees: [39.665, 39.666],
          longitudeDegrees: [20.8537, 20.854],
          sourceSampleCount: 2,
          returnedSampleCount: 2,
          missingSampleCount: 0,
        },
      } : {}),
    })),
    getActivityMetrics: vi.fn().mockResolvedValue({
      selectedMetricCount: 1,
      availableMetricCount: 1,
      metrics: [{
        ...metricDescriptor,
        value: 10_000,
        available: true,
      }],
    }),
    getActivityOverview: vi.fn().mockResolvedValue({
      activityType: 'Running',
      locationRedacted: true,
      availableMetrics: [metricDescriptor],
      details: [
        { kind: 'laps', status: 'available', count: 2 },
        { kind: 'jumps', status: 'empty', count: 0 },
        { kind: 'swim_lengths', status: 'unavailable', count: null },
      ],
      chartData: {
        sourceDeclared: true,
        candidateMetrics: MCP_ACTIVITY_CHART_METRICS.map(metric => metric.id),
      },
    }),
    rankActivitiesByMetric: vi.fn().mockResolvedValue({
      metric: metricDescriptor,
      order: 'highest',
      scannedActivityCount: 1,
      matchedActivityCount: 1,
      activities: [{
        rank: 1,
        activityRef: ACTIVITY_REF,
        startTime: new Date(DAY_MS).toISOString(),
        activityType: 'Running',
        value: 10_000,
      }],
    }),
    listRoutes: vi.fn().mockResolvedValue({
      scannedRouteCount: 1,
      skippedRouteCount: 0,
      routes: [
        routeLocation ? routeSummaryWithLocation : routeSummaryRedacted,
      ],
      nextCursor: null,
      scanComplete: true,
    }),
    findRoutesNearLocation: vi.fn().mockResolvedValue({
      location: {
        source: 'mapbox',
        resolvedLabel: 'Ioannina, Greece',
        ...coordinate,
        radiusMeters: 1_000,
      },
      scannedRouteCount: 1,
      loadedRoutePreviewCount: 1,
      decodedRoutePointCount: 2,
      skippedRouteCount: 0,
      routes: [{
        ...routeSummaryWithLocation,
        nearestDistanceMeters: 20,
        nearestPosition: coordinate,
        matchingSegmentIndex: 0,
        matchingSegmentStartPosition: coordinate,
        matchingSegmentEndPosition: {
          latitudeDegrees: 39.666,
          longitudeDegrees: 20.854,
        },
      }],
      nextCursor: null,
      scanComplete: true,
    }),
    getRouteGeometry: vi.fn().mockResolvedValue({
      geometry: {
        version: 1,
        encoding: 'polyline5',
        precision: 5,
        sourcePointCount: 2,
        pointCount: 2,
        bounds,
        segments: [{
          segmentIndex: 0,
          activityType: 'Cycling',
          sourcePointCount: 2,
          pointCount: 2,
          bounds,
          startPosition: coordinate,
          endPosition: {
            latitudeDegrees: 39.666,
            longitudeDegrees: 20.854,
          },
          encodedPolyline: '??AA',
        }],
      },
    }),
    listRouteWaypoints: vi.fn().mockResolvedValue({
      waypoints: [{
        index: 0,
        latitudeDegrees: coordinate.latitudeDegrees,
        longitudeDegrees: coordinate.longitudeDegrees,
        altitudeMeters: null,
        distanceMeters: null,
        routeIndex: null,
        routePointIndex: null,
        type: null,
      }],
      waypointCount: 1,
    }),
  } as unknown as InjectedDataService;
  service.getCurrentReadiness = vi.fn().mockImplementation(async input => {
    const legacy = await service.getTodayReadiness(input);
    const personalRange = { tone: 'positive' as const, reason: 'within_range' as const,
      observationDayCount: 60, requiredObservationDayCount: 14, currentObservationDayCount: 7,
      requiredCurrentObservationDayCount: 3, baselineAverage: 45, currentAverage: 41,
      normalRange: { min: 40, max: 50 }, latestMs: 42, latestAtMs: DAY_MS - 3600000 };
    const score = calculateCurrentReadinessScore({ form: legacy.drivers.load.form, rampRate: legacy.drivers.load.rampRate,
      sleepScore: legacy.drivers.sleep.score, hrvPersonalRange: personalRange, overnightHeartRateRatio: legacy.drivers.overnightHeartRate.combinedRatio })!;
    return { ...legacy, formulaVersion: 4, score: score.score, label: score.score >= 75 ? 'Ready' : score.score >= 55 ? 'Mixed' : 'Recover',
      availableSignalCount: score.availableSignalCount, availableWeightPercent: score.availableWeight,
      confidence: resolveReadinessConfidence(score.availableWeight, legacy.baselineEvidenceCount), drivers: { ...legacy.drivers,
      hrv: { weightPercent: 20, baselineWindowDays: 60, currentWindowDays: 7, personalRange } } };
  });
  service.getReadinessHistory = vi.fn().mockResolvedValue({ formulaVersion: 4, dayBoundary: 'UTC',
    asOfDayMs: DAY_MS, generatedAtMs: DAY_MS, historyDays: 14,
    points: Array.from({ length: 14 }, (_, index) => ({ dayMs: DAY_MS - (13 - index) * 86400000,
      score: 50, label: 'Recover', confidence: 'low', availableSignalCount: 1, baselineEvidenceCount: 0, totalSignalCount: 4,
      form: null, rampRate: null, sleepScore: null, latestSleepAtMs: null, hrvRatio: 1,
      hrvPersonalRange: { tone: 'positive', reason: 'within_range', observationDayCount: 60,
        requiredObservationDayCount: 14, currentObservationDayCount: 7, requiredCurrentObservationDayCount: 3,
        baselineAverage: 41, currentAverage: 41, normalRange: { min: 41, max: 41 }, latestMs: 41,
        latestAtMs: DAY_MS - (13 - index) * 86400000 },
      averageHeartRateRatio: null, minimumHeartRateRatio: null, overnightHeartRateRatio: null })) });
  service.getDailyReport = vi.fn().mockImplementation(async input => {
    const [readiness, briefing] = await Promise.all([
      service.getCurrentReadiness(input),
      service.getDailyBriefing(input),
    ]);
    return {
      sleep: {
        status: 'available',
        latestSession: {
          sleepDate: '2026-07-01',
          startTimeMs: DAY_MS,
          endTimeMs: NEXT_DAY_MS,
          durationSeconds: 28_800,
          inBedDurationSeconds: 30_600,
          score: {
            value: 80,
            qualifier: 'good',
          },
          vitals: {
            averageHrvMs: 55,
            overnightHrvMs: 56,
            averageHeartRateBpm: 49,
            minimumHeartRateBpm: 40,
          },
        },
        comparison: {
          sameProviderNightCount: 5,
          averageDurationSeconds: 27_600,
          durationDeltaSeconds: 1_200,
        },
      },
      readiness,
      trainingSummary: briefing.trainingSummary,
    };
  });
  return service;
}

const successfulToolArguments: Record<
  PublicMcpToolName,
  Record<string, unknown>
> = {
  list_training_plans: {},
  get_training_plan: { planRef: 'opaque-plan-reference' },
  query_planned_workouts: { startDate: '2026-07-01', endDate: '2026-07-02' },
  query_planned_workouts_by_date: { startDate: '2026-07-01', endDate: '2026-07-02' },
  get_planned_workout: { workoutRef: 'opaque-workout-reference' },
  get_training_sync_status: { scope: 'plan', reference: 'opaque-plan-reference' },
  get_planned_workout_completion: { workoutRef: 'opaque-workout-reference' },
  get_planned_workout_completions: { workoutRefs: ['opaque-workout-reference'] },
  assess_planned_workout_compatibility: { workoutRef: 'opaque-workout-reference', providers: ['garmin'] },
  preview_create_planned_workout: {
    expectedScheduleRevision: 1,
    localDate: '2026-07-02',
    title: 'Easy run',
    structure: { version: 1, sport: 'Running', nodes: [{
      kind: 'step', id: 'easy', purpose: 'work', ending: { kind: 'time', seconds: 1800 }, targets: [],
    }] },
    delivery: { providers: ['garmin'], timeZone: 'Europe/Helsinki' },
  },
  preview_training_changes: { expectedScheduleRevision: 1, changes: [{
    kind: 'rename-plan', plan: { ref: 'opaque-plan-reference' }, name: 'Autumn build',
  }] },
  apply_training_changes: { proposalRef: 'opaque-proposal-reference', permissionMode: 'schedule' },
  get_activity_description: { activityRef: 'opaque-activity-ref' },
  query_timeline_notes: { startDate: '2026-07-01', endDate: '2026-07-02' },
  list_health_metrics: {},
  query_health_metric: { metricId: 'heart_rate', startDate: '2026-07-01', endDate: '2026-07-02' },
  get_hrv_personal_range: { start: '2026-07-01T00:00:00Z', end: '2026-07-02T00:00:00Z' },
  list_measurement_types: {},
  query_measurements: {
    measurementType: 'body_weight',
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-07-02T00:00:00.000Z',
    timeZone: 'Europe/Helsinki',
  },
  list_metrics: {},
  query_metric: {
    metric: 'Distance',
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-07-02T00:00:00.000Z',
    timeZone: 'Europe/Helsinki',
  },
  query_metrics: {
    metrics: [{
      metric: 'Distance',
      aggregation: 'total',
    }],
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-07-02T00:00:00.000Z',
    timeZone: 'Europe/Helsinki',
  },
  list_training_metrics: {},
  get_training_metric: {
    metricKind: DERIVED_METRIC_KINDS.Form,
  },
  list_sleep_vitals: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-07-02T00:00:00.000Z',
  },
  list_sleep_sessions: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-07-02T00:00:00.000Z',
  },
  query_sleep_summary: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-07-02T00:00:00.000Z',
    timeZone: 'Europe/Helsinki',
  },
  get_sleep_trend: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-07-02T00:00:00.000Z',
    timeZone: 'Europe/Helsinki',
  },
  get_current_readiness: { timeZone: 'Europe/Helsinki' },
  get_readiness_history: {},
  get_today_readiness: {
    timeZone: 'Europe/Helsinki',
  },
  get_daily_report: {
    timeZone: 'Europe/Helsinki',
  },
  get_daily_briefing: {
    timeZone: 'Europe/Helsinki',
  },
  list_activity_types: {},
  list_activities: {
    activityTypes: ['Running'],
    limit: 1,
  },
  query_activities: {
    activityTypes: ['Running'],
    limit: 1,
  },
  query_activities_with_tags: {
    activityTypes: ['Running'],
    tags: ['Race'],
    tagMatch: 'all',
    limit: 1,
  },
  find_activities_near_location: {
    location: coordinate,
  },
  search_activities_near_location: {
    location: coordinate,
  },
  list_activity_laps: {
    activityRef: ACTIVITY_REF,
  },
  list_activity_jumps: {
    activityRef: ACTIVITY_REF,
  },
  list_activity_swim_lengths: {
    activityRef: ACTIVITY_REF,
  },
  list_activity_chart_metrics: {},
  get_activity_samples: {activityRef: ACTIVITY_REF, metrics: ['heart_rate']},
  get_activity_chart_data: {
    activityRef: ACTIVITY_REF,
    metrics: ['heart_rate'],
    xAxis: 'elapsed_time',
    includeLocation: true,
  },
  get_activity_metrics: {
    activityRef: ACTIVITY_REF,
    metrics: ['Distance'],
  },
  get_activity_overview: {
    activityRef: ACTIVITY_REF,
  },
  rank_activities_by_metric: {
    metric: 'Maximum Jump Distance',
    activityGroup: 'mountain_biking_group',
    limit: 1,
  },
  list_routes: {
    activityTypes: ['Running'],
    search: 'ridge',
  },
  find_routes_near_location: {
    location: { query: 'Ioannina, Greece' },
  },
  search_routes_near_location: {
    location: { query: 'Ioannina, Greece' },
  },
  get_route_geometry: {
    routeRef: ROUTE_REF,
  },
  list_route_waypoints: {
    routeRef: ROUTE_REF,
  },
};

type FixtureTransport = 'in-memory' | 'legacy-http' | 'modern-http';

async function connectFixtureServerForTransport(
  dataService: InjectedDataService,
  scopes = Object.values(MCP_OAUTH_SCOPES),
  mode: FixtureTransport = 'in-memory',
) {
  const factory = () => createMcpServer({
    uid: 'user-1',
    clientId: 'https://client.example/client.json',
    connectionId: 'connection-1',
    scopes,
  }, 'https://quantified-self.io', dataService);
  const client = new Client({
    name: 'output-contract-test-client',
    version: '1.0.0',
  }, { versionNegotiation: { mode: mode === 'modern-http' ? { pin: '2026-07-28' } : 'legacy' } });
  if (mode !== 'in-memory') {
    const server = createMcpTransportHandler(factory, error => { throw error; });
    const transport = new StreamableHTTPClientTransport(new URL('https://contract.example/mcp'), {
      fetch: (url, init) => server.fetch(new Request(url, init)),
    });
    await client.connect(transport);
    expect(client.getNegotiatedProtocolVersion()).toBe(mode === 'modern-http' ? '2026-07-28' : '2025-11-25');
    return { client, server };
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = factory();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function createAjv() {
  const ajv = new Ajv({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
  });
  addFormats(ajv);
  return ajv;
}

function collectPropertyNames(value: unknown, names = new Set<string>()) {
  if (!value || typeof value !== 'object') {
    return names;
  }
  if (Array.isArray(value)) {
    value.forEach(child => collectPropertyNames(child, names));
    return names;
  }
  const record = value as Record<string, unknown>;
  if (record.properties && typeof record.properties === 'object') {
    Object.keys(record.properties).forEach(name => names.add(name));
  }
  Object.values(record).forEach(child => collectPropertyNames(child, names));
  return names;
}

function collectObjectSchemas(
  value: unknown,
  schemas: Array<Record<string, unknown>> = [],
) {
  if (!value || typeof value !== 'object') {
    return schemas;
  }
  if (Array.isArray(value)) {
    value.forEach(child => collectObjectSchemas(child, schemas));
    return schemas;
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'object' && record.properties) {
    schemas.push(record);
  }
  Object.values(record).forEach(child => collectObjectSchemas(child, schemas));
  return schemas;
}

describe.each<FixtureTransport>(['in-memory', 'legacy-http', 'modern-http'])('MCP public output contracts (%s)', mode => {
  const connectFixtureServer = (
    dataService: InjectedDataService,
    scopes = Object.values(MCP_OAUTH_SCOPES),
  ) => connectFixtureServerForTransport(dataService, scopes, mode);
  const connections: Array<{
    client: Client;
    server: { close(): Promise<void> };
  }> = [];

  afterEach(async () => {
    await Promise.all(connections.splice(0).map(async ({ client, server }) => {
      await client.close();
      await server.close();
    }));
  });

  it('keeps public tools and derived payload schemas mechanically exhaustive', () => {
    const registry = createMcpOutputSchemaRegistry({
      activityLocation: true,
      routeLocation: true,
    });
    expect(Object.keys(registry).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort(),
    );
    expect(Object.keys(MCP_DERIVED_PAYLOAD_SCHEMAS).sort()).toEqual(
      Object.values(DERIVED_METRIC_KINDS).sort(),
    );
    Object.entries(derivedPayloadFixtures).forEach(([metricKind, payload]) => {
      expect(
        MCP_DERIVED_PAYLOAD_SCHEMAS[metricKind as DerivedMetricKind]
          .safeParse(payload).success,
      ).toBe(true);
    });
    expect(MCP_DERIVED_PAYLOAD_SCHEMAS.training_summary.safeParse({
      ...derivedPayloadFixtures.training_summary,
      disciplines: [{
        discipline: 'running',
        current28d: {
          periodDays: 28,
          windowStartDayMs: DAY_MS,
          windowEndDayMs: NEXT_DAY_MS,
          activityCount: 2,
          durationSeconds: 7_200,
          easySeconds: 3_600,
          moderateSeconds: 2_400,
          hardSeconds: 1_200,
        },
        baseline28d: {
          periodDays: 28,
          windowStartDayMs: DAY_MS - (84 * 24 * 60 * 60 * 1000),
          windowEndDayMs: DAY_MS - 1,
          activityCount: 0.67,
          durationSeconds: 2_400,
          easySeconds: 1_200,
          moderateSeconds: 800,
          hardSeconds: 400,
        },
      }],
    }).success).toBe(true);
    expect(MCP_DERIVED_PAYLOAD_SCHEMAS.training_summary.safeParse({
      ...derivedPayloadFixtures.training_summary,
      disciplines: [{
        discipline: 'running',
        current28d: {
          periodDays: 28,
          windowStartDayMs: DAY_MS,
          windowEndDayMs: NEXT_DAY_MS,
          activityCount: 0.67,
          durationSeconds: 2_400,
          easySeconds: 1_200,
          moderateSeconds: 800,
          hardSeconds: 400,
        },
        baseline28d: {
          periodDays: 28,
          windowStartDayMs: DAY_MS - (84 * 24 * 60 * 60 * 1000),
          windowEndDayMs: DAY_MS - 1,
          activityCount: 1,
          durationSeconds: 3_600,
          easySeconds: 1_800,
          moderateSeconds: 1_200,
          hardSeconds: 600,
        },
      }],
    }).success).toBe(false);

    expect(registry.get_training_metric.safeParse({
      metricKind: DERIVED_METRIC_KINDS.Form,
      schemaVersion: MCP_TRAINING_METRIC_SCHEMA_VERSION,
      updatedAtMs: DAY_MS,
      sourceEventCount: 0,
      payload: derivedPayloadFixtures[DERIVED_METRIC_KINDS.BodyWeightTrend],
    }).success).toBe(false);
    expect(registry.get_training_metric.safeParse({
      metricKind: DERIVED_METRIC_KINDS.Form,
      schemaVersion: MCP_TRAINING_METRIC_SCHEMA_VERSION,
      updatedAtMs: -1,
      sourceEventCount: 0,
      payload: derivedPayloadFixtures[DERIVED_METRIC_KINDS.Form],
    }).success).toBe(false);
    expect(registry.get_today_readiness.safeParse({
      asOfTimeMs: DAY_MS,
      timeZone: 'Europe/Helsinki',
      localDayStartTimeMs: DAY_MS,
      localDayEndTimeMs: NEXT_DAY_MS - 1,
      dayBoundary: 'UTC',
      asOfDayMs: DAY_MS,
      formulaVersion: 3,
      status: 'no_signal',
      score: null,
      label: null,
      confidence: null,
      availableSignalCount: 0,
      availableWeightPercent: 0,
      baselineEvidenceCount: 0,
      totalSignalCount: 4,
      drivers: {
        load: {
          status: 'not_ready',
          weightPercent: 40,
          form: null,
          rampRate: null,
          asOfDayMs: null,
          sourceUpdatedAtMs: null,
        },
        sleep: {
          status: 'no_recent_session',
          weightPercent: 25,
          score: null,
          scoreSource: null,
          latestSleepAtMs: null,
          sleepDate: null,
          durationSeconds: null,
          recordedScore: null,
        },
        hrv: {
          status: 'not_recorded',
          weightPercent: 20,
          latestMs: null,
          baselineMedianMs: null,
          baselineNightCount: 0,
          ratio: null,
        },
        overnightHeartRate: {
          status: 'not_recorded',
          weightPercent: 15,
          combinedRatio: null,
          average: {
            status: 'not_recorded',
            latestBpm: null,
            baselineMedianBpm: null,
            baselineNightCount: 0,
            ratio: null,
          },
          minimum: {
            status: 'not_recorded',
            latestBpm: null,
            baselineMedianBpm: null,
            baselineNightCount: 0,
            ratio: null,
          },
        },
      },
    }).success).toBe(true);
    expect(registry.get_daily_briefing.safeParse({
      asOfTimeMs: DAY_MS,
      timeZone: 'Europe/Helsinki',
      localDayStartTimeMs: DAY_MS,
      localDayEndTimeMs: NEXT_DAY_MS - 1,
      sleep: {
        status: 'available',
        latestSession: null,
        comparison: {
          sameProviderNightCount: 0,
          averageDurationSeconds: null,
          durationDeltaSeconds: null,
        },
      },
      trainingReadiness: {
        status: 'not_ready',
        dayBoundary: 'UTC',
        asOfDayMs: null,
        generatedAtMs: null,
        updatedAtMs: null,
        score: null,
        label: null,
        confidence: null,
        availableSignalCount: null,
        baselineEvidenceCount: null,
      },
      trainingSummary: {
        status: 'not_ready',
        dayBoundary: 'UTC',
        asOfDayMs: null,
        updatedAtMs: null,
        baselineSourceWindowDays: null,
        current28d: null,
        usual28d: null,
        disciplines: [],
      },
    }).success).toBe(false);
    expect(registry.get_daily_briefing.safeParse({
      asOfTimeMs: DAY_MS,
      timeZone: 'Europe/Helsinki',
      localDayStartTimeMs: DAY_MS,
      localDayEndTimeMs: NEXT_DAY_MS - 1,
      sleep: {
        status: 'no_completed_session',
        latestSession: null,
        comparison: {
          sameProviderNightCount: 0,
          averageDurationSeconds: null,
          durationDeltaSeconds: null,
        },
      },
      trainingReadiness: {
        status: 'stale',
        dayBoundary: 'UTC',
        asOfDayMs: DAY_MS,
        generatedAtMs: DAY_MS,
        updatedAtMs: DAY_MS,
        score: 76,
        label: 'Ready',
        confidence: 'high',
        availableSignalCount: 4,
        baselineEvidenceCount: 14,
      },
      trainingSummary: {
        status: 'not_ready',
        dayBoundary: 'UTC',
        asOfDayMs: null,
        updatedAtMs: null,
        baselineSourceWindowDays: null,
        current28d: null,
        usual28d: null,
        disciplines: [],
      },
    }).success).toBe(false);
  });

  it('rejects daily-briefing Training totals that disagree with the discipline breakdown', async () => {
    const registry = createMcpOutputSchemaRegistry({
      activityLocation: true,
      routeLocation: true,
    });
    const fixture = await createFixtureDataService().getDailyBriefing({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });
    if (fixture.trainingSummary.current28d === null) {
      throw new Error('The daily-briefing fixture must include a Training Summary.');
    }

    expect(registry.get_daily_briefing.safeParse({
      ...fixture,
      trainingSummary: {
        ...fixture.trainingSummary,
        current28d: {
          ...fixture.trainingSummary.current28d,
          durationSeconds: fixture.trainingSummary.current28d.durationSeconds + 1,
        },
      },
    }).success).toBe(false);
  });

  it('keeps the daily report sleep-vital allowlist strict and its availability states consistent', async () => {
    const registry = createMcpOutputSchemaRegistry({
      activityLocation: true,
      routeLocation: true,
    });
    const fixture = await createFixtureDataService().getDailyReport({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });

    expect(registry.get_daily_report.safeParse(fixture).success).toBe(true);
    expect(registry.get_daily_report.safeParse({
      ...fixture,
      sleep: {
        ...fixture.sleep,
        latestSession: fixture.sleep.latestSession
          ? {
              ...fixture.sleep.latestSession,
              vitals: {
                ...fixture.sleep.latestSession.vitals,
                maxSpo2Percent: 99,
              },
            }
          : null,
      },
    }).success).toBe(false);
    expect(registry.get_daily_report.safeParse({
      ...fixture,
      sleep: {
        ...fixture.sleep,
        latestSession: null,
      },
    }).success).toBe(false);
    expect(registry.get_daily_report.safeParse({
      ...fixture,
      sleep: {
        status: 'no_completed_session',
        latestSession: null,
        comparison: {
          sameProviderNightCount: 5,
          averageDurationSeconds: 27_600,
          durationDeltaSeconds: null,
        },
      },
    }).success).toBe(false);
    expect(registry.get_daily_report.safeParse({
      ...fixture,
      sleep: {
        ...fixture.sleep,
        comparison: {
          sameProviderNightCount: 2,
          averageDurationSeconds: 27_600,
          durationDeltaSeconds: 1_200,
        },
      },
    }).success).toBe(false);
  });

  it('rejects impossible live-readiness baseline and combined-heart-rate states', async () => {
    const registry = createMcpOutputSchemaRegistry({
      activityLocation: true,
      routeLocation: true,
    });
    const fixture = await createFixtureDataService().getTodayReadiness({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });
    const current = await createFixtureDataService().getCurrentReadiness({ uid: 'user-1', timeZone: 'Europe/Helsinki' });
    expect(registry.get_current_readiness.safeParse({ ...current, drivers: { ...current.drivers,
      hrv: { ...current.drivers.hrv, personalRange: { ...current.drivers.hrv.personalRange,
        latestAtMs: current.asOfTimeMs - 8 * 86400000 } } } }).success).toBe(false);

    expect(registry.get_today_readiness.safeParse({
      ...fixture,
      drivers: {
        ...fixture.drivers,
        hrv: {
          ...fixture.drivers.hrv,
          status: 'insufficient_baseline',
          baselineMedianMs: 50,
          baselineNightCount: 0,
          ratio: null,
        },
      },
    }).success).toBe(false);

    expect(registry.get_today_readiness.safeParse({
      ...fixture,
      availableSignalCount: 3,
      availableWeightPercent: 85,
      drivers: {
        ...fixture.drivers,
        overnightHeartRate: {
          ...fixture.drivers.overnightHeartRate,
          status: 'insufficient_baseline',
          combinedRatio: null,
        },
      },
    }).success).toBe(false);
  });

  it('advertises strict schemas and validates every successful tool call', async () => {
    const dataService = createFixtureDataService();
    const connection = await connectFixtureServer(dataService);
    connections.push(connection);
    const tools = (await connection.client.listTools()).tools;
    expect(tools.map(tool => tool.name).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort(),
    );
    expect(tools.every(tool => Boolean(tool.outputSchema))).toBe(true);
    const healthTools = tools.filter(tool => ['list_health_metrics', 'query_health_metric', 'get_hrv_personal_range'].includes(tool.name));
    const noteTools = tools.filter(tool => ['query_timeline_notes', 'get_activity_description'].includes(tool.name));
    expect(Buffer.byteLength(JSON.stringify(noteTools), 'utf8')).toBeLessThan(8 * 1024);
    // Keep the frozen surface's budget; each additive family has its own explicit bound.
    const planTools = tools.filter(tool => (TRAINING_READ_TOOLS as readonly string[]).includes(tool.name));
    const planReadExtensions = planTools.filter(tool => (TRAINING_READ_EXTENSION_TOOLS as readonly string[]).includes(tool.name));
    const planReadCore = planTools.filter(tool => !(TRAINING_READ_EXTENSION_TOOLS as readonly string[]).includes(tool.name));
    expect(Buffer.byteLength(JSON.stringify(planReadCore), 'utf8')).toBeLessThan(32 * 1024);
    expect(Buffer.byteLength(JSON.stringify(planReadExtensions), 'utf8')).toBeLessThan(12 * 1024);
    const planWriteTools = tools.filter(tool => (TRAINING_WRITE_TOOLS as readonly string[]).includes(tool.name));
    expect(Buffer.byteLength(JSON.stringify(planWriteTools), 'utf8')).toBeLessThan(48 * 1024);
    const applyTrainingChangesTool = tools.find(tool => tool.name === 'apply_training_changes');
    expect(applyTrainingChangesTool?.title).toBe('Apply previewed Training changes');
    expect(applyTrainingChangesTool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    const sampleTools = tools.filter(tool => tool.name === 'get_activity_samples');
    const readinessTools = tools.filter(tool => ['get_current_readiness', 'get_readiness_history', 'get_daily_report'].includes(tool.name));
    expect(Buffer.byteLength(JSON.stringify(readinessTools), 'utf8')).toBeLessThan(32 * 1024);
    expect(Buffer.byteLength(JSON.stringify(sampleTools), 'utf8')).toBeLessThan(12 * 1024);
    expect(Buffer.byteLength(JSON.stringify(healthTools), 'utf8')).toBeLessThan(24 * 1024);
    expect(Buffer.byteLength(JSON.stringify(tools.filter(tool => !planTools.includes(tool) && !planWriteTools.includes(tool)
      && !healthTools.includes(tool) && !noteTools.includes(tool) && !sampleTools.includes(tool)
      && !readinessTools.includes(tool))), 'utf8'))
      .toBeLessThan(256 * 1024);
    collectObjectSchemas(tools.map(tool => tool.outputSchema))
      .forEach(schema => expect(schema.additionalProperties).toBe(false));

    const trainingSchema = tools.find(
      tool => tool.name === 'get_training_metric',
    )!.outputSchema as Record<string, unknown>;
    expect(trainingSchema).toMatchObject({
      properties: {
        payload: {
          $ref: '#/definitions/McpDerivedPayload',
        },
      },
      allOf: expect.arrayContaining([
        expect.objectContaining({
          if: {
            properties: {
              metricKind: {
                const: DERIVED_METRIC_KINDS.Form,
              },
            },
            required: ['metricKind'],
          },
        }),
      ]),
    });
    expect((trainingSchema.allOf as unknown[]).length).toBe(
      Object.values(DERIVED_METRIC_KINDS).length,
    );

    const ajv = createAjv();
    const validators = new Map(tools.map(tool => [
      tool.name,
      ajv.compile(tool.outputSchema as AnySchema),
    ]));
    const trainingValidator = validators.get('get_training_metric')!;
    expect(trainingValidator({
      metricKind: DERIVED_METRIC_KINDS.Form,
      schemaVersion: MCP_TRAINING_METRIC_SCHEMA_VERSION,
      updatedAtMs: DAY_MS,
      sourceEventCount: 0,
      payload: derivedPayloadFixtures[DERIVED_METRIC_KINDS.BodyWeightTrend],
    })).toBe(false);

    const healthFixture = await dataService.queryHealthMetric({
      uid: 'user-1', metricId: 'heart_rate', startDate: '2026-07-01', endDate: '2026-07-02',
      mode: 'summaries', maxPoints: 200, measurementsAllowed: false,
    });
    expect(validators.get('query_health_metric')!({
      ...healthFixture,
      metric: getMcpHealthCatalog().metrics.find(metric => metric.id === 'body_fat'),
    })).toBe(false); // Body composition must not expose otherwise-valid source series.

    for (const toolName of PUBLIC_MCP_TOOL_NAMES) {
      const result = await connection.client.callTool({
        name: toolName,
        arguments: successfulToolArguments[toolName],
      });
      expect(result.isError, toolName).not.toBe(true);
      expect(result.structuredContent, toolName).toBeDefined();
      const validator = validators.get(toolName)!;
      expect(
        validator(result.structuredContent),
        `${toolName}: ${JSON.stringify(validator.errors)}`,
      ).toBe(true);
      const text = result.content.find(content => content.type === 'text');
      expect(text?.type).toBe('text');
      if (text?.type === 'text') {
        expect(JSON.parse(text.text)).toEqual(result.structuredContent);
      }
    }
    expect(dataService.listActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        startTimeMs: undefined,
        endTimeMs: undefined,
        activityTypes: ['Running'],
        limit: 1,
      }),
    );
    expect(dataService.queryActivitiesWithTags).toHaveBeenCalledWith(
      expect.objectContaining({
        startTimeMs: undefined,
        endTimeMs: undefined,
        activityTypes: ['Running'],
        tags: ['Race'],
        tagMatch: 'all',
        limit: 1,
      }),
    );
    await connection.client.callTool({
      name: 'list_activities',
      arguments: {
        relativePeriod: 'today',
        timeZone: 'Europe/Helsinki',
        limit: 1,
      },
    });
    expect(dataService.listActivities).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startTimeMs: undefined,
        endTimeMs: undefined,
        relativePeriod: 'today',
        timeZone: 'Europe/Helsinki',
        limit: 1,
      }),
    );
    expect(dataService.listRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        activityTypes: ['Running'],
        search: 'ridge',
      }),
    );

    const distanceChart = await connection.client.callTool({
      name: 'get_activity_chart_data',
      arguments: {
        activityRef: ACTIVITY_REF,
        metrics: ['heart_rate'],
        xAxis: 'distance',
        includeLocation: false,
      },
    });
    expect(distanceChart.structuredContent).toMatchObject({
      xAxis: 'distance',
      xAxisUnit: 'meters',
    });

    for (const metricKind of Object.values(DERIVED_METRIC_KINDS)) {
      const result = await connection.client.callTool({
        name: 'get_training_metric',
        arguments: { metricKind },
      });
      expect(result.isError, metricKind).not.toBe(true);
      expect(
        validators.get('get_training_metric')!(result.structuredContent),
        `${metricKind}: ${JSON.stringify(
          validators.get('get_training_metric')!.errors,
        )}`,
      ).toBe(true);
    }
  }, 30_000);

  it('rejects private Health ordering fields and arbitrary categorical values at the output boundary', async () => {
    const dataService = createFixtureDataService();
    const fixture = await dataService.queryHealthMetric({
      uid: 'user-1', metricId: 'heart_rate', startDate: '2026-07-01', endDate: '2026-07-02',
      mode: 'summaries', maxPoints: 200, measurementsAllowed: false,
    });
    const connection = await connectFixtureServer(dataService, [MCP_OAUTH_SCOPES.HealthRead]);
    connections.push(connection);
    for (const privatePoint of [
      { endTimeMs: 1_788_220_800_001 }, { observedAtMs: 1_788_220_800_001 }, { value: 'private-category-canary' },
    ]) {
      dataService.queryHealthMetric = vi.fn().mockResolvedValue({
        ...fixture, series: [{ ...fixture.series[0], points: [{ ...fixture.series[0].points[0], ...privatePoint }] }],
      });
      const result = await connection.client.callTool({
        name: 'query_health_metric', arguments: successfulToolArguments.query_health_metric,
      });
      expect(result.isError).toBe(true);
      expect(result).not.toHaveProperty('structuredContent');
      expect(JSON.stringify(result)).not.toMatch(/1788220800001|private-category-canary|endTimeMs|observedAtMs/);
    }
  });

  it('requires both readiness grants and rejects private current/history evidence on every transport', async () => {
    for (const scopes of [[], [MCP_OAUTH_SCOPES.MetricsRead], [MCP_OAUTH_SCOPES.SleepRead]]) {
      const connection = await connectFixtureServer(createFixtureDataService(), scopes);
      connections.push(connection);
      const names = (await connection.client.listTools()).tools.map(tool => tool.name);
      expect(names).not.toContain('get_current_readiness');
      expect(names).not.toContain('get_readiness_history');
    }
    const service = createFixtureDataService();
    const withoutHealth = await connectFixtureServer(service, [MCP_OAUTH_SCOPES.MetricsRead, MCP_OAUTH_SCOPES.SleepRead]);
    connections.push(withoutHealth);
    const names = (await withoutHealth.client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain('get_current_readiness');
    expect(names).not.toContain('get_readiness_history');
    const scopes = [MCP_OAUTH_SCOPES.MetricsRead, MCP_OAUTH_SCOPES.SleepRead, MCP_OAUTH_SCOPES.HealthRead];
    const connection = await connectFixtureServer(service, scopes);
    connections.push(connection);
    const current = await service.getCurrentReadiness({ uid: 'user-1', timeZone: 'Europe/Helsinki' });
    const history = await service.getReadinessHistory({ uid: 'user-1', scopes });
    for (const field of ['sourceKey', 'providerUserId', 'rawSamples']) {
      service.getCurrentReadiness = vi.fn().mockResolvedValue({ ...current, drivers: { ...current.drivers,
        hrv: { ...current.drivers.hrv, personalRange: { ...current.drivers.hrv.personalRange, [field]: 'private-range-canary' } } } });
      service.getReadinessHistory = vi.fn().mockResolvedValue({ ...history,
        points: history.points.map(point => ({ ...point,
          hrvPersonalRange: { ...point.hrvPersonalRange, [field]: 'private-range-canary' } })) });
      for (const name of ['get_current_readiness', 'get_readiness_history'] as const) {
        const result = await connection.client.callTool({ name, arguments: successfulToolArguments[name] });
        expect(result.isError).toBe(true);
        expect(result).not.toHaveProperty('structuredContent');
        expect(JSON.stringify(result)).not.toContain('private-range-canary');
      }
    }
  });

  it('requires both HRV grants and rejects private HRV output on every transport', async () => {
    for (const scopes of [[], [MCP_OAUTH_SCOPES.HealthRead], [MCP_OAUTH_SCOPES.SleepRead]]) {
      const connection = await connectFixtureServer(createFixtureDataService(), scopes);
      connections.push(connection);
      expect((await connection.client.listTools()).tools.map(tool => tool.name)).not.toContain('get_hrv_personal_range');
    }
    const service = createFixtureDataService();
    const connection = await connectFixtureServer(service, [MCP_OAUTH_SCOPES.HealthRead, MCP_OAUTH_SCOPES.SleepRead]);
    connections.push(connection);
    await connection.client.callTool({ name: 'get_hrv_personal_range', arguments: {
      ...successfulToolArguments.get_hrv_personal_range, uid: 'attacker', scopes: [],
    } });
    expect(service.getHrvPersonalRange).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1',
      scopes: [MCP_OAUTH_SCOPES.HealthRead, MCP_OAUTH_SCOPES.SleepRead] }));
    const fixture = await service.getHrvPersonalRange({ uid: 'user-1', scopes: [], startTimeMs: 0, endTimeMs: DAY_MS });
    service.getHrvPersonalRange = vi.fn().mockResolvedValue({ ...fixture, series: [] });
    const empty = await connection.client.callTool({ name: 'get_hrv_personal_range', arguments: successfulToolArguments.get_hrv_personal_range });
    expect(empty.structuredContent).toMatchObject({ series: [] });
    service.getHrvPersonalRange = vi.fn().mockResolvedValue({ ...fixture,
      series: [{ ...fixture.series[0], providerAccountId: 'private-hrv-canary' }] });
    const nested = await connection.client.callTool({ name: 'get_hrv_personal_range', arguments: successfulToolArguments.get_hrv_personal_range });
    expect(nested.isError).toBe(true);
    expect(JSON.stringify(nested)).not.toContain('private-hrv-canary');
    service.getHrvPersonalRange = vi.fn().mockResolvedValue({ sourceKey: 'private-hrv-canary' });
    const rejected = await connection.client.callTool({ name: 'get_hrv_personal_range', arguments: successfulToolArguments.get_hrv_personal_range });
    expect(rejected.isError).toBe(true);
    expect(rejected).not.toHaveProperty('structuredContent');
    expect(JSON.stringify(rejected)).not.toContain('private-hrv-canary');
  });

  it('bounds both serialized copies of private description text on every transport', async () => {
    const service = createFixtureDataService();
    const connection = await connectFixtureServer(service, [
      MCP_OAUTH_SCOPES.ActivityDetailsRead, MCP_OAUTH_SCOPES.ActivityDescriptionsRead,
    ]);
    connections.push(connection);
    const args = successfulToolArguments.get_activity_description;
    for (const description of ['x'.repeat(65_536), '\u0000'.repeat(11_000)]) {
      const projection = { activityRef: args.activityRef, description };
      // Both pass the original projection-only byte check, including the escaped-text case.
      expect(Buffer.byteLength(JSON.stringify(projection), 'utf8')).toBeLessThan(128 * 1024);
      service.getActivityDescription = vi.fn().mockResolvedValue(projection);
      const result = await connection.client.callTool({ name: 'get_activity_description', arguments: args });
      expect(result.isError).toBe(true);
      expect(result).not.toHaveProperty('structuredContent');
      expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ error: 'query_too_large' });
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(128 * 1024);
    }
    const description = 'private-description-canary\n'.repeat(1_000);
    service.getActivityDescription = vi.fn().mockResolvedValue({ activityRef: args.activityRef, description });
    const result = await connection.client.callTool({ name: 'get_activity_description', arguments: args });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ activityRef: args.activityRef, description });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(128 * 1024);
  });

  it('bounds both sample result copies even when an injected page fits its schema and projection budget', async () => {
    const service = createFixtureDataService();
    const connection = await connectFixtureServer(service, [MCP_OAUTH_SCOPES.ActivityDetailsRead]); connections.push(connection);
    const length = 6000;
    const projection = {
      activityType: 'Running', sampling: 'all_available', timeUnit: 'seconds', sampleIntervalSeconds: 1,
      range: {startOffsetSeconds: 0, endOffsetSeconds: length, totalSampleCount: length},
      page: {startOffsetSeconds: 0, endOffsetSeconds: length, returnedSampleCount: length},
      elapsedTimeSeconds: Array.from({length}, (_, i) => i),
      series: [{metric: 'heart_rate', canonicalUnit: 'beats_per_minute', sourceSampleCount: length, missingSampleCount: 0, values: Array(length).fill((Math.PI * 1e100))}],
      nextCursor: null,
    };
    expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThan(256 * 1024);
    service.getActivitySamples = vi.fn().mockResolvedValue(projection);
    const result = await connection.client.callTool({name: 'get_activity_samples', arguments: successfulToolArguments.get_activity_samples});
    expect(result.isError).toBe(true); expect(result).not.toHaveProperty('structuredContent');
    expect(JSON.parse((result.content[0] as {text: string}).text).error).toBe('query_too_large');
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(256 * 1024);
  });

  it('bounds both serialized copies of tagged activity results', async () => {
    const service = createFixtureDataService();
    const connection = await connectFixtureServer(service, [
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
    ]);
    connections.push(connection);
    const activity = {
      ...activitySummaryRedacted,
      activityRef: 'r'.repeat(512),
      appUrl: `https://example.com/${'x'.repeat(2_000)}`,
      tags: Array.from({ length: 10 }, (_, index) => (
        `${index}`.padEnd(32, 't')
      )),
    };
    service.queryActivitiesWithTags = vi.fn().mockResolvedValue({
      scannedActivityCount: 100,
      skippedActivityCount: 0,
      activities: Array.from({ length: 100 }, () => activity),
      nextCursor: null,
      scanComplete: true,
    });

    const result = await connection.client.callTool({
      name: 'query_activities_with_tags',
      arguments: successfulToolArguments.query_activities_with_tags,
    });

    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty('structuredContent');
    expect(JSON.parse((result.content[0] as { text: string }).text))
      .toMatchObject({ error: 'query_too_large' });
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8'))
      .toBeLessThan(256 * 1024);
  });

  it('uses Activity details alone for samples and rejects private or inconsistent pages on every transport', async () => {
    const service = createFixtureDataService();
    for (const scopes of [[], [MCP_OAUTH_SCOPES.MetricsRead], [MCP_OAUTH_SCOPES.ActivityLocationRead]]) {
      const denied = await connectFixtureServer(service, scopes); connections.push(denied);
      expect((await denied.client.listTools()).tools.map(tool => tool.name)).not.toContain('get_activity_samples');
    }
    const connection = await connectFixtureServer(service, [MCP_OAUTH_SCOPES.ActivityDetailsRead]); connections.push(connection);
    const args = successfulToolArguments.get_activity_samples;
    for (const injected of [{uid: 'attacker'}, {scopes: []}, {connectionId: 'attacker'}, {includeLocation: true}]) {
      const result = await connection.client.callTool({name: 'get_activity_samples', arguments: {...args, ...injected}});
      expect(result.isError).toBe(true); expect(service.getActivitySamples).not.toHaveBeenCalled();
    }
    const fixture = await service.getActivitySamples({uid: 'user-1', connectionId: 'connection-1', scopes: ['activity-details:read'], activityRef: ACTIVITY_REF, metrics: ['heart_rate']});
    const first = await connection.client.callTool({name: 'get_activity_samples', arguments: args});
    expect(first.isError).not.toBe(true);
    expect(service.getActivitySamples).toHaveBeenLastCalledWith({...args, uid: 'user-1', connectionId: 'connection-1', scopes: ['activity-details:read'], startOffsetSeconds: 0, limit: 2000});
    for (const field of ['eventID', 'name', 'creator', 'sourceKey', 'originalFile', 'latitudeDegrees', 'startTimeMs']) {
      for (const projection of [{...fixture, [field]: 'private-samples-canary'},
        {...fixture, series: [{...fixture.series[0], [field]: 'private-samples-canary'}]},
        {...fixture, page: {...fixture.page, [field]: 'private-samples-canary'}}]) {
        service.getActivitySamples = vi.fn().mockResolvedValue(projection);
        const result = await connection.client.callTool({name: 'get_activity_samples', arguments: args});
        expect(result.isError, field).toBe(true); expect(result).not.toHaveProperty('structuredContent');
        expect(JSON.stringify(result)).not.toContain('private-samples-canary');
      }
    }
    for (const projection of [
      {...fixture, elapsedTimeSeconds: [0, 2]}, {...fixture, nextCursor: null},
      {...fixture, series: [{...fixture.series[0], values: [1]}]},
      {...fixture, series: [{...fixture.series[0], missingSampleCount: 0}]},
      {...fixture, series: [{...fixture.series[0], canonicalUnit: 'watts'}]},
    ]) {
      service.getActivitySamples = vi.fn().mockResolvedValue(projection);
      expect((await connection.client.callTool({name: 'get_activity_samples', arguments: args})).isError).toBe(true);
    }
    for (const projection of [
      {...fixture, range: {startOffsetSeconds: 0, endOffsetSeconds: 2, totalSampleCount: 2}, nextCursor: null},
      {...fixture, range: {startOffsetSeconds: 0, endOffsetSeconds: 0, totalSampleCount: 0}, page: {startOffsetSeconds: 0, endOffsetSeconds: 0, returnedSampleCount: 0}, elapsedTimeSeconds: [], series: [{...fixture.series[0], sourceSampleCount: 0, missingSampleCount: 0, values: []}], nextCursor: null},
    ]) {
      service.getActivitySamples = vi.fn().mockResolvedValue(projection);
      const result = await connection.client.callTool({name: 'get_activity_samples', arguments: args});
      expect(result.isError).not.toBe(true); expect(result.structuredContent).toEqual(projection);
    }
  });

  it('isolates Training permission and rejects injected identity or private output on every transport', async () => {
    const service = createFixtureDataService();
    const denied = await connectFixtureServer(service, [MCP_OAUTH_SCOPES.MetricsRead, MCP_OAUTH_SCOPES.TimelineNotesRead]); connections.push(denied);
    expect((await denied.client.listTools()).tools.map(tool => tool.name).filter(name => (TRAINING_READ_TOOLS as readonly string[]).includes(name))).toEqual([]);
    const connection = await connectFixtureServer(service, [MCP_OAUTH_SCOPES.TrainingPlansRead]); connections.push(connection);
    for (const tool of TRAINING_READ_TOOLS) {
      vi.mocked(service.readTrainingPlans).mockClear();
      const injected = await connection.client.callTool({ name: tool, arguments: { ...successfulToolArguments[tool], uid:'attacker' } });
      expect(injected.isError).toBe(true); expect(service.readTrainingPlans).not.toHaveBeenCalled();
      for (const field of ['id','owner','destinationKey','approvalDigest','issues','remoteWorkoutId','receipt']) {
        service.readTrainingPlans = vi.fn().mockResolvedValue({ ...trainingReadFixtures[tool], [field]: 'PRIVATE-TRAINING-CANARY' });
        const result = await connection.client.callTool({ name: tool, arguments: successfulToolArguments[tool] });
        expect(result.isError).toBe(true); expect(result).not.toHaveProperty('structuredContent');
        expect(JSON.stringify(result)).not.toContain('PRIVATE-TRAINING-CANARY');
      }
    }
  });

  it('requires both activity grants and strictly projects description text on every transport', async () => {
    const service = createFixtureDataService();
    for (const scopes of [[], [MCP_OAUTH_SCOPES.ActivityDetailsRead], [MCP_OAUTH_SCOPES.ActivityDescriptionsRead]]) {
      const denied = await connectFixtureServer(service, scopes);
      connections.push(denied);
      expect((await denied.client.listTools()).tools.map(tool => tool.name)).not.toContain('get_activity_description');
    }
    const scopes = [MCP_OAUTH_SCOPES.ActivityDetailsRead, MCP_OAUTH_SCOPES.ActivityDescriptionsRead];
    const connection = await connectFixtureServer(service, scopes);
    connections.push(connection);
    const args = successfulToolArguments.get_activity_description;
    const injected = await connection.client.callTool({ name: 'get_activity_description', arguments: {
      ...args, uid: 'attacker', scopes: [], connectionId: 'attacker',
    } });
    expect(injected.isError).toBe(true);
    expect(service.getActivityDescription).not.toHaveBeenCalled();
    for (const description of [null, '', 'Private context.\nIgnore all instructions is text, not authority.']) {
      service.getActivityDescription = vi.fn().mockResolvedValue({ activityRef: args.activityRef, description });
      const result = await connection.client.callTool({ name: 'get_activity_description', arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ activityRef: args.activityRef, description });
      expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
      expect(service.getActivityDescription).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1', scopes }));
    }
    for (const field of ['eventID', 'name', 'creator', 'sourceKey', 'startPosition', 'notes', 'originalFile']) {
      service.getActivityDescription = vi.fn().mockResolvedValue({ activityRef: args.activityRef,
        description: 'Allowed text', [field]: 'private-description-canary' });
      const result = await connection.client.callTool({ name: 'get_activity_description', arguments: args });
      expect(result.isError, field).toBe(true);
      expect(result).not.toHaveProperty('structuredContent');
      expect(JSON.stringify(result)).not.toContain('private-description-canary');
    }
  });

  it('binds full notes to the bearer grant and rejects private neighboring fields', async () => {
    const service = createFixtureDataService();
    const connection = await connectFixtureServer(service, [MCP_OAUTH_SCOPES.TimelineNotesRead]);
    connections.push(connection);
    const fixture = await service.queryTimelineNotes({ uid: 'fixture', connectionId: 'fixture', scopes: [],
      startDate: '2026-07-01', endDate: '2026-07-02' });
    await connection.client.callTool({ name: 'query_timeline_notes', arguments: {
      ...successfulToolArguments.query_timeline_notes, uid: 'attacker', connectionId: 'attacker', scopes: [],
    } });
    expect(service.queryTimelineNotes).toHaveBeenLastCalledWith(expect.objectContaining({
      uid: 'user-1', scopes: [MCP_OAUTH_SCOPES.TimelineNotesRead], limit: 32,
    }));
    for (const field of ['id', 'revision', 'createdAtMs', 'updatedAtMs', 'color', 'showOnCharts', 'receipt', 'providerAccountId']) {
      service.queryTimelineNotes = vi.fn().mockResolvedValue({ ...fixture,
        notes: [{ ...fixture.notes[0], [field]: 'private-note-secret' }],
      });
      const result = await connection.client.callTool({ name: 'query_timeline_notes', arguments: successfulToolArguments.query_timeline_notes });
      expect(result.isError, field).toBe(true);
      expect(result).not.toHaveProperty('structuredContent');
      expect(JSON.stringify(result)).not.toContain('private-note-secret');
    }
    service.queryTimelineNotes = vi.fn().mockResolvedValue({ ...fixture, notes: [], scanComplete: false,
      recordsScanned: 512, skippedRecords: 512, limitsReached: ['records'], nextCursor: 'opaque-cursor' });
    const page = await connection.client.callTool({ name: 'query_timeline_notes', arguments: successfulToolArguments.query_timeline_notes });
    expect(page.isError).not.toBe(true);
    expect(page.structuredContent).toMatchObject({ scanComplete: false, nextCursor: 'opaque-cursor' });
  });

  it('binds Health reads to bearer identity and grants rather than client-supplied arguments', async () => {
    const dataService = createFixtureDataService();
    const connection = await connectFixtureServer(dataService, [MCP_OAUTH_SCOPES.HealthRead]);
    connections.push(connection);
    const result = await connection.client.callTool({
      name: 'query_health_metric',
      arguments: { ...successfulToolArguments.query_health_metric, uid: 'private-other-user', measurementsAllowed: true },
    });
    expect(result.isError).not.toBe(true);
    expect(dataService.queryHealthMetric).toHaveBeenCalledWith({
      uid: 'user-1', metricId: 'heart_rate', startDate: '2026-07-01', endDate: '2026-07-02',
      mode: 'summaries', maxPoints: 200, measurementsAllowed: false,
    });
    expect(JSON.stringify(result)).not.toContain('private-other-user');
  });

  it('covers empty results, terminal pagination, and nullable summaries', () => {
    const registry = createMcpOutputSchemaRegistry({
      activityLocation: false,
      routeLocation: false,
    });
    const emptyMeasurementResult = {
      measurementType: {
        id: 'body_weight',
        displayName: 'Body weight',
        description: 'Recorded body weight.',
        canonicalMetric: {
          type: 'Weight',
          displayType: 'Weight',
          unit: 'kg',
          unitSystem: 'metric',
        },
        defaultAggregation: 'median',
        supportedAggregations: ['median'],
        defaultInterval: 'day',
        supportedIntervals: ['day'],
        maximumRangeDays: 366,
        requiresExplicitIanaTimeZone: true,
        currentTrend: {
          tool: 'get_training_metric',
          metricKind: 'body_weight_trend',
          requiredScope: 'metrics:read',
          windowDays: 28,
          dayBoundaryTimeZone: 'UTC',
          readiness: 'ready_snapshot_required',
        },
      },
      startTimeMs: DAY_MS,
      endTimeMs: NEXT_DAY_MS,
      timeZone: 'UTC',
      aggregation: 'median',
      interval: 'day',
      measurementCount: 0,
      points: [],
      summary: null,
    };
    expect(registry.query_measurements.safeParse(
      emptyMeasurementResult,
    ).success).toBe(true);
    expect(registry.query_measurements.safeParse({
      ...emptyMeasurementResult,
      startTimeMs: PRE_EPOCH_DAY_MS,
      endTimeMs: PRE_EPOCH_DAY_MS + 86_400_000,
    }).success).toBe(true);
    expect(registry.list_activity_swim_lengths.safeParse({
      items: [],
      nextCursor: null,
    }).success).toBe(true);
    expect(registry.list_activities.safeParse({
      scannedActivityCount: 0,
      skippedActivityCount: 0,
      activities: [],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(true);
    expect(registry.list_routes.safeParse({
      scannedRouteCount: 0,
      skippedRouteCount: 0,
      routes: [],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(true);
  });

  it('canonicalizes optional undefined values identically in both success forms', async () => {
    const dataService = createFixtureDataService();
    dataService.queryMetric = vi.fn().mockResolvedValue({
      metric: metricDescriptor,
      matchedEventCount: 1,
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        resolvedTimeInterval: TimeIntervals.Daily,
        buckets: [{
          bucketKey: DAY_MS,
          time: undefined,
          totalCount: 1,
          aggregateValue: 10_000,
          seriesValues: { Running: 10_000 },
          seriesCounts: { Running: 1 },
        }],
      },
    });
    const connection = await connectFixtureServer(
      dataService,
      [MCP_OAUTH_SCOPES.MetricsRead],
    );
    connections.push(connection);

    const result = await connection.client.callTool({
      name: 'query_metric',
      arguments: successfulToolArguments.query_metric,
    });

    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as {
      aggregation: { buckets: Array<Record<string, unknown>> };
    };
    expect(structured.aggregation.buckets[0]).not.toHaveProperty('time');
    const text = result.content.find(content => content.type === 'text');
    expect(text?.type).toBe('text');
    if (text?.type === 'text') {
      expect(JSON.parse(text.text)).toEqual(structured);
    }
  });

  it('keeps parent-only activity and route schemas free of location fields', async () => {
    const parentScopes = [
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.RoutesRead,
    ];
    const connection = await connectFixtureServer(
      createFixtureDataService({
        activityLocation: false,
        routeLocation: false,
      }),
      parentScopes,
    );
    connections.push(connection);
    const tools = (await connection.client.listTools()).tools;
    const advertised = Object.fromEntries(
      tools.map(tool => [tool.name, tool.outputSchema]),
    );
    expect(JSON.stringify(advertised.list_activities))
      .not.toContain('startPosition');
    expect(JSON.stringify(advertised.query_activities))
      .not.toContain('startPosition');
    expect(JSON.stringify(advertised.query_activities_with_tags))
      .not.toContain('startPosition');
    expect(JSON.stringify(advertised.list_activity_jumps))
      .not.toContain('latitudeDegrees');
    expect(JSON.stringify(advertised.list_routes)).not.toContain('bounds');
    expect(JSON.stringify(advertised.get_activity_chart_data))
      .not.toContain('location');

    for (const toolName of [
      'list_activities',
      'query_activities',
      'query_activities_with_tags',
      'list_activity_jumps',
      'get_activity_chart_data',
      'list_routes',
    ] as const) {
      const argumentsForTool = toolName === 'get_activity_chart_data'
        ? {
            ...successfulToolArguments[toolName],
            includeLocation: false,
          }
        : successfulToolArguments[toolName];
      const result = await connection.client.callTool({
        name: toolName,
        arguments: argumentsForTool,
      });
      expect(result.isError, toolName).not.toBe(true);
      expect(JSON.stringify(result.structuredContent))
        .not.toMatch(/latitudeDegrees|longitudeDegrees|startPosition|bounds/);
    }

    const parentRegistry = createMcpOutputSchemaRegistry({
      activityLocation: false,
      routeLocation: false,
    });
    expect(parentRegistry.list_activities.safeParse({
      scannedActivityCount: 1,
      skippedActivityCount: 0,
      activities: [activitySummaryWithLocation],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(false);
    expect(parentRegistry.list_activity_jumps.safeParse({
      items: [{
        index: 0,
        timestampMs: DAY_MS,
        distanceMeters: 2,
        heightMeters: null,
        hangTimeSeconds: null,
        speedMetersPerSecond: null,
        rotations: null,
        score: 60,
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.8537,
        locationRedacted: false,
      }],
      nextCursor: null,
    }).success).toBe(false);
    expect(parentRegistry.list_routes.safeParse({
      scannedRouteCount: 1,
      skippedRouteCount: 0,
      routes: [routeSummaryWithLocation],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(false);
    expect(parentRegistry.get_activity_chart_data.safeParse({
      activityType: 'Running',
      xAxis: 'elapsed_time',
      xAxisUnit: 'seconds',
      series: [],
      location: {
        xValues: [],
        latitudeDegrees: [],
        longitudeDegrees: [],
        sourceSampleCount: 0,
        returnedSampleCount: 0,
        missingSampleCount: 0,
      },
    }).success).toBe(false);
    expect(parentRegistry.find_activities_near_location.safeParse({
      location: {
        source: 'coordinates',
        resolvedLabel: null,
        ...coordinate,
        radiusMeters: 1_000,
      },
      scannedActivityCount: 0,
      skippedActivityCount: 0,
      activities: [],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(false);
    expect(parentRegistry.get_route_geometry.safeParse({
      geometry: {
        version: 1,
        encoding: 'polyline5',
        precision: 5,
        sourcePointCount: 0,
        pointCount: 0,
        bounds: null,
        segments: [],
      },
    }).success).toBe(false);

    const activityLocationOnlyRegistry = createMcpOutputSchemaRegistry({
      activityLocation: true,
      routeLocation: false,
    });
    expect(activityLocationOnlyRegistry.list_activities.safeParse({
      scannedActivityCount: 1,
      skippedActivityCount: 0,
      activities: [activitySummaryWithLocation],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(true);
    expect(activityLocationOnlyRegistry.list_routes.safeParse({
      scannedRouteCount: 1,
      skippedRouteCount: 0,
      routes: [routeSummaryWithLocation],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(false);

    const routeLocationOnlyRegistry = createMcpOutputSchemaRegistry({
      activityLocation: false,
      routeLocation: true,
    });
    expect(routeLocationOnlyRegistry.list_routes.safeParse({
      scannedRouteCount: 1,
      skippedRouteCount: 0,
      routes: [routeSummaryWithLocation],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(true);
    expect(routeLocationOnlyRegistry.list_activities.safeParse({
      scannedActivityCount: 1,
      skippedActivityCount: 0,
      activities: [activitySummaryWithLocation],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(false);
  });

  it('does not advertise private projection or provenance fields', async () => {
    const connection = await connectFixtureServer(createFixtureDataService());
    connections.push(connection);
    const tools = (await connection.client.listTools()).tools;
    const propertyNames = collectPropertyNames(
      tools.map(tool => tool.outputSchema),
    );
    // `id` is intentionally public for static measurement/Health metric catalogs;
    // opaque activity, event, route, and source IDs are not.
    expect(propertyNames.has('id')).toBe(true);
    for (const forbidden of [
      'eventId',
      'eventID',
      'activityId',
      'activityID',
      'sourceKey',
      'sourceActivityKey',
      'previousSourceKey',
      'sourceFingerprint',
      'originalFile',
      'originalFiles',
      'bucket',
      'generation',
      'path',
      'filePath',
      'storagePath',
      'providerUserId',
      'providerSessionId',
      'creator',
      'device',
      'deviceInfo',
      'serialNumber',
      'parserExtension',
      'srcFileType',
      'selectionKey',
    ]) {
      expect(propertyNames.has(forbidden), forbidden).toBe(false);
    }

    const registry = createMcpOutputSchemaRegistry({
      activityLocation: true,
      routeLocation: true,
    });
    expect(registry.list_activities.safeParse({
      scannedActivityCount: 1,
      skippedActivityCount: 0,
      activities: [{
        ...activitySummaryWithLocation,
        eventID: 'private-event-id',
        stats: {
          ...activityStats,
          sourceKey: 'private-source-key',
        },
      }],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(false);
    expect(registry.list_activity_types.safeParse({
      activityTypeCount: 1,
      activityTypes: [{
        activityType: 'Running',
        activityGroup: 'running_group',
        indoor: false,
        sourceKey: 'private-source-key',
      }],
    }).success).toBe(false);
    expect(registry.query_metrics.safeParse({
      results: [{
        metric: {
          ...metricDescriptor,
          sourceKey: 'private-source-key',
        },
        matchedEventCount: 1,
        aggregation: {
          dataType: 'Distance',
          valueType: ChartDataValueTypes.Total,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Daily,
          buckets: [],
        },
      }],
    }).success).toBe(false);
    const multiMetricOutput = {
      metric: metricDescriptor,
      matchedEventCount: 1,
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        resolvedTimeInterval: TimeIntervals.Daily,
        buckets: [],
      },
    };
    expect(registry.query_metrics.safeParse({
      results: [{
        ...multiMetricOutput,
        aggregation: {
          ...multiMetricOutput.aggregation,
          dataType: 'Ascent',
        },
      }],
    }).success).toBe(false);
    expect(registry.query_metrics.safeParse({
      results: [
        multiMetricOutput,
        multiMetricOutput,
      ],
    }).success).toBe(false);
    expect(registry.list_training_metrics.safeParse({
      metrics: [{
        metricKind: DERIVED_METRIC_KINDS.Form,
        title: 'Form',
        description: 'Training form.',
        category: 'load',
        periodLabel: 'Daily',
        status: 'ready',
        updatedAtMs: DAY_MS,
        sourceEventCount: 1,
        sourceFingerprint: 'private-source-fingerprint',
      }],
    }).success).toBe(false);
    const duplicateTrainingMetric = {
      metricKind: DERIVED_METRIC_KINDS.Form,
      title: 'Form',
      description: 'Training form.',
      category: 'load' as const,
      periodLabel: 'Daily',
      status: 'ready' as const,
      updatedAtMs: DAY_MS,
      sourceEventCount: 1,
    };
    expect(registry.list_training_metrics.safeParse({
      metrics: [
        duplicateTrainingMetric,
        duplicateTrainingMetric,
      ],
    }).success).toBe(false);
    expect(registry.get_activity_overview.safeParse({
      activityType: 'Running',
      locationRedacted: true,
      startPosition: coordinate,
      availableMetrics: [metricDescriptor],
      details: [
        { kind: 'laps', status: 'available', count: 1 },
        { kind: 'jumps', status: 'empty', count: 0 },
        { kind: 'swim_lengths', status: 'unavailable', count: null },
      ],
      chartData: {
        sourceDeclared: false,
        candidateMetrics: [],
      },
    }).success).toBe(false);
    expect(registry.rank_activities_by_metric.safeParse({
      metric: metricDescriptor,
      order: 'highest',
      scannedActivityCount: 1,
      matchedActivityCount: 1,
      activities: [{
        rank: 1,
        activityRef: ACTIVITY_REF,
        startTime: new Date(DAY_MS).toISOString(),
        activityType: 'Running',
        value: 10_000,
        eventID: 'private-event-id',
      }],
    }).success).toBe(false);
    expect(registry.rank_activities_by_metric.safeParse({
      metric: metricDescriptor,
      order: 'highest',
      scannedActivityCount: 1,
      matchedActivityCount: 1,
      activities: [{
        rank: 1,
        activityRef: ACTIVITY_REF,
        startTime: '2026-02-31T08:00:00.000Z',
        activityType: 'Running',
        value: 10_000,
      }],
    }).success).toBe(false);
    expect(registry.rank_activities_by_metric.safeParse({
      metric: metricDescriptor,
      order: 'highest',
      scannedActivityCount: 2,
      matchedActivityCount: 2,
      activities: [{
        rank: 1,
        activityRef: ACTIVITY_REF,
        startTime: new Date(NEXT_DAY_MS).toISOString(),
        activityType: 'Running',
        value: 10_000,
      }, {
        rank: 2,
        activityRef: ACTIVITY_REF,
        startTime: new Date(DAY_MS).toISOString(),
        activityType: 'Running',
        value: 11_000,
      }],
    }).success).toBe(false);
    expect(registry.rank_activities_by_metric.safeParse({
      metric: metricDescriptor,
      order: 'highest',
      scannedActivityCount: 2,
      matchedActivityCount: 2,
      activities: [{
        rank: 1,
        activityRef: ACTIVITY_REF,
        startTime: new Date(DAY_MS).toISOString(),
        activityType: 'Running',
        value: 10_000,
      }, {
        rank: 2,
        activityRef: ACTIVITY_REF,
        startTime: new Date(NEXT_DAY_MS).toISOString(),
        activityType: 'Running',
        value: 10_000,
      }],
    }).success).toBe(false);
    expect(registry.rank_activities_by_metric.safeParse({
      metric: metricDescriptor,
      order: 'highest',
      scannedActivityCount: 1,
      matchedActivityCount: 1,
      activities: [{
        rank: 1,
        activityRef: ACTIVITY_REF,
        startTimeMs: DAY_MS,
        endTimeMs: NEXT_DAY_MS,
        activityType: 'Running',
        value: 10_000,
      }],
    }).success).toBe(false);
    expect(registry.list_routes.safeParse({
      scannedRouteCount: 1,
      skippedRouteCount: 0,
      routes: [{
        ...routeSummaryWithLocation,
        storagePath: 'users/private/routes/source.fit',
      }],
      nextCursor: null,
      scanComplete: true,
    }).success).toBe(false);
    expect(registry.list_sleep_sessions.safeParse({
      sessions: [{
        provider: 'GarminAPI',
        sleepDate: '2026-07-01',
        startTimeMs: DAY_MS,
        endTimeMs: NEXT_DAY_MS,
        durationSeconds: 1,
        inBedDurationSeconds: null,
        isNap: false,
        stageDurationsSeconds: {},
        score: null,
        vitals: null,
        providerUserId: 'private-provider-user',
      }],
      nextCursor: null,
    }).success).toBe(false);
    expect(registry.list_sleep_vitals.safeParse({
      matchedSessionCount: 1,
      vitals: [{
        type: 'overnightHrvMs',
        label: 'Overnight HRV',
        unit: 'milliseconds',
        sessionCount: 1,
        providerUserId: 'private-provider-user',
      }],
    }).success).toBe(false);
    expect(registry.get_sleep_trend.safeParse({
      rangeStartTimeMs: DAY_MS,
      rangeEndTimeMs: NEXT_DAY_MS,
      timeZone: 'Europe/Helsinki',
      groupBy: 'day',
      matchedSessionCount: 1,
      availableVitals: [{
        type: 'overnightHrvMs',
        label: 'Overnight HRV',
        unit: 'milliseconds',
        sessionCount: 1,
      }],
      buckets: [{
        bucketStartMs: DAY_MS,
        sessionCount: 1,
        providers: ['GarminAPI'],
        totalDurationSeconds: 28_800,
        averageDurationSeconds: 28_800,
        averageInBedDurationSeconds: null,
        averageScore: 80,
        stageDurationsSeconds: {},
        averageVitals: {
          overnightHrvMs: 55,
        },
        hrvSamples: [{ value: 55 }],
      }],
    }).success).toBe(false);
    expect(registry.get_sleep_trend.safeParse({
      rangeStartTimeMs: DAY_MS,
      rangeEndTimeMs: NEXT_DAY_MS,
      timeZone: 'Europe/Helsinki',
      groupBy: 'day',
      matchedSessionCount: 1,
      availableVitals: [{
        type: 'overnightHrvMs',
        label: 'Overnight HRV',
        unit: 'milliseconds',
        sessionCount: 1,
      }],
      buckets: [{
        bucketStartMs: DAY_MS,
        sessionCount: 1,
        providers: ['GarminAPI'],
        totalDurationSeconds: 28_800,
        averageDurationSeconds: 28_800,
        averageInBedDurationSeconds: null,
        averageScore: 80,
        stageDurationsSeconds: {},
        averageVitals: {
          overnightHrvMs: 55,
          providerRecoveryScore: 99,
        },
      }],
    }).success).toBe(false);
    expect(registry.list_route_waypoints.safeParse({
      waypoints: [{
        index: 0,
        ...coordinate,
        altitudeMeters: null,
        distanceMeters: null,
        routeIndex: null,
        routePointIndex: null,
        type: null,
        parserExtension: '.fit',
      }],
      waypointCount: 1,
    }).success).toBe(false);
    expect(MCP_DERIVED_PAYLOAD_SCHEMAS.training_capacity.safeParse({
      ...derivedPayloadFixtures.training_capacity,
      disciplines: [{
        discipline: 'cycling',
        ftpSetting: {
          kind: 'ftp-setting',
          value: 250,
          sourceKey: 'private-device',
          provenance: 'imported-activity-stat',
          firstSeenAtMs: DAY_MS,
          lastSeenAtMs: DAY_MS,
          observationCount: 1,
          previousValue: null,
          previousAtMs: null,
          changePct: null,
        },
        importedVo2Max: null,
      }],
    }).success).toBe(false);
    expect(MCP_DERIVED_PAYLOAD_SCHEMAS.power_curve.safeParse({
      ...derivedPayloadFixtures.power_curve,
      scopes: {
        ...derivedPayloadFixtures.power_curve.scopes,
        cycling: {
          ...derivedPayloadFixtures.power_curve.scopes.cycling,
          ranges: {
            ...derivedPayloadFixtures.power_curve.scopes.cycling.ranges,
            all: {
              ...derivedPayloadFixtures.power_curve.scopes.cycling.ranges.all,
              bestPoints: [1, 500],
            },
          },
        },
      },
    }).success).toBe(false);
    expect(registry.get_activity_chart_data.safeParse({
      activityType: 'Running',
      xAxis: 'elapsed_time',
      xAxisUnit: 'seconds',
      series: [{
        metric: 'heart_rate',
        canonicalUnit: 'beats_per_minute',
        xValues: [],
        values: [],
        sourceSampleCount: 0,
        returnedSampleCount: 0,
        missingSampleCount: 0,
      }],
      location: null,
    }).success).toBe(false);
    expect(registry.get_activity_chart_data.safeParse({
      activityType: 'Running',
      xAxis: 'elapsed_time',
      xAxisUnit: 'seconds',
      series: [{
        metric: 'heart_rate',
        canonicalUnit: 'watts',
        xValues: [],
        values: [],
        sourceSampleCount: 0,
        returnedSampleCount: 0,
        missingSampleCount: 0,
      }],
    }).success).toBe(false);
  });

  it('turns output mismatches into generic text-only MCP errors', async () => {
    const leakingService = createFixtureDataService();
    leakingService.listMeasurementTypes = vi.fn().mockResolvedValue({
      measurementTypes: [],
      sourceKey: 'private-source-key',
    });
    const connection = await connectFixtureServer(
      leakingService,
      [MCP_OAUTH_SCOPES.MeasurementsRead],
    );
    connections.push(connection);

    const result = await connection.client.callTool({
      name: 'list_measurement_types',
      arguments: {},
    });
    expect(result).toMatchObject({
      isError: true,
    });
    expect(result).not.toHaveProperty('structuredContent');
    expect(JSON.stringify(result)).toContain('internal_error');
    expect(JSON.stringify(result)).not.toContain('private-source-key');
  });

  it('keeps expected data errors text-only and preserves their safe code', async () => {
    const errorService = createFixtureDataService();
    errorService.listMetrics = vi.fn().mockRejectedValue(
      new McpDataError('invalid_metric', 'Choose a supported metric.'),
    );
    const connection = await connectFixtureServer(
      errorService,
      [MCP_OAUTH_SCOPES.MetricsRead],
    );
    connections.push(connection);

    const result = await connection.client.callTool({
      name: 'list_metrics',
      arguments: {},
    });
    expect(result).toMatchObject({
      isError: true,
    });
    expect(result).not.toHaveProperty('structuredContent');
    expect(JSON.stringify(result)).toContain('invalid_metric');
    expect(JSON.stringify(result)).toContain('Choose a supported metric.');
  });

  it('fails closed on contract mismatches in every tool family', async () => {
    const mismatchService = createFixtureDataService();
    const healthFixture = await mismatchService.queryHealthMetric({
      uid: 'user-1', metricId: 'heart_rate', startDate: '2026-07-01', endDate: '2026-07-02',
      mode: 'summaries', maxPoints: 200, measurementsAllowed: false,
    });
    mismatchService.listHealthMetrics = vi.fn().mockResolvedValue({
      ...getMcpHealthCatalog(), accountKey: 'health-catalog-secret',
    });
    mismatchService.queryHealthMetric = vi.fn().mockResolvedValue({
      ...healthFixture,
      series: [{ ...healthFixture.series[0], accountKey: 'health-source-secret' }],
    });
    const dailyReportFixture = await mismatchService.getDailyReport({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });
    mismatchService.listMeasurementTypes = vi.fn().mockResolvedValue({
      measurementTypes: [],
      sourceKey: 'measurement-secret',
    });
    mismatchService.listMetrics = vi.fn().mockResolvedValue({
      eventMetrics: [],
      nextCursor: null,
      scannedEventCount: 0,
      eventScanTruncated: false,
      derivedMetricKinds: [],
      sleepCapabilities: {
        providers: [],
        sessionSummaries: true,
        aggregateGroupings: [],
      },
      sourceFingerprint: 'metric-secret',
    });
    mismatchService.listSleepSessions = vi.fn().mockResolvedValue({
      sessions: [],
      nextCursor: null,
      providerUserId: 'sleep-secret',
    });
    mismatchService.getTodayReadiness = vi.fn().mockResolvedValue({
      asOfTimeMs: DAY_MS,
      timeZone: 'Europe/Helsinki',
      localDayStartTimeMs: DAY_MS,
      localDayEndTimeMs: NEXT_DAY_MS - 1,
      dayBoundary: 'UTC',
      asOfDayMs: DAY_MS,
      formulaVersion: 3,
      status: 'no_signal',
      score: null,
      label: null,
      confidence: null,
      availableSignalCount: 0,
      availableWeightPercent: 0,
      baselineEvidenceCount: 0,
      totalSignalCount: 4,
      drivers: {
        load: {
          status: 'not_ready',
          weightPercent: 40,
          form: null,
          rampRate: null,
          asOfDayMs: null,
          sourceUpdatedAtMs: null,
        },
        sleep: {
          status: 'no_recent_session',
          weightPercent: 25,
          score: null,
          scoreSource: null,
          latestSleepAtMs: null,
          sleepDate: null,
          durationSeconds: null,
          recordedScore: null,
        },
        hrv: {
          status: 'not_recorded',
          weightPercent: 20,
          latestMs: null,
          baselineMedianMs: null,
          baselineNightCount: 0,
          ratio: null,
        },
        overnightHeartRate: {
          status: 'not_recorded',
          weightPercent: 15,
          combinedRatio: null,
          average: {
            status: 'not_recorded',
            latestBpm: null,
            baselineMedianBpm: null,
            baselineNightCount: 0,
            ratio: null,
          },
          minimum: {
            status: 'not_recorded',
            latestBpm: null,
            baselineMedianBpm: null,
            baselineNightCount: 0,
            ratio: null,
          },
        },
      },
      sourceKey: 'readiness-secret',
    });
    mismatchService.getDailyReport = vi.fn().mockResolvedValue({
      ...dailyReportFixture,
      providerUserId: 'daily-report-secret',
    });
    mismatchService.getDailyBriefing = vi.fn().mockResolvedValue({
      asOfTimeMs: DAY_MS,
      timeZone: 'Europe/Helsinki',
      localDayStartTimeMs: DAY_MS,
      localDayEndTimeMs: NEXT_DAY_MS - 1,
      sleep: {
        status: 'no_completed_session',
        latestSession: null,
        comparison: {
          sameProviderNightCount: 0,
          averageDurationSeconds: null,
          durationDeltaSeconds: null,
        },
      },
      trainingReadiness: {
        status: 'not_ready',
        dayBoundary: 'UTC',
        asOfDayMs: null,
        generatedAtMs: null,
        updatedAtMs: null,
        score: null,
        label: null,
        confidence: null,
        availableSignalCount: null,
        baselineEvidenceCount: null,
      },
      trainingSummary: {
        status: 'not_ready',
        dayBoundary: 'UTC',
        asOfDayMs: null,
        updatedAtMs: null,
        baselineSourceWindowDays: null,
        current28d: null,
        usual28d: null,
        disciplines: [],
        sourceKey: 'training-summary-secret',
      },
      providerUserId: 'briefing-secret',
    });
    mismatchService.listActivities = vi.fn().mockResolvedValue({
      activities: [],
      nextCursor: null,
      activityId: 'activity-secret',
    });
    mismatchService.queryActivitiesWithTags = vi.fn().mockResolvedValue({
      activities: [],
      nextCursor: null,
      eventName: 'event-secret',
    });
    mismatchService.findActivitiesNearLocation = vi.fn().mockResolvedValue({
      activities: [],
      nextCursor: null,
      activityId: 'nearby-activity-secret',
    });
    mismatchService.listRoutes = vi.fn().mockResolvedValue({
      routes: [],
      nextCursor: null,
      originalFiles: ['route-secret'],
    });
    mismatchService.findRoutesNearLocation = vi.fn().mockResolvedValue({
      routes: [],
      nextCursor: null,
      originalFiles: ['nearby-route-secret'],
    });
    const connection = await connectFixtureServer(mismatchService);
    connections.push(connection);

    for (const toolName of [
      'list_health_metrics',
      'query_health_metric',
      'list_measurement_types',
      'list_metrics',
      'list_sleep_sessions',
      'get_today_readiness',
      'get_daily_report',
      'get_daily_briefing',
      'list_activities',
      'query_activities',
      'query_activities_with_tags',
      'find_activities_near_location',
      'search_activities_near_location',
      'list_routes',
      'find_routes_near_location',
      'search_routes_near_location',
    ] as const) {
      const result = await connection.client.callTool({
        name: toolName,
        arguments: successfulToolArguments[toolName],
      });
      expect(result.isError, toolName).toBe(true);
      expect(result, toolName).not.toHaveProperty('structuredContent');
      expect(JSON.stringify(result), toolName).toContain('internal_error');
      expect(JSON.stringify(result), toolName).not.toContain('secret');
    }
  });

  it('keeps expected errors text-only across every tool family', async () => {
    const errorService = createFixtureDataService();
    const expectedError = () => new McpDataError(
      'temporarily_unavailable',
      'This data is temporarily unavailable.',
    );
    errorService.listHealthMetrics = vi.fn().mockRejectedValue(expectedError());
    errorService.queryHealthMetric = vi.fn().mockRejectedValue(expectedError());
    errorService.listMeasurementTypes = vi.fn().mockImplementation(
      async () => {
        throw expectedError();
      },
    );
    errorService.listMetrics = vi.fn().mockImplementation(async () => {
      throw expectedError();
    });
    errorService.listSleepSessions = vi.fn().mockImplementation(async () => {
      throw expectedError();
    });
    errorService.getDailyBriefing = vi.fn().mockImplementation(async () => {
      throw expectedError();
    });
    errorService.getDailyReport = vi.fn().mockImplementation(async () => {
      throw expectedError();
    });
    errorService.listActivities = vi.fn().mockImplementation(async () => {
      throw expectedError();
    });
    errorService.queryActivitiesWithTags = vi.fn().mockImplementation(
      async () => {
        throw expectedError();
      },
    );
    errorService.findActivitiesNearLocation = vi.fn().mockImplementation(
      async () => {
        throw expectedError();
      },
    );
    errorService.listRoutes = vi.fn().mockImplementation(async () => {
      throw expectedError();
    });
    errorService.findRoutesNearLocation = vi.fn().mockImplementation(
      async () => {
        throw expectedError();
      },
    );
    const connection = await connectFixtureServer(errorService);
    connections.push(connection);

    for (const toolName of [
      'list_health_metrics',
      'query_health_metric',
      'list_measurement_types',
      'list_metrics',
      'list_sleep_sessions',
      'get_daily_report',
      'get_daily_briefing',
      'list_activities',
      'query_activities',
      'query_activities_with_tags',
      'find_activities_near_location',
      'search_activities_near_location',
      'list_routes',
      'find_routes_near_location',
      'search_routes_near_location',
    ] as const) {
      const result = await connection.client.callTool({
        name: toolName,
        arguments: successfulToolArguments[toolName],
      });
      expect(result.isError, toolName).toBe(true);
      expect(result, toolName).not.toHaveProperty('structuredContent');
      expect(JSON.stringify(result), toolName)
        .toContain('temporarily_unavailable');
    }
  });
});
