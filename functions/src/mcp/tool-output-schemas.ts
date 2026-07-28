import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { z } from 'zod';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DerivedMetricKind,
} from '../../../shared/derived-metrics';
import {
  SLEEP_PROVIDERS,
  SLEEP_STAGES,
} from '../../../shared/sleep';
import {
  MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS,
  MCP_ACTIVITY_CHART_DEFAULT_POINTS,
  MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS,
  MCP_ACTIVITY_CHART_MAX_POINTS,
  MCP_ACTIVITY_CHART_METRICS,
} from './activity-chart.service';
import {
  MCP_DERIVED_PAYLOAD_SCHEMAS,
  validateMcpDerivedPayload,
} from './derived-output-schemas';
import { MCP_MEASUREMENT_TYPE_IDS } from './measurement-catalog';

export const PUBLIC_MCP_TOOL_NAMES = [
  'list_measurement_types',
  'query_measurements',
  'list_metrics',
  'query_metric',
  'get_training_metric',
  'list_sleep_sessions',
  'query_sleep_summary',
  'list_activity_types',
  'list_activities',
  'find_activities_near_location',
  'list_activity_laps',
  'list_activity_jumps',
  'list_activity_swim_lengths',
  'list_activity_chart_metrics',
  'get_activity_chart_data',
  'get_activity_metrics',
  'list_routes',
  'find_routes_near_location',
  'get_route_geometry',
  'list_route_waypoints',
] as const;

export type PublicMcpToolName = typeof PUBLIC_MCP_TOOL_NAMES[number];

export interface McpOutputSchemaScope {
  activityLocation: boolean;
  routeLocation: boolean;
}

const number = z.number();
const nullableNumber = number.nullable();
const nonNegativeNumber = number.nonnegative();
const nullableNonNegativeNumber = nonNegativeNumber.nullable();
const count = z.number().int().nonnegative();
const timestampMs = z.number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const nullableTimestampMs = timestampMs.nullable();
const nullableNonNegativeTimestampMs = timestampMs.nonnegative().nullable();
const cursor = z.string().min(1).max(512).nullable();
const unavailableLocationOutput = z.strictObject({}).superRefine(
  (_value, context) => {
    context.addIssue({
      code: 'custom',
      message: 'The required location scope is unavailable.',
    });
  },
).meta({
  title: 'McpUnavailableLocationOutput',
  not: {},
});

export const MCP_ACTIVITY_REFERENCE_OUTPUT_SCHEMA = z.string()
  .min(1)
  .max(512)
  .meta({ title: 'McpActivityReference' });
export const MCP_ROUTE_REFERENCE_OUTPUT_SCHEMA = z.string()
  .min(1)
  .max(512)
  .meta({ title: 'McpRouteReference' });
