import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataActivityTypes,
  DataAscent,
  DataCadence,
  DataCadenceAvg,
  DataDistance,
  DataDepthAvg,
  DataDuration,
  DataEndPosition,
  DataEnergy,
  DataHeartRateAvg,
  DataJumpDistanceMax,
  DataJumpEvent,
  DataLatitudeDegrees,
  DataPowerAvg,
  DataPressureSACAvg,
  DataSpeedAvg,
  DataStartPosition,
  DataStrokeRate,
  DataStrokeRateAvg,
  DataWeight,
  encodeRoutePolyline5,
  EventImporterJSON,
  EventInterface,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DERIVED_METRICS_ENTRY_TYPES,
} from '../../../shared/derived-metrics';
import {
  buildReadinessSignals,
} from '../../../shared/readiness';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import {
  buildTrainingLoadPoints,
} from '../../../shared/training-load';
import { TRAINING_DISCIPLINES } from '../../../shared/training-disciplines';
import {
  createMcpDataService,
  McpDataError,
  McpDataServiceDependencies,
  projectDerivedMetricPayloadForMcp,
  resolveMcpActivitySourcePath,
  resolveMcpRouteSourcePath,
  SAFE_ACTIVITY_LOCATION_FIELDS,
} from './data.service';
import {
  MCP_DERIVED_PAYLOAD_SCHEMAS,
  MCP_TRAINING_METRIC_SCHEMA_VERSION,
} from './derived-output-schemas';
import { McpActivityChartRateLimitError } from './activity-chart-rate-limit';
import { createMcpOutputSchemaRegistry } from './tool-output-schemas';

function makeEvent(
  startDate: string,
  value: number,
  activityType = ActivityTypes.Running,
) {
  return {
    startDate: new Date(startDate),
    getActivityTypesAsArray: () => [activityType],
    getStat: (type: string) => {
      if (type === DataActivityTypes.type) {
        return {
          getValue: () => [activityType],
          getDisplayValue: () => activityType,
        };
      }
      return type === DataDistance.type ? { getValue: () => value } : null;
    },
  } as unknown as EventInterface;
}

function sleepDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sleep-1',
    data: {
      source: {
        provider: SLEEP_PROVIDERS.GarminAPI,
        sourceSessionKey: 'private-source-key',
        providerUserId: 'private-provider-user',
      },
      sleepDate: '2024-04-01',
      startTimeMs: Date.parse('2024-03-31T20:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-01T04:00:00.000Z'),
      durationSeconds: 8 * 60 * 60,
      inBedDurationSeconds: 8.5 * 60 * 60,
      isNap: false,
      stages: [{ stage: 'deep', startTimeMs: 1, endTimeMs: 2 }],
      stageDurationsSeconds: {
        deep: 7200,
        light: 14400,
      },
      score: {
        value: 82,
        qualifier: 'good',
        components: { private: true },
      },
      vitals: {
        averageHeartRateBpm: 50,
        overnightHrvMs: 55,
      },
      hrvSamples: [{ value: 123 }],
      spo2Samples: [{ value: 99 }],
      respirationSamples: [{ value: 12 }],
      providerFields: { garmin: { private: true } },
      ...overrides,
    },
  };
}

function activityDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'activity-1',
    data: {
      eventID: 'event-1',
      eventStartDate: new Date('2026-07-01T08:00:00.000Z'),
      startDate: Date.parse('2026-07-01T08:00:00.000Z'),
      endDate: Date.parse('2026-07-01T09:00:00.000Z'),
      type: ActivityTypes.Cycling,
      name: 'Private MTB workout',
      creator: { name: 'Private device' },
      sourceActivityKey: 'private-source-key',
      powerMeter: true,
      trainer: false,
      stats: {
        [DataDuration.type]: 3600,
        [DataDistance.type]: 20_000,
        [DataAscent.type]: 600,
        [DataSpeedAvg.type]: 5.5,
        [DataHeartRateAvg.type]: 145,
        [DataPowerAvg.type]: 220,
        [DataCadenceAvg.type]: 82,
        [DataEnergy.type]: 700,
        'Jump Count': 2,
        [DataStartPosition.type]: {
          latitudeDegrees: 39.6671,
          longitudeDegrees: 20.8374,
          accuracyMeters: 3,
          sourceKey: 'private-position-source',
        },
        [DataEndPosition.type]: {
          latitudeDegrees: 39.6722,
          longitudeDegrees: 20.8428,
          providerPayload: 'private-position-payload',
        },
        'Owner controlled private stat': 'do-not-return',
      },
      ...overrides,
    },
  };
}

function routeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'route-1',
    data: {
      name: 'Ridge loop',
      createdAt: new Date('2026-06-30T10:00:00.000Z'),
      importedAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
      activityTypes: [ActivityTypes.Cycling],
      routeCount: 1,
      waypointCount: 2,
      pointCount: 200,
      bounds: {
        minLatitudeDegrees: 39.6,
        maxLatitudeDegrees: 39.8,
        minLongitudeDegrees: 20.7,
        maxLongitudeDegrees: 20.9,
      },
      stats: {
        [DataDistance.type]: 30_000,
        [DataAscent.type]: 900,
        'Owner controlled private stat': 'do-not-return',
      },
      sourceSummary: { providerRouteId: 'private-provider-route' },
      deliverySummaries: [{ destination: 'private-destination' }],
      ...overrides,
    },
  };
}

