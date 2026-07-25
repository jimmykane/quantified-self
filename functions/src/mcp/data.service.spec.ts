import {
  ActivityTypes,
  ChartDataCategoryTypes,
  DataActivityTypes,
  DataAscent,
  DataCadenceAvg,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRateAvg,
  DataJumpEvent,
  DataPowerAvg,
  DataSpeedAvg,
  EventImporterJSON,
  EventInterface,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
} from '../../../shared/derived-metrics';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import {
  createMcpDataService,
  McpDataError,
  McpDataServiceDependencies,
  resolveMcpRouteSourcePath,
} from './data.service';

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
      fetchMetricDiscoveryDocuments: vi.fn().mockResolvedValue([]),
      fetchEventDocuments: vi.fn().mockResolvedValue([]),
      fetchDerivedSnapshot: vi.fn().mockResolvedValue(null),
      fetchSleepDocuments: vi.fn().mockResolvedValue([]),
      fetchActivityDocuments: vi.fn().mockResolvedValue([]),
      fetchActivityDetailDocument: vi.fn().mockResolvedValue(null),
      fetchRouteDocuments: vi.fn().mockResolvedValue([]),
      fetchRouteDocument: vi.fn().mockResolvedValue(null),
      downloadRouteSource: vi.fn().mockResolvedValue(Buffer.from('route')),
      parseRouteWaypoints: vi.fn().mockResolvedValue([]),
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

  it('projects activity summaries and exact MTB jump coordinates without leaking raw activity data', async () => {
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

    expect(activities.activities).toEqual([{
      activityRef: expect.any(String),
      appUrl: 'https://quantified-self.io/user/user-1/event/event-1',
      startTimeMs: Date.parse('2026-07-01T08:00:00.000Z'),
      endTimeMs: Date.parse('2026-07-01T09:00:00.000Z'),
      activityType: ActivityTypes.Cycling,
      powerMeter: true,
      trainer: false,
      jumpCount: 2,
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
    expect(JSON.stringify(activities.activities[0])).not.toContain('Owner controlled');

    vi.mocked(dependencies.fetchActivityDetailDocument).mockResolvedValue({
      id: 'activity-1',
      data: {
        eventID: 'event-1',
        events: [{
          [DataJumpEvent.type]: {
            timestamp: Date.parse('2026-07-01T08:30:00.000Z'),
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
    });

    expect(jumps).toEqual({
      items: [{
        index: 0,
        timestampMs: Date.parse('2026-07-01T08:30:00.000Z'),
        distanceMeters: 2.069,
        heightMeters: 0.42,
        hangTimeSeconds: 0.36,
        speedMetersPerSecond: 5.748,
        rotations: 0.2,
        score: 62.44,
        latitudeDegrees: 39.6679,
        longitudeDegrees: 20.8382,
      }],
      nextCursor: null,
    });
    expect(JSON.stringify(jumps)).not.toContain('providerPayload');
    expect(dependencies.fetchActivityDetailDocument).toHaveBeenCalledWith(
      'user-1',
      'activity-1',
      'jumps',
    );
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

  it('projects saved-route summaries and polyline geometry without route provenance', async () => {
    vi.mocked(dependencies.fetchRouteDocuments).mockResolvedValue([
      routeDocument(),
    ]);
    const service = createMcpDataService(dependencies);
    const routes = await service.listRoutes({
      uid: 'user-1',
      connectionId: 'connection-1',
      appBaseUrl: 'https://quantified-self.io',
    });

    expect(routes.routes).toEqual([{
      routeRef: expect.any(String),
      appUrl: 'https://quantified-self.io/user/user-1/route/route-1',
      name: 'Ridge loop',
      createdAtMs: Date.parse('2026-06-30T10:00:00.000Z'),
      importedAtMs: Date.parse('2026-07-01T10:00:00.000Z'),
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
      stats: expect.objectContaining({
        distanceMeters: 30_000,
        ascentMeters: 900,
      }),
    }]);
    expect(JSON.stringify(routes)).not.toContain('private-provider-route');
    expect(JSON.stringify(routes)).not.toContain('private-destination');
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
        encodedPolyline: '_p~iF~ps|U_ulLnnqC',
      }],
    });
    expect(JSON.stringify(geometry)).not.toContain('private-segment-id');
    expect(JSON.stringify(geometry)).not.toContain('Private segment name');
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
    expect(result.sleepCapabilities.providers).toContain(SLEEP_PROVIDERS.GarminAPI);
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
      async (_uid, _startTimeMs, _endTimeMs, limit) => Array.from(
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
      25,
      undefined,
    );
    expect(dependencies.fetchEventDocuments).toHaveBeenNthCalledWith(
      2,
      'user-1',
      Date.parse('2024-01-01T00:00:00.000Z'),
      Date.parse('2024-02-01T00:00:00.000Z'),
      25,
      'cursor-24',
    );
    expect(dependencies.importEvent).toHaveBeenCalledTimes(26);
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
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
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