export const MCP_APP_URL_OUTPUT_SCHEMA = z.url()
  .max(2_048)
  .regex(/^https?:\/\//)
  .meta({ title: 'McpApplicationUrl' });
export const MCP_DATE_RANGE_OUTPUT_SHAPE = {
  startTimeMs: timestampMs,
  endTimeMs: timestampMs,
  timeZone: z.string().min(1).max(80),
} as const;
export const MCP_PAGINATION_OUTPUT_SHAPE = {
  nextCursor: cursor,
} as const;

export const MCP_COORDINATE_OUTPUT_SCHEMA = z.strictObject({
  latitudeDegrees: z.number().min(-90).max(90),
  longitudeDegrees: z.number().min(-180).max(180),
}).meta({ title: 'McpCoordinate' });

export const MCP_BOUNDS_OUTPUT_SCHEMA = z.strictObject({
  minLatitudeDegrees: z.number().min(-90).max(90),
  maxLatitudeDegrees: z.number().min(-90).max(90),
  minLongitudeDegrees: z.number().min(-180).max(180),
  maxLongitudeDegrees: z.number().min(-180).max(180),
}).superRefine((value, context) => {
  if (value.minLatitudeDegrees > value.maxLatitudeDegrees) {
    context.addIssue({
      code: 'custom',
      path: ['minLatitudeDegrees'],
      message: 'Minimum latitude must not exceed maximum latitude.',
    });
  }
  if (value.minLongitudeDegrees > value.maxLongitudeDegrees) {
    context.addIssue({
      code: 'custom',
      path: ['minLongitudeDegrees'],
      message: 'Minimum longitude must not exceed maximum longitude.',
    });
  }
}).meta({ title: 'McpBounds' });

export const MCP_METRIC_DESCRIPTOR_OUTPUT_SCHEMA = z.strictObject({
  type: z.string().min(1).max(160),
  displayType: z.string().min(1).max(160),
  unit: z.string().max(80),
  unitSystem: z.enum(['metric', 'imperial']),
}).meta({ title: 'McpMetricDescriptor' });

const activityStats = z.strictObject({
  durationSeconds: nullableNonNegativeNumber,
  distanceMeters: nullableNonNegativeNumber,
  ascentMeters: nullableNonNegativeNumber,
  descentMeters: nullableNonNegativeNumber,
  averageSpeedMetersPerSecond: nullableNonNegativeNumber,
  maximumSpeedMetersPerSecond: nullableNonNegativeNumber,
  averageHeartRateBpm: nullableNonNegativeNumber,
  maximumHeartRateBpm: nullableNonNegativeNumber,
  averagePowerWatts: nullableNonNegativeNumber,
  maximumPowerWatts: nullableNonNegativeNumber,
  averageCadenceRpm: nullableNonNegativeNumber,
  maximumCadenceRpm: nullableNonNegativeNumber,
  energyKilocalories: nullableNonNegativeNumber,
}).meta({ title: 'McpActivityStats' });

const measurementAggregation = z.enum([
  'median',
  'average',
  'minimum',
  'maximum',
  'latest',
]);
const measurementInterval = z.enum(['day', 'week', 'month']);
const measurementDescriptor = z.strictObject({
  id: z.enum(MCP_MEASUREMENT_TYPE_IDS),
  displayName: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  canonicalMetric: MCP_METRIC_DESCRIPTOR_OUTPUT_SCHEMA,
  defaultAggregation: measurementAggregation,
  supportedAggregations: z.array(measurementAggregation),
  defaultInterval: measurementInterval,
  supportedIntervals: z.array(measurementInterval),
  maximumRangeDays: z.literal(366),
  requiresExplicitIanaTimeZone: z.literal(true),
  currentTrend: z.strictObject({
    tool: z.literal('get_training_metric'),
    metricKind: z.literal(DERIVED_METRIC_KINDS.BodyWeightTrend),
    requiredScope: z.literal('metrics:read'),
    windowDays: z.literal(28),
    dayBoundaryTimeZone: z.literal('UTC'),
    readiness: z.literal('ready_snapshot_required'),
  }),
}).meta({ title: 'McpMeasurementDescriptor' });
const measurementPoint = z.strictObject({
  bucketStartTimeMs: timestampMs,
  value: number,
  measurementCount: count,
}).meta({ title: 'McpMeasurementPoint' });

const derivedMetricKind = z.enum(
  Object.values(DERIVED_METRIC_KINDS) as [
    DerivedMetricKind,
    ...DerivedMetricKind[],
  ],
);
const derivedPayloadSchemas = Object.values(
  MCP_DERIVED_PAYLOAD_SCHEMAS,
) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]];
const derivedPayloadUnion = z.union(derivedPayloadSchemas);
const derivedPayloadEntries = Object.entries(MCP_DERIVED_PAYLOAD_SCHEMAS);
const derivedPayloadDefinitions: Record<string, Record<string, unknown>> =
  Object.fromEntries(
  derivedPayloadEntries.map(([metricKind, schema]) => {
    const schemaId = schema.meta()?.title;
    if (typeof schemaId !== 'string' || !schemaId) {
      throw new Error(
        `Missing MCP derived payload schema title for ${metricKind}.`,
      );
    }
    const definition = z.toJSONSchema(schema, {
      target: 'draft-7',
      io: 'output',
    });
    delete definition.$schema;
    return [schemaId, definition];
  }),
);
const derivedPayloadDefinitionName = 'McpDerivedPayload';
derivedPayloadDefinitions[derivedPayloadDefinitionName] = {
  anyOf: derivedPayloadEntries.map(([metricKind, schema]) => ({
    title: metricKind,
    $ref: `#/definitions/${String(schema.meta()?.title)}`,
  })),
};
const derivedPayloadConditionals = Object.entries(
  MCP_DERIVED_PAYLOAD_SCHEMAS,
).map(([metricKind, schema]) => {
  const schemaId = schema.meta()?.title;
  if (typeof schemaId !== 'string' || !schemaId) {
    throw new Error(`Missing MCP derived payload schema id for ${metricKind}.`);
  }
  return {
    if: {
      properties: {
        metricKind: { const: metricKind },
      },
      required: ['metricKind'],
    },
    then: {
      properties: {
        payload: { $ref: `#/definitions/${schemaId}` },
      },
    },
  };
});
const trainingMetricOutput = z.strictObject({
  metricKind: derivedMetricKind,
  schemaVersion: z.literal(DERIVED_METRIC_SCHEMA_VERSION),
  updatedAtMs: nullableNonNegativeTimestampMs,
  sourceEventCount: count.nullable(),
  payload: derivedPayloadUnion,
}).superRefine((value, context) => {
  if (!validateMcpDerivedPayload(value.metricKind, value.payload)) {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Payload does not match metricKind.',
    });
  }
}).meta({
  title: 'McpTrainingMetricOutput',
  properties: {
    metricKind: {
      type: 'string',
      enum: Object.values(DERIVED_METRIC_KINDS),
    },
    schemaVersion: {
      const: DERIVED_METRIC_SCHEMA_VERSION,
      type: 'number',
    },
    updatedAtMs: {
      type: ['number', 'null'],
      minimum: 0,
    },
    sourceEventCount: {
      type: ['integer', 'null'],
      minimum: 0,
    },
    payload: {
      $ref: `#/definitions/${derivedPayloadDefinitionName}`,
    },
  },
  required: [
    'metricKind',
    'schemaVersion',
    'updatedAtMs',
    'sourceEventCount',
    'payload',
  ],
  additionalProperties: false,
  definitions: derivedPayloadDefinitions,
  allOf: derivedPayloadConditionals,
});