describe('MCP data service', () => {
  let dependencies: McpDataServiceDependencies;

  beforeEach(() => {
    dependencies = {
      now: vi.fn().mockReturnValue(Date.parse('2026-07-27T12:00:00.000Z')),
      fetchMetricDiscoveryDocuments: vi.fn().mockResolvedValue([]),
      fetchEventDocuments: vi.fn().mockResolvedValue([]),
      fetchDerivedSnapshot: vi.fn().mockResolvedValue(null),
      fetchDerivedSnapshotMetadataDocuments: vi.fn().mockResolvedValue([]),
      fetchSleepDocuments: vi.fn().mockResolvedValue([]),
      fetchReadinessSleepDocuments: vi.fn().mockResolvedValue([]),
      fetchActivityDocuments: vi.fn().mockResolvedValue([]),
      fetchNearbyActivityDocuments: vi.fn().mockResolvedValue([]),
      fetchActivityDetailDocument: vi.fn().mockResolvedValue(null),
      fetchActivityMetricDocument: vi.fn().mockResolvedValue(null),
      fetchActivityOverviewDocument: vi.fn().mockResolvedValue(null),
      hasActivityChartSource: vi.fn().mockResolvedValue(false),
      fetchActivityRankingDocuments: vi.fn().mockResolvedValue([]),
      fetchActivityChartContext: vi.fn().mockResolvedValue(null),
      downloadActivityChartSource: vi.fn().mockResolvedValue(Buffer.from('activity')),
      consumeActivityChartRateLimit: vi.fn().mockResolvedValue(undefined),
      buildActivityChartData: vi.fn().mockResolvedValue({
        activityType: ActivityTypes.Cycling,
        xAxis: 'elapsed_time',
        xAxisUnit: 'seconds',
        series: [],
      }),
      fetchRouteDocuments: vi.fn().mockResolvedValue([]),
      fetchRouteDocument: vi.fn().mockResolvedValue(null),
      downloadRouteSource: vi.fn().mockResolvedValue(Buffer.from('route')),
      parseRouteWaypoints: vi.fn().mockResolvedValue([]),
      forwardGeocodeLocation: vi.fn().mockResolvedValue({
        resolvedLabel: 'Ioannina, Epirus, Greece',
        center: {
          latitudeDegrees: 39.665,
          longitudeDegrees: 20.8537,
        },
        featureType: 'place',
      }),
      consumeGeocodingRateLimit: vi.fn().mockResolvedValue(undefined),
      importEvent: vi.fn(),
    };
  });

  it('restricts route source reads to the owning route path and project bucket', () => {
    expect(resolveMcpRouteSourcePath(
      'user-1',
      'route-1',
      {
        path: 'users/user-1/routes/route-1/uploads/attempt/original.gpx',
        bucket: 'project.appspot.com',
      },
      'project.appspot.com',
    )).toBe('users/user-1/routes/route-1/uploads/attempt/original.gpx');
    expect(() => resolveMcpRouteSourcePath(
      'user-1',
      'route-1',
      {
        path: 'users/user-1/routes/route-2/uploads/attempt/original.gpx',
        bucket: 'project.appspot.com',
      },
      'project.appspot.com',
    )).toThrow(expect.objectContaining({ code: 'detail_not_available' }));
    expect(() => resolveMcpRouteSourcePath(
      'user-1',
      'route-1',
      {
        path: 'users/user-1/routes/route-1/uploads/attempt/original.gpx',
        bucket: 'other-project.appspot.com',
      },
      'project.appspot.com',
    )).toThrow(expect.objectContaining({ code: 'detail_not_available' }));
  });

  it('restricts activity source reads to the owning event path and approved buckets', () => {
    const source = {
      path: 'users/user-1/events/event-1/uploads/attempt/original.fit',
      bucket: 'project.appspot.com',
      startDate: new Date(),
    };
    expect(resolveMcpActivitySourcePath(
      'user-1',
      'event-1',
      source,
      ['project.appspot.com'],
    )).toBe(source.path);
    expect(() => resolveMcpActivitySourcePath(
      'user-1',
      'event-1',
      { ...source, path: 'users/user-2/events/event-1/original.fit' },
      ['project.appspot.com'],
    )).toThrow(expect.objectContaining({ code: 'detail_not_available' }));
    expect(() => resolveMcpActivitySourcePath(
      'user-1',
      'event-1',
      { ...source, path: 'users/user-1/events/event-1/../event-2/original.fit' },
      ['project.appspot.com'],
    )).toThrow(expect.objectContaining({ code: 'detail_not_available' }));
    expect(() => resolveMcpActivitySourcePath(
      'user-1',
      'event-1',
      { ...source, path: 'users/user-1/events/event-1/%2e%2e/original.fit' },
      ['project.appspot.com'],
    )).toThrow(expect.objectContaining({ code: 'detail_not_available' }));
    expect(() => resolveMcpActivitySourcePath(
      'user-1',
      'event-1',
      { ...source, bucket: 'other.appspot.com' },
      ['project.appspot.com'],
    )).toThrow(expect.objectContaining({ code: 'detail_not_available' }));
  });

  it('projects exact activity and MTB jump coordinates without leaking raw activity data', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const activities = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
      includeLocation: true,
    });

    expect(activities.activities).toEqual([{
      activityRef: expect.any(String),
      appUrl: 'https://quantified-self.io/user/user-1/event/event-1',
      startTimeMs: Date.parse('2026-07-01T08:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-01T09:00:00.000Z'),
      activityType: ActivityTypes.Cycling,
      powerMeter: true,
      trainer: false,
      jumpCount: 2,
      startPosition: {
        latitudeDegrees: 39.6671,
        longitudeDegrees: 20.8374,
      },
      endPosition: {
        latitudeDegrees: 39.6722,
        longitudeDegrees: 20.8428,
      },
      locationRedacted: false,
      supportedDetailKinds: ['laps', 'jumps', 'swim_lengths'],
      stats: expect.objectContaining({
        durationSeconds: 3600,
        distanceMeters: 20_000,
        ascentMeters: 600,
        averageSpeedMetersPerSecond: 5.5,
        averageHeartRateBpm: 145,
        averagePowerWatts: 220,
        averageCadenceRpm: 82,
        energyKilocalories: 700,
      }),
    }]);
    const activityRef = activities.activities[0].activityRef;
    expect(Buffer.from(activityRef, 'base64url').toString('utf8')).not.toContain('activity-1');
    expect(JSON.stringify(activities.activities[0])).not.toContain('Private device');
    expect(JSON.stringify(activities.activities[0])).not.toContain('private-source-key');
    expect(JSON.stringify(activities.activities[0])).not.toContain('private-position-source');
    expect(JSON.stringify(activities.activities[0])).not.toContain('private-position-payload');
    expect(JSON.stringify(activities.activities[0])).not.toContain('accuracyMeters');
    expect(JSON.stringify(activities.activities[0])).not.toContain('Owner controlled');

    vi.mocked(dependencies.fetchActivityDetailDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        events: [{
          [DataJumpEvent.type]: {
            timestamp: 624,
            jumpData: {
              distance: 2.069,
              height: 0.42,
              hang_time: 0.36,
              speed: 5.748,
              rotations: 0.2,
              score: 62.44,
              position_lat: 39.6679,
              position_long: 20.8382,
              providerPayload: 'private',
            },
          },
          otherPrivateEventField: true,
        }, {
          'Timer Event': {
            timestamp: 1,
            providerPayload: 'private',
          },
        }],
      },
    });

    const jumps = await service.listActivityJumps({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      includeLocation: true,
    });

    expect(jumps).toEqual({
      items: [{
        index: 0,
        timestampMs: 624_000,
        distanceMeters: 2.069,
        heightMeters: 0.42,
        hangTimeSeconds: 0.36,
        speedMetersPerSecond: 5.748,
        rotations: 0.2,
        score: 62.44,
        latitudeDegrees: 39.6679,
        longitudeDegrees: 20.8382,
        locationRedacted: false,
      }],
      nextCursor: null,
    });
    expect(JSON.stringify(jumps)).not.toContain('providerPayload');
    expect(dependencies.fetchActivityDetailDocument).toHaveBeenCalledWith(
      'user-1',
      'activity-1',
      'jumps',
      true,
    );
  });

  it('normalizes historical absolute jump timestamps to elapsed milliseconds', async () => {
    const startTimeMs = Date.parse('2026-07-01T08:00:00.000Z');
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument({ startDate: startTimeMs }),
    ]);
    const service = createMcpDataService(dependencies);
    const activities = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      limit: 1,
    });
    vi.mocked(dependencies.fetchActivityDetailDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        startDate: startTimeMs,
        events: [{
          [DataJumpEvent.type]: {
            timestamp: startTimeMs + 624_000,
            jumpData: { distance: 10.41, score: 92 },
          },
        }, {
          [DataJumpEvent.type]: {
            timestamp: (startTimeMs + 900_000) / 1_000,
            jumpData: { distance: 8.2, score: 80 },
          },
        }],
      },
    });

    const jumps = await service.listActivityJumps({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: activities.activities[0].activityRef,
    });

    expect(jumps.items.map(jump => jump.timestampMs)).toEqual([
      624_000,
      900_000,
    ]);
  });

  it('includes both start and end coordinate leaves in nearby-activity reads', () => {
    expect(SAFE_ACTIVITY_LOCATION_FIELDS.map(field => String(field))).toEqual([
      'stats.`Start Position`.latitudeDegrees',
      'stats.`Start Position`.longitudeDegrees',
      'stats.`End Position`.latitudeDegrees',
      'stats.`End Position`.longitudeDegrees',
    ]);
  });

  it('redacts activity and route coordinates while preserving non-location summaries', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      routeDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const activities = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
    });
    const routes = await service.listRoutes({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
    });
    expect(activities.activities[0]).toMatchObject({
      activityType: ActivityTypes.Cycling,
      jumpCount: 2,
      locationRedacted: true,
    });
    expect(activities.activities[0]).not.toHaveProperty('startPosition');
    expect(activities.activities[0]).not.toHaveProperty('endPosition');
    expect(routes.routes[0]).toMatchObject({
      name: 'Ridge loop',
      pointCount: 200,
      locationRedacted: true,
    });
    expect(routes.routes[0]).not.toHaveProperty('bounds');
    expect(dependencies.fetchActivityDocuments).toHaveBeenCalledWith(
      'user-1',
      Date.parse('2026-07-01T00:00:00.000Z'),
      Date.parse('2026-07-02T00:00:00.000Z'),
      26,
      undefined,
      undefined,
    );
    expect(dependencies.fetchRouteDocuments).toHaveBeenCalledWith(
      'user-1',
      26,
      undefined,
      undefined,
    );

    vi.mocked(dependencies.fetchActivityDetailDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        events: [{
          [DataJumpEvent.type]: {
            timestamp: 624,
            jumpData: {
              distance: 2,
              score: 60,
              position_lat: 39.6679,
              position_long: 20.8382,
            },
          },
        }],
      },
    });
    const jumps = await service.listActivityJumps({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: activities.activities[0].activityRef,
    });
    expect(jumps.items[0]).toMatchObject({
      distanceMeters: 2,
      score: 60,
      locationRedacted: true,
    });
    expect(jumps.items[0]).not.toHaveProperty('latitudeDegrees');
    expect(jumps.items[0]).not.toHaveProperty('longitudeDegrees');
  });

  it('resolves chart sources from the connection-bound activity and rate-limits before reading', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const listed = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
    });
    vi.mocked(dependencies.fetchActivityChartContext).mockResolvedValue({
      event: {
        id: 'event-1',
        data: {
          originalFiles: [{
            path: 'users/user-1/events/event-1/original.fit',
            bucket: 'project.appspot.com',
            generation: '123',
          }],
        },
      },
      activities: [{
        id: 'activity-1',
        data: {
          eventID: 'event-1',
          startDate: Date.parse('2026-07-01T08:00:00.000Z'),
          endDate: Date.parse('2026-07-01T09:00:00.000Z'),
          type: ActivityTypes.Cycling,
          stats: {
            [DataDuration.type]: 3_600,
            [DataDistance.type]: 30_000,
          },
        },
      }],
    });
    vi.mocked(dependencies.buildActivityChartData).mockImplementation(
      async (context, _input, chartDependencies) => {
        expect(dependencies.consumeActivityChartRateLimit).toHaveBeenCalledWith(
          'user-1',
          'connection-1',
        );
        expect(context.sourceFiles[0]).toMatchObject({
          path: 'users/user-1/events/event-1/original.fit',
          bucket: 'project.appspot.com',
          generation: '123',
        });
        await chartDependencies.loadSource(context.sourceFiles[0], 1024);
        return {
          activityType: ActivityTypes.Cycling,
          xAxis: 'elapsed_time' as const,
          xAxisUnit: 'seconds',
          series: [],
        };
      },
    );

    const result = await service.getActivityChartData({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: listed.activities[0].activityRef,
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    });
    expect(result).toMatchObject({
      activityType: ActivityTypes.Cycling,
      xAxis: 'elapsed_time',
    });
    expect(dependencies.downloadActivityChartSource).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      expect.objectContaining({ generation: '123' }),
      1024,
    );
  });

  it('rejects incompatible chart metrics before rate limits or source access', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const listed = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
    });
    vi.mocked(dependencies.fetchActivityChartContext).mockResolvedValue({
      event: {
        id: 'event-1',
        data: {
          originalFiles: [{
            path: 'users/user-1/events/event-1/original.fit',
          }],
        },
      },
      activities: [{
        id: 'activity-1',
        data: {
          eventID: 'event-1',
          startDate: Date.parse('2026-07-01T08:00:00.000Z'),
          endDate: Date.parse('2026-07-01T09:00:00.000Z'),
          type: ActivityTypes.Cycling,
        },
      }],
    });

    await expect(service.getActivityChartData({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: listed.activities[0].activityRef,
      metrics: ['swim_pace'],
      xAxis: 'elapsed_time',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_metric',
    });
    expect(dependencies.consumeActivityChartRateLimit).not.toHaveBeenCalled();
    expect(dependencies.downloadActivityChartSource).not.toHaveBeenCalled();
    expect(dependencies.buildActivityChartData).not.toHaveBeenCalled();
  });

  it('does not expose parser, merge, storage, or rate-limit error details', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const listed = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
    });
    vi.mocked(dependencies.fetchActivityChartContext).mockResolvedValue({
      event: {
        id: 'event-1',
        data: {
          originalFiles: [{
            path: 'users/user-1/events/event-1/original.fit',
          }],
        },
      },
      activities: [{
        id: 'activity-1',
        data: {
          eventID: 'event-1',
          startDate: Date.parse('2026-07-01T08:00:00.000Z'),
          endDate: Date.parse('2026-07-01T09:00:00.000Z'),
          type: ActivityTypes.Cycling,
        },
      }],
    });

    vi.mocked(dependencies.consumeActivityChartRateLimit)
      .mockRejectedValueOnce(new McpActivityChartRateLimitError());
    await expect(service.getActivityChartData({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: listed.activities[0].activityRef,
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    })).rejects.toMatchObject({
      code: 'temporarily_unavailable',
      message: 'Activity chart parsing is temporarily rate limited. Retry later.',
    });

    vi.mocked(dependencies.consumeActivityChartRateLimit)
      .mockResolvedValue(undefined);
    vi.mocked(dependencies.buildActivityChartData)
      .mockRejectedValueOnce(new Error('parser leaked /private/storage/path.fit'));
    await expect(service.getActivityChartData({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: listed.activities[0].activityRef,
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    })).rejects.toMatchObject({
      code: 'detail_not_available',
      message: 'The original activity could not be charted.',
    });

    vi.mocked(dependencies.buildActivityChartData)
      .mockRejectedValueOnce(new Error('merge exceeded owner-secret limit'));
    await expect(service.getActivityChartData({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: listed.activities[0].activityRef,
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    })).rejects.toMatchObject({
      code: 'query_too_large',
      message: 'The activity chart request exceeds a processing limit.',
    });
  });

  it('returns only explicitly selected canonical numeric metrics for a referenced activity', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const activities = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
    });
    const activityRef = activities.activities[0].activityRef;
    vi.mocked(dependencies.fetchActivityMetricDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        stats: {
          [DataDistance.type]: 20_000,
          [DataAscent.type]: 'private-non-numeric-value',
          'Owner controlled private stat': 'do-not-return',
        },
        sourceActivityKey: 'private-source-key',
      },
    });

    const result = await service.getActivityMetrics({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      metrics: [
        DataDistance.type,
        DataAscent.type,
        DataDistance.type,
      ],
    });

    expect(dependencies.fetchActivityMetricDocument).toHaveBeenCalledWith(
      'user-1',
      'activity-1',
      [DataDistance.type, DataAscent.type],
    );
    expect(result).toEqual({
      selectedMetricCount: 2,
      availableMetricCount: 1,
      metrics: [{
        type: DataDistance.type,
        displayType: expect.any(String),
        unit: 'm',
        unitSystem: 'metric',
        value: 20_000,
        available: true,
      }, {
        type: DataAscent.type,
        displayType: expect.any(String),
        unit: 'm',
        unitSystem: 'metric',
        value: null,
        available: false,
      }],
    });
    expect(JSON.stringify(result)).not.toContain('Owner controlled');
    expect(JSON.stringify(result)).not.toContain('private-source-key');
    expect(JSON.stringify(result)).not.toContain('private-non-numeric-value');

    vi.mocked(dependencies.fetchActivityMetricDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        type: ActivityTypes.Rowing,
        stats: {
          [DataCadenceAvg.type]: 31,
          sourceKey: 'private-rowing-source',
        },
      },
    });
    const strokeRate = await service.getActivityMetrics({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      metrics: [DataStrokeRateAvg.type],
    });
    expect(strokeRate.metrics).toEqual([expect.objectContaining({
      type: DataStrokeRateAvg.type,
      unit: 'spm',
      value: 31,
      available: true,
    })]);
    expect(JSON.stringify(strokeRate)).not.toContain('private-rowing-source');

    vi.mocked(dependencies.fetchActivityMetricDocument).mockClear();
    await expect(service.getActivityMetrics({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      metrics: [DataLatitudeDegrees.type],
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_metric',
    });
    expect(dependencies.fetchActivityMetricDocument).not.toHaveBeenCalled();

    await expect(service.getActivityMetrics({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      metrics: [DataWeight.type],
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_metric',
    });
    expect(dependencies.fetchActivityMetricDocument).not.toHaveBeenCalled();

    await expect(service.getActivityMetrics({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      metrics: Array.from({ length: 26 }, () => DataDistance.type),
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchActivityMetricDocument).not.toHaveBeenCalled();

    vi.mocked(dependencies.fetchActivityMetricDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'different-event',
        stats: { [DataDistance.type]: 20_000 },
      },
    });
    await expect(service.getActivityMetrics({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      metrics: [DataDistance.type],
    })).rejects.toMatchObject<McpDataError>({
      code: 'detail_not_available',
    });

    vi.mocked(dependencies.fetchActivityMetricDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        stats: { [DataDistance.type]: 'x'.repeat(65 * 1024) },
      },
    });
    await expect(service.getActivityMetrics({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      metrics: [DataDistance.type],
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
  });

  it('returns one bounded activity overview without private fields or coordinates', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const listed = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      limit: 1,
    });
    vi.mocked(dependencies.fetchActivityOverviewDocument).mockResolvedValue(
      activityDocument({
        stats: {
          [DataDuration.type]: 3_600,
          [DataDistance.type]: 20_000,
          [DataPowerAvg.type]: 220,
          [DataAscent.type]: 'invalid-ascent',
          [DataWeight.type]: 71,
          [DataStartPosition.type]: {
            latitudeDegrees: 39.6671,
            longitudeDegrees: 20.8374,
          },
          sourceKey: 'private-source-key',
        },
        laps: [{
          lapId: 1,
          startDate: Date.parse('2026-07-01T08:00:00.000Z'),
          endDate: Date.parse('2026-07-01T08:30:00.000Z'),
          stats: {
            [DataDuration.type]: 1_800,
          },
          creator: { name: 'private-device' },
        }],
        events: [],
        swimLengths: undefined,
        originalFiles: ['private-file.fit'],
      }),
    );
    vi.mocked(dependencies.hasActivityChartSource).mockResolvedValue(true);

    const result = await service.getActivityOverview({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: listed.activities[0].activityRef,
    });

    expect(result).toMatchObject({
      activityType: ActivityTypes.Cycling,
      locationRedacted: true,
      details: [{
        kind: 'laps',
        status: 'available',
        count: 1,
      }, {
        kind: 'jumps',
        status: 'empty',
        count: 0,
      }, {
        kind: 'swim_lengths',
        status: 'unavailable',
        count: null,
      }],
      chartData: {
        sourceDeclared: true,
        candidateMetrics: expect.any(Array),
      },
    });
    expect(result.availableMetrics.map(metric => metric.type)).toContain(
      DataDistance.type,
    );
    expect(result.availableMetrics.map(metric => metric.type)).not.toContain(
      DataWeight.type,
    );
    expect(result.availableMetrics.map(metric => metric.type)).not.toContain(
      DataAscent.type,
    );
    expect(dependencies.hasActivityChartSource).toHaveBeenCalledWith(
      'user-1',
      'event-1',
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /latitudeDegrees|longitudeDegrees|sourceKey|private-device|private-file/,
    );
  });

  it('canonicalizes pre-19 stroke-rate summaries in an activity overview', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument({ type: ActivityTypes.Rowing }),
    ]);
    const service = createMcpDataService(dependencies);
    const listed = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      limit: 1,
    });
    expect(listed.activities[0].stats).toMatchObject({
      averageCadenceRpm: null,
      maximumCadenceRpm: null,
    });
    vi.mocked(dependencies.fetchActivityOverviewDocument).mockResolvedValue(
      activityDocument({
        type: ActivityTypes.Rowing,
        stats: {
          [DataCadenceAvg.type]: 29,
          sourceKey: 'private-rowing-source',
        },
        laps: [],
        events: [],
        swimLengths: [],
      }),
    );

    const result = await service.getActivityOverview({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: listed.activities[0].activityRef,
    });

    expect(result.availableMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: DataStrokeRateAvg.type,
        unit: 'spm',
      }),
    ]));
    expect(result.availableMetrics.map(metric => metric.type)).not.toContain(DataCadenceAvg.type);
    expect(JSON.stringify(result)).not.toContain('private-rowing-source');
  });

  it('does not mislabel pre-19 lap stroke rate as cadence', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument({ type: ActivityTypes.Rowing }),
    ]);
    const service = createMcpDataService(dependencies);
    const listed = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      limit: 1,
    });
    vi.mocked(dependencies.fetchActivityDetailDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        type: ActivityTypes.Rowing,
        laps: [{
          lapId: 1,
          type: 'Manual',
          startDate: Date.parse('2026-07-01T08:00:00.000Z'),
          endDate: Date.parse('2026-07-01T08:10:00.000Z'),
          stats: {
            [DataCadenceAvg.type]: 28,
          },
        }],
      },
    });

    const result = await service.listActivityLaps({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: listed.activities[0].activityRef,
    });

    expect(result.items[0].stats).toMatchObject({
      averageCadenceRpm: null,
      maximumCadenceRpm: null,
    });
  });

  it('rejects oversized activity overview projections before chart-source reads', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const listed = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      limit: 1,
    });
    vi.mocked(dependencies.fetchActivityOverviewDocument).mockResolvedValue(
      activityDocument({
        stats: {
          [DataDistance.type]: 'x'.repeat(65 * 1024),
        },
      }),
    );

    await expect(service.getActivityOverview({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: listed.activities[0].activityRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
    expect(dependencies.hasActivityChartSource).not.toHaveBeenCalled();
  });

  it('ranks bounded activity metrics with deterministic ties and no identity leakage', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const listed = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      limit: 1,
    });
    expect(listed.activities[0].activityRef).toEqual(expect.any(String));

    const first = activityDocument({
      eventID: 'event-1',
      type: ActivityTypes.Running,
      startDate: Date.parse('2026-07-01T08:00:00.000Z'),
      endDate: Date.parse('2026-07-01T09:00:00.000Z'),
      stats: {
        [DataAscent.type]: 300,
        sourceKey: 'private-first-source',
      },
    });
    const second = activityDocument({
      eventID: 'event-2',
      type: ActivityTypes.Running,
      startDate: Date.parse('2026-07-02T08:00:00.000Z'),
      endDate: Date.parse('2026-07-02T09:00:00.000Z'),
      stats: {
        [DataAscent.type]: 300,
      },
    });
    second.id = 'activity-2';
    const cycling = activityDocument({
      eventID: 'event-3',
      type: ActivityTypes.Cycling,
      startDate: Date.parse('2026-07-03T08:00:00.000Z'),
      endDate: Date.parse('2026-07-03T09:00:00.000Z'),
      stats: {
        [DataAscent.type]: 400,
      },
    });
    cycling.id = 'activity-3';
    const outsideRange = activityDocument({
      eventID: 'event-4',
      eventStartDate: Date.parse('2026-07-05T08:00:00.000Z'),
      type: ActivityTypes.Running,
      startDate: Date.parse('2026-07-05T08:00:00.000Z'),
      endDate: Date.parse('2026-07-05T09:00:00.000Z'),
      stats: {
        [DataAscent.type]: 500,
      },
    });
    outsideRange.id = 'activity-4';
    vi.mocked(dependencies.fetchActivityRankingDocuments).mockResolvedValue([
      {
        ...first,
        cursor: 'cursor-1',
      },
      {
        ...second,
        cursor: 'cursor-2',
      },
      {
        ...cycling,
        cursor: 'cursor-3',
      },
      {
        ...outsideRange,
        cursor: 'cursor-4',
      },
    ]);

    const result = await service.rankActivitiesByMetric({
      uid: 'user-1',
      connectionId: 'connection-1',
      metric: DataAscent.type,
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-04T00:00:00.000Z'),
      activityTypes: ['run'],
      order: 'highest',
      limit: 2,
    });

    expect(result).toMatchObject({
      metric: {
        type: DataAscent.type,
      },
      order: 'highest',
      scannedActivityCount: 4,
      matchedActivityCount: 2,
      activities: [{
        rank: 1,
        activityType: ActivityTypes.Running,
        value: 300,
        startTime: '2026-07-02T08:00:00.000Z',
      }, {
        rank: 2,
        activityType: ActivityTypes.Running,
        value: 300,
        startTime: '2026-07-01T08:00:00.000Z',
      }],
    });
    expect(dependencies.fetchActivityRankingDocuments).toHaveBeenCalledWith(
      'user-1',
      Date.parse('2026-07-01T00:00:00.000Z'),
      Date.parse('2026-07-04T00:00:00.000Z'),
      DataAscent.type,
      [ActivityTypes.Running],
      25,
      undefined,
    );
    expect(JSON.stringify(result)).not.toContain('private-first-source');

    vi.mocked(dependencies.fetchActivityRankingDocuments).mockClear();
    await expect(service.rankActivitiesByMetric({
      uid: 'user-1',
      connectionId: 'connection-1',
      metric: DataWeight.type,
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-04T00:00:00.000Z'),
      order: 'highest',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_metric',
    });
    expect(dependencies.fetchActivityRankingDocuments).not.toHaveBeenCalled();
  });

  it('ranks pre-19 stroke-rate activities through the canonical metric', async () => {
    vi.mocked(dependencies.fetchActivityRankingDocuments).mockResolvedValue([
      activityDocument({
        type: ActivityTypes.Rowing,
        stats: {
          [DataCadenceAvg.type]: 27,
          sourceKey: 'private-rowing-source',
        },
      }),
    ]);

    const result = await createMcpDataService(dependencies).rankActivitiesByMetric({
      uid: 'user-1',
      connectionId: 'connection-1',
      metric: DataStrokeRateAvg.type,
      activityTypes: [ActivityTypes.Rowing],
      order: 'highest',
      limit: 1,
    });

    expect(result).toMatchObject({
      metric: {
        type: DataStrokeRateAvg.type,
        unit: 'spm',
      },
      scannedActivityCount: 1,
      matchedActivityCount: 1,
      activities: [{
        rank: 1,
        activityType: ActivityTypes.Rowing,
        value: 27,
      }],
    });
    expect(JSON.stringify(result)).not.toContain('private-rowing-source');
  });

  it('rejects oversized projected activity ranking data', async () => {
    vi.mocked(dependencies.fetchActivityRankingDocuments).mockResolvedValue([
      activityDocument({
        stats: {
          [DataAscent.type]: 'x'.repeat(513 * 1024),
        },
      }),
    ]);

    await expect(createMcpDataService(dependencies).rankActivitiesByMetric({
      uid: 'user-1',
      connectionId: 'connection-1',
      metric: DataAscent.type,
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-04T00:00:00.000Z'),
      order: 'highest',
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
  });

  it('ranks all available matching activity history without returning a partial scan', async () => {
    const mountainBikeActivity = activityDocument({
      eventID: 'event-mtb-1',
      eventStartDate: Date.parse('2024-05-01T08:00:00.000Z'),
      type: ActivityTypes.MountainBiking,
      startDate: Date.parse('2024-05-01T08:00:00.000Z'),
      endDate: Date.parse('2024-05-01T09:00:00.000Z'),
      stats: {
        [DataJumpDistanceMax.type]: 8.4,
        providerPayload: 'private-provider-data',
      },
    });
    mountainBikeActivity.id = 'activity-mtb-1';
    vi.mocked(dependencies.fetchActivityRankingDocuments).mockResolvedValue([
      mountainBikeActivity,
    ]);
    const service = createMcpDataService(dependencies);

    const result = await service.rankActivitiesByMetric({
      uid: 'user-1',
      connectionId: 'connection-1',
      metric: DataJumpDistanceMax.type,
      activityGroup: 'mountain_biking_group',
      order: 'highest',
      limit: 1,
    });

    expect(result).toMatchObject({
      metric: { type: DataJumpDistanceMax.type },
      scannedActivityCount: 1,
      matchedActivityCount: 1,
      activities: [{
        rank: 1,
        startTime: '2024-05-01T08:00:00.000Z',
        activityType: ActivityTypes.MountainBiking,
        value: 8.4,
      }],
    });
    expect(dependencies.fetchActivityRankingDocuments).toHaveBeenCalledWith(
      'user-1',
      undefined,
      undefined,
      DataJumpDistanceMax.type,
      [
        ActivityTypes.DownhillCycling,
        'Enduro MTB',
        ActivityTypes.MountainBiking,
      ],
      25,
      undefined,
    );
    expect(result.activities[0]).not.toHaveProperty('startTimeMs');
    expect(result.activities[0]).not.toHaveProperty('endTimeMs');
    expect(result.activities[0]).not.toHaveProperty('endTime');
    expect(JSON.stringify(result)).not.toContain('private-provider-data');

    vi.mocked(dependencies.fetchActivityRankingDocuments).mockClear();
    await expect(service.rankActivitiesByMetric({
      uid: 'user-1',
      connectionId: 'connection-1',
      metric: DataJumpDistanceMax.type,
      startTimeMs: Date.parse('2026-01-01T00:00:00.000Z'),
      order: 'highest',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchActivityRankingDocuments).not.toHaveBeenCalled();

    await expect(service.rankActivitiesByMetric({
      uid: 'user-1',
      connectionId: 'connection-1',
      metric: DataJumpDistanceMax.type,
      activityGroup: 'invented_group',
      order: 'highest',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchActivityRankingDocuments).not.toHaveBeenCalled();

    await expect(service.rankActivitiesByMetric({
      uid: 'user-1',
      connectionId: 'connection-1',
      metric: DataJumpDistanceMax.type,
      activityGroup: 'unspecified_group',
      order: 'highest',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchActivityRankingDocuments).not.toHaveBeenCalled();
  });

  it('skips ranked activities whose stored start time cannot be represented as ISO', async () => {
    vi.mocked(dependencies.fetchActivityRankingDocuments).mockResolvedValue([
      activityDocument({
        startDate: Number.MAX_SAFE_INTEGER,
        endDate: Number.MAX_SAFE_INTEGER,
        stats: { [DataAscent.type]: 500 },
      }),
    ]);

    await expect(createMcpDataService(dependencies).rankActivitiesByMetric({
      uid: 'user-1',
      connectionId: 'connection-1',
      metric: DataAscent.type,
      order: 'highest',
    })).resolves.toMatchObject({
      scannedActivityCount: 1,
      matchedActivityCount: 0,
      activities: [],
    });
  });

  it('finds activities by exact start or end position without geocoding coordinates', async () => {
    vi.mocked(dependencies.fetchNearbyActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const result = await service.findActivitiesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: {
        latitudeDegrees: 39.6671,
        longitudeDegrees: 20.8374,
      },
      radiusMeters: 1_000,
    });

    expect(result).toMatchObject({
      location: {
        source: 'coordinates',
        resolvedLabel: null,
        latitudeDegrees: 39.6671,
        longitudeDegrees: 20.8374,
        radiusMeters: 1_000,
      },
      scannedActivityCount: 1,
      activities: [{
        activityType: ActivityTypes.Cycling,
        nearestPositionKind: 'start',
        nearestPosition: {
          latitudeDegrees: 39.6671,
          longitudeDegrees: 20.8374,
        },
        matchedPositionKinds: expect.arrayContaining(['start']),
      }],
      nextCursor: null,
      scanComplete: true,
    });
    expect(dependencies.fetchNearbyActivityDocuments).toHaveBeenCalledWith(
      'user-1',
      undefined,
      undefined,
      101,
      undefined,
    );
    expect(dependencies.consumeGeocodingRateLimit).not.toHaveBeenCalled();
    expect(dependencies.forwardGeocodeLocation).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-source-key');
  });

  it('geocodes place text before nearby activity scans and binds cursors to the query', async () => {
    vi.mocked(dependencies.fetchNearbyActivityDocuments).mockResolvedValue([
      activityDocument(),
      activityDocument({
        eventStartDate: new Date('2026-06-30T08:00:00.000Z'),
      }),
    ]);
    const service = createMcpDataService(dependencies);
    const first = await service.findActivitiesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: { query: 'Ioannina, Greece' },
      radiusMeters: 5_000,
      limit: 1,
    });

    expect(dependencies.consumeGeocodingRateLimit).toHaveBeenCalledWith(
      'user-1',
      'connection-1',
    );
    expect(dependencies.forwardGeocodeLocation).toHaveBeenCalledWith(
      'Ioannina, Greece',
    );
    expect(first.location).toMatchObject({
      source: 'mapbox',
      resolvedLabel: 'Ioannina, Epirus, Greece',
    });
    expect(first.nextCursor).toEqual(expect.any(String));

    await expect(service.findActivitiesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: {
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.8537,
      },
      radiusMeters: 6_000,
      limit: 1,
      cursor: first.nextCursor!,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
  });

  it('rejects invalid provider coordinates before starting a nearby scan', async () => {
    vi.mocked(dependencies.forwardGeocodeLocation).mockResolvedValue({
      resolvedLabel: 'Invalid place',
      center: {
        latitudeDegrees: 91,
        longitudeDegrees: 20,
      },
      featureType: 'place',
    });
    const service = createMcpDataService(dependencies);

    await expect(service.findActivitiesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: { query: 'Invalid place' },
    })).rejects.toMatchObject<McpDataError>({
      code: 'temporarily_unavailable',
    });
    expect(dependencies.fetchNearbyActivityDocuments).not.toHaveBeenCalled();
  });

  it('rejects ambiguous locations in the data boundary without calling Mapbox', async () => {
    const service = createMcpDataService(dependencies);

    await expect(service.findActivitiesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: {
        query: 'Ioannina, Greece',
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.8537,
      } as unknown as {
        query: string;
      },
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.consumeGeocodingRateLimit).not.toHaveBeenCalled();
    expect(dependencies.forwardGeocodeLocation).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { query: '   ' },
    { query: 'word '.repeat(21) },
  ])('rejects malformed locations before consuming geocoding quota', async (location) => {
    const service = createMcpDataService(dependencies);

    await expect(service.findActivitiesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: location as unknown as { query: string },
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.consumeGeocodingRateLimit).not.toHaveBeenCalled();
    expect(dependencies.forwardGeocodeLocation).not.toHaveBeenCalled();
  });

  it('normalizes a valid place before charging quota and geocoding', async () => {
    await createMcpDataService(dependencies).findActivitiesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: { query: '  Ioannina,\n Greece  ' },
    });

    expect(dependencies.consumeGeocodingRateLimit).toHaveBeenCalledOnce();
    expect(dependencies.forwardGeocodeLocation).toHaveBeenCalledWith(
      'Ioannina, Greece',
    );
  });

  it('projects only allowlisted fields from a resolved provider center', async () => {
    vi.mocked(dependencies.forwardGeocodeLocation).mockResolvedValue({
      resolvedLabel: 'Ioannina, Greece',
      center: {
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.8537,
        providerPayload: 'private-provider-data',
      } as unknown as {
        latitudeDegrees: number;
        longitudeDegrees: number;
      },
      featureType: 'place',
    });
    const result = await createMcpDataService(dependencies)
      .findActivitiesNearLocation({
        uid: 'user-1',
        connectionId: 'connection-1',
        appBaseUrl: 'https://quantified-self.io',
        location: { query: 'Ioannina, Greece' },
      });

    expect(result.location).toMatchObject({
      latitudeDegrees: 39.665,
      longitudeDegrees: 20.8537,
    });
    expect(JSON.stringify(result)).not.toContain('private-provider-data');
  });

  it('returns null for incomplete or invalid activity positions while preserving zero coordinates', async () => {
    const zeroAndPartial = activityDocument({
      eventID: 'event-zero',
      stats: {
        [DataStartPosition.type]: {
          latitudeDegrees: 0,
          longitudeDegrees: 0,
        },
        [DataEndPosition.type]: {
          latitudeDegrees: 39.6722,
        },
      },
    });
    zeroAndPartial.id = 'activity-zero';
    const outOfRange = activityDocument({
      eventID: 'event-range',
      stats: {
        [DataStartPosition.type]: {
          latitudeDegrees: 91,
          longitudeDegrees: 20,
        },
        [DataEndPosition.type]: {
          latitudeDegrees: 40,
          longitudeDegrees: -181,
        },
      },
    });
    outOfRange.id = 'activity-range';
    const nonFiniteAndMissing = activityDocument({
      eventID: 'event-non-finite',
      stats: {
        [DataStartPosition.type]: {
          latitudeDegrees: Number.POSITIVE_INFINITY,
          longitudeDegrees: 20,
        },
      },
    });
    nonFiniteAndMissing.id = 'activity-non-finite';
    const missingAndValidEnd = activityDocument({
      eventID: 'event-valid-end',
      stats: {
        [DataEndPosition.type]: {
          latitudeDegrees: -90,
          longitudeDegrees: 180,
        },
      },
    });
    missingAndValidEnd.id = 'activity-valid-end';
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      zeroAndPartial,
      outOfRange,
      nonFiniteAndMissing,
      missingAndValidEnd,
    ]);
    const service = createMcpDataService(dependencies);

    const result = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
      includeLocation: true,
    });

    expect(result.activities.map(activity => ({
      startPosition: activity.startPosition,
      endPosition: activity.endPosition,
    }))).toEqual([{
      startPosition: {
        latitudeDegrees: 0,
        longitudeDegrees: 0,
      },
      endPosition: null,
    }, {
      startPosition: null,
      endPosition: null,
    }, {
      startPosition: null,
      endPosition: null,
    }, {
      startPosition: null,
      endPosition: {
        latitudeDegrees: -90,
        longitudeDegrees: 180,
      },
    }]);
  });

  it('binds activity references and detail cursors to the MCP connection', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const activities = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
    });
    const activityRef = activities.activities[0].activityRef;

    await expect(service.listActivityLaps({
      uid: 'user-1',
      connectionId: 'connection-2',
      activityRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchActivityDetailDocument).not.toHaveBeenCalled();

    vi.mocked(dependencies.fetchActivityDetailDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        laps: [{
          lapId: 1,
          type: 'Manual',
          startDate: Date.parse('2026-07-01T08:00:00.000Z'),
          endDate: Date.parse('2026-07-01T08:10:00.000Z'),
          stats: { [DataDistance.type]: 1000 },
        }, {
          lapId: 2,
          type: 'Manual',
          startDate: Date.parse('2026-07-01T08:10:00.000Z'),
          endDate: Date.parse('2026-07-01T08:20:00.000Z'),
          stats: { [DataDistance.type]: 1100 },
        }],
      },
    });
    const firstPage = await service.listActivityLaps({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      limit: 1,
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    await expect(service.listActivityLaps({
      uid: 'user-1',
      connectionId: 'connection-2',
      activityRef,
      cursor: firstPage.nextCursor!,
      limit: 1,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    const secondPage = await service.listActivityLaps({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef,
      cursor: firstPage.nextCursor!,
      limit: 1,
    });
    expect(secondPage.items).toEqual([
      expect.objectContaining({
        index: 1,
        lapNumber: 2,
        stats: expect.objectContaining({ distanceMeters: 1100 }),
      }),
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('binds activity list cursors to the original date range', async () => {
    const secondActivity = activityDocument({
      eventID: 'event-2',
      eventStartDate: new Date('2026-07-01T07:00:00.000Z'),
      startDate: Date.parse('2026-07-01T07:00:00.000Z'),
      endDate: Date.parse('2026-07-01T08:00:00.000Z'),
    });
    secondActivity.id = 'activity-2';
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
      secondActivity,
    ]);
    const service = createMcpDataService(dependencies);
    const originalInput = {
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
      limit: 1,
    };
    const firstPage = await service.listActivities(originalInput);

    expect(firstPage.nextCursor).toEqual(expect.any(String));
    await expect(service.listActivities({
      ...originalInput,
      endTimeMs: Date.parse('2026-07-03T00:00:00.000Z'),
      cursor: firstPage.nextCursor!,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchActivityDocuments).toHaveBeenCalledTimes(1);

    await service.listActivities({
      ...originalInput,
      cursor: firstPage.nextCursor!,
    });
    expect(dependencies.fetchActivityDocuments).toHaveBeenLastCalledWith(
      'user-1',
      originalInput.startTimeMs,
      originalInput.endTimeMs,
      2,
      {
        timeMs: Date.parse('2026-07-01T08:00:00.000Z'),
        id: 'activity-1',
      },
      undefined,
    );
  });

  it('discovers unique canonical Sports Lib activity types with grouping hints', () => {
    const result = createMcpDataService(dependencies).listActivityTypes();
    const names = result.activityTypes.map(entry => entry.activityType);

    expect(result.activityTypeCount).toBe(result.activityTypes.length);
    expect(result.activityTypeCount).toBeGreaterThan(20);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(result.activityTypes).toContainEqual({
      activityType: ActivityTypes.Running,
      activityGroup: 'running_group',
      indoor: false,
    });
    expect(result.activityTypes).toContainEqual({
      activityType: 'Indoor Running',
      activityGroup: 'running_group',
      indoor: true,
    });
  });

  it('filters activity lists during a bounded scan and binds canonical types into cursors', async () => {
    const runningActivity = activityDocument({
      eventID: 'event-2',
      eventStartDate: new Date('2026-07-01T07:00:00.000Z'),
      startDate: Date.parse('2026-07-01T07:00:00.000Z'),
      endDate: Date.parse('2026-07-01T08:00:00.000Z'),
      type: ActivityTypes.Running,
    });
    runningActivity.id = 'activity-2';
    const olderRunningActivity = activityDocument({
      eventID: 'event-3',
      eventStartDate: new Date('2026-07-01T06:00:00.000Z'),
      startDate: Date.parse('2026-07-01T06:00:00.000Z'),
      endDate: Date.parse('2026-07-01T07:00:00.000Z'),
      type: ActivityTypes.Running,
    });
    olderRunningActivity.id = 'activity-3';
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
      runningActivity,
      olderRunningActivity,
    ]);
    const service = createMcpDataService(dependencies);
    const input = {
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      activityTypes: ['run'],
      limit: 1,
    };
    const firstPage = await service.listActivities(input);

    expect(firstPage).toMatchObject({
      scannedActivityCount: 2,
      skippedActivityCount: 1,
      activities: [
        expect.objectContaining({
          activityType: ActivityTypes.Running,
        }),
      ],
      nextCursor: expect.any(String),
      scanComplete: false,
    });
    expect(dependencies.fetchActivityDocuments).toHaveBeenCalledWith(
      'user-1',
      undefined,
      undefined,
      101,
      undefined,
      undefined,
    );

    await expect(service.listActivities({
      ...input,
      activityTypes: [ActivityTypes.Cycling],
      cursor: firstPage.nextCursor!,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchActivityDocuments).toHaveBeenCalledTimes(1);

    await service.listActivities({
      ...input,
      activityTypes: ['running'],
      cursor: firstPage.nextCursor!,
    });
    expect(dependencies.fetchActivityDocuments).toHaveBeenLastCalledWith(
      'user-1',
      undefined,
      undefined,
      101,
      {
        timeMs: Date.parse('2026-07-01T07:00:00.000Z'),
        id: 'activity-2',
      },
      undefined,
    );
  });

  it('keeps activity-list cursors bounded with the maximum type-filter count', async () => {
    const service = createMcpDataService(dependencies);
    const activityTypes = service.listActivityTypes().activityTypes
      .slice(0, 20)
      .map(entry => entry.activityType);
    const latestActivity = activityDocument({
      type: activityTypes[0],
    });
    const secondActivity = activityDocument({
      eventID: 'event-2',
      eventStartDate: new Date('2026-07-01T07:00:00.000Z'),
      startDate: Date.parse('2026-07-01T07:00:00.000Z'),
      endDate: Date.parse('2026-07-01T08:00:00.000Z'),
      type: activityTypes[0],
    });
    secondActivity.id = 'activity-2';
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      latestActivity,
      secondActivity,
    ]);

    const result = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      activityTypes,
      limit: 1,
    });

    expect(activityTypes).toHaveLength(20);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.nextCursor!.length).toBeLessThanOrEqual(512);
  });

  it('resolves DST-aware relative activity days and preserves their range in cursors', async () => {
    const latestActivity = activityDocument({
      eventStartDate: new Date('2026-03-29T10:00:00.000Z'),
      startDate: Date.parse('2026-03-29T10:00:00.000Z'),
      endDate: Date.parse('2026-03-29T11:00:00.000Z'),
    });
    const secondActivity = activityDocument({
      eventID: 'event-2',
      eventStartDate: new Date('2026-03-29T09:00:00.000Z'),
      startDate: Date.parse('2026-03-29T09:00:00.000Z'),
      endDate: Date.parse('2026-03-29T10:00:00.000Z'),
    });
    secondActivity.id = 'activity-2';
    vi.mocked(dependencies.now).mockReturnValue(
      Date.parse('2026-03-29T12:00:00.000Z'),
    );
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      latestActivity,
      secondActivity,
    ]);
    const service = createMcpDataService(dependencies);
    const input = {
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      relativePeriod: 'today' as const,
      timeZone: ' Europe/Helsinki ',
      limit: 1,
    };
    const firstPage = await service.listActivities(input);
    const expectedStartTimeMs = Date.parse('2026-03-28T22:00:00.000Z');
    const expectedEndTimeMs = Date.parse('2026-03-29T20:59:59.999Z');

    expect(dependencies.fetchActivityDocuments).toHaveBeenCalledWith(
      'user-1',
      expectedStartTimeMs,
      expectedEndTimeMs,
      2,
      undefined,
      undefined,
    );

    vi.mocked(dependencies.now).mockReturnValue(
      Date.parse('2026-03-30T12:00:00.000Z'),
    );
    await service.listActivities({
      ...input,
      cursor: firstPage.nextCursor!,
    });
    expect(dependencies.fetchActivityDocuments).toHaveBeenLastCalledWith(
      'user-1',
      expectedStartTimeMs,
      expectedEndTimeMs,
      2,
      {
        timeMs: Date.parse('2026-03-29T10:00:00.000Z'),
        id: 'activity-1',
      },
      undefined,
    );
  });

  it('resolves yesterday across a DST-long local calendar day', async () => {
    vi.mocked(dependencies.now).mockReturnValue(
      Date.parse('2026-10-26T12:00:00.000Z'),
    );
    const service = createMcpDataService(dependencies);

    await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      relativePeriod: 'yesterday',
      timeZone: 'Europe/Helsinki',
    });

    expect(dependencies.fetchActivityDocuments).toHaveBeenCalledWith(
      'user-1',
      Date.parse('2026-10-24T21:00:00.000Z'),
      Date.parse('2026-10-25T21:59:59.999Z'),
      26,
      undefined,
      undefined,
    );
  });

  it('validates relative activity period inputs before reading Firestore', async () => {
    const service = createMcpDataService(dependencies);
    const baseInput = {
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
    };

    await expect(service.listActivities({
      ...baseInput,
      relativePeriod: 'today',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_timezone',
    });
    await expect(service.listActivities({
      ...baseInput,
      timeZone: 'Europe/Helsinki',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    await expect(service.listActivities({
      ...baseInput,
      relativePeriod: 'yesterday',
      timeZone: 'Europe/Helsinki',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    await expect(service.listActivities({
      ...baseInput,
      activityTypes: ['not-a-sport'],
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    await expect(service.listActivities({
      ...baseInput,
      activityTypes: Array.from({ length: 21 }, () => ActivityTypes.Running),
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchActivityDocuments).not.toHaveBeenCalled();
  });

  it('does not report scan completion when a page boundary cannot be resumed safely', async () => {
    const unsafeActivity = activityDocument();
    unsafeActivity.id = '__unsafe__';
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      unsafeActivity,
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);

    await expect(service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      limit: 1,
    })).rejects.toMatchObject<McpDataError>({
      code: 'temporarily_unavailable',
    });

    const unsafeRoute = routeDocument();
    unsafeRoute.id = '__unsafe__';
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      unsafeRoute,
      routeDocument(),
    ]);
    await expect(service.listRoutes({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      limit: 1,
    })).rejects.toMatchObject<McpDataError>({
      code: 'temporarily_unavailable',
    });
  });

  it('lists the latest activity without date bounds and binds unbounded cursors', async () => {
    const secondActivity = activityDocument({
      eventID: 'event-2',
      eventStartDate: new Date('2026-07-01T07:00:00.000Z'),
      startDate: Date.parse('2026-07-01T07:00:00.000Z'),
      endDate: Date.parse('2026-07-01T08:00:00.000Z'),
    });
    secondActivity.id = 'activity-2';
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
      secondActivity,
    ]);
    const service = createMcpDataService(dependencies);
    const unboundedInput = {
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      limit: 1,
    };
    const firstPage = await service.listActivities(unboundedInput);

    expect(firstPage.activities).toEqual([
      expect.objectContaining({
        startTimeMs: Date.parse('2026-07-01T08:00:00.000Z'),
      }),
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(dependencies.fetchActivityDocuments).toHaveBeenCalledWith(
      'user-1',
      undefined,
      undefined,
      2,
      undefined,
      undefined,
    );

    await expect(service.listActivities({
      ...unboundedInput,
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
      cursor: firstPage.nextCursor!,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchActivityDocuments).toHaveBeenCalledTimes(1);

    await service.listActivities({
      ...unboundedInput,
      cursor: firstPage.nextCursor!,
    });
    expect(dependencies.fetchActivityDocuments).toHaveBeenLastCalledWith(
      'user-1',
      undefined,
      undefined,
      2,
      {
        timeMs: Date.parse('2026-07-01T08:00:00.000Z'),
        id: 'activity-1',
      },
      undefined,
    );
  });

  it('rejects a partially bounded activity list before reading Firestore', async () => {
    const service = createMcpDataService(dependencies);

    await expect(service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
      message: 'start and end must either both be provided or both be omitted.',
    });
    expect(dependencies.fetchActivityDocuments).not.toHaveBeenCalled();
  });

  it('projects swim lengths through an explicit field allowlist', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const activities = await service.listActivities({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
    });
    vi.mocked(dependencies.fetchActivityDetailDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        swimLengths: [{
          index: 4,
          lapIndex: 1,
          startDate: Date.parse('2026-07-01T08:00:00.000Z'),
          endDate: Date.parse('2026-07-01T08:00:30.000Z'),
          type: 'active',
          stroke: 'freestyle',
          strokes: 18,
          elapsedTime: 30,
          timerTime: 29,
          distance: 25,
          poolLength: 25,
          avgSpeed: 0.83,
          avgCadence: 36,
          avgHeartRate: 130,
          maxHeartRate: 142,
          swolf: 48,
          calories: 5,
          privateExtension: { source: 'provider' },
        }],
      },
    });

    const result = await service.listActivitySwimLengths({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: activities.activities[0].activityRef,
    });

    expect(result.items).toEqual([{
      index: 0,
      sourceIndex: 4,
      lapIndex: 1,
      startTimeMs: Date.parse('2026-07-01T08:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-01T08:00:30.000Z'),
      type: 'active',
      stroke: 'freestyle',
      strokeCount: 18,
      elapsedTimeSeconds: 30,
      timerTimeSeconds: 29,
      distanceMeters: 25,
      poolLengthMeters: 25,
      averageSpeedMetersPerSecond: 0.83,
      averageCadenceRpm: 36,
      averageHeartRateBpm: 130,
      maximumHeartRateBpm: 142,
      swolf: 48,
      energyKilocalories: 5,
    }]);
    expect(JSON.stringify(result)).not.toContain('privateExtension');
  });

  it('rejects oversized activity list and detail materialization', async () => {
    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument({
        stats: {
          [DataDuration.type]: 'x'.repeat((512 * 1024) + 1),
        },
      }),
    ]);
    const service = createMcpDataService(dependencies);
    const listInput = {
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
    };
    await expect(service.listActivities(listInput)).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });

    vi.mocked(dependencies.fetchActivityDocuments).mockResolvedValue([
      activityDocument(),
    ]);
    const activities = await service.listActivities(listInput);
    vi.mocked(dependencies.fetchActivityDetailDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        laps: [{
          privatePayload: 'x'.repeat((512 * 1024) + 1),
        }],
      },
    });
    await expect(service.listActivityLaps({
      uid: 'user-1',
      connectionId: 'connection-1',
      activityRef: activities.activities[0].activityRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
  });

  it('filters saved routes during a bounded scan and binds type and name filters into cursors', async () => {
    const runningRoute = routeDocument({
      name: 'River route',
      importedAt: new Date('2026-07-01T09:00:00.000Z'),
      activityTypes: [ActivityTypes.Running],
    });
    runningRoute.id = 'route-2';
    const matchingRoute = routeDocument({
      name: 'Ridge run',
      importedAt: new Date('2026-07-01T08:00:00.000Z'),
      activityTypes: [ActivityTypes.Running],
    });
    matchingRoute.id = 'route-3';
    const olderMatchingRoute = routeDocument({
      name: 'Ridge trail',
      importedAt: new Date('2026-07-01T07:00:00.000Z'),
      activityTypes: [ActivityTypes.Running],
    });
    olderMatchingRoute.id = 'route-4';
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      routeDocument(),
      runningRoute,
      matchingRoute,
      olderMatchingRoute,
    ]);
    const service = createMcpDataService(dependencies);
    const input = {
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      activityTypes: ['run'],
      search: 'ridge',
      limit: 1,
    };
    const firstPage = await service.listRoutes(input);

    expect(firstPage).toMatchObject({
      scannedRouteCount: 3,
      skippedRouteCount: 2,
      routes: [expect.objectContaining({
        name: 'Ridge run',
        activityTypes: [ActivityTypes.Running],
      })],
      nextCursor: expect.any(String),
      scanComplete: false,
    });
    expect(dependencies.fetchRouteDocuments).toHaveBeenCalledWith(
      'user-1',
      101,
      undefined,
      undefined,
    );

    await expect(service.listRoutes({
      ...input,
      search: 'river',
      cursor: firstPage.nextCursor!,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    await expect(service.listRoutes({
      ...input,
      activityTypes: [ActivityTypes.Cycling],
      cursor: firstPage.nextCursor!,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchRouteDocuments).toHaveBeenCalledTimes(1);

    await service.listRoutes({
      ...input,
      activityTypes: ['running'],
      search: ' RIDGE ',
      cursor: firstPage.nextCursor!,
    });
    expect(dependencies.fetchRouteDocuments).toHaveBeenLastCalledWith(
      'user-1',
      101,
      {
        timeMs: Date.parse('2026-07-01T08:00:00.000Z'),
        id: 'route-3',
      },
      undefined,
    );
  });

  it('keeps maximum saved-route filters in a bounded cursor', async () => {
    const service = createMcpDataService(dependencies);
    const activityTypes = service.listActivityTypes().activityTypes
      .slice(0, 20)
      .map(entry => entry.activityType);
    const search = '😀'.repeat(60);
    const matchingRoute = routeDocument({
      name: search,
      activityTypes: [activityTypes[0]],
    });
    const olderRoute = routeDocument({
      name: search,
      importedAt: new Date('2026-07-01T09:00:00.000Z'),
      activityTypes: [activityTypes[0]],
    });
    olderRoute.id = 'route-2';
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      matchingRoute,
      olderRoute,
    ]);

    const result = await service.listRoutes({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      activityTypes,
      search,
      limit: 1,
    });

    expect(activityTypes).toHaveLength(20);
    expect(search).toHaveLength(120);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.nextCursor!.length).toBeLessThanOrEqual(512);

    await expect(service.listRoutes({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      search: 'x'.repeat(121),
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchRouteDocuments).toHaveBeenCalledTimes(1);
  });

  it('projects saved-route summaries and polyline geometry without route provenance', async () => {
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      routeDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const routes = await service.listRoutes({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      includeLocation: true,
    });

    expect(routes.routes).toEqual([{
      routeRef: expect.any(String),
      appUrl: 'https://quantified-self.io/user/user-1/route/route-1',
      name: 'Ridge loop',
      createdAtMs: Date.parse('2026-06-30T10:00:00.000Z'),
      importedAtMs: Date.parse('2026-07-01T10:00:00.000Z'),
      updatedAtMs: Date.parse('2026-07-02T10:00:00.000Z'),
      activityTypes: [ActivityTypes.Cycling],
      routeCount: 1,
      waypointCount: 2,
      pointCount: 200,
      bounds: {
        minLatitudeDegrees: 39.6,
        maxLatitudeDegrees: 39.8,
        minLongitudeDegrees: 20.7,
        maxLongitudeDegrees: 20.9,
      },
      locationRedacted: false,
      stats: expect.objectContaining({
        distanceMeters: 30_000,
        ascentMeters: 900,
      }),
    }]);
    expect(JSON.stringify(routes)).not.toContain('private-provider-route');
    expect(JSON.stringify(routes)).not.toContain('private-destination');
    expect(dependencies.fetchRouteDocuments).toHaveBeenCalledWith(
      'user-1',
      26,
      undefined,
      true,
    );
    const routeRef = routes.routes[0].routeRef;
    expect(Buffer.from(routeRef, 'base64url').toString('utf8')).not.toContain('route-1');

    vi.mocked(dependencies.fetchRouteDocument).mockResolvedValue({
      id: 'route-1',
      data: {
        preview: {
          version: 1,
          encoding: 'polyline5',
          precision: 5,
          sourcePointCount: 200,
          pointCount: 2,
          bounds: routeDocument().data.bounds,
          segments: [{
            id: 'private-segment-id',
            name: 'Private segment name',
            activityType: ActivityTypes.Cycling,
            sourcePointCount: 200,
            pointCount: 2,
            encodedPolyline: '_p~iF~ps|U_ulLnnqC',
          }],
        },
      },
    });
    const geometry = await service.getRouteGeometry({
      uid: 'user-1',
      connectionId: 'connection-1',
      routeRef,
    });

    expect(geometry.geometry).toMatchObject({
      version: 1,
      encoding: 'polyline5',
      precision: 5,
      sourcePointCount: 200,
      pointCount: 2,
      segments: [{
        segmentIndex: 0,
        activityType: ActivityTypes.Cycling,
        startPosition: {
          latitudeDegrees: 38.5,
          longitudeDegrees: -120.2,
        },
        endPosition: {
          latitudeDegrees: 40.7,
          longitudeDegrees: -120.95,
        },
        encodedPolyline: '_p~iF~ps|U_ulLnnqC',
      }],
    });
    expect(JSON.stringify(geometry)).not.toContain('private-segment-id');
    expect(JSON.stringify(geometry)).not.toContain('Private segment name');
  });

  it('finds routes near any preview segment and returns the matched segment endpoints', async () => {
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      routeDocument({
        bounds: null,
      }),
    ]);
    vi.mocked(dependencies.fetchRouteDocument).mockResolvedValue({
      id: 'route-1',
      data: {
        preview: {
          version: 1,
          encoding: 'polyline5',
          precision: 5,
          sourcePointCount: 200,
          pointCount: 2,
          segments: [{
            activityType: ActivityTypes.Cycling,
            sourcePointCount: 200,
            pointCount: 2,
            bounds: {
              minLatitudeDegrees: 38.5,
              maxLatitudeDegrees: 40.7,
              minLongitudeDegrees: -120.95,
              maxLongitudeDegrees: -120.2,
            },
            encodedPolyline: '_p~iF~ps|U_ulLnnqC',
          }],
        },
      },
    });
    const service = createMcpDataService(dependencies);
    const result = await service.findRoutesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: {
        latitudeDegrees: 39.6,
        longitudeDegrees: -120.58,
      },
      radiusMeters: 25_000,
    });

    expect(result).toMatchObject({
      scannedRouteCount: 1,
      loadedRoutePreviewCount: 1,
      routes: [{
        name: 'Ridge loop',
        matchingSegmentIndex: 0,
        matchingSegmentStartPosition: {
          latitudeDegrees: 38.5,
          longitudeDegrees: -120.2,
        },
        matchingSegmentEndPosition: {
          latitudeDegrees: 40.7,
          longitudeDegrees: -120.95,
        },
      }],
      nextCursor: null,
      scanComplete: true,
    });
    expect(result.routes[0].nearestDistanceMeters).toBeLessThan(25_000);
    expect(JSON.stringify(result)).not.toContain('private-provider-route');
  });

  it('uses route bounds to avoid preview loads outside the search radius', async () => {
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      routeDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const result = await service.findRoutesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: {
        latitudeDegrees: -33.8688,
        longitudeDegrees: 151.2093,
      },
      radiusMeters: 1_000,
    });

    expect(result.routes).toEqual([]);
    expect(result).toMatchObject({
      scannedRouteCount: 1,
      loadedRoutePreviewCount: 0,
      skippedRouteCount: 1,
      scanComplete: true,
    });
    expect(dependencies.fetchRouteDocument).not.toHaveBeenCalled();
  });

  it('stops route preview fan-out at the per-page detail budget and returns a cursor', async () => {
    const routeDocuments = Array.from({ length: 14 }, (_, index) => ({
      ...routeDocument({
        name: `Route ${index}`,
        importedAt: new Date(Date.parse('2026-07-01T10:00:00.000Z') - index),
        bounds: {
          minLatitudeDegrees: -1,
          maxLatitudeDegrees: 1,
          minLongitudeDegrees: -1,
          maxLongitudeDegrees: 1,
        },
      }),
      id: `route-${index}`,
    }));
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue(routeDocuments);
    vi.mocked(dependencies.fetchRouteDocument).mockImplementation(
      async (_uid, routeId) => ({
        id: routeId,
        data: {
          preview: {
            version: 1,
            encoding: 'polyline5',
            precision: 5,
            sourcePointCount: 2,
            pointCount: 2,
            segments: [{
              sourcePointCount: 2,
              pointCount: 2,
              encodedPolyline: '_p~iF~ps|U_ulLnnqC',
            }],
          },
        },
      }),
    );
    const service = createMcpDataService(dependencies);
    const result = await service.findRoutesNearLocation({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
      location: {
        latitudeDegrees: 0,
        longitudeDegrees: 0,
      },
      radiusMeters: 1_000,
    });

    expect(result).toMatchObject({
      scannedRouteCount: 12,
      loadedRoutePreviewCount: 12,
      routes: [],
      scanComplete: false,
      nextCursor: expect.any(String),
    });
    expect(dependencies.fetchRouteDocument).toHaveBeenCalledTimes(12);
  });

  it('defers rather than skips the first route beyond the cumulative preview-byte budget', async () => {
    const routeDocuments = Array.from({ length: 6 }, (_, index) => ({
      ...routeDocument({
        name: `Route ${index}`,
        importedAt: new Date(Date.parse('2026-07-01T10:00:00.000Z') - index),
        bounds: {
          minLatitudeDegrees: -1,
          maxLatitudeDegrees: 1,
          minLongitudeDegrees: -1,
          maxLongitudeDegrees: 1,
        },
      }),
      id: `route-${index}`,
    }));
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue(routeDocuments);
    vi.mocked(dependencies.fetchRouteDocument).mockImplementation(
      async (_uid, routeId) => ({
        id: routeId,
        data: {
          preview: {
            version: 1,
            encoding: 'polyline5',
            precision: 5,
            sourcePointCount: 2,
            pointCount: 2,
            padding: 'x'.repeat(250_000),
            segments: [{
              sourcePointCount: 2,
              pointCount: 2,
              encodedPolyline: '_p~iF~ps|U_ulLnnqC',
            }],
          },
        },
      }),
    );
    const result = await createMcpDataService(dependencies)
      .findRoutesNearLocation({
        uid: 'user-1',
        connectionId: 'connection-1',
        appBaseUrl: 'https://quantified-self.io',
        location: {
          latitudeDegrees: 0,
          longitudeDegrees: 0,
        },
        radiusMeters: 1_000,
      });

    expect(result).toMatchObject({
      scannedRouteCount: 4,
      loadedRoutePreviewCount: 5,
      skippedRouteCount: 4,
      routes: [],
      scanComplete: false,
      nextCursor: expect.any(String),
    });
  });

  it('defers rather than skips the first route beyond the decoded-point budget', async () => {
    const routeDocuments = Array.from({ length: 5 }, (_, index) => ({
      ...routeDocument({
        name: `Route ${index}`,
        importedAt: new Date(Date.parse('2026-07-01T10:00:00.000Z') - index),
        bounds: {
          minLatitudeDegrees: -1,
          maxLatitudeDegrees: 1,
          minLongitudeDegrees: -1,
          maxLongitudeDegrees: 1,
        },
      }),
      id: `route-${index}`,
    }));
    const points = Array.from({ length: 5_000 }, (_, index) => ({
      latitudeDegrees: 38.5 + (index * 0.000001),
      longitudeDegrees: -120.2,
    }));
    const encodedPolyline = encodeRoutePolyline5(points);
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue(routeDocuments);
    vi.mocked(dependencies.fetchRouteDocument).mockImplementation(
      async (_uid, routeId) => ({
        id: routeId,
        data: {
          preview: {
            version: 1,
            encoding: 'polyline5',
            precision: 5,
            sourcePointCount: points.length,
            pointCount: points.length,
            segments: [{
              sourcePointCount: points.length,
              pointCount: points.length,
              encodedPolyline,
            }],
          },
        },
      }),
    );
    const result = await createMcpDataService(dependencies)
      .findRoutesNearLocation({
        uid: 'user-1',
        connectionId: 'connection-1',
        appBaseUrl: 'https://quantified-self.io',
        location: {
          latitudeDegrees: 0,
          longitudeDegrees: 0,
        },
        radiusMeters: 1_000,
      });

    expect(result).toMatchObject({
      scannedRouteCount: 4,
      loadedRoutePreviewCount: 5,
      decodedRoutePointCount: 20_000,
      skippedRouteCount: 4,
      routes: [],
      scanComplete: false,
      nextCursor: expect.any(String),
    });
  });

  it('charges invalid preview decoding against the cumulative point-work budget', async () => {
    const routeDocuments = Array.from({ length: 5 }, (_, index) => ({
      ...routeDocument({
        name: `Invalid route ${index}`,
        importedAt: new Date(Date.parse('2026-07-01T10:00:00.000Z') - index),
        bounds: {
          minLatitudeDegrees: -1,
          maxLatitudeDegrees: 1,
          minLongitudeDegrees: -1,
          maxLongitudeDegrees: 1,
        },
      }),
      id: `route-${index}`,
    }));
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue(routeDocuments);
    vi.mocked(dependencies.fetchRouteDocument).mockImplementation(
      async (_uid, routeId) => ({
        id: routeId,
        data: {
          preview: {
            version: 1,
            encoding: 'polyline5',
            precision: 5,
            sourcePointCount: 5_000,
            pointCount: 5_000,
            segments: [{
              sourcePointCount: 5_000,
              pointCount: 5_000,
              // Exactly 5,000 encoded 0,0 points. Sports Lib filters these
              // coordinates after decoding, so every preview is invalid.
              encodedPolyline: '??'.repeat(5_000),
            }],
          },
        },
      }),
    );

    const result = await createMcpDataService(dependencies)
      .findRoutesNearLocation({
        uid: 'user-1',
        connectionId: 'connection-1',
        appBaseUrl: 'https://quantified-self.io',
        location: {
          latitudeDegrees: 0,
          longitudeDegrees: 0,
        },
        radiusMeters: 1_000,
      });

    expect(result).toMatchObject({
      scannedRouteCount: 4,
      loadedRoutePreviewCount: 5,
      decodedRoutePointCount: 0,
      skippedRouteCount: 4,
      routes: [],
      scanComplete: false,
      nextCursor: expect.any(String),
    });
  });

  it('returns only safe route waypoint coordinates from a bounded source parse', async () => {
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      routeDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const routes = await service.listRoutes({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
    });
    vi.mocked(dependencies.fetchRouteDocument).mockResolvedValue({
      id: 'route-1',
      data: {
        srcFileType: 'gpx',
        originalFiles: [{
          path: 'users/user-1/routes/route-1/uploads/attempt/original.gpx',
          bucket: 'private-bucket-name',
          extension: 'gpx',
          originalFilename: 'Private route name.gpx',
        }],
      },
    });
    vi.mocked(dependencies.parseRouteWaypoints).mockResolvedValue([
      {
        latitudeDegrees: 39.6679,
        longitudeDegrees: 20.8382,
        altitude: 900,
        distance: 1500,
        routeIndex: 0,
        routePointIndex: 12,
        type: 'left',
        name: 'Private waypoint',
        comment: 'Private comment',
        description: 'Private description',
        links: [{ href: 'https://private.example' }],
        extensions: { provider: 'private' },
      },
    ]);

    const result = await service.listRouteWaypoints({
      uid: 'user-1',
      connectionId: 'connection-1',
      routeRef: routes.routes[0].routeRef,
    });

    expect(result).toEqual({
      waypoints: [{
        index: 0,
        latitudeDegrees: 39.6679,
        longitudeDegrees: 20.8382,
        altitudeMeters: 900,
        distanceMeters: 1500,
        routeIndex: 0,
        routePointIndex: 12,
        type: 'left',
      }],
      waypointCount: 1,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Private waypoint');
    expect(serialized).not.toContain('Private comment');
    expect(serialized).not.toContain('private.example');
    expect(dependencies.downloadRouteSource).toHaveBeenCalledWith(
      'user-1',
      'route-1',
      expect.objectContaining({
        path: 'users/user-1/routes/route-1/uploads/attempt/original.gpx',
      }),
      2 * 1024 * 1024,
    );
    expect(dependencies.parseRouteWaypoints).toHaveBeenCalledWith(
      Buffer.from('route'),
      'gpx',
    );
  });

  it('binds route references to a connection and rejects oversized route detail', async () => {
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      routeDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const routes = await service.listRoutes({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
    });
    const routeRef = routes.routes[0].routeRef;

    await expect(service.getRouteGeometry({
      uid: 'user-1',
      connectionId: 'connection-2',
      routeRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchRouteDocument).not.toHaveBeenCalled();

    vi.mocked(dependencies.fetchRouteDocument).mockResolvedValue({
      id: 'route-1',
      data: {
        preview: {
          version: 1,
          encoding: 'polyline5',
          precision: 5,
          sourcePointCount: 10_000,
          pointCount: 5_001,
          segments: [{
            sourcePointCount: 10_000,
            pointCount: 5_001,
            encodedPolyline: '_p~iF~ps|U_ulLnnqC',
          }],
        },
      },
    });
    await expect(service.getRouteGeometry({
      uid: 'user-1',
      connectionId: 'connection-1',
      routeRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });

    vi.mocked(dependencies.fetchRouteDocument).mockResolvedValue({
      id: 'route-1',
      data: {
        preview: {
          version: 1,
          encoding: 'polyline5',
          precision: 5,
          sourcePointCount: 1,
          pointCount: 1,
          segments: [{
            sourcePointCount: 1,
            pointCount: 1,
            encodedPolyline: '?'.repeat(13),
          }],
        },
      },
    });
    await expect(service.getRouteGeometry({
      uid: 'user-1',
      connectionId: 'connection-1',
      routeRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'detail_not_available',
    });

    vi.mocked(dependencies.fetchRouteDocument).mockResolvedValue({
      id: 'route-1',
      data: {
        preview: {
          version: 1,
          encoding: 'polyline5',
          precision: 5,
          sourcePointCount: 1,
          pointCount: 1,
          segments: [{
            sourcePointCount: 1,
            pointCount: 1,
            // Polyline5 for latitude 91, longitude 0. Sports Lib currently
            // drops it, and MCP independently rejects invalid decoded points.
            encodedPolyline: '_mljP?',
          }],
        },
      },
    });
    await expect(service.getRouteGeometry({
      uid: 'user-1',
      connectionId: 'connection-1',
      routeRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'detail_not_available',
    });

    vi.mocked(dependencies.fetchRouteDocument).mockResolvedValue({
      id: 'route-1',
      data: {
        preview: {
          version: 1,
          encoding: 'polyline5',
          precision: 5,
          sourcePointCount: 1,
          pointCount: 2,
          segments: [{
            sourcePointCount: 1,
            pointCount: 2,
            encodedPolyline: '_p~iF~ps|U_ulLnnqC',
          }],
        },
      },
    });
    await expect(service.getRouteGeometry({
      uid: 'user-1',
      connectionId: 'connection-1',
      routeRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'detail_not_available',
    });
  });

  it('rejects oversized route source files and waypoint sets', async () => {
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      routeDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const routes = await service.listRoutes({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
    });
    const routeRef = routes.routes[0].routeRef;
    vi.mocked(dependencies.fetchRouteDocument).mockResolvedValue({
      id: 'route-1',
      data: {
        srcFileType: 'gpx',
        originalFiles: [{
          path: 'users/user-1/routes/route-1/uploads/attempt/original.gpx',
          extension: 'gpx',
        }],
      },
    });
    vi.mocked(dependencies.downloadRouteSource).mockResolvedValue(
      Buffer.alloc((2 * 1024 * 1024) + 1),
    );
    await expect(service.listRouteWaypoints({
      uid: 'user-1',
      connectionId: 'connection-1',
      routeRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
    expect(dependencies.parseRouteWaypoints).not.toHaveBeenCalled();

    vi.mocked(dependencies.downloadRouteSource).mockResolvedValue(Buffer.from('route'));
    vi.mocked(dependencies.parseRouteWaypoints).mockResolvedValue(
      Array.from({ length: 501 }, () => ({
        latitudeDegrees: 39.6,
        longitudeDegrees: 20.8,
      })),
    );
    await expect(service.listRouteWaypoints({
      uid: 'user-1',
      connectionId: 'connection-1',
      routeRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });

    vi.mocked(dependencies.parseRouteWaypoints).mockResolvedValue(
      null as unknown as never[],
    );
    await expect(service.listRouteWaypoints({
      uid: 'user-1',
      connectionId: 'connection-1',
      routeRef,
    })).rejects.toMatchObject<McpDataError>({
      code: 'detail_not_available',
    });
  });

  it('lists only numeric Sports Lib stats that are persisted for the user', async () => {
    vi.mocked(dependencies.fetchMetricDiscoveryDocuments).mockResolvedValue([
      {
        id: 'event-1',
        data: {
          stats: {
            [DataDistance.type]: 1000,
            [DataActivityTypes.type]: ['Running'],
            Latitude: 60.1,
          },
        },
      },
    ]);

    const result = await createMcpDataService(dependencies).listMetrics({
      uid: 'user-1',
      search: 'distance',
      limit: 10,
    });

    expect(result.eventMetrics).toEqual([
      expect.objectContaining({ type: DataDistance.type }),
    ]);
    expect(result.derivedMetricKinds).toContain(DERIVED_METRIC_KINDS.TrainingReadiness);
    expect(result.derivedMetricKinds).toContain(DERIVED_METRIC_KINDS.BodyWeightTrend);
    expect(result.sleepCapabilities.providers).toContain(SLEEP_PROVIDERS.GarminAPI);
  });

  it('discovers only persisted source-native dive summary metrics', async () => {
    vi.mocked(dependencies.fetchMetricDiscoveryDocuments).mockResolvedValue([
      {
        id: 'private-dive-1',
        data: {
          name: 'Private reef dive',
          sourceKey: 'private-dive-source',
          stats: {
            [DataDepthAvg.type]: 12.4,
            [DataPressureSACAvg.type]: 1.67,
            Latitude: 60.1,
          },
          streams: {
            AirTimeRemaining: [600, 540],
          },
          diveGases: [{ oxygenContent: 32 }],
        },
      },
    ]);

    const result = await createMcpDataService(dependencies).listMetrics({
      uid: 'user-1',
      search: 'average',
      limit: 50,
    });

    expect(result.eventMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: DataDepthAvg.type, unit: 'm' }),
      expect.objectContaining({ type: DataPressureSACAvg.type, unit: 'bar/min' }),
    ]));
    expect(JSON.stringify(result)).not.toMatch(
      /Private reef dive|private-dive-source|AirTimeRemaining|oxygenContent|Latitude/,
    );
  });

  it('discovers and queries pre-19 stroke-rate summaries through their canonical metric', async () => {
    const pre19Stats = {
      [DataActivityTypes.type]: [ActivityTypes.OpenWaterSwimming],
      [DataCadence.type]: 32,
    };
    vi.mocked(dependencies.fetchMetricDiscoveryDocuments).mockResolvedValue([{
      id: 'open-water-1',
      data: {
        name: 'Private lake swim',
        sourceKey: 'private-source-key',
        stats: pre19Stats,
      },
    }]);
    const service = createMcpDataService(dependencies);

    const catalog = await service.listMetrics({
      uid: 'user-1',
      search: 'stroke',
      limit: 10,
    });

    expect(catalog.eventMetrics).toEqual([
      expect.objectContaining({
        type: DataStrokeRate.type,
        unit: 'spm',
      }),
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/Private lake swim|private-source-key/);

    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue([{
      id: 'open-water-1',
      data: {
        startDate: Date.parse('2026-07-01T08:00:00.000Z'),
        endDate: Date.parse('2026-07-01T09:00:00.000Z'),
        stats: pre19Stats,
      },
    }]);
    dependencies.importEvent = vi.fn((data, id) => (
      EventImporterJSON.getEventFromJSON(data).setID(id)
    ));

    const result = await service.queryMetric({
      uid: 'user-1',
      metric: DataStrokeRate.type,
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-02T00:00:00.000Z'),
      aggregation: 'average',
      groupBy: 'date',
      interval: 'daily',
      timeZone: 'UTC',
    });

    expect(result.matchedEventCount).toBe(1);
    expect(result.aggregation.buckets).toEqual([
      expect.objectContaining({ aggregateValue: 32 }),
    ]);
    expect(dependencies.fetchEventDocuments).toHaveBeenCalledWith(
      'user-1',
      Date.parse('2026-07-01T00:00:00.000Z'),
      Date.parse('2026-07-02T00:00:00.000Z'),
      [DataStrokeRate.type, DataCadence.type, DataActivityTypes.type],
      25,
      undefined,
    );
    expect(JSON.stringify(result)).not.toMatch(/Private lake swim|private-source-key/);
  });

  it('does not advertise metrics that exist only on benchmark merges', async () => {
    vi.mocked(dependencies.fetchMetricDiscoveryDocuments).mockResolvedValue([
      {
        id: 'benchmark-1',
        data: {
          isMerge: true,
          stats: {
            [DataDistance.type]: 1000,
          },
        },
      },
    ]);

    const result = await createMcpDataService(dependencies).listMetrics({
      uid: 'user-1',
      search: 'distance',
      limit: 10,
    });

    expect(result.eventMetrics).toEqual([]);
    expect(result.scannedEventCount).toBe(1);
  });

  it('queries a canonical metric, excludes benchmark merges, and applies timezone bucketing', async () => {
    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue([
      { id: 'event-1', data: { startDate: 1 } },
      { id: 'event-2', data: { startDate: 2, mergeType: 'benchmark' } },
    ]);
    vi.mocked(dependencies.importEvent).mockImplementation((_data, id) => (
      id === 'event-1'
        ? makeEvent('2024-03-31T21:30:00.000Z', 5000)
        : makeEvent('2024-03-31T22:30:00.000Z', 10000)
    ));

    const result = await createMcpDataService(dependencies).queryMetric({
      uid: 'user-1',
      metric: DataDistance.type,
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-30T00:00:00.000Z'),
      aggregation: 'total',
      groupBy: 'date',
      interval: 'daily',
      timeZone: 'Europe/Helsinki',
    });

    expect(result.matchedEventCount).toBe(1);
    expect(result.aggregation.categoryType).toBe(ChartDataCategoryTypes.DateType);
    expect(result.aggregation.resolvedTimeInterval).toBe(TimeIntervals.Daily);
    expect(result.aggregation.buckets).toEqual([
      expect.objectContaining({
        bucketKey: Date.parse('2024-03-31T21:00:00.000Z'),
        aggregateValue: 5000,
      }),
    ]);
    expect(dependencies.importEvent).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchEventDocuments).toHaveBeenCalledWith(
      'user-1',
      Date.parse('2024-03-01T00:00:00.000Z'),
      Date.parse('2024-04-30T00:00:00.000Z'),
      [DataDistance.type, DataActivityTypes.type],
      25,
      undefined,
    );
  });

  it('queries several canonical metrics through one bounded import pass', async () => {
    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue([{
      id: 'event-1',
      data: {
        startDate: Date.parse('2024-04-01T08:00:00.000Z'),
        stats: {
          [DataDistance.type]: 5_000,
          [DataAscent.type]: 220,
          [DataActivityTypes.type]: [ActivityTypes.Running],
          sourceKey: 'private-source-key',
        },
      },
    }]);
    vi.mocked(dependencies.importEvent).mockReturnValue({
      startDate: new Date('2024-04-01T08:00:00.000Z'),
      getActivityTypesAsArray: () => [ActivityTypes.Running],
      getStat: (type: string) => {
        if (type === DataDistance.type) {
          return { getValue: () => 5_000 };
        }
        if (type === DataAscent.type) {
          return { getValue: () => 220 };
        }
        return null;
      },
    } as unknown as EventInterface);

    const result = await createMcpDataService(dependencies).queryMetrics({
      uid: 'user-1',
      metrics: [{
        metric: DataDistance.type,
        aggregation: 'total',
      }, {
        metric: DataAscent.type,
        aggregation: 'average',
      }, {
        metric: DataDistance.type,
        aggregation: 'total',
      }],
      startTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-02T00:00:00.000Z'),
      groupBy: 'date',
      interval: 'daily',
      timeZone: 'UTC',
    });

    expect(result.results).toHaveLength(2);
    expect(result.results).toEqual([
      expect.objectContaining({
        metric: expect.objectContaining({ type: DataDistance.type }),
        matchedEventCount: 1,
        aggregation: expect.objectContaining({
          valueType: ChartDataValueTypes.Total,
        }),
      }),
      expect.objectContaining({
        metric: expect.objectContaining({ type: DataAscent.type }),
        matchedEventCount: 1,
        aggregation: expect.objectContaining({
          valueType: ChartDataValueTypes.Average,
        }),
      }),
    ]);
    expect(dependencies.importEvent).toHaveBeenCalledTimes(1);
    expect(dependencies.importEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: {
          [DataDistance.type]: 5_000,
          [DataAscent.type]: 220,
          [DataActivityTypes.type]: [ActivityTypes.Running],
        },
      }),
      'event-1',
    );
    expect(dependencies.fetchEventDocuments).toHaveBeenCalledWith(
      'user-1',
      Date.parse('2024-04-01T00:00:00.000Z'),
      Date.parse('2024-04-02T00:00:00.000Z'),
      [DataDistance.type, DataAscent.type, DataActivityTypes.type],
      25,
      undefined,
    );
    expect(JSON.stringify(result)).not.toContain('private-source-key');
  });

  it('rejects measurement and excessive selectors before multi-metric reads', async () => {
    const service = createMcpDataService(dependencies);
    const input = {
      uid: 'user-1',
      startTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-02T00:00:00.000Z'),
      groupBy: 'date' as const,
      interval: 'daily' as const,
      timeZone: 'UTC',
    };

    await expect(service.queryMetrics({
      ...input,
      metrics: [{
        metric: DataWeight.type,
        aggregation: 'average',
      }],
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_metric',
    });
    await expect(service.queryMetrics({
      ...input,
      metrics: Array.from({ length: 5 }, () => ({
        metric: DataDistance.type,
        aggregation: 'average' as const,
      })),
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchEventDocuments).not.toHaveBeenCalled();
  });

  it('keeps direct MCP metric calls bounded to one public-compatible year', async () => {
    await expect(createMcpDataService(dependencies).queryMetric({
      uid: 'user-1',
      metric: DataDistance.type,
      startTimeMs: Date.parse('2020-01-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2022-01-01T00:00:00.000Z'),
      aggregation: 'total',
      groupBy: 'date',
      interval: 'yearly',
      timeZone: 'UTC',
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
    expect(dependencies.fetchEventDocuments).not.toHaveBeenCalled();
  });

  it('lists first-class body-measurement capabilities', async () => {
    const result = await createMcpDataService(dependencies).listMeasurementTypes();

    expect(result.measurementTypes).toEqual([
      expect.objectContaining({
        id: 'body_weight',
        canonicalMetric: expect.objectContaining({
          type: DataWeight.type,
          unit: 'kg',
        }),
        defaultAggregation: 'median',
        defaultInterval: 'day',
        maximumRangeDays: 366,
      }),
    ]);
  });

  it('keeps first-class measurements out of generic metric discovery and queries', async () => {
    vi.mocked(dependencies.fetchMetricDiscoveryDocuments).mockResolvedValue([{
      id: 'weight-1',
      data: {
        startDate: Date.parse('2026-07-26T08:00:00.000Z'),
        stats: {
          [DataWeight.type]: 71.2,
          [DataDistance.type]: 5_000,
        },
      },
    }]);
    const service = createMcpDataService(dependencies);

    const catalog = await service.listMetrics({
      uid: 'user-1',
    });
    expect(catalog.eventMetrics.map(metric => metric.type)).toContain(
      DataDistance.type,
    );
    expect(catalog.eventMetrics.map(metric => metric.type)).not.toContain(
      DataWeight.type,
    );

    await expect(service.queryMetric({
      uid: 'user-1',
      metric: DataWeight.type,
      startTimeMs: Date.parse('2026-07-26T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-27T00:00:00.000Z'),
      aggregation: 'average',
      groupBy: 'date',
      interval: 'daily',
      timeZone: 'UTC',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_metric',
    });
    expect(dependencies.fetchEventDocuments).not.toHaveBeenCalled();
  });

  it('returns identity-free daily median body-weight measurements in an IANA timezone', async () => {
    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue([
      {
        id: 'weight-1',
        data: {
          startDate: Date.parse('2024-03-31T00:30:00.000Z'),
          stats: { [DataWeight.type]: 70 },
          name: 'Private morning weigh-in',
          sourceKey: 'private-source-key',
          creator: { name: 'Private scale' },
        },
      },
      {
        id: 'weight-2',
        data: {
          startDate: Date.parse('2024-03-31T01:30:00.000Z'),
          stats: { [DataWeight.type]: 72 },
          previousSourceKey: 'private-previous-source',
        },
      },
      {
        id: 'benchmark-1',
        data: {
          startDate: Date.parse('2024-03-31T02:30:00.000Z'),
          isMerge: true,
          stats: { [DataWeight.type]: 200 },
        },
      },
      {
        id: 'weight-3',
        data: {
          startDate: Date.parse('2024-04-01T04:00:00.000Z'),
          stats: { [DataWeight.type]: 73 },
        },
      },
    ]);

    const result = await createMcpDataService(dependencies).queryMeasurements({
      uid: 'user-1',
      measurementType: 'body_weight',
      startTimeMs: Date.parse('2024-03-30T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-02T00:00:00.000Z'),
      aggregation: 'median',
      interval: 'day',
      timeZone: 'Europe/Helsinki',
    });

    expect(result).toMatchObject({
      measurementType: {
        id: 'body_weight',
        canonicalMetric: {
          type: DataWeight.type,
          unit: 'kg',
        },
      },
      timeZone: 'Europe/Helsinki',
      aggregation: 'median',
      interval: 'day',
      measurementCount: 3,
      points: [{
        bucketStartTimeMs: Date.parse('2024-03-30T22:00:00.000Z'),
        value: 71,
        measurementCount: 2,
      }, {
        bucketStartTimeMs: Date.parse('2024-03-31T21:00:00.000Z'),
        value: 73,
        measurementCount: 1,
      }],
      summary: {
        absoluteChange: 2,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('weight-1');
    expect(serialized).not.toContain('Private morning weigh-in');
    expect(serialized).not.toContain('private-source-key');
    expect(serialized).not.toContain('private-previous-source');
    expect(serialized).not.toContain('Private scale');
    expect(dependencies.fetchEventDocuments).toHaveBeenCalledWith(
      'user-1',
      Date.parse('2024-03-30T00:00:00.000Z'),
      Date.parse('2024-04-02T00:00:00.000Z'),
      [DataWeight.type],
      25,
      undefined,
    );
  });

  it('keeps even-count medians finite when all persisted values are finite', async () => {
    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue([
      {
        id: 'weight-extreme-1',
        data: {
          startDate: Date.parse('2026-07-26T08:00:00.000Z'),
          stats: { [DataWeight.type]: Number.MAX_VALUE },
        },
      },
      {
        id: 'weight-extreme-2',
        data: {
          startDate: Date.parse('2026-07-26T20:00:00.000Z'),
          stats: { [DataWeight.type]: Number.MAX_VALUE },
        },
      },
    ]);

    const result = await createMcpDataService(dependencies).queryMeasurements({
      uid: 'user-1',
      measurementType: 'body_weight',
      startTimeMs: Date.parse('2026-07-26T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-27T00:00:00.000Z'),
      aggregation: 'median',
      interval: 'day',
      timeZone: 'UTC',
    });

    expect(result.points).toEqual([{
      bucketStartTimeMs: Date.parse('2026-07-26T00:00:00.000Z'),
      value: Number.MAX_VALUE,
      measurementCount: 2,
    }]);
    expect(Number.isFinite(result.points[0].value)).toBe(true);
  });

  it('supports natural body-weight aliases and latest-within-bucket aggregation', async () => {
    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue([
      {
        id: 'weight-newer',
        data: {
          startDate: Date.parse('2026-07-26T20:00:00.000Z'),
          stats: { [DataWeight.type]: 70.5 },
        },
      },
      {
        id: 'weight-older',
        data: {
          startDate: Date.parse('2026-07-26T08:00:00.000Z'),
          stats: { [DataWeight.type]: 71 },
        },
      },
      {
        id: 'weight-invalid',
        data: {
          startDate: Date.parse('2026-07-26T09:00:00.000Z'),
          stats: { [DataWeight.type]: 0 },
        },
      },
    ]);

    const result = await createMcpDataService(dependencies).queryMeasurements({
      uid: 'user-1',
      measurementType: 'body mass',
      startTimeMs: Date.parse('2026-07-26T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-27T00:00:00.000Z'),
      aggregation: 'latest',
      interval: 'day',
      timeZone: 'UTC',
    });

    expect(result.measurementCount).toBe(2);
    expect(result.points).toEqual([{
      bucketStartTimeMs: Date.parse('2026-07-26T00:00:00.000Z'),
      value: 70.5,
      measurementCount: 2,
    }]);
  });

  it('rejects unknown measurement types before reading events', async () => {
    await expect(createMcpDataService(dependencies).queryMeasurements({
      uid: 'user-1',
      measurementType: 'latitude',
      startTimeMs: Date.parse('2026-07-26T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-27T00:00:00.000Z'),
      aggregation: 'median',
      interval: 'day',
      timeZone: 'UTC',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_metric',
    });
    expect(dependencies.fetchEventDocuments).not.toHaveBeenCalled();
  });

  it('keeps measurement ranges bounded and represents missing history explicitly', async () => {
    const service = createMcpDataService(dependencies);

    await expect(service.queryMeasurements({
      uid: 'user-1',
      measurementType: 'body_weight',
      startTimeMs: Date.parse('2025-01-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-01-03T00:00:00.000Z'),
      aggregation: 'median',
      interval: 'month',
      timeZone: 'UTC',
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
    expect(dependencies.fetchEventDocuments).not.toHaveBeenCalled();

    await expect(service.queryMeasurements({
      uid: 'user-1',
      measurementType: 'body_weight',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-27T00:00:00.000Z'),
      aggregation: 'median',
      interval: 'day',
      timeZone: 'Not/A_Timezone',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_timezone',
    });
    expect(dependencies.fetchEventDocuments).not.toHaveBeenCalled();

    const empty = await service.queryMeasurements({
      uid: 'user-1',
      measurementType: 'body_weight',
      startTimeMs: Date.parse('2026-07-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-27T00:00:00.000Z'),
      aggregation: 'median',
      interval: 'month',
      timeZone: 'UTC',
    });
    expect(empty).toMatchObject({
      measurementCount: 0,
      points: [],
      summary: null,
    });
  });

  it('ignores unrelated legacy event fields that Sports Lib cannot import', async () => {
    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue([{
      id: 'event-1',
      data: {
        name: 'Private workout',
        startDate: Date.parse('2024-04-01T08:00:00.000Z'),
        endDate: Date.parse('2024-04-01T09:00:00.000Z'),
        stats: {
          [DataDistance.type]: 5000,
          [DataActivityTypes.type]: [ActivityTypes.Running],
          'Removed legacy stat': { malformed: true },
        },
        activities: [{
          stats: {
            'Removed nested stat': { malformed: true },
          },
        }],
        powerCurve: {
          unexpected: true,
        },
      },
    }]);
    dependencies.importEvent = vi.fn((data, id) => (
      EventImporterJSON.getEventFromJSON(data).setID(id)
    ));

    const result = await createMcpDataService(dependencies).queryMetric({
      uid: 'user-1',
      metric: DataDistance.type,
      startTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-02T00:00:00.000Z'),
      aggregation: 'total',
      groupBy: 'date',
      interval: 'daily',
      timeZone: 'UTC',
    });

    expect(result.matchedEventCount).toBe(1);
    expect(result.aggregation.buckets).toEqual([
      expect.objectContaining({
        aggregateValue: 5000,
      }),
    ]);
    expect(dependencies.importEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: {
          [DataDistance.type]: 5000,
          [DataActivityTypes.type]: [ActivityTypes.Running],
        },
      }),
      'event-1',
    );
  });

  it('fails explicitly when an event query exceeds the safety limit', async () => {
    let nextEventIndex = 0;
    vi.mocked(dependencies.fetchEventDocuments).mockImplementation(
      async (_uid, _startTimeMs, _endTimeMs, _statTypes, limit) => Array.from(
        { length: Math.min(limit, 2001 - nextEventIndex) },
        () => {
          const index = nextEventIndex;
          nextEventIndex += 1;
          return {
            id: `event-${index}`,
            data: {},
            cursor: `cursor-${index}`,
          };
        },
      ),
    );

    await expect(createMcpDataService(dependencies).queryMetric({
      uid: 'user-1',
      metric: DataDistance.type,
      startTimeMs: Date.parse('2024-01-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-02-01T00:00:00.000Z'),
      aggregation: 'average',
      groupBy: 'activity_type',
      interval: 'auto',
      timeZone: 'UTC',
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
    expect(dependencies.fetchEventDocuments).toHaveBeenCalledTimes(81);
    expect(dependencies.importEvent).not.toHaveBeenCalled();
  });

  it('rejects aggregate stat work above the cumulative entry budget before Sports Lib import', async () => {
    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue([{
      id: 'event-1',
      data: {
        stats: Object.fromEntries(
          Array.from({ length: 20_001 }, (_, index) => [`Untrusted Stat ${index}`, index]),
        ),
      },
    }]);

    await expect(createMcpDataService(dependencies).queryMetric({
      uid: 'user-1',
      metric: DataDistance.type,
      startTimeMs: Date.parse('2024-01-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-02-01T00:00:00.000Z'),
      aggregation: 'average',
      groupBy: 'activity_type',
      interval: 'auto',
      timeZone: 'UTC',
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
    expect(dependencies.importEvent).not.toHaveBeenCalled();
  });

  it('rejects aggregate stat bytes above the cumulative budget before Sports Lib import', async () => {
    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue([{
      id: 'event-1',
      data: {
        stats: {
          [DataDistance.type]: 1000,
          'Oversized owner-controlled stat': 'x'.repeat((4 * 1024 * 1024) + 1),
        },
      },
    }]);

    await expect(createMcpDataService(dependencies).queryMetric({
      uid: 'user-1',
      metric: DataDistance.type,
      startTimeMs: Date.parse('2024-01-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-02-01T00:00:00.000Z'),
      aggregation: 'average',
      groupBy: 'activity_type',
      interval: 'auto',
      timeZone: 'UTC',
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
    expect(dependencies.importEvent).not.toHaveBeenCalled();
  });

  it('pages event reads before materializing and importing a bounded query', async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      id: `event-${index}`,
      data: {
        stats: {
          [DataDistance.type]: 1000,
        },
      },
      cursor: `cursor-${index}`,
    }));
    const secondPage = [{
      id: 'event-25',
      data: {
        stats: {
          [DataDistance.type]: 1000,
        },
      },
      cursor: 'cursor-25',
    }];
    vi.mocked(dependencies.fetchEventDocuments)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    vi.mocked(dependencies.importEvent).mockReturnValue(
      makeEvent('2024-01-01T00:00:00.000Z', 1000),
    );

    const result = await createMcpDataService(dependencies).queryMetric({
      uid: 'user-1',
      metric: DataDistance.type,
      startTimeMs: Date.parse('2024-01-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-02-01T00:00:00.000Z'),
      aggregation: 'average',
      groupBy: 'activity_type',
      interval: 'auto',
      timeZone: 'UTC',
    });

    expect(result.matchedEventCount).toBe(26);
    expect(dependencies.fetchEventDocuments).toHaveBeenNthCalledWith(
      1,
      'user-1',
      Date.parse('2024-01-01T00:00:00.000Z'),
      Date.parse('2024-02-01T00:00:00.000Z'),
      [DataDistance.type, DataActivityTypes.type],
      25,
      undefined,
    );
    expect(dependencies.fetchEventDocuments).toHaveBeenNthCalledWith(
      2,
      'user-1',
      Date.parse('2024-01-01T00:00:00.000Z'),
      Date.parse('2024-02-01T00:00:00.000Z'),
      [DataDistance.type, DataActivityTypes.type],
      25,
      'cursor-24',
    );
    expect(dependencies.importEvent).toHaveBeenCalledTimes(26);
  });

  it('describes Training metrics and reports availability without reading payloads', async () => {
    vi.mocked(dependencies.fetchDerivedSnapshotMetadataDocuments)
      .mockImplementation(async (_uid, metricKinds) => metricKinds.flatMap(
        (metricKind) => {
          if (metricKind === DERIVED_METRIC_KINDS.TrainingReadiness) {
            return [{
              id: metricKind,
              data: {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
                metricKind,
                status: 'ready',
                schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
                updatedAtMs: 123,
                sourceEventCount: 9,
                payload: {
                  privateProviderPayload: 'must-not-be-returned',
                },
                lastError: 'private-error',
              },
            }];
          }
          if (metricKind === DERIVED_METRIC_KINDS.FormNow) {
            return [{
              id: metricKind,
              data: {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
                metricKind,
                status: 'building',
                schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
                updatedAtMs: 122,
                sourceEventCount: 8,
                payload: null,
              },
            }];
          }
          if (metricKind === DERIVED_METRIC_KINDS.RampRate) {
            return [{
              id: metricKind,
              data: {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
                metricKind,
                status: 'ready',
                schemaVersion: DERIVED_METRIC_SCHEMA_VERSION - 1,
                updatedAtMs: 121,
                sourceEventCount: 7,
                payload: {},
              },
            }];
          }
          if (metricKind === DERIVED_METRIC_KINDS.RecoveryNow) {
            return [{
              id: metricKind,
              data: {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
                status: 'ready',
                schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
                updatedAtMs: 120.5,
                sourceEventCount: 6,
              },
            }];
          }
          if (metricKind === DERIVED_METRIC_KINDS.Acwr) {
            return [{
              id: metricKind,
              data: {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                metricKind,
                status: 'ready',
                schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
                updatedAtMs: 120,
                sourceEventCount: 6,
              },
            }];
          }
          return [];
        },
      ));

    const service = createMcpDataService(dependencies);
    const readiness = await service.listTrainingMetrics({
      uid: 'user-1',
      search: 'readiness',
    });
    const all = await service.listTrainingMetrics({
      uid: 'user-1',
    });

    expect(readiness).toEqual({
      metrics: [{
        metricKind: DERIVED_METRIC_KINDS.TrainingReadiness,
        title: 'Training readiness history',
        description: expect.any(String),
        category: 'readiness',
        periodLabel: 'Latest 14 UTC days',
        status: 'ready',
        updatedAtMs: 123,
        sourceEventCount: 9,
      }],
    });
    expect(all.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricKind: DERIVED_METRIC_KINDS.FormNow,
        status: 'building',
      }),
      expect.objectContaining({
        metricKind: DERIVED_METRIC_KINDS.RampRate,
        status: 'schema_mismatch',
      }),
      expect.objectContaining({
        metricKind: DERIVED_METRIC_KINDS.RecoveryNow,
        status: 'schema_mismatch',
        updatedAtMs: null,
      }),
      expect.objectContaining({
        metricKind: DERIVED_METRIC_KINDS.Acwr,
        status: 'schema_mismatch',
      }),
      expect.objectContaining({
        metricKind: DERIVED_METRIC_KINDS.Form,
        status: 'missing',
      }),
    ]));
    expect(all.metrics).toHaveLength(Object.values(DERIVED_METRIC_KINDS).length);
    expect(dependencies.fetchDerivedSnapshot).not.toHaveBeenCalled();
    expect(dependencies.fetchDerivedSnapshotMetadataDocuments)
      .toHaveBeenLastCalledWith(
        'user-1',
        Object.values(DERIVED_METRIC_KINDS),
      );
    expect(JSON.stringify(all)).not.toContain('privateProviderPayload');
    expect(JSON.stringify(all)).not.toContain('private-error');
  });

  it('returns ready Training snapshots without event or activity identifiers and labels', async () => {
    vi.mocked(dependencies.fetchDerivedSnapshot).mockResolvedValue({
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: 123,
      sourceEventCount: 3,
      payload: {
        score: 88,
        sourceEventIds: ['event-1'],
        event: {
          id: 'event-1',
          name: 'Private workout',
          value: 42,
          metadata: {
            id: 'nested-event-id',
            label: 'Nested private workout',
            value: 7,
          },
        },
        suggestedEvents: [{
          eventId: 'event-2',
          label: 'Private suggested workout',
          distanceMeters: 10000,
          metadata: {
            name: 'Nested private suggestion',
            distanceMeters: 5000,
          },
        }],
        selection: {
          mode: 'event',
          durationWeeks: 12,
          eventId: 'event-3',
          selectionKey: 'event:12:event-3',
          label: 'Private benchmark',
        },
        powerSystems: {
          activityTypes: [{
            activityType: 'Cycling',
            current: {
              effectiveDayMs: Date.parse('2024-04-01T00:00:00.000Z'),
              sourceFingerprint: 'three-dimensional-capacity:private-fingerprint',
            },
          }],
        },
        activityLabel: 'Private label',
      },
    });

    const result = await createMcpDataService(dependencies).getTrainingMetric(
      'user-1',
      DERIVED_METRIC_KINDS.TrainingReadiness,
    );

    expect(result.schemaVersion).toBe(MCP_TRAINING_METRIC_SCHEMA_VERSION);
    expect(result.payload).toEqual({
      score: 88,
      event: {
        value: 42,
        metadata: {
          value: 7,
        },
      },
      suggestedEvents: [{
        distanceMeters: 10000,
        metadata: {
          distanceMeters: 5000,
        },
      }],
      selection: {
        mode: 'event',
        durationWeeks: 12,
      },
      powerSystems: {
        activityTypes: [{
          activityType: 'Cycling',
          current: {
            effectiveDayMs: Date.parse('2024-04-01T00:00:00.000Z'),
          },
        }],
      },
    });
    expect(JSON.stringify(result.payload)).not.toContain('event-3');
    expect(JSON.stringify(result.payload)).not.toContain('sourceFingerprint');
  });

  it('projects expanded internal Training summaries through the frozen three-sport MCP contract', async () => {
    const contextByDiscipline = {
      running: ['running', 'endurance'],
      cycling: ['downhill', 'gravity'],
      swimming: ['pool-swimming', 'pool'],
      rowing: ['on-water-rowing', 'rowing'],
      'walking-hiking': ['hiking', 'vertical-endurance'],
      'nordic-skiing': ['roller-skiing', 'vertical-endurance'],
      strength: ['strength', 'strength'],
      paddling: ['kayaking', 'paddling'],
    } as const;
    const window = (discipline: typeof TRAINING_DISCIPLINES[number]) => ({
      periodDays: 28,
      windowStartDayMs: 1,
      windowEndDayMs: 2,
      activityCount: 1,
      durationSeconds: 3_600,
      easySeconds: 0,
      moderateSeconds: 0,
      hardSeconds: 0,
      contexts: [{
        context: contextByDiscipline[discipline][0],
        profile: contextByDiscipline[discipline][1],
        activityCount: 1,
        metrics: discipline === 'cycling'
          ? [{ metric: 'max-jump-distance', value: 7.4, sourceActivityCount: 1 }]
          : discipline === 'rowing'
            ? [{ metric: 'stroke-rate', value: 28, sourceActivityCount: 1 }]
            : [{ metric: 'distance', value: 10_000, sourceActivityCount: 1 }],
        privateContextNote: 'must-not-leak',
      }],
    });
    vi.mocked(dependencies.fetchDerivedSnapshot).mockResolvedValue({
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: 123,
      sourceEventCount: 8,
      payload: {
        dayBoundary: 'UTC',
        asOfDayMs: 2,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: TRAINING_DISCIPLINES.map(discipline => ({
          discipline,
          current28d: window(discipline),
          baseline28d: window(discipline),
        })),
        excludesMergedEvents: true,
      },
    });

    const result = await createMcpDataService(dependencies).getTrainingMetric(
      'user-1',
      DERIVED_METRIC_KINDS.TrainingSummary,
    );
    const parsed = MCP_DERIVED_PAYLOAD_SCHEMAS[DERIVED_METRIC_KINDS.TrainingSummary]
      .parse(result.payload);
    const serialized = JSON.stringify(result.payload);

    expect(parsed.disciplines.map(item => item.discipline))
      .toEqual(['running', 'cycling', 'swimming']);
    expect(serialized).not.toContain('contexts');
    expect(serialized).not.toContain('downhill');
    expect(serialized).not.toContain('rowing');
    expect(serialized).not.toContain('walking-hiking');
    expect(serialized).not.toContain('privateContextNote');
    expect(serialized).not.toContain('max-jump-distance');
    expect(serialized).not.toContain('stroke-rate');
  });

  it('strips internal context metrics and added families from Training build projection', () => {
    const buildWindow = {
      periodWeeks: 8,
      windowStartDayMs: 1,
      windowEndDayMs: 2,
      activityCount: 1,
      durationSeconds: 3_600,
      distanceMeters: 10_000,
      distanceEventCount: 1,
      trainingStressScore: null,
      trainingStressScoreEventCount: 0,
      activeWeekCount: 1,
      longestActivityDurationSeconds: 3_600,
      easySeconds: null,
      moderateSeconds: null,
      hardSeconds: null,
      intensitySourceEventCount: 0,
      durability: null,
      poolAveragePaceSecondsPer100m: null,
      poolPaceActivityCount: 0,
      openWaterAveragePaceSecondsPer100m: null,
      openWaterPaceActivityCount: 0,
      contexts: [{
        context: 'downhill',
        profile: 'gravity',
        activityCount: 1,
        metrics: [
          { metric: 'descent', value: 900, sourceActivityCount: 1 },
          { metric: 'max-jump-distance', value: 7.4, sourceActivityCount: 1 },
        ],
      }],
    };
    const projected = projectDerivedMetricPayloadForMcp(
      DERIVED_METRIC_KINDS.TrainingBuildComparison,
      {
        disciplines: TRAINING_DISCIPLINES.map(discipline => ({
          discipline,
          status: discipline === 'cycling' ? 'ready' : 'not-configured',
          selection: null,
          current: discipline === 'cycling' ? buildWindow : null,
          benchmark: discipline === 'cycling' ? buildWindow : null,
          recovery: null,
          durabilityComparisons: [],
          suggestedRaces: [],
          suggestedEvents: [],
        })),
      },
    );
    const projectedBuild = projected as {
      disciplines: Array<{ discipline: string }>;
    };
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain('contexts');
    expect(serialized).not.toContain('descent');
    expect(serialized).not.toContain('max-jump-distance');
    expect(serialized).not.toContain('rowing');
    expect(projectedBuild.disciplines.map(item => item.discipline))
      .toEqual(['running', 'cycling', 'swimming']);
  });

  it('folds added Training families into legacy explanation Other rows without leaking contributor labels', async () => {
    const loads = ([
      ['running', 'Running', 10],
      ['cycling', 'Cycling', 20],
      ['swimming', 'Swimming', 30],
      ['rowing', 'Rowing', 40],
      ['walking-hiking', 'Walking & Hiking', 50],
      ['nordic-skiing', 'Nordic Skiing', 60],
      ['strength', 'Strength', null],
      ['paddling', 'Paddling', 70],
      ['other', 'Other', 80],
      ['unclassified', 'Unclassified', 90],
    ] as Array<[string, string, number | null]>).map(([sport, label, trainingStressScore]) => ({
      sport,
      label,
      activityCount: 1,
      loadActivityCount: trainingStressScore === null ? 0 : 1,
      trainingStressScore,
      loadSharePercent: trainingStressScore === null ? null : 10,
    }));
    const coverage = {
      totalCount: 10,
      loadedCount: 9,
      classifiedCount: 9,
      unclassifiedCount: 1,
      ratio: 0.9,
    };
    const windowMetrics = {
      parentEventCount: 10,
      parentLoadEventCount: 9,
      parentTrainingStressScore: 450,
      parentLoadCoverage: coverage,
      childActivityCount: 10,
      childLoadActivityCount: 9,
      childTrainingStressScore: 450,
      childLoadCoverage: coverage,
      sportLoads: loads,
      rhythms: TRAINING_DISCIPLINES.map(discipline => ({
        discipline,
        sessionCount: 1,
        activeDayCount: 1,
        activeWeekCount: 1,
        longestInactivityGapDays: 0,
        longestSessionDurationSeconds: 3_600,
      })),
    };
    const window = {
      ...windowMetrics,
      periodDays: 28,
      windowStartDayMs: 1,
      windowEndDayMs: 2,
    };
    vi.mocked(dependencies.fetchDerivedSnapshot).mockResolvedValue({
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: 123,
      sourceEventCount: 10,
      payload: {
        dayBoundary: 'UTC',
        asOfDayMs: 2,
        currentWindowDays: 28,
        baselineBlockCount: 3,
        excludesMergedEvents: true,
        excludesMissingDates: true,
        excludesFutureEvents: true,
        current: window,
        baselineBlocks: [window, window, window],
        baselineMedian: windowMetrics,
        topContributors: [{
          eventId: 'private-event',
          label: 'Private workout',
          startDayMs: 2,
          trainingStressScore: 50,
          loadSharePercent: 10,
          childComposition: [loads[0], loads[3], loads[6]],
        }],
      },
    });

    const result = await createMcpDataService(dependencies).getTrainingMetric(
      'user-1',
      DERIVED_METRIC_KINDS.TrainingExplanation,
    );
    const payload = MCP_DERIVED_PAYLOAD_SCHEMAS[DERIVED_METRIC_KINDS.TrainingExplanation]
      .parse(result.payload);

    expect(payload.current.sportLoads.map(load => load.sport))
      .toEqual(['running', 'cycling', 'swimming', 'other', 'unclassified']);
    expect(payload.current.sportLoads.find(load => load.sport === 'other')).toMatchObject({
      activityCount: 6,
      loadActivityCount: 5,
      trainingStressScore: 300,
    });
    expect(payload.topContributors[0].childComposition).toEqual([
      expect.objectContaining({ sport: 'running', trainingStressScore: 10 }),
      expect.objectContaining({ sport: 'other', activityCount: 2, trainingStressScore: 40 }),
    ]);
    expect(payload.topContributors[0].childComposition.every(load => !('label' in load))).toBe(true);
  });

  it('fails closed when an expanded Training payload is malformed before projection', () => {
    expect(() => projectDerivedMetricPayloadForMcp(
      DERIVED_METRIC_KINDS.TrainingSummary,
      { disciplines: [{ discipline: 'running' }] },
    )).not.toThrow();
    expect(projectDerivedMetricPayloadForMcp(
      DERIVED_METRIC_KINDS.TrainingSummary,
      { disciplines: [{ discipline: 'running' }] },
    )).toBeNull();
    expect(projectDerivedMetricPayloadForMcp(
      DERIVED_METRIC_KINDS.TrainingSummary,
      {
        disciplines: [
          { discipline: 'running' },
          { discipline: 'running' },
          { discipline: 'cycling' },
          { discipline: 'swimming' },
        ],
      },
    )).toBeNull();
  });

  it('exposes the ready body-weight trend with only its safe daily values', async () => {
    vi.mocked(dependencies.fetchDerivedSnapshot).mockResolvedValue({
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: 123,
      sourceEventCount: 4,
      payload: {
        dayBoundary: 'UTC',
        asOfDayMs: Date.parse('2026-07-26T00:00:00.000Z'),
        trendDays: 28,
        comparisonWindowDays: 7,
        minimumComparableDayCount: 3,
        latestWeightKg: 71.2,
        latestWeightDayMs: Date.parse('2026-07-26T00:00:00.000Z'),
        median7dKg: 71.4,
        median28dKg: 71.8,
        change7dKg: -0.3,
        change7dPercent: -0.42,
        change28dKg: -0.6,
        change28dPercent: -0.84,
        recordedDayCount7d: 4,
        recordedDayCount28d: 11,
        points: [{
          dayMs: Date.parse('2026-07-26T00:00:00.000Z'),
          weightKg: 71.2,
          eventId: 'private-weight-entry',
          label: 'Morning measurement',
        }],
      },
    });

    const result = await createMcpDataService(dependencies).getTrainingMetric(
      'user-1',
      DERIVED_METRIC_KINDS.BodyWeightTrend,
    );

    expect(result).toEqual({
      metricKind: DERIVED_METRIC_KINDS.BodyWeightTrend,
      schemaVersion: MCP_TRAINING_METRIC_SCHEMA_VERSION,
      updatedAtMs: 123,
      sourceEventCount: 4,
      payload: {
        dayBoundary: 'UTC',
        asOfDayMs: Date.parse('2026-07-26T00:00:00.000Z'),
        trendDays: 28,
        comparisonWindowDays: 7,
        minimumComparableDayCount: 3,
        latestWeightKg: 71.2,
        latestWeightDayMs: Date.parse('2026-07-26T00:00:00.000Z'),
        median7dKg: 71.4,
        median28dKg: 71.8,
        change7dKg: -0.3,
        change7dPercent: -0.42,
        change28dKg: -0.6,
        change28dPercent: -0.84,
        recordedDayCount7d: 4,
        recordedDayCount28d: 11,
        points: [{
          dayMs: Date.parse('2026-07-26T00:00:00.000Z'),
          weightKg: 71.2,
        }],
      },
    });
    expect(JSON.stringify(result.payload)).not.toContain('private-weight-entry');
    expect(JSON.stringify(result.payload)).not.toContain('Morning measurement');
  });

  it('removes imported device provenance from Training capacity while preserving metrics', async () => {
    vi.mocked(dependencies.fetchDerivedSnapshot).mockResolvedValue({
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: 123,
      sourceEventCount: 3,
      payload: {
        dayBoundary: 'UTC',
        asOfDayMs: Date.parse('2024-04-01T00:00:00.000Z'),
        excludesMergedEvents: true,
        disciplines: [{
          discipline: 'cycling',
          ftpSetting: {
            kind: 'ftp-setting',
            value: 275,
            sourceKey: 'garmin / edge 840',
            provenance: 'imported-activity-stat',
            firstSeenAtMs: 100,
            lastSeenAtMs: 200,
            observationCount: 2,
            previousValue: 260,
            previousAtMs: 90,
            previousSourceKey: 'garmin / edge 830',
            changePct: 5.77,
          },
          importedVo2Max: null,
        }],
      },
    });

    const result = await createMcpDataService(dependencies).getTrainingMetric(
      'user-1',
      DERIVED_METRIC_KINDS.TrainingCapacity,
    );
    const serialized = JSON.stringify(result.payload);

    expect(result.payload).toEqual({
      dayBoundary: 'UTC',
      asOfDayMs: Date.parse('2024-04-01T00:00:00.000Z'),
      excludesMergedEvents: true,
      disciplines: [{
        discipline: 'cycling',
        ftpSetting: {
          kind: 'ftp-setting',
          value: 275,
          provenance: 'imported-activity-stat',
          firstSeenAtMs: 100,
          lastSeenAtMs: 200,
          observationCount: 2,
          previousValue: 260,
          previousAtMs: 90,
          changePct: 5.77,
        },
        importedVo2Max: null,
      }],
    });
    expect(serialized).not.toContain('sourceKey');
    expect(serialized).not.toContain('edge 840');
    expect(serialized).not.toContain('edge 830');
  });

  it('preserves current Training power-system diagnostics while removing the source fingerprint', async () => {
    vi.mocked(dependencies.fetchDerivedSnapshot).mockResolvedValue({
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: 123,
      sourceEventCount: 4,
      payload: {
        dayBoundary: 'UTC',
        asOfDayMs: Date.parse('2026-07-20T00:00:00.000Z'),
        policyVersion: 1,
        activityTypes: [{
          activityType: 'Cycling',
          current: {
            effectiveDayMs: Date.parse('2026-07-20T00:00:00.000Z'),
            status: 'partial',
            reason: 'unstable-w-prime-fit',
            sourceFingerprint: 'three-dimensional-capacity:private-input-fingerprint',
            criticalPower: {
              status: 'ready',
              reason: null,
              value: 275,
            },
            wPrime: {
              status: 'unstable',
              reason: 'unstable-w-prime-fit',
              value: null,
            },
            diagnostics: {
              rejectedShortPowerSpikePointCount: 3,
              wPrimeCandidateCount: 3,
              wPrimeCandidateMinimumJoules: 10_017,
              wPrimeCandidateMaximumJoules: 14_410,
              criticalPowerSourceRemovalFitCount: 2,
              criticalPowerSourceRemovalFailureCount: 1,
              criticalPowerSourceRemovalMaximumChangeRatio: 0.04,
              wPrimeSourceRemovalMaximumChangeRatio: 0.19,
            },
          },
        }],
      },
    });

    const result = await createMcpDataService(dependencies).getTrainingMetric(
      'user-1',
      DERIVED_METRIC_KINDS.TrainingPowerSystems,
    );

    expect(result).toMatchObject({
      metricKind: DERIVED_METRIC_KINDS.TrainingPowerSystems,
      schemaVersion: MCP_TRAINING_METRIC_SCHEMA_VERSION,
      payload: {
        activityTypes: [{
          current: {
            status: 'partial',
            reason: 'unstable-w-prime-fit',
            criticalPower: {
              status: 'ready',
              value: 275,
            },
            wPrime: {
              status: 'unstable',
              value: null,
            },
            diagnostics: {
              rejectedShortPowerSpikePointCount: 3,
              wPrimeCandidateCount: 3,
              wPrimeCandidateMinimumJoules: 10_017,
              wPrimeCandidateMaximumJoules: 14_410,
              criticalPowerSourceRemovalFitCount: 2,
              criticalPowerSourceRemovalFailureCount: 1,
              criticalPowerSourceRemovalMaximumChangeRatio: 0.04,
              wPrimeSourceRemovalMaximumChangeRatio: 0.19,
            },
          },
        }],
      },
    });
    expect(JSON.stringify(result.payload)).not.toContain('sourceFingerprint');
    expect(JSON.stringify(result.payload)).not.toContain('private-input-fingerprint');
  });

  it.each([
    undefined,
    DERIVED_METRIC_SCHEMA_VERSION - 1,
    DERIVED_METRIC_SCHEMA_VERSION + 1,
  ])('does not expose a ready Training snapshot with incompatible schema %s', async (schemaVersion) => {
    vi.mocked(dependencies.fetchDerivedSnapshot).mockResolvedValue({
      status: 'ready',
      schemaVersion,
      updatedAtMs: 123,
      sourceEventCount: 3,
      payload: {
        score: 88,
      },
    });

    await expect(createMcpDataService(dependencies).getTrainingMetric(
      'user-1',
      DERIVED_METRIC_KINDS.TrainingReadiness,
    )).rejects.toMatchObject<McpDataError>({
      code: 'metric_not_ready',
    });
  });

  it('calculates current readiness with Dashboard-parity load, HRV, and overnight-HR evidence', async () => {
    const nowTimeMs = Date.parse('2026-07-27T12:00:00.000Z');
    const asOfDayMs = Date.parse('2026-07-27T00:00:00.000Z');
    const dailyLoads = [
      { dayMs: Date.parse('2026-07-18T00:00:00.000Z'), load: 100 },
      { dayMs: Date.parse('2026-07-20T00:00:00.000Z'), load: 40 },
      { dayMs: Date.parse('2026-07-25T00:00:00.000Z'), load: 80 },
    ];
    const loadPoints = buildTrainingLoadPoints(dailyLoads, asOfDayMs);
    const latestLoad = loadPoints[loadPoints.length - 1];
    const priorLoad = loadPoints.find(
      point => point.dayMs === asOfDayMs - (7 * 24 * 60 * 60 * 1000),
    );
    const form = Math.round(latestLoad.formSameDay * 10_000) / 10_000;
    const rampRate = Math.round(
      (latestLoad.ctl - (priorLoad?.ctl || 0)) * 10_000,
    ) / 10_000;
    const sleepInputs = [{
      id: 'baseline-private-1',
      sleepDate: '2026-07-23',
      endTimeMs: Date.parse('2026-07-23T06:00:00.000Z'),
      hrv: 40,
      averageHeartRate: 50,
      minimumHeartRate: 42,
    }, {
      id: 'baseline-private-2',
      sleepDate: '2026-07-24',
      endTimeMs: Date.parse('2026-07-24T06:00:00.000Z'),
      hrv: 50,
      averageHeartRate: 52,
      minimumHeartRate: 44,
    }, {
      id: 'baseline-private-3',
      sleepDate: '2026-07-25',
      endTimeMs: Date.parse('2026-07-25T06:00:00.000Z'),
      hrv: 60,
      averageHeartRate: 54,
      minimumHeartRate: 46,
    }, {
      id: 'latest-private',
      sleepDate: '2026-07-27',
      endTimeMs: Date.parse('2026-07-27T06:00:00.000Z'),
      hrv: 55,
      averageHeartRate: 49,
      minimumHeartRate: 40,
    }];
    vi.mocked(dependencies.fetchReadinessSleepDocuments).mockResolvedValue(
      sleepInputs.map((input, index) => ({
        ...sleepDocument({
          sleepDate: input.sleepDate,
          startTimeMs: input.endTimeMs - (8 * 60 * 60 * 1000),
          endTimeMs: input.endTimeMs,
          durationSeconds: 8 * 60 * 60,
          score: index === sleepInputs.length - 1
            ? {
                value: 84,
                qualifier: 'good',
                components: { private: true },
              }
            : null,
          vitals: {
            averageHrvMs: input.hrv,
            overnightHrvMs: 999,
            averageHeartRateBpm: input.averageHeartRate,
            minimumHeartRateBpm: input.minimumHeartRate,
            rawSamples: [{ private: true }],
          },
        }),
        id: input.id,
      })),
    );
    const formSnapshot = {
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: Date.parse('2026-07-27T08:00:00.000Z'),
      sourceEventCount: 3,
      payload: {
        dayBoundary: 'UTC',
        rangeStartDayMs: dailyLoads[0].dayMs,
        rangeEndDayMs: dailyLoads[dailyLoads.length - 1].dayMs,
        dailyLoads,
        excludesMergedEvents: true,
      },
    };
    const formNowSnapshot = {
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: Date.parse('2026-07-27T09:00:00.000Z'),
      payload: {
        dayBoundary: 'UTC',
        asOfDayMs,
        latestDayMs: asOfDayMs,
        value: 999,
        trend8Weeks: [],
      },
    };
    const rampRateSnapshot = {
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: Date.parse('2026-07-27T10:00:00.000Z'),
      payload: {
        dayBoundary: 'UTC',
        asOfDayMs,
        latestDayMs: asOfDayMs,
        ctlToday: 999,
        ctl7DaysAgo: 0,
        rampRate: 999,
        trend8Weeks: [],
      },
    };
    vi.mocked(dependencies.fetchDerivedSnapshot).mockImplementation(
      async (_uid, metricKind) => ({
        [DERIVED_METRIC_KINDS.Form]: formSnapshot,
        [DERIVED_METRIC_KINDS.FormNow]: formNowSnapshot,
        [DERIVED_METRIC_KINDS.RampRate]: rampRateSnapshot,
      })[metricKind] || null,
    );

    const result = await createMcpDataService(dependencies).getTodayReadiness({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });
    const expectedSignals = buildReadinessSignals({
      form,
      rampRate,
      nowMs: nowTimeMs,
      sleepPoints: sleepInputs.map((input, index) => ({
        id: input.id,
        sleepDate: input.sleepDate,
        provider: SLEEP_PROVIDERS.GarminAPI,
        startTimeMs: input.endTimeMs - (8 * 60 * 60 * 1000),
        endTimeMs: input.endTimeMs,
        totalSeconds: 8 * 60 * 60,
        score: index === sleepInputs.length - 1 ? 84 : null,
        averageHrvMs: input.hrv,
        averageHeartRateBpm: input.averageHeartRate,
        minimumHeartRateBpm: input.minimumHeartRate,
      })),
    });

    expect(result).toMatchObject({
      asOfTimeMs: nowTimeMs,
      timeZone: 'Europe/Helsinki',
      dayBoundary: 'UTC',
      asOfDayMs,
      formulaVersion: 3,
      status: 'available',
      score: expectedSignals?.score,
      label: expectedSignals?.label,
      confidence: expectedSignals?.confidence,
      availableSignalCount: 4,
      availableWeightPercent: 100,
      baselineEvidenceCount: 3,
      totalSignalCount: 4,
      drivers: {
        load: {
          status: 'available',
          weightPercent: 40,
          form,
          rampRate,
          asOfDayMs,
          sourceUpdatedAtMs: formSnapshot.updatedAtMs,
        },
        sleep: {
          status: 'available',
          weightPercent: 25,
          score: 84,
          scoreSource: 'recorded',
          latestSleepAtMs: sleepInputs[3].endTimeMs,
          sleepDate: '2026-07-27',
          durationSeconds: 28_800,
          recordedScore: 84,
        },
        hrv: {
          status: 'available',
          weightPercent: 20,
          latestMs: 55,
          baselineMedianMs: 50,
          baselineNightCount: 3,
          ratio: 1.1,
        },
        overnightHeartRate: {
          status: 'available',
          weightPercent: 15,
          combinedRatio: expectedSignals?.overnightHeartRateRatio,
          average: {
            latestBpm: 49,
            baselineMedianBpm: 52,
            baselineNightCount: 3,
            ratio: 49 / 52,
          },
          minimum: {
            latestBpm: 40,
            baselineMedianBpm: 44,
            baselineNightCount: 3,
            ratio: 40 / 44,
          },
        },
      },
    });
    expect(dependencies.fetchReadinessSleepDocuments).toHaveBeenCalledWith(
      'user-1',
      nowTimeMs - 30 * 24 * 60 * 60 * 1000,
      nowTimeMs,
      257,
    );
    expect(dependencies.fetchDerivedSnapshot).toHaveBeenCalledTimes(3);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('GarminAPI');
    expect(serialized).not.toContain('private-');
    expect(serialized).not.toContain('components');
    expect(serialized).not.toContain('rawSamples');
    expect(serialized).not.toContain('providerUserId');
  });

  it('uses current compact load fallbacks and keeps missing recovery evidence explicit', async () => {
    const asOfDayMs = Date.parse('2026-07-27T00:00:00.000Z');
    vi.mocked(dependencies.fetchDerivedSnapshot).mockImplementation(
      async (_uid, metricKind) => {
        if (metricKind === DERIVED_METRIC_KINDS.Form) {
          return null;
        }
        if (metricKind === DERIVED_METRIC_KINDS.FormNow) {
          return {
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            updatedAtMs: Date.parse('2026-07-27T09:00:00.000Z'),
            payload: {
              dayBoundary: 'UTC',
              asOfDayMs,
              latestDayMs: asOfDayMs,
              value: 8,
              trend8Weeks: [],
            },
          };
        }
        return {
          status: 'ready',
          schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
          updatedAtMs: Date.parse('2026-07-27T08:00:00.000Z'),
          payload: {
            dayBoundary: 'UTC',
            asOfDayMs,
            latestDayMs: asOfDayMs,
            ctlToday: 42,
            ctl7DaysAgo: 40,
            rampRate: 2,
            trend8Weeks: [],
          },
        };
      },
    );

    const result = await createMcpDataService(dependencies).getTodayReadiness({
      uid: 'user-1',
      timeZone: 'UTC',
    });

    expect(result).toMatchObject({
      status: 'available',
      availableSignalCount: 1,
      availableWeightPercent: 40,
      baselineEvidenceCount: 0,
      drivers: {
        load: {
          status: 'available',
          form: 8,
          rampRate: 2,
          sourceUpdatedAtMs: Date.parse('2026-07-27T08:00:00.000Z'),
        },
        sleep: {
          status: 'no_recent_session',
        },
        hrv: {
          status: 'not_recorded',
        },
        overnightHeartRate: {
          status: 'not_recorded',
        },
      },
    });
  });

  it('omits load freshness when ready snapshots have no current load value', async () => {
    const asOfDayMs = Date.parse('2026-07-27T00:00:00.000Z');
    const previousDayMs = asOfDayMs - (24 * 60 * 60 * 1000);
    vi.mocked(dependencies.fetchDerivedSnapshot).mockImplementation(
      async (_uid, metricKind) => {
        if (metricKind === DERIVED_METRIC_KINDS.Form) {
          return {
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            updatedAtMs: Date.parse('2026-07-27T08:00:00.000Z'),
            payload: {
              dayBoundary: 'UTC',
              rangeStartDayMs: null,
              rangeEndDayMs: null,
              dailyLoads: [],
              excludesMergedEvents: true,
            },
          };
        }
        if (metricKind === DERIVED_METRIC_KINDS.FormNow) {
          return {
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            updatedAtMs: Date.parse('2026-07-27T09:00:00.000Z'),
            payload: {
              dayBoundary: 'UTC',
              asOfDayMs,
              latestDayMs: previousDayMs,
              value: 8,
              trend8Weeks: [],
            },
          };
        }
        if (metricKind === DERIVED_METRIC_KINDS.RampRate) {
          return {
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            updatedAtMs: Date.parse('2026-07-27T10:00:00.000Z'),
            payload: {
              dayBoundary: 'UTC',
              asOfDayMs,
              latestDayMs: previousDayMs,
              ctlToday: 42,
              ctl7DaysAgo: 40,
              rampRate: 2,
              trend8Weeks: [],
            },
          };
        }
        return null;
      },
    );

    const result = await createMcpDataService(dependencies).getDailyReport({
      uid: 'user-1',
      timeZone: 'UTC',
    });

    expect(result.readiness.drivers.load).toEqual({
      status: 'not_ready',
      weightPercent: 40,
      form: null,
      rampRate: null,
      asOfDayMs: null,
      sourceUpdatedAtMs: null,
    });
    expect(createMcpOutputSchemaRegistry({
      activityLocation: true,
      routeLocation: true,
    }).get_daily_report.safeParse(result).success).toBe(true);
  });

  it('uses the normalized Suunto offset for live-readiness sleep-date grouping', async () => {
    const endTimeMs = Date.parse('2026-07-26T23:30:00.000Z');
    vi.mocked(dependencies.fetchReadinessSleepDocuments).mockResolvedValue([{
      ...sleepDocument({
        source: {
          provider: SLEEP_PROVIDERS.SuuntoApp,
          sourceSessionKey: 'private-suunto-session',
        },
        sleepDate: '2026-07-26',
        startTimeMs: endTimeMs - (8 * 60 * 60 * 1000),
        endTimeMs,
        timezoneOffsetSeconds: 2 * 60 * 60,
      }),
      id: 'private-suunto-document',
    }]);

    const result = await createMcpDataService(dependencies).getTodayReadiness({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });

    expect(result.drivers.sleep).toMatchObject({
      status: 'available',
      sleepDate: '2026-07-27',
    });
    expect(JSON.stringify(result)).not.toContain('SuuntoApp');
    expect(JSON.stringify(result)).not.toContain('private-suunto');
  });

  it('rejects oversized or invalid current-readiness queries before projection', async () => {
    await expect(createMcpDataService(dependencies).getTodayReadiness({
      uid: 'user-1',
      timeZone: 'Not/A_Timezone',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_timezone',
    });
    expect(dependencies.fetchReadinessSleepDocuments).not.toHaveBeenCalled();

    vi.mocked(dependencies.fetchReadinessSleepDocuments).mockResolvedValue(
      Array.from({ length: 257 }, (_, index) => ({
        ...sleepDocument(),
        id: `sleep-${index}`,
      })),
    );
    await expect(createMcpDataService(dependencies).getTodayReadiness({
      uid: 'user-1',
      timeZone: 'UTC',
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
  });

  it('returns one bounded daily report with safe sleep HRV, heart rate, and live readiness', async () => {
    const nowTimeMs = Date.parse('2026-07-27T12:00:00.000Z');
    const nights = [{
      id: 'baseline-private-1',
      sleepDate: '2026-07-24',
      endTimeMs: Date.parse('2026-07-24T06:00:00.000Z'),
      durationSeconds: 28_800,
      hrv: 40,
      overnightHrv: 41,
      averageHeartRate: 54,
      minimumHeartRate: 46,
    }, {
      id: 'baseline-private-2',
      sleepDate: '2026-07-25',
      endTimeMs: Date.parse('2026-07-25T06:00:00.000Z'),
      durationSeconds: 28_800,
      hrv: 50,
      overnightHrv: 51,
      averageHeartRate: 52,
      minimumHeartRate: 44,
    }, {
      id: 'baseline-private-3',
      sleepDate: '2026-07-26',
      endTimeMs: Date.parse('2026-07-26T06:00:00.000Z'),
      durationSeconds: 28_800,
      hrv: 60,
      overnightHrv: 61,
      averageHeartRate: 50,
      minimumHeartRate: 42,
    }, {
      id: 'latest-private',
      sleepDate: '2026-07-27',
      endTimeMs: Date.parse('2026-07-27T06:00:00.000Z'),
      durationSeconds: 29_700,
      hrv: 55,
      overnightHrv: 56,
      averageHeartRate: 49,
      minimumHeartRate: 40,
    }];
    vi.mocked(dependencies.now).mockReturnValue(nowTimeMs);
    vi.mocked(dependencies.fetchReadinessSleepDocuments).mockResolvedValue(
      nights.map((night, index) => ({
        ...sleepDocument({
          sleepDate: night.sleepDate,
          startTimeMs: night.endTimeMs - night.durationSeconds * 1000,
          endTimeMs: night.endTimeMs,
          durationSeconds: night.durationSeconds,
          inBedDurationSeconds: night.durationSeconds + 900,
          score: index === nights.length - 1
            ? {
                value: 84,
                qualifier: 'good',
                components: { private: true },
              }
            : null,
          vitals: {
            averageHrvMs: night.hrv,
            overnightHrvMs: night.overnightHrv,
            averageHeartRateBpm: night.averageHeartRate,
            minimumHeartRateBpm: night.minimumHeartRate,
            maxSpo2Percent: 99,
            averageRespirationBrpm: 12,
            rawSamples: [{ private: true }],
          },
        }),
        id: night.id,
      })),
    );

    const result = await createMcpDataService(dependencies).getDailyReport({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });

    expect(result).toMatchObject({
      sleep: {
        status: 'available',
        latestSession: {
          sleepDate: '2026-07-27',
          startTimeMs: nights[3].endTimeMs - nights[3].durationSeconds * 1000,
          endTimeMs: nights[3].endTimeMs,
          durationSeconds: 29_700,
          inBedDurationSeconds: 30_600,
          score: {
            value: 84,
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
          sameProviderNightCount: 3,
          averageDurationSeconds: 28_800,
          durationDeltaSeconds: 900,
        },
      },
      readiness: {
        asOfTimeMs: nowTimeMs,
        timeZone: 'Europe/Helsinki',
        status: 'available',
        availableSignalCount: 3,
        availableWeightPercent: 60,
        baselineEvidenceCount: 3,
        drivers: {
          load: {
            status: 'not_ready',
          },
          sleep: {
            status: 'available',
            recordedScore: 84,
          },
          hrv: {
            status: 'available',
            latestMs: 55,
            baselineMedianMs: 50,
            baselineNightCount: 3,
            ratio: 1.1,
          },
          overnightHeartRate: {
            status: 'available',
            average: {
              latestBpm: 49,
              baselineMedianBpm: 52,
              baselineNightCount: 3,
            },
            minimum: {
              latestBpm: 40,
              baselineMedianBpm: 44,
              baselineNightCount: 3,
            },
          },
        },
      },
      trainingSummary: {
        status: 'not_ready',
      },
    });
    expect(dependencies.fetchReadinessSleepDocuments).toHaveBeenCalledWith(
      'user-1',
      nowTimeMs - 30 * 24 * 60 * 60 * 1000,
      nowTimeMs,
      257,
      true,
    );
    expect(dependencies.fetchSleepDocuments).not.toHaveBeenCalled();
    expect(dependencies.fetchDerivedSnapshot).toHaveBeenCalledTimes(4);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('GarminAPI');
    expect(serialized).not.toContain('private-');
    expect(serialized).not.toContain('maxSpo2Percent');
    expect(serialized).not.toContain('averageRespirationBrpm');
    expect(serialized).not.toContain('components');
    expect(serialized).not.toContain('rawSamples');
  });

  it('rejects an invalid daily-report timezone before reading account data', async () => {
    await expect(createMcpDataService(dependencies).getDailyReport({
      uid: 'user-1',
      timeZone: 'Not/A_Timezone',
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_timezone',
    });

    expect(dependencies.fetchReadinessSleepDocuments).not.toHaveBeenCalled();
    expect(dependencies.fetchDerivedSnapshot).not.toHaveBeenCalled();
  });

  it('returns explicit unavailable states when the daily report has no account evidence', async () => {
    const nowTimeMs = Date.parse('2026-07-27T12:00:00.000Z');
    vi.mocked(dependencies.now).mockReturnValue(nowTimeMs);

    const result = await createMcpDataService(dependencies).getDailyReport({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });

    expect(result).toMatchObject({
      sleep: {
        status: 'no_completed_session',
        latestSession: null,
        comparison: {
          sameProviderNightCount: 0,
          averageDurationSeconds: null,
          durationDeltaSeconds: null,
        },
      },
      readiness: {
        status: 'no_signal',
        score: null,
        availableSignalCount: 0,
        availableWeightPercent: 0,
        baselineEvidenceCount: 0,
        drivers: {
          load: {
            status: 'not_ready',
          },
          sleep: {
            status: 'no_recent_session',
          },
          hrv: {
            status: 'not_recorded',
          },
          overnightHeartRate: {
            status: 'not_recorded',
          },
        },
      },
      trainingSummary: {
        status: 'not_ready',
      },
    });
  });

  it('uses the same deterministic same-provider sleep-night grouping for the report and readiness', async () => {
    const nightlyDocument = (
      id: string,
      sleepDate: string,
      startTimeMs: number,
      endTimeMs: number,
      hrv: number,
      averageHeartRate: number,
      minimumHeartRate: number,
      score: number | null = null,
    ) => ({
      ...sleepDocument({
        sleepDate,
        startTimeMs,
        endTimeMs,
        durationSeconds: (endTimeMs - startTimeMs) / 1000,
        inBedDurationSeconds: (endTimeMs - startTimeMs) / 1000,
        score: score === null ? null : {
          value: score,
          qualifier: 'recorded',
        },
        vitals: {
          averageHrvMs: hrv,
          averageHeartRateBpm: averageHeartRate,
          minimumHeartRateBpm: minimumHeartRate,
        },
      }),
      id,
    });
    const baselineDates = ['2026-07-24', '2026-07-25', '2026-07-26'];
    const baselineHrv = [40, 50, 60];
    const documents = baselineDates.map((sleepDate, index) => {
      const endTimeMs = Date.parse(`${sleepDate}T06:00:00.000Z`);
      return nightlyDocument(
        `baseline-${index}`,
        sleepDate,
        endTimeMs - 28_800_000,
        endTimeMs,
        baselineHrv[index],
        52,
        44,
      );
    });
    documents.push(
      nightlyDocument(
        'latest-a',
        '2026-07-27',
        Date.parse('2026-07-26T22:00:00.000Z'),
        Date.parse('2026-07-27T02:00:00.000Z'),
        50,
        50,
        42,
      ),
      nightlyDocument(
        'latest-b',
        '2026-07-27',
        Date.parse('2026-07-27T02:00:00.000Z'),
        Date.parse('2026-07-27T06:00:00.000Z'),
        60,
        48,
        40,
        82,
      ),
    );
    vi.mocked(dependencies.fetchReadinessSleepDocuments).mockResolvedValue(
      documents,
    );

    const result = await createMcpDataService(dependencies).getDailyReport({
      uid: 'user-1',
      timeZone: 'UTC',
    });

    expect(result.sleep.latestSession).toMatchObject({
      sleepDate: '2026-07-27',
      startTimeMs: Date.parse('2026-07-26T22:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-27T06:00:00.000Z'),
      durationSeconds: 28_800,
      inBedDurationSeconds: 28_800,
      score: {
        value: 82,
        qualifier: 'recorded',
      },
      vitals: {
        averageHrvMs: 55,
        averageHeartRateBpm: 49,
        minimumHeartRateBpm: 40,
      },
    });
    expect(result.readiness.drivers.sleep).toMatchObject({
      durationSeconds: 28_800,
      recordedScore: 82,
    });
    expect(result.readiness.drivers.hrv).toMatchObject({
      latestMs: 55,
      baselineMedianMs: 50,
    });
    expect(result.readiness.drivers.overnightHeartRate).toMatchObject({
      average: {
        latestBpm: 49,
        baselineMedianBpm: 52,
      },
      minimum: {
        latestBpm: 40,
        baselineMedianBpm: 44,
      },
    });
  });

  it('does not understate grouped in-bed duration when a sleep fragment is missing it', async () => {
    const firstEndTimeMs = Date.parse('2026-07-27T02:00:00.000Z');
    const secondEndTimeMs = Date.parse('2026-07-27T06:00:00.000Z');
    vi.mocked(dependencies.fetchReadinessSleepDocuments).mockResolvedValue([
      {
        ...sleepDocument({
          sleepDate: '2026-07-27',
          startTimeMs: Date.parse('2026-07-26T22:00:00.000Z'),
          endTimeMs: firstEndTimeMs,
          durationSeconds: 14_400,
          inBedDurationSeconds: 14_400,
        }),
        id: 'latest-a',
      },
      {
        ...sleepDocument({
          sleepDate: '2026-07-27',
          startTimeMs: firstEndTimeMs,
          endTimeMs: secondEndTimeMs,
          durationSeconds: 14_400,
          inBedDurationSeconds: null,
        }),
        id: 'latest-b',
      },
    ]);

    const result = await createMcpDataService(dependencies).getDailyReport({
      uid: 'user-1',
      timeZone: 'UTC',
    });

    expect(result.sleep.latestSession).toMatchObject({
      durationSeconds: 28_800,
      inBedDurationSeconds: null,
    });
  });

  it('returns a bounded, identity-free daily briefing from completed sleep and current readiness only', async () => {
    const nowTimeMs = Date.parse('2026-07-27T12:00:00.000Z');
    vi.mocked(dependencies.now).mockReturnValue(nowTimeMs);
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument({
        endTimeMs: Date.parse('2026-07-27T06:00:00.000Z'),
        startTimeMs: Date.parse('2026-07-26T22:00:00.000Z'),
        sleepDate: '2026-07-27',
        durationSeconds: 28_800,
      }),
      sleepDocument({
        endTimeMs: Date.parse('2026-07-26T06:00:00.000Z'),
        startTimeMs: Date.parse('2026-07-25T22:30:00.000Z'),
        sleepDate: '2026-07-26',
        durationSeconds: 27_000,
      }),
      sleepDocument({
        id: 'duplicate-prior-night',
        endTimeMs: Date.parse('2026-07-26T05:00:00.000Z'),
        startTimeMs: Date.parse('2026-07-26T01:00:00.000Z'),
        sleepDate: '2026-07-26',
        durationSeconds: 14_400,
      }),
      sleepDocument({
        endTimeMs: Date.parse('2026-07-25T06:00:00.000Z'),
        startTimeMs: Date.parse('2026-07-24T22:15:00.000Z'),
        sleepDate: '2026-07-25',
        durationSeconds: 27_900,
      }),
      sleepDocument({
        endTimeMs: Date.parse('2026-07-24T06:00:00.000Z'),
        startTimeMs: Date.parse('2026-07-23T22:00:00.000Z'),
        sleepDate: '2026-07-24',
        durationSeconds: 28_200,
      }),
      sleepDocument({
        id: 'nap-private',
        isNap: true,
        endTimeMs: Date.parse('2026-07-27T10:00:00.000Z'),
      }),
    ]);
    const readinessSnapshot = {
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: nowTimeMs,
      payload: {
        formulaVersion: 3,
        dayBoundary: 'UTC',
        asOfDayMs: Date.parse('2026-07-27T00:00:00.000Z'),
        generatedAtMs: nowTimeMs,
        historyDays: 14,
        points: [{
          dayMs: Date.parse('2026-07-27T00:00:00.000Z'),
          score: 76,
          label: 'Ready',
          confidence: 'high',
          availableSignalCount: 4,
          baselineEvidenceCount: 14,
          totalSignalCount: 4,
          form: 12,
          rampRate: 3,
          sleepScore: 82,
          latestSleepAtMs: Date.parse('2026-07-27T06:00:00.000Z'),
          hrvRatio: 1.04,
          averageHeartRateRatio: 0.98,
          minimumHeartRateRatio: 0.97,
          overnightHeartRateRatio: 0.98,
        }],
      },
    };
    const trainingSummarySnapshot = {
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: nowTimeMs,
      payload: {
        dayBoundary: 'UTC',
        asOfDayMs: Date.parse('2026-07-27T00:00:00.000Z'),
        currentWindowDays: 28,
        baselineWindowDays: 84,
        excludesMergedEvents: true,
        disciplines: [{
          discipline: 'running',
          current28d: {
            periodDays: 28,
            windowStartDayMs: Date.parse('2026-06-30T00:00:00.000Z'),
            windowEndDayMs: Date.parse('2026-07-27T00:00:00.000Z'),
            activityCount: 6,
            durationSeconds: 14_400,
            easySeconds: 9_000,
            moderateSeconds: 3_600,
            hardSeconds: 1_800,
          },
          baseline28d: {
            periodDays: 28,
            windowStartDayMs: Date.parse('2026-04-07T00:00:00.000Z'),
            windowEndDayMs: Date.parse('2026-06-29T00:00:00.000Z'),
            activityCount: 4.67,
            durationSeconds: 11_200,
            easySeconds: 7_000,
            moderateSeconds: 2_800,
            hardSeconds: 1_400,
          },
        }, {
          discipline: 'cycling',
          current28d: {
            periodDays: 28,
            windowStartDayMs: Date.parse('2026-06-30T00:00:00.000Z'),
            windowEndDayMs: Date.parse('2026-07-27T00:00:00.000Z'),
            activityCount: 3,
            durationSeconds: 10_800,
            easySeconds: 7_200,
            moderateSeconds: 2_400,
            hardSeconds: 1_200,
          },
          baseline28d: {
            periodDays: 28,
            windowStartDayMs: Date.parse('2026-04-07T00:00:00.000Z'),
            windowEndDayMs: Date.parse('2026-06-29T00:00:00.000Z'),
            activityCount: 2,
            durationSeconds: 7_200,
            easySeconds: 4_800,
            moderateSeconds: 1_600,
            hardSeconds: 800,
          },
        }, {
          discipline: 'swimming',
          current28d: {
            periodDays: 28,
            windowStartDayMs: Date.parse('2026-06-30T00:00:00.000Z'),
            windowEndDayMs: Date.parse('2026-07-27T00:00:00.000Z'),
            activityCount: 2,
            durationSeconds: 3_600,
            easySeconds: 2_400,
            moderateSeconds: 900,
            hardSeconds: 300,
          },
          baseline28d: {
            periodDays: 28,
            windowStartDayMs: Date.parse('2026-04-07T00:00:00.000Z'),
            windowEndDayMs: Date.parse('2026-06-29T00:00:00.000Z'),
            activityCount: 1.33,
            durationSeconds: 2_800,
            easySeconds: 1_800,
            moderateSeconds: 700,
            hardSeconds: 300,
          },
        }],
      },
    };
    vi.mocked(dependencies.fetchDerivedSnapshot).mockImplementation(
      async (_uid, metricKind) => (
        metricKind === DERIVED_METRIC_KINDS.TrainingSummary
          ? trainingSummarySnapshot
          : readinessSnapshot
      ),
    );

    const result = await createMcpDataService(dependencies).getDailyBriefing({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });

    expect(result).toMatchObject({
      asOfTimeMs: nowTimeMs,
      timeZone: 'Europe/Helsinki',
      sleep: {
        status: 'available',
        latestSession: {
          sleepDate: '2026-07-27',
          durationSeconds: 28_800,
        },
        comparison: {
          sameProviderNightCount: 3,
          averageDurationSeconds: 27_700,
          durationDeltaSeconds: 1_100,
        },
      },
      trainingReadiness: {
        status: 'available',
        dayBoundary: 'UTC',
        score: 76,
        label: 'Ready',
        confidence: 'high',
        availableSignalCount: 4,
        baselineEvidenceCount: 14,
      },
      trainingSummary: {
        status: 'available',
        dayBoundary: 'UTC',
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
          current28d: expect.objectContaining({ activityCount: 6 }),
          usual28d: expect.objectContaining({ activityCount: 4.67 }),
        }, {
          discipline: 'cycling',
          current28d: expect.objectContaining({ activityCount: 3 }),
          usual28d: expect.objectContaining({ activityCount: 2 }),
        }, {
          discipline: 'swimming',
          current28d: expect.objectContaining({ activityCount: 2 }),
          usual28d: expect.objectContaining({ activityCount: 1.33 }),
        }],
      },
    });
    expect(dependencies.fetchSleepDocuments).toHaveBeenCalledWith(
      'user-1',
      nowTimeMs - 14 * 24 * 60 * 60 * 1000,
      nowTimeMs,
      33,
    );
    expect(dependencies.fetchDerivedSnapshot).toHaveBeenCalledWith(
      'user-1',
      DERIVED_METRIC_KINDS.TrainingReadiness,
    );
    expect(dependencies.fetchDerivedSnapshot).toHaveBeenCalledWith(
      'user-1',
      DERIVED_METRIC_KINDS.TrainingSummary,
    );
    trainingSummarySnapshot.payload.excludesMergedEvents = false;
    const summaryIncludingMergedEvents = await createMcpDataService(dependencies)
      .getDailyBriefing({
        uid: 'user-1',
        timeZone: 'Europe/Helsinki',
      });
    expect(summaryIncludingMergedEvents.trainingSummary).toMatchObject({
      status: 'not_ready',
      current28d: null,
      usual28d: null,
      disciplines: [],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('GarminAPI');
    expect(serialized).not.toContain('private-source-key');
    expect(serialized).not.toContain('averageHeartRateBpm');
    expect(serialized).not.toContain('overnightHeartRateRatio');
    expect(serialized).not.toContain('latestSleepAtMs');
    expect(serialized).not.toContain('windowStartDayMs');
    expect(serialized).not.toContain('windowEndDayMs');
  });

  it('makes unavailable daily-briefing inputs explicit without returning a stale readiness score', async () => {
    vi.mocked(dependencies.fetchDerivedSnapshot).mockResolvedValue(null);

    const result = await createMcpDataService(dependencies).getDailyBriefing({
      uid: 'user-1',
      timeZone: 'Europe/Helsinki',
    });

    expect(result.sleep).toEqual({
      status: 'no_completed_session',
      latestSession: null,
      comparison: {
        sameProviderNightCount: 0,
        averageDurationSeconds: null,
        durationDeltaSeconds: null,
      },
    });
    expect(result.trainingReadiness).toEqual({
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
    });
    expect(result.trainingSummary).toEqual({
      status: 'not_ready',
      dayBoundary: 'UTC',
      asOfDayMs: null,
      updatedAtMs: null,
      baselineSourceWindowDays: null,
      current28d: null,
      usual28d: null,
      disciplines: [],
    });
  });

  it('withholds a stale daily-readiness score even when the stored snapshot is ready', async () => {
    vi.mocked(dependencies.fetchDerivedSnapshot).mockResolvedValue({
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      updatedAtMs: Date.parse('2026-07-26T12:00:00.000Z'),
      payload: {
        formulaVersion: 3,
        dayBoundary: 'UTC',
        asOfDayMs: Date.parse('2026-07-26T00:00:00.000Z'),
        generatedAtMs: Date.parse('2026-07-26T12:00:00.000Z'),
        historyDays: 14,
        points: [{
          dayMs: Date.parse('2026-07-26T00:00:00.000Z'),
          score: 64,
          label: 'Mixed',
          confidence: 'medium',
          availableSignalCount: 3,
          baselineEvidenceCount: 8,
          totalSignalCount: 4,
          form: 2,
          rampRate: 1,
          sleepScore: 80,
          latestSleepAtMs: null,
          hrvRatio: null,
          averageHeartRateRatio: null,
          minimumHeartRateRatio: null,
          overnightHeartRateRatio: null,
        }],
      },
    });

    const result = await createMcpDataService(dependencies).getDailyBriefing({
      uid: 'user-1',
      timeZone: 'UTC',
    });

    expect(result.trainingReadiness).toMatchObject({
      status: 'stale',
      asOfDayMs: Date.parse('2026-07-26T00:00:00.000Z'),
      score: null,
      label: null,
      confidence: null,
      availableSignalCount: null,
      baselineEvidenceCount: null,
    });
  });

  it('withholds stale or partial Training Summary snapshots from the daily briefing', async () => {
    const staleSummaryDayMs = Date.parse('2026-07-26T00:00:00.000Z');
    const summaryWindow = {
      periodDays: 28,
      windowStartDayMs: staleSummaryDayMs - (27 * 24 * 60 * 60 * 1000),
      windowEndDayMs: staleSummaryDayMs,
      activityCount: 0,
      durationSeconds: 0,
      easySeconds: 0,
      moderateSeconds: 0,
      hardSeconds: 0,
      contexts: [],
    };
    vi.mocked(dependencies.fetchDerivedSnapshot).mockImplementation(
      async (_uid, metricKind) => {
        if (metricKind === DERIVED_METRIC_KINDS.TrainingReadiness) {
          return null;
        }
        return {
          status: 'ready',
          schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
          updatedAtMs: -1,
          payload: {
            dayBoundary: 'UTC',
            asOfDayMs: staleSummaryDayMs,
            currentWindowDays: 28,
            baselineWindowDays: 84,
            excludesMergedEvents: true,
            disciplines: TRAINING_DISCIPLINES.map(discipline => ({
              discipline,
              current28d: summaryWindow,
              baseline28d: summaryWindow,
            })),
          },
        };
      },
    );

    const stale = await createMcpDataService(dependencies).getDailyBriefing({
      uid: 'user-1',
      timeZone: 'UTC',
    });
    expect(stale.trainingSummary).toEqual({
      status: 'stale',
      dayBoundary: 'UTC',
      asOfDayMs: staleSummaryDayMs,
      updatedAtMs: null,
      baselineSourceWindowDays: null,
      current28d: null,
      usual28d: null,
      disciplines: [],
    });

    vi.mocked(dependencies.fetchDerivedSnapshot).mockImplementation(
      async (_uid, metricKind) => {
        if (metricKind === DERIVED_METRIC_KINDS.TrainingReadiness) {
          return null;
        }
        return {
          status: 'ready',
          schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
          updatedAtMs: Date.parse('2026-07-27T12:00:00.000Z'),
          payload: {
            dayBoundary: 'UTC',
            asOfDayMs: Date.parse('2026-07-27T00:00:00.000Z'),
            currentWindowDays: 28,
            baselineWindowDays: 84,
            excludesMergedEvents: true,
            disciplines: [],
          },
        };
      },
    );
    const partial = await createMcpDataService(dependencies).getDailyBriefing({
      uid: 'user-1',
      timeZone: 'UTC',
    });
    expect(partial.trainingSummary).toEqual({
      status: 'not_ready',
      dayBoundary: 'UTC',
      asOfDayMs: null,
      updatedAtMs: null,
      baselineSourceWindowDays: null,
      current28d: null,
      usual28d: null,
      disciplines: [],
    });
  });

  it('redacts raw sleep samples, provider identifiers, stage intervals, and provider payloads', async () => {
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument(),
    ]);

    const result = await createMcpDataService(dependencies).listSleepSessions({
      uid: 'user-1',
      connectionId: 'connection-1',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
    });

    expect(result.sessions).toEqual([{
      provider: SLEEP_PROVIDERS.GarminAPI,
      sleepDate: '2024-04-01',
      startTimeMs: Date.parse('2024-03-31T20:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-01T04:00:00.000Z'),
      durationSeconds: 28800,
      inBedDurationSeconds: 30600,
      isNap: false,
      stageDurationsSeconds: {
        deep: 7200,
        light: 14400,
      },
      score: {
        value: 82,
        qualifier: 'good',
      },
      vitals: {
        averageHeartRateBpm: 50,
        overnightHrvMs: 55,
      },
    }]);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('hrvSamples');
    expect(JSON.stringify(result)).not.toContain('spo2Samples');
    expect(JSON.stringify(result)).not.toContain('respirationSamples');
    expect(JSON.stringify(result)).not.toContain('stages');
  });

  it('discovers only recorded aggregate sleep vitals without source or sample data', async () => {
    const secondarySession = sleepDocument({
      vitals: {
        averageHrvMs: 41,
        hrvSampleCount: 96,
        maxSpo2Percent: 98,
        averageRespirationBrpm: 13,
      },
      hrvSamples: [{ value: 41, timestampMs: 1_712_000_000_000 }],
      providerFields: { coros: { private: true } },
    });
    secondarySession.id = 'sleep-2';
    const napSession = sleepDocument({
      isNap: true,
      vitals: { restingHeartRateBpm: 44 },
    });
    napSession.id = 'sleep-3';
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument(),
      secondarySession,
      napSession,
    ]);

    const result = await createMcpDataService(dependencies).listSleepVitals({
      uid: 'user-1',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
    });

    expect(result).toEqual({
      matchedSessionCount: 2,
      vitals: [
        {
          type: 'averageHeartRateBpm',
          label: 'Average heart rate',
          unit: 'beats_per_minute',
          sessionCount: 1,
        },
        {
          type: 'averageHrvMs',
          label: 'Average HRV',
          unit: 'milliseconds',
          sessionCount: 1,
        },
        {
          type: 'hrvSampleCount',
          label: 'HRV sample count',
          unit: 'count',
          sessionCount: 1,
        },
        {
          type: 'overnightHrvMs',
          label: 'Overnight HRV',
          unit: 'milliseconds',
          sessionCount: 1,
        },
        {
          type: 'maxSpo2Percent',
          label: 'Maximum blood oxygen saturation',
          unit: 'percent',
          sessionCount: 1,
        },
        {
          type: 'averageRespirationBrpm',
          label: 'Average respiration',
          unit: 'breaths_per_minute',
          sessionCount: 1,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('hrvSamples');
  });

  it('returns sleep and HRV coverage plus trend buckets in one bounded read', async () => {
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument(),
      sleepDocument({
        sleepDate: '2024-04-02',
        startTimeMs: Date.parse('2024-04-01T20:00:00.000Z'),
        endTimeMs: Date.parse('2024-04-02T04:00:00.000Z'),
        durationSeconds: 7 * 60 * 60,
        score: { value: 72, qualifier: 'fair' },
        vitals: {
          averageHrvMs: 41,
          providerRecoveryScore: 99,
        },
        hrvSamples: [{ value: 41, timestampMs: 1_712_030_400_000 }],
        providerFields: { garmin: { private: true } },
      }),
    ]);

    const result = await createMcpDataService(dependencies).getSleepTrend({
      uid: 'user-1',
      startTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-03T00:00:00.000Z'),
      groupBy: 'day',
      timeZone: 'UTC',
    });

    expect(dependencies.fetchSleepDocuments).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      rangeStartTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
      rangeEndTimeMs: Date.parse('2024-04-03T00:00:00.000Z'),
      timeZone: 'UTC',
      groupBy: 'day',
      matchedSessionCount: 2,
      availableVitals: [
        {
          type: 'averageHeartRateBpm',
          label: 'Average heart rate',
          unit: 'beats_per_minute',
          sessionCount: 1,
        },
        {
          type: 'averageHrvMs',
          label: 'Average HRV',
          unit: 'milliseconds',
          sessionCount: 1,
        },
        {
          type: 'overnightHrvMs',
          label: 'Overnight HRV',
          unit: 'milliseconds',
          sessionCount: 1,
        },
      ],
      buckets: [
        expect.objectContaining({
          bucketStartMs: Date.parse('2024-04-01T00:00:00.000Z'),
          sessionCount: 1,
          averageDurationSeconds: 8 * 60 * 60,
          averageScore: 82,
          averageVitals: {
            averageHeartRateBpm: 50,
            overnightHrvMs: 55,
          },
        }),
        expect.objectContaining({
          bucketStartMs: Date.parse('2024-04-02T00:00:00.000Z'),
          sessionCount: 1,
          averageDurationSeconds: 7 * 60 * 60,
          averageScore: 72,
          averageVitals: {
            averageHrvMs: 41,
          },
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain('providerUserId');
    expect(JSON.stringify(result)).not.toContain('hrvSamples');
    expect(JSON.stringify(result)).not.toContain('providerFields');
    expect(JSON.stringify(result)).not.toContain('providerRecoveryScore');
  });

  it('keeps grouped HRV sample-count averages inside the integer wire contract', async () => {
    const secondSession = sleepDocument({
      sleepDate: '2024-04-02',
      startTimeMs: Date.parse('2024-04-01T20:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-02T04:00:00.000Z'),
      vitals: { hrvSampleCount: 97 },
    });
    secondSession.id = 'sleep-2';
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument({ vitals: { hrvSampleCount: 96 } }),
      secondSession,
    ]);

    const result = await createMcpDataService(dependencies).getSleepTrend({
      uid: 'user-1',
      startTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-08T00:00:00.000Z'),
      groupBy: 'week',
      timeZone: 'UTC',
    });

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].averageVitals.hrvSampleCount).toBe(97);
    expect(Number.isInteger(
      result.buckets[0].averageVitals.hrvSampleCount,
    )).toBe(true);
    expect(createMcpOutputSchemaRegistry({
      activityLocation: false,
      routeLocation: false,
    }).get_sleep_trend.safeParse(result).success).toBe(true);
  });

  it('keeps normalized sleep vitals consistent across summaries, trends, and the daily report', async () => {
    const session = sleepDocument({
      vitals: {
        averageHeartRateBpm: 49,
        minimumHeartRateBpm: 40,
        averageHrvMs: 54,
        overnightHrvMs: 56,
        maxSpo2Percent: 98,
        averageRespirationBrpm: 13,
      },
    });
    vi.mocked(dependencies.now).mockReturnValue(
      Date.parse('2024-04-02T12:00:00.000Z'),
    );
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([session]);
    vi.mocked(dependencies.fetchReadinessSleepDocuments).mockResolvedValue([
      session,
    ]);

    const service = createMcpDataService(dependencies);
    const input = {
      uid: 'user-1',
      startTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-02T00:00:00.000Z'),
      groupBy: 'day' as const,
      timeZone: 'UTC',
    };
    const [summary, trend, report] = await Promise.all([
      service.querySleepSummary(input),
      service.getSleepTrend(input),
      service.getDailyReport({
        uid: 'user-1',
        timeZone: 'UTC',
      }),
    ]);

    expect(trend.buckets).toEqual(summary.buckets);
    expect(trend.availableVitals.map(vital => vital.type)).toEqual([
      'averageHeartRateBpm',
      'minimumHeartRateBpm',
      'averageHrvMs',
      'overnightHrvMs',
      'maxSpo2Percent',
      'averageRespirationBrpm',
    ]);
    expect(summary.buckets[0].averageVitals).toEqual({
      averageHeartRateBpm: 49,
      minimumHeartRateBpm: 40,
      averageHrvMs: 54,
      overnightHrvMs: 56,
      maxSpo2Percent: 98,
      averageRespirationBrpm: 13,
    });
    expect(report.sleep.latestSession?.vitals).toEqual({
      averageHrvMs: 54,
      overnightHrvMs: 56,
      averageHeartRateBpm: 49,
      minimumHeartRateBpm: 40,
    });
    expect(JSON.stringify(report)).not.toContain('maxSpo2Percent');
    expect(JSON.stringify(report)).not.toContain('averageRespirationBrpm');
  });

  it('averages session-level SpO2 maxima and respiration averages in trend buckets', async () => {
    const secondSession = sleepDocument({
      startTimeMs: Date.parse('2024-03-31T21:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-01T03:00:00.000Z'),
      durationSeconds: 6 * 60 * 60,
      vitals: {
        maxSpo2Percent: 96,
        averageRespirationBrpm: 14,
      },
    });
    secondSession.id = 'sleep-2';
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument({
        vitals: {
          maxSpo2Percent: 98,
          averageRespirationBrpm: 12,
        },
      }),
      secondSession,
    ]);

    const result = await createMcpDataService(dependencies).getSleepTrend({
      uid: 'user-1',
      startTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-04-02T00:00:00.000Z'),
      groupBy: 'day',
      timeZone: 'UTC',
    });

    expect(result.availableVitals).toEqual([
      {
        type: 'maxSpo2Percent',
        label: 'Maximum blood oxygen saturation',
        unit: 'percent',
        sessionCount: 2,
      },
      {
        type: 'averageRespirationBrpm',
        label: 'Average respiration',
        unit: 'breaths_per_minute',
        sessionCount: 2,
      },
    ]);
    expect(result.buckets).toEqual([
      expect.objectContaining({
        bucketStartMs: Date.parse('2024-04-01T00:00:00.000Z'),
        sessionCount: 2,
        averageVitals: {
          maxSpo2Percent: 97,
          averageRespirationBrpm: 13,
        },
      }),
    ]);
  });

  it('rejects a sleep trend that exceeds the shared session budget', async () => {
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue(
      Array.from({ length: 1_001 }, (_, index) => ({
        ...sleepDocument(),
        id: `sleep-${index}`,
      })),
    );

    await expect(createMcpDataService(dependencies).getSleepTrend({
      uid: 'user-1',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
      groupBy: 'day',
      timeZone: 'UTC',
    })).rejects.toMatchObject<McpDataError>({
      code: 'query_too_large',
    });
    expect(dependencies.fetchSleepDocuments).toHaveBeenCalledWith(
      'user-1',
      Date.parse('2024-03-01T00:00:00.000Z'),
      Date.parse('2024-05-01T00:00:00.000Z'),
      1_001,
    );
  });

  it('preserves missing optional sleep measurements instead of treating them as zero', async () => {
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument({
        source: {
          provider: SLEEP_PROVIDERS.COROSAPI,
          sourceSessionKey: 'private-source-key',
          providerUserId: 'private-provider-user',
        },
        inBedDurationSeconds: null,
        score: {
          value: null,
          qualifier: null,
        },
        vitals: {
          averageHeartRateBpm: null,
          overnightHrvMs: null,
        },
      }),
    ]);
    const service = createMcpDataService(dependencies);
    const range = {
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
    };

    const sessions = await service.listSleepSessions({
      uid: 'user-1',
      connectionId: 'connection-1',
      ...range,
    });
    const summary = await service.querySleepSummary({
      uid: 'user-1',
      ...range,
      groupBy: 'day',
      timeZone: 'UTC',
    });

    expect(sessions.sessions).toEqual([
      expect.objectContaining({
        provider: SLEEP_PROVIDERS.COROSAPI,
        inBedDurationSeconds: null,
        score: {
          value: null,
          qualifier: null,
        },
        vitals: null,
      }),
    ]);
    expect(summary.buckets).toEqual([
      expect.objectContaining({
        averageInBedDurationSeconds: null,
        averageScore: null,
        averageVitals: {},
      }),
    ]);
  });

  it('does not expose invalid zero-valued sleep physiology or include it in averages', async () => {
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument({
        vitals: {
          averageHeartRateBpm: 0,
          minimumHeartRateBpm: 0,
          restingHeartRateBpm: 0,
          averageHrvMs: 0,
          hrvSampleCount: 0,
          overnightHrvMs: 0,
          maxSpo2Percent: 0,
          averageRespirationBrpm: 0,
        },
      }),
    ]);
    const service = createMcpDataService(dependencies);
    const range = {
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
    };

    const sessions = await service.listSleepSessions({
      uid: 'user-1',
      connectionId: 'connection-1',
      ...range,
    });
    const summary = await service.querySleepSummary({
      uid: 'user-1',
      ...range,
      groupBy: 'day',
      timeZone: 'UTC',
    });

    expect(sessions.sessions).toEqual([
      expect.objectContaining({
        vitals: {
          hrvSampleCount: 0,
        },
      }),
    ]);
    expect(summary.buckets).toEqual([
      expect.objectContaining({
        averageVitals: {
          hrvSampleCount: 0,
        },
      }),
    ]);
  });

  it('skips malformed normalized sleep sessions', async () => {
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument({
        sleepDate: 'not-a-date',
      }),
      sleepDocument({
        sleepDate: '2024-02-31',
      }),
      sleepDocument({
        startTimeMs: Date.parse('2024-04-01T05:00:00.000Z'),
        endTimeMs: Date.parse('2024-04-01T04:00:00.000Z'),
      }),
      sleepDocument({
        durationSeconds: 0,
      }),
    ]);

    const result = await createMcpDataService(dependencies).listSleepSessions({
      uid: 'user-1',
      connectionId: 'connection-1',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
    });

    expect(result.sessions).toEqual([]);
  });

  it('rejects plaintext or tampered pagination cursors', async () => {
    const cursor = Buffer.from(JSON.stringify({
      endTimeMs: Date.parse('2024-04-01T04:00:00.000Z'),
      id: 'sleep-1',
    }), 'utf8').toString('base64url');
    await expect(createMcpDataService(dependencies).listSleepSessions({
      uid: 'user-1',
      connectionId: 'connection-1',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
      cursor,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
    expect(dependencies.fetchSleepDocuments).not.toHaveBeenCalled();
  });

  it('returns a cursor when an entire sleep scan page is excluded by filters', async () => {
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue(
      Array.from({ length: 126 }, (_, index) => sleepDocument({
        endTimeMs: Date.parse('2024-04-01T04:00:00.000Z') - index,
        isNap: true,
      })).map((document, index) => ({
        ...document,
        id: `sleep-${index}`,
      })),
    );

    const result = await createMcpDataService(dependencies).listSleepSessions({
      uid: 'user-1',
      connectionId: 'connection-1',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
      limit: 25,
      includeNaps: false,
    });

    expect(result.sessions).toEqual([]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(Buffer.from(result.nextCursor!, 'base64url').toString('utf8')).not.toContain('sleep-124');
  });

  it('binds opaque sleep cursors to the MCP connection', async () => {
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue(
      Array.from({ length: 126 }, (_, index) => sleepDocument({
        endTimeMs: Date.parse('2024-04-01T04:00:00.000Z') - index,
        isNap: true,
      })).map((document, index) => ({
        ...document,
        id: `sleep-${index}`,
      })),
    );
    const service = createMcpDataService(dependencies);
    const firstPage = await service.listSleepSessions({
      uid: 'user-1',
      connectionId: 'connection-1',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
      limit: 25,
      includeNaps: false,
    });

    await service.listSleepSessions({
      uid: 'user-1',
      connectionId: 'connection-1',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
      cursor: firstPage.nextCursor!,
      limit: 25,
      includeNaps: false,
    });
    expect(dependencies.fetchSleepDocuments).toHaveBeenLastCalledWith(
      'user-1',
      Date.parse('2024-03-01T00:00:00.000Z'),
      Date.parse('2024-05-01T00:00:00.000Z'),
      126,
      {
        endTimeMs: Date.parse('2024-04-01T04:00:00.000Z') - 124,
        id: 'sleep-124',
      },
    );

    await expect(service.listSleepSessions({
      uid: 'user-1',
      connectionId: 'connection-2',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
      cursor: firstPage.nextCursor!,
    })).rejects.toMatchObject<McpDataError>({
      code: 'invalid_request',
    });
  });

  it('aggregates sleep sessions by the requested local calendar day', async () => {
    vi.mocked(dependencies.fetchSleepDocuments).mockResolvedValue([
      sleepDocument(),
      sleepDocument({
        sleepDate: '2024-04-01',
        startTimeMs: Date.parse('2024-03-31T21:00:00.000Z'),
        endTimeMs: Date.parse('2024-04-01T05:00:00.000Z'),
        durationSeconds: 7 * 60 * 60,
        score: { value: 78 },
      }),
    ]);

    const result = await createMcpDataService(dependencies).querySleepSummary({
      uid: 'user-1',
      startTimeMs: Date.parse('2024-03-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
      groupBy: 'day',
      timeZone: 'Europe/Helsinki',
    });

    expect(result.matchedSessionCount).toBe(2);
    expect(result.buckets).toEqual([
      expect.objectContaining({
        bucketStartMs: Date.parse('2024-03-31T21:00:00.000Z'),
        sessionCount: 2,
        averageDurationSeconds: 27000,
        averageScore: 80,
      }),
    ]);
  });
});
