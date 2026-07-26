import {
  ActivityTypes,
  ChartDataCategoryTypes,
  DataActivityTypes,
  DataAscent,
  DataCadenceAvg,
  DataDistance,
  DataDuration,
  DataEndPosition,
  DataEnergy,
  DataHeartRateAvg,
  DataJumpEvent,
  DataLatitudeDegrees,
  DataPowerAvg,
  DataSpeedAvg,
  DataStartPosition,
  encodeRoutePolyline5,
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
      fetchNearbyActivityDocuments: vi.fn().mockResolvedValue([]),
      fetchActivityDetailDocument: vi.fn().mockResolvedValue(null),
      fetchActivityMetricDocument: vi.fn().mockResolvedValue(null),
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
    );
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
    expect(dependencies.fetchRouteDocuments).toHaveBeenCalledWith(
      'user-1',
      26,
      undefined,
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