const sleepProvider = z.enum([
  SLEEP_PROVIDERS.GarminAPI,
  SLEEP_PROVIDERS.SuuntoApp,
  SLEEP_PROVIDERS.COROSAPI,
]);
const sleepStageDurations = z.strictObject({
  [SLEEP_STAGES.Deep]: nonNegativeNumber.optional(),
  [SLEEP_STAGES.Light]: nonNegativeNumber.optional(),
  [SLEEP_STAGES.Rem]: nonNegativeNumber.optional(),
  [SLEEP_STAGES.Awake]: nonNegativeNumber.optional(),
  [SLEEP_STAGES.Unmeasurable]: nonNegativeNumber.optional(),
  [SLEEP_STAGES.Unknown]: nonNegativeNumber.optional(),
}).meta({ title: 'McpSleepStageDurations' });
const sleepVitalsShape = {
  averageHeartRateBpm: nonNegativeNumber.optional(),
  minimumHeartRateBpm: nonNegativeNumber.optional(),
  restingHeartRateBpm: nonNegativeNumber.optional(),
  averageHrvMs: nonNegativeNumber.optional(),
  hrvSampleCount: count.optional(),
  overnightHrvMs: nonNegativeNumber.optional(),
  maxSpo2Percent: nonNegativeNumber.optional(),
  averageRespirationBrpm: nonNegativeNumber.optional(),
};
const sleepVitals = z.strictObject({
  ...sleepVitalsShape,
}).meta({ title: 'McpSleepVitals' });
const sleepSession = z.strictObject({
  provider: sleepProvider,
  sleepDate: z.iso.date(),
  startTimeMs: timestampMs,
  endTimeMs: timestampMs,
  durationSeconds: nonNegativeNumber,
  inBedDurationSeconds: nullableNonNegativeNumber,
  isNap: z.boolean(),
  stageDurationsSeconds: sleepStageDurations,
  score: z.strictObject({
    value: nullableNonNegativeNumber,
    qualifier: z.string().max(120).nullable(),
  }).nullable(),
  vitals: sleepVitals.nullable(),
}).meta({ title: 'McpSleepSession' });

