import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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
  DERIVED_METRIC_SCHEMA_VERSION,
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
import { MCP_DERIVED_PAYLOAD_SCHEMAS } from './derived-output-schemas';
import { MCP_OAUTH_SCOPES } from './oauth.service';
import { createMcpServer } from './server';
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

function createFixtureDataService(
  options: {
    activityLocation?: boolean;
    routeLocation?: boolean;
  } = {},
): InjectedDataService {
  const activityLocation = options.activityLocation !== false;
  const routeLocation = options.routeLocation !== false;
  return {
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
      eventMetrics: [metricDescriptor],
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
    getTrainingMetric: vi.fn().mockImplementation(
      async (_uid: string, metricKind: DerivedMetricKind) => ({
        metricKind,
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
        updatedAtMs: DAY_MS,
        sourceEventCount: 0,
        payload: derivedPayloadFixtures[metricKind],
      }),
    ),
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
    listActivities: vi.fn().mockResolvedValue({
      activities: [
        activityLocation
          ? activitySummaryWithLocation
          : activitySummaryRedacted,
      ],
      nextCursor: NEXT_CURSOR,
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
    listRoutes: vi.fn().mockResolvedValue({
      routes: [
        routeLocation ? routeSummaryWithLocation : routeSummaryRedacted,
      ],
      nextCursor: null,
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
}

const successfulToolArguments: Record<
  PublicMcpToolName,
  Record<string, unknown>
> = {
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
  get_training_metric: {
    metricKind: DERIVED_METRIC_KINDS.Form,
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
  list_activities: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-07-02T00:00:00.000Z',
  },
  find_activities_near_location: {
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
  list_routes: {},
  find_routes_near_location: {
    location: { query: 'Ioannina, Greece' },
  },
  get_route_geometry: {
    routeRef: ROUTE_REF,
  },
  list_route_waypoints: {
    routeRef: ROUTE_REF,
  },
};

async function connectFixtureServer(
  dataService: InjectedDataService,
  scopes = Object.values(MCP_OAUTH_SCOPES),
) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer({
    uid: 'user-1',
    clientId: 'https://client.example/client.json',
    connectionId: 'connection-1',
    scopes,
  }, 'https://quantified-self.io', dataService);
  const client = new Client({
    name: 'output-contract-test-client',
    version: '1.0.0',
  });
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

describe('MCP public output contracts', () => {
  const connections: Array<{
    client: Client;
    server: ReturnType<typeof createMcpServer>;
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

    expect(registry.get_training_metric.safeParse({
      metricKind: DERIVED_METRIC_KINDS.Form,
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: DAY_MS,
      sourceEventCount: 0,
      payload: derivedPayloadFixtures[DERIVED_METRIC_KINDS.BodyWeightTrend],
    }).success).toBe(false);
    expect(registry.get_training_metric.safeParse({
      metricKind: DERIVED_METRIC_KINDS.Form,
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: -1,
      sourceEventCount: 0,
      payload: derivedPayloadFixtures[DERIVED_METRIC_KINDS.Form],
    }).success).toBe(false);
  });

  it('advertises strict schemas and validates every successful tool call', async () => {
    const connection = await connectFixtureServer(createFixtureDataService());
    connections.push(connection);
    const tools = (await connection.client.listTools()).tools;
    expect(tools.map(tool => tool.name).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort(),
    );
    expect(tools.every(tool => Boolean(tool.outputSchema))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(tools), 'utf8'))
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
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: DAY_MS,
      sourceEventCount: 0,
      payload: derivedPayloadFixtures[DERIVED_METRIC_KINDS.BodyWeightTrend],
    })).toBe(false);

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
    expect(registry.list_routes.safeParse({
      routes: [],
      nextCursor: null,
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
    expect(JSON.stringify(advertised.list_activity_jumps))
      .not.toContain('latitudeDegrees');
    expect(JSON.stringify(advertised.list_routes)).not.toContain('bounds');
    expect(JSON.stringify(advertised.get_activity_chart_data))
      .not.toContain('location');

    for (const toolName of [
      'list_activities',
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
      activities: [activitySummaryWithLocation],
      nextCursor: null,
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
      routes: [routeSummaryWithLocation],
      nextCursor: null,
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
      activities: [activitySummaryWithLocation],
      nextCursor: null,
    }).success).toBe(true);
    expect(activityLocationOnlyRegistry.list_routes.safeParse({
      routes: [routeSummaryWithLocation],
      nextCursor: null,
    }).success).toBe(false);

    const routeLocationOnlyRegistry = createMcpOutputSchemaRegistry({
      activityLocation: false,
      routeLocation: true,
    });
    expect(routeLocationOnlyRegistry.list_routes.safeParse({
      routes: [routeSummaryWithLocation],
      nextCursor: null,
    }).success).toBe(true);
    expect(routeLocationOnlyRegistry.list_activities.safeParse({
      activities: [activitySummaryWithLocation],
      nextCursor: null,
    }).success).toBe(false);
  });

  it('does not advertise private projection or provenance fields', async () => {
    const connection = await connectFixtureServer(createFixtureDataService());
    connections.push(connection);
    const tools = (await connection.client.listTools()).tools;
    const propertyNames = collectPropertyNames(
      tools.map(tool => tool.outputSchema),
    );
    // `id` is intentionally public only for the measurement-type catalog
    // (`body_weight`); opaque activity, event, route, and source IDs are not.
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
      activities: [{
        ...activitySummaryWithLocation,
        eventID: 'private-event-id',
        stats: {
          ...activityStats,
          sourceKey: 'private-source-key',
        },
      }],
      nextCursor: null,
    }).success).toBe(false);
    expect(registry.list_routes.safeParse({
      routes: [{
        ...routeSummaryWithLocation,
        storagePath: 'users/private/routes/source.fit',
      }],
      nextCursor: null,
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
    mismatchService.listActivities = vi.fn().mockResolvedValue({
      activities: [],
      nextCursor: null,
      activityId: 'activity-secret',
    });
    mismatchService.listRoutes = vi.fn().mockResolvedValue({
      routes: [],
      nextCursor: null,
      originalFiles: ['route-secret'],
    });
    const connection = await connectFixtureServer(mismatchService);
    connections.push(connection);

    for (const toolName of [
      'list_measurement_types',
      'list_metrics',
      'list_sleep_sessions',
      'list_activities',
      'list_routes',
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
    errorService.listActivities = vi.fn().mockImplementation(async () => {
      throw expectedError();
    });
    errorService.listRoutes = vi.fn().mockImplementation(async () => {
      throw expectedError();
    });
    const connection = await connectFixtureServer(errorService);
    connections.push(connection);

    for (const toolName of [
      'list_measurement_types',
      'list_metrics',
      'list_sleep_sessions',
      'list_activities',
      'list_routes',
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
