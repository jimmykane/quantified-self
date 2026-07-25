import {
  ActivityTypes,
  ChartDataCategoryTypes,
  DataActivityTypes,
  DataDistance,
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

describe('MCP data service', () => {
  let dependencies: McpDataServiceDependencies;

  beforeEach(() => {
    dependencies = {
      fetchMetricDiscoveryDocuments: vi.fn().mockResolvedValue([]),
      fetchEventDocuments: vi.fn().mockResolvedValue([]),
      fetchDerivedSnapshot: vi.fn().mockResolvedValue(null),
      fetchSleepDocuments: vi.fn().mockResolvedValue([]),
      importEvent: vi.fn(),
    };
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

  it('fails explicitly when an event query exceeds the safety limit', async () => {
    vi.mocked(dependencies.fetchEventDocuments).mockResolvedValue(
      Array.from({ length: 2001 }, (_, index) => ({
        id: `event-${index}`,
        data: {},
      })),
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
        },
        suggestedEvents: [{
          eventId: 'event-2',
          label: 'Private suggested workout',
          distanceMeters: 10000,
        }],
        selection: {
          mode: 'event',
          durationWeeks: 12,
          eventId: 'event-3',
          selectionKey: 'event:12:event-3',
          label: 'Private benchmark',
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
      },
      suggestedEvents: [{
        distanceMeters: 10000,
      }],
      selection: {
        mode: 'event',
        durationWeeks: 12,
      },
    });
    expect(JSON.stringify(result.payload)).not.toContain('event-3');
  });

  it.each([
    undefined,
    DERIVED_METRIC_SCHEMA_VERSION - 1,
  ])('does not expose a ready Training snapshot with stale schema %s', async (schemaVersion) => {
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