const activityTypeDescriptor = z.strictObject({
  activityType: z.string().min(1).max(120),
  activityGroup: z.string().min(1).max(120),
  indoor: z.boolean(),
}).meta({ title: 'McpActivityTypeDescriptor' });

const activitySummaryBaseShape = {
  activityRef: MCP_ACTIVITY_REFERENCE_OUTPUT_SCHEMA,
  appUrl: MCP_APP_URL_OUTPUT_SCHEMA,
  startTimeMs: timestampMs,
  endTimeMs: timestampMs,
  activityType: z.string().max(120).nullable(),
  powerMeter: z.boolean(),
  trainer: z.boolean(),
  jumpCount: count.nullable(),
  supportedDetailKinds: z.array(
    z.enum(['laps', 'jumps', 'swim_lengths']),
  ),
  stats: activityStats,
};
const activitySummaryWithoutLocation = z.strictObject({
  ...activitySummaryBaseShape,
  locationRedacted: z.literal(true),
}).meta({ title: 'McpActivitySummaryRedacted' });
const activitySummaryWithLocation = z.strictObject({
  ...activitySummaryBaseShape,
  startPosition: MCP_COORDINATE_OUTPUT_SCHEMA.nullable(),
  endPosition: MCP_COORDINATE_OUTPUT_SCHEMA.nullable(),
  locationRedacted: z.literal(false),
}).meta({ title: 'McpActivitySummaryWithLocation' });

const nearbyLocationResult = z.strictObject({
  source: z.enum(['coordinates', 'mapbox']),
  resolvedLabel: z.string().max(300).nullable(),
  latitudeDegrees: z.number().min(-90).max(90),
  longitudeDegrees: z.number().min(-180).max(180),
  radiusMeters: z.number().min(100).max(500_000),
}).meta({ title: 'McpNearbyLocationResult' });
const nearbyActivity = z.strictObject({
  ...activitySummaryBaseShape,
  startPosition: MCP_COORDINATE_OUTPUT_SCHEMA.nullable(),
  endPosition: MCP_COORDINATE_OUTPUT_SCHEMA.nullable(),
  locationRedacted: z.literal(false),
  nearestDistanceMeters: nonNegativeNumber,
  nearestPosition: MCP_COORDINATE_OUTPUT_SCHEMA,
  nearestPositionKind: z.enum(['start', 'end']),
  matchedPositionKinds: z.array(z.enum(['start', 'end'])),
}).meta({ title: 'McpNearbyActivity' });

const lap = z.strictObject({
  index: count,
  lapNumber: count.nullable(),
  type: z.string().max(80).nullable(),
  startTimeMs: timestampMs,
  endTimeMs: timestampMs,
  startSampleIndex: count.nullable(),
  endSampleIndex: count.nullable(),
  stats: activityStats,
}).meta({ title: 'McpActivityLap' });
const jumpBaseShape = {
  index: count,
  timestampMs,
  distanceMeters: nonNegativeNumber,
  heightMeters: nullableNonNegativeNumber,
  hangTimeSeconds: nullableNonNegativeNumber,
  speedMetersPerSecond: nullableNonNegativeNumber,
  rotations: nullableNonNegativeNumber,
  score: nonNegativeNumber,
};
const jumpWithoutLocation = z.strictObject({
  ...jumpBaseShape,
  locationRedacted: z.literal(true),
}).meta({ title: 'McpActivityJumpRedacted' });
const jumpWithLocation = z.strictObject({
  ...jumpBaseShape,
  latitudeDegrees: z.number().min(-90).max(90).nullable(),
  longitudeDegrees: z.number().min(-180).max(180).nullable(),
  locationRedacted: z.literal(false),
}).meta({ title: 'McpActivityJumpWithLocation' });
const swimLength = z.strictObject({
  index: count,
  sourceIndex: count.nullable(),
  lapIndex: count.nullable(),
  startTimeMs: timestampMs,
  endTimeMs: timestampMs,
  type: z.string().max(40).nullable(),
  stroke: z.string().max(40).nullable(),
  strokeCount: count.nullable(),
  elapsedTimeSeconds: nullableNonNegativeNumber,
  timerTimeSeconds: nullableNonNegativeNumber,
  distanceMeters: nullableNonNegativeNumber,
  poolLengthMeters: nullableNonNegativeNumber,
  averageSpeedMetersPerSecond: nullableNonNegativeNumber,
  averageCadenceRpm: nullableNonNegativeNumber,
  averageHeartRateBpm: nullableNonNegativeNumber,
  maximumHeartRateBpm: nullableNonNegativeNumber,
  swolf: nullableNonNegativeNumber,
  energyKilocalories: nullableNonNegativeNumber,
}).meta({ title: 'McpActivitySwimLength' });

const chartCatalogMetricSchemas = MCP_ACTIVITY_CHART_METRICS.map(metric => (
  z.strictObject({
    metric: z.literal(metric.id),
    label: z.literal(metric.label),
    canonicalUnit: z.literal(metric.unit),
  }).meta({ title: `McpChartCatalog_${metric.id}` })
)) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]];
const chartCatalogMetric = z.union(chartCatalogMetricSchemas);
const chartSeriesSchemas = MCP_ACTIVITY_CHART_METRICS.map(metric => (
  z.strictObject({
    metric: z.literal(metric.id),
    canonicalUnit: z.literal(metric.unit),
    xValues: z.array(number).max(MCP_ACTIVITY_CHART_MAX_POINTS),
    values: z.array(number).max(MCP_ACTIVITY_CHART_MAX_POINTS),
    sourceSampleCount: count,
    returnedSampleCount: count,
    missingSampleCount: count,
  }).superRefine((value, context) => {
    if (value.xValues.length !== value.values.length) {
      context.addIssue({
        code: 'custom',
        message: 'Chart xValues and values must have equal lengths.',
      });
    }
    if (value.returnedSampleCount !== value.values.length) {
      context.addIssue({
        code: 'custom',
        path: ['returnedSampleCount'],
        message: 'returnedSampleCount must match values length.',
      });
    }
  }).meta({ title: `McpChartSeries_${metric.id}` })
)) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]];
const chartSeries = z.union(chartSeriesSchemas);
const chartLocation = z.strictObject({
  xValues: z.array(number).max(MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS),
  latitudeDegrees: z.array(z.number().min(-90).max(90))
    .max(MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS),
  longitudeDegrees: z.array(z.number().min(-180).max(180))
    .max(MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS),
  sourceSampleCount: count,
  returnedSampleCount: count,
  missingSampleCount: count,
}).superRefine((value, context) => {
  if (
    value.xValues.length !== value.latitudeDegrees.length
    || value.xValues.length !== value.longitudeDegrees.length
    || value.returnedSampleCount !== value.xValues.length
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Chart location arrays and returnedSampleCount must align.',
    });
  }
}).meta({ title: 'McpChartLocation' });
const chartDataBaseShape = {
  activityType: z.string().min(1).max(120),
  xAxis: z.enum(['elapsed_time', 'distance']),
  xAxisUnit: z.enum(['seconds', 'meters']),
  series: z.array(chartSeries).min(1).max(4),
};

const activityMetricValue = z.strictObject({
  type: z.string().min(1).max(160),
  displayType: z.string().min(1).max(160),
  unit: z.string().max(80),
  unitSystem: z.enum(['metric', 'imperial']),
  value: nullableNumber,
  available: z.boolean(),
}).superRefine((value, context) => {
  if (value.available !== (value.value !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['available'],
      message: 'available must match value presence.',
    });
  }
}).meta({ title: 'McpActivityMetricValue' });

const routeSummaryBaseShape = {
  routeRef: MCP_ROUTE_REFERENCE_OUTPUT_SCHEMA,
  appUrl: MCP_APP_URL_OUTPUT_SCHEMA,
  name: z.string().min(1).max(120),
  createdAtMs: nullableTimestampMs,
  importedAtMs: timestampMs,
  updatedAtMs: nullableTimestampMs,
  activityTypes: z.array(z.string().min(1).max(120)),
  routeCount: count.nullable(),
  waypointCount: count.nullable(),
  pointCount: count.nullable(),
  stats: activityStats,
};
const routeSummaryWithoutLocation = z.strictObject({
  ...routeSummaryBaseShape,
  locationRedacted: z.literal(true),
}).meta({ title: 'McpRouteSummaryRedacted' });
const routeSummaryWithLocation = z.strictObject({
  ...routeSummaryBaseShape,
  bounds: MCP_BOUNDS_OUTPUT_SCHEMA.nullable(),
  locationRedacted: z.literal(false),
}).meta({ title: 'McpRouteSummaryWithLocation' });
const nearbyRoute = z.strictObject({
  ...routeSummaryBaseShape,
  bounds: MCP_BOUNDS_OUTPUT_SCHEMA.nullable(),
  locationRedacted: z.literal(false),
  nearestDistanceMeters: nonNegativeNumber,
  nearestPosition: MCP_COORDINATE_OUTPUT_SCHEMA,
  matchingSegmentIndex: count,
  matchingSegmentStartPosition: MCP_COORDINATE_OUTPUT_SCHEMA,
  matchingSegmentEndPosition: MCP_COORDINATE_OUTPUT_SCHEMA,
}).meta({ title: 'McpNearbyRoute' });

const routeSegment = z.strictObject({
  segmentIndex: count,
  activityType: z.string().max(120).nullable(),
  sourcePointCount: count,
  pointCount: count,
  bounds: MCP_BOUNDS_OUTPUT_SCHEMA.nullable(),
  startPosition: MCP_COORDINATE_OUTPUT_SCHEMA,
  endPosition: MCP_COORDINATE_OUTPUT_SCHEMA,
  encodedPolyline: z.string().min(1).max(512 * 1024),
}).meta({ title: 'McpRouteSegment' });
const routeGeometry = z.strictObject({
  version: z.literal(1),
  encoding: z.literal('polyline5'),
  precision: z.literal(5),
  sourcePointCount: count,
  pointCount: count,
  bounds: MCP_BOUNDS_OUTPUT_SCHEMA.nullable(),
  segments: z.array(routeSegment),
}).meta({ title: 'McpRouteGeometry' });
const routeWaypoint = z.strictObject({
  index: count,
  latitudeDegrees: z.number().min(-90).max(90),
  longitudeDegrees: z.number().min(-180).max(180),
  altitudeMeters: nullableNumber,
  distanceMeters: nullableNonNegativeNumber,
  routeIndex: count.nullable(),
  routePointIndex: count.nullable(),
  type: z.string().max(40).nullable(),
}).meta({ title: 'McpRouteWaypoint' });

const metricAggregation = z.strictObject({
  dataType: z.string().min(1).max(160),
  valueType: z.enum([
    ChartDataValueTypes.Total,
    ChartDataValueTypes.Average,
    ChartDataValueTypes.Minimum,
    ChartDataValueTypes.Maximum,
  ]),
  categoryType: z.enum([
    ChartDataCategoryTypes.DateType,
    ChartDataCategoryTypes.ActivityType,
  ]),
  resolvedTimeInterval: z.union([
    z.literal(TimeIntervals.Auto),
    z.literal(TimeIntervals.Hourly),
    z.literal(TimeIntervals.Daily),
    z.literal(TimeIntervals.Weekly),
    z.literal(TimeIntervals.BiWeekly),
    z.literal(TimeIntervals.Monthly),
    z.literal(TimeIntervals.Quarterly),
    z.literal(TimeIntervals.Semesterly),
    z.literal(TimeIntervals.Yearly),
  ]),
  buckets: z.array(z.strictObject({
    bucketKey: z.union([z.string().max(200), number]),
    time: timestampMs.optional(),
    totalCount: count,
    aggregateValue: number,
    seriesValues: z.record(
      z.string().min(1).max(200),
      number,
    ),
    seriesCounts: z.record(
      z.string().min(1).max(200),
      count,
    ),
  })),
}).meta({ title: 'McpMetricAggregation' });

function paginatedItems<T extends z.ZodType>(items: T) {
  return z.strictObject({
    items: z.array(items),
    ...MCP_PAGINATION_OUTPUT_SHAPE,
  });
}

function chartDataOutput(includeLocation: boolean) {
  const schema = z.strictObject({
    ...chartDataBaseShape,
    ...(includeLocation ? {
      location: chartLocation.optional(),
    } : {}),
  }).superRefine((value, context) => {
    const expectedUnit = value.xAxis === 'elapsed_time' ? 'seconds' : 'meters';
    if (value.xAxisUnit !== expectedUnit) {
      context.addIssue({
        code: 'custom',
        path: ['xAxisUnit'],
        message: 'xAxisUnit does not match xAxis.',
      });
    }
  });
  return schema.meta({
    allOf: [{
      if: {
        properties: { xAxis: { const: 'elapsed_time' } },
        required: ['xAxis'],
      },
      then: {
        properties: { xAxisUnit: { const: 'seconds' } },
      },
    }, {
      if: {
        properties: { xAxis: { const: 'distance' } },
        required: ['xAxis'],
      },
      then: {
        properties: { xAxisUnit: { const: 'meters' } },
      },
    }],
  });
}

/**
 * Mandatory public MCP projection contract.
 *
 * This is not a second metric-discovery registry: it only describes and
 * validates the already-projected wire payloads returned by public tools.
 * Every public tool key is compile-time exhaustive, and location-sensitive
 * variants deliberately omit fields that the current scopes cannot expose.
 */
export function createMcpOutputSchemaRegistry(scope: McpOutputSchemaScope) {
  const registry = {
    list_measurement_types: z.strictObject({
      measurementTypes: z.array(measurementDescriptor),
    }),
    query_measurements: z.strictObject({
      measurementType: measurementDescriptor,
      ...MCP_DATE_RANGE_OUTPUT_SHAPE,
      aggregation: measurementAggregation,
      interval: measurementInterval,
      measurementCount: count,
      points: z.array(measurementPoint),
      summary: z.strictObject({
        firstPoint: measurementPoint,
        latestPoint: measurementPoint,
        absoluteChange: number,
      }).nullable(),
    }),
    list_metrics: z.strictObject({
      eventMetrics: z.array(MCP_METRIC_DESCRIPTOR_OUTPUT_SCHEMA),
      nextCursor: z.string().min(1).max(256).nullable(),
      scannedEventCount: count,
      eventScanTruncated: z.boolean(),
      derivedMetricKinds: z.array(derivedMetricKind),
      sleepCapabilities: z.strictObject({
        providers: z.array(sleepProvider),
        sessionSummaries: z.boolean(),
        aggregateGroupings: z.array(z.enum(['day', 'week', 'month'])),
      }),
    }),
    query_metric: z.strictObject({
      metric: MCP_METRIC_DESCRIPTOR_OUTPUT_SCHEMA,
      matchedEventCount: count,
      aggregation: metricAggregation,
    }),
    get_training_metric: trainingMetricOutput,
    list_sleep_sessions: z.strictObject({
      sessions: z.array(sleepSession),
      ...MCP_PAGINATION_OUTPUT_SHAPE,
    }),
    query_sleep_summary: z.strictObject({
      timeZone: z.string().min(1).max(80),
      groupBy: z.enum(['day', 'week', 'month']),
      matchedSessionCount: count,
      buckets: z.array(z.strictObject({
        bucketStartMs: timestampMs,
        sessionCount: count,
        providers: z.array(sleepProvider),
        totalDurationSeconds: nonNegativeNumber,
        averageDurationSeconds: nonNegativeNumber,
        averageInBedDurationSeconds: nullableNonNegativeNumber,
        averageScore: nullableNonNegativeNumber,
        stageDurationsSeconds: sleepStageDurations,
        averageVitals: z.strictObject({
          ...sleepVitalsShape,
        }),
      })),
    }),
    list_activity_types: z.strictObject({
      activityTypeCount: count,
      activityTypes: z.array(activityTypeDescriptor),
    }),
    list_activities: z.strictObject({
      scannedActivityCount: count,
      skippedActivityCount: count,
      activities: z.array(
        scope.activityLocation
          ? activitySummaryWithLocation
          : activitySummaryWithoutLocation,
      ),
      ...MCP_PAGINATION_OUTPUT_SHAPE,
      scanComplete: z.boolean(),
    }),
    find_activities_near_location: scope.activityLocation
      ? z.strictObject({
          location: nearbyLocationResult,
          scannedActivityCount: count,
          skippedActivityCount: count,
          activities: z.array(nearbyActivity),
          ...MCP_PAGINATION_OUTPUT_SHAPE,
          scanComplete: z.boolean(),
        })
      : unavailableLocationOutput,
    list_activity_laps: paginatedItems(lap),
    list_activity_jumps: paginatedItems(
      scope.activityLocation ? jumpWithLocation : jumpWithoutLocation,
    ),
    list_activity_swim_lengths: paginatedItems(swimLength),
    list_activity_chart_metrics: z.strictObject({
      activityType: z.string().min(1).max(120).nullable(),
      metrics: z.array(chartCatalogMetric),
      xAxes: z.tuple([
        z.strictObject({
          xAxis: z.literal('elapsed_time'),
          canonicalUnit: z.literal('seconds'),
        }),
        z.strictObject({
          xAxis: z.literal('distance'),
          canonicalUnit: z.literal('meters'),
        }),
      ]).meta({
        minItems: 2,
        maxItems: 2,
        additionalItems: false,
      }),
      pointLimits: z.strictObject({
        defaultPerMetric: z.literal(MCP_ACTIVITY_CHART_DEFAULT_POINTS),
        maximumPerMetric: z.literal(MCP_ACTIVITY_CHART_MAX_POINTS),
        defaultLocation: z.literal(MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS),
        maximumLocation: z.literal(MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS),
      }),
    }),
    get_activity_chart_data: chartDataOutput(scope.activityLocation),
    get_activity_metrics: z.strictObject({
      selectedMetricCount: count,
      availableMetricCount: count,
      metrics: z.array(activityMetricValue),
    }),
    list_routes: z.strictObject({
      scannedRouteCount: count,
      skippedRouteCount: count,
      routes: z.array(
        scope.routeLocation
          ? routeSummaryWithLocation
          : routeSummaryWithoutLocation,
      ),
      ...MCP_PAGINATION_OUTPUT_SHAPE,
      scanComplete: z.boolean(),
    }),
    find_routes_near_location: scope.routeLocation
      ? z.strictObject({
          location: nearbyLocationResult,
          scannedRouteCount: count,
          loadedRoutePreviewCount: count,
          decodedRoutePointCount: count,
          skippedRouteCount: count,
          routes: z.array(nearbyRoute),
          ...MCP_PAGINATION_OUTPUT_SHAPE,
          scanComplete: z.boolean(),
        })
      : unavailableLocationOutput,
    get_route_geometry: scope.routeLocation
      ? z.strictObject({
          geometry: routeGeometry,
        })
      : unavailableLocationOutput,
    list_route_waypoints: scope.routeLocation
      ? z.strictObject({
          waypoints: z.array(routeWaypoint),
          waypointCount: count,
        })
      : unavailableLocationOutput,
  } as const satisfies Record<PublicMcpToolName, z.ZodObject>;

  return registry;
}

export type McpOutputSchemaRegistry = ReturnType<
  typeof createMcpOutputSchemaRegistry
>;
