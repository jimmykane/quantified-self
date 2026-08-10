import {
  ActivityTypes,
  DataAltitude,
  DataAltitudeSmooth,
  DataDistance,
  DataGrade,
  DataGradeAdjustedPace,
  DataGradeAdjustedSpeed,
  DataGradeSmooth,
  DataHeartRate,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
  DataPace,
  DataPower,
  DataSpeed,
  DataSwimPace,
  EventImporterJSON,
  EventUtilities,
  FileType,
  Privacy,
} from '@sports-alliance/sports-lib';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  getActivityChartDataFromSources,
  listActivityChartMetrics,
  MCP_ACTIVITY_CHART_MAX_DECOMPRESSED_BYTES,
  MCP_ACTIVITY_CHART_MAX_RAW_BYTES,
  MCP_ACTIVITY_CHART_MAX_RESPONSE_BYTES,
  MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES,
  MCP_ACTIVITY_CHART_MAX_SOURCE_FILES,
} from './activity-chart.service';

function activityJson(
  startDate: number,
  streams: Record<string, Array<number | null>>,
  type = ActivityTypes.Running,
) {
  const length = Math.max(1, ...Object.values(streams).map(values => values.length));
  return {
    name: 'Private source activity',
    startDate,
    endDate: startDate + ((length - 1) * 1000),
    type,
    powerMeter: false,
    trainer: false,
    stats: {},
    streams,
    laps: [],
    creator: {
      name: 'Private device',
      serialNumber: 'private-serial',
      devices: [],
    },
    intensityZones: [],
    events: [],
  };
}

function eventWithActivities(
  activities: ReturnType<typeof activityJson>[],
) {
  const startDate = Math.min(...activities.map(activity => activity.startDate));
  const endDate = Math.max(...activities.map(activity => activity.endDate));
  return EventImporterJSON.getEventFromJSON({
    name: 'Private original file',
    srcFileType: FileType.FIT,
    description: null,
    isMerge: false,
    privacy: Privacy.Private,
    startDate,
    endDate,
    stats: {},
    activities,
  });
}

function persistedIdentity(
  startDate: number,
  length: number,
  type = ActivityTypes.Running,
) {
  return {
    startDate,
    endDate: startDate + ((length - 1) * 1000),
    type,
    getStat: () => null,
  };
}

describe('MCP on-demand activity charts', () => {
  it('lists a static family-aware catalog without reading a source', () => {
    expect(listActivityChartMetrics(ActivityTypes.TrailRunning)).toMatchObject({
      activityType: ActivityTypes.TrailRunning,
      metrics: expect.arrayContaining([
        expect.objectContaining({ metric: 'heart_rate' }),
        expect.objectContaining({ metric: 'pace' }),
        expect.objectContaining({ metric: 'grade_adjusted_pace' }),
      ]),
    });
    expect(listActivityChartMetrics(ActivityTypes.Swimming).metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'swim_pace',
          canonicalUnit: 'seconds_per_100_meters',
        }),
      ]),
    );

    const snorkelingCatalog = listActivityChartMetrics(ActivityTypes.Snorkeling);
    expect(snorkelingCatalog.metrics.map((metric) => metric.metric)).not.toContain('depth');
    expect(JSON.stringify(snorkelingCatalog)).not.toContain('Depth');
  });

  it.each([
    'original.fit',
    'original.gpx',
    'original.tcx',
    'original.json',
    'original.sml',
    'original.fit.gz',
  ])('accepts bounded %s sources and requests only selected dependencies', async (path) => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const parsed = eventWithActivities([
      activityJson(startDate, {
        [DataHeartRate.type]: [100, 105, 110],
        [DataDistance.type]: [0, 10, 20],
      }),
    ]);
    const parseSource = vi.fn().mockResolvedValue(parsed);
    const raw = path.endsWith('.gz')
      ? gzipSync(Buffer.from('prepared'))
      : Buffer.from('prepared');
    const result = await getActivityChartDataFromSources({
      sourceFiles: [{ path, startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 3)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'distance',
      maxPoints: 3,
    }, {
      loadSource: vi.fn().mockResolvedValue(raw),
      parseSource,
    });

    expect(result.series[0]).toMatchObject({
      metric: 'heart_rate',
      canonicalUnit: 'beats_per_minute',
      xValues: [0, 10, 20],
      values: [100, 105, 110],
      sourceSampleCount: 3,
      returnedSampleCount: 3,
      missingSampleCount: 0,
    });
    expect(parseSource.mock.calls[0][0]).toEqual(Buffer.from('prepared'));
    expect(parseSource.mock.calls[0][2].streams.includeTypes).toEqual(
      expect.arrayContaining([
        DataHeartRate.type,
        DataDistance.type,
        DataLatitudeDegrees.type,
        DataLongitudeDegrees.type,
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('Private');
    expect(JSON.stringify(result)).not.toContain('serial');
  });

  it('preserves whole-domain endpoints and bucket extrema when downsampling', async () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const parsed = eventWithActivities([
      activityJson(startDate, {
        [DataHeartRate.type]: [100, 101, 180, 102, 103, 70, 104, 105, 106, 110],
      }),
    ]);
    const result = await getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 10)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
      maxPoints: 6,
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue(parsed),
    });

    expect(result.series[0].xValues[0]).toBe(0);
    expect(result.series[0].xValues.at(-1)).toBe(9);
    expect(result.series[0].values).toEqual(expect.arrayContaining([180, 70]));
    expect(result.series[0].returnedSampleCount).toBeLessThanOrEqual(6);
  });

  it.each([
    {
      metric: 'pace',
      streamType: DataPace.type,
      type: ActivityTypes.Running,
      unit: 'seconds_per_kilometer',
      values: [300, 330],
    },
    {
      metric: 'swim_pace',
      streamType: DataSwimPace.type,
      type: ActivityTypes.Swimming,
      unit: 'seconds_per_100_meters',
      values: [90, 105],
    },
  ])(
    'returns canonical $metric duration values without converting them to speed',
    async ({ metric, streamType, type, unit, values }) => {
      const startDate = Date.parse('2026-07-01T08:00:00.000Z');
      const parsed = eventWithActivities([
        activityJson(startDate, { [streamType]: values }, type),
      ]);
      const result = await getActivityChartDataFromSources({
        sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
        existingActivities: [persistedIdentity(startDate, values.length, type)],
        targetExistingIndex: 0,
      }, {
        metrics: [metric],
        xAxis: 'elapsed_time',
      }, {
        loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
        parseSource: vi.fn().mockResolvedValue(parsed),
      });

      expect(result.series[0]).toMatchObject({
        metric,
        canonicalUnit: unit,
        values,
      });
    },
  );

  it('retains transitive Sports Lib derivation streams for budget accounting', async () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const parsed = eventWithActivities([
      activityJson(startDate, {
        [DataGradeAdjustedPace.type]: [300, 295],
        [DataGradeAdjustedSpeed.type]: [3.33, 3.39],
        [DataSpeed.type]: [3.33, 3.39],
        [DataGradeSmooth.type]: [1, 2],
        [DataGrade.type]: [1, 2],
        [DataDistance.type]: [0, 3.33],
        [DataAltitudeSmooth.type]: [100, 101],
        [DataAltitude.type]: [100, 101],
        [DataLatitudeDegrees.type]: [39.1, 39.2],
        [DataLongitudeDegrees.type]: [20.1, 20.2],
      }),
    ]);
    const parseSource = vi.fn().mockResolvedValue(parsed);

    const result = await getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 2)],
      targetExistingIndex: 0,
    }, {
      metrics: ['grade_adjusted_pace'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource,
    });

    expect(parseSource.mock.calls[0][2].streams.includeTypes).toEqual(
      expect.arrayContaining([
        DataGradeAdjustedPace.type,
        DataGradeAdjustedSpeed.type,
        DataSpeed.type,
        DataGradeSmooth.type,
        DataGrade.type,
        DataDistance.type,
        DataAltitudeSmooth.type,
        DataAltitude.type,
        DataLatitudeDegrees.type,
        DataLongitudeDegrees.type,
      ]),
    );
    expect(result.series[0].values).toEqual([300, 295]);
    expect(parsed.getActivities()[0].getAllStreams().map(stream => stream.type))
      .toEqual([DataGradeAdjustedPace.type]);
  });

  it('returns an aligned bounded breadcrumb only when requested', async () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const parsed = eventWithActivities([
      activityJson(startDate, {
        [DataHeartRate.type]: [100, 101, 102, 103, 104],
        [DataLatitudeDegrees.type]: [39.1, 39.2, null, 39.4, 39.5],
        [DataLongitudeDegrees.type]: [20.1, 20.2, null, 20.4, 20.5],
      }),
    ]);
    const result = await getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 5)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
      includeLocation: true,
      maxLocationPoints: 3,
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue(parsed),
    });

    expect(result.location).toEqual({
      xValues: [0, 3, 4],
      latitudeDegrees: [39.1, 39.4, 39.5],
      longitudeDegrees: [20.1, 20.4, 20.5],
      sourceSampleCount: 5,
      returnedSampleCount: 3,
      missingSampleCount: 1,
    });
  });

  it('counts every importer-materialized stream before pruning unrequested data', async () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const parsed = eventWithActivities([
      activityJson(startDate, {
        [DataHeartRate.type]: [100],
        [DataPower.type]: Array.from(
          { length: MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES },
          () => 200,
        ),
      }),
    ]);

    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [
        persistedIdentity(startDate, MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES),
      ],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue(parsed),
    })).rejects.toThrow('selected-sample');
  });

  it('removes every stream outside the requested public chart allowlist', async () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const parsed = eventWithActivities([
      activityJson(startDate, {
        [DataHeartRate.type]: [100, 101],
        [DataPower.type]: [220, 225],
        [DataPace.type]: [300, 295],
      }),
    ]);

    await getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 2)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue(parsed),
    });

    expect(parsed.getActivities()[0].getStreamData(DataHeartRate.type)).toEqual([
      100,
      101,
    ]);
    expect(parsed.getActivities()[0].getAllStreams().map(stream => stream.type))
      .toEqual([DataHeartRate.type]);
  });

  it('bounds and prunes streams materialized by multi-source merging', async () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const parsedSources = [
      eventWithActivities([
        activityJson(startDate, { [DataHeartRate.type]: [100] }),
      ]),
      eventWithActivities([
        activityJson(startDate + 60_000, { [DataHeartRate.type]: [101] }),
      ]),
    ];
    const merged = eventWithActivities([
      activityJson(startDate, {
        [DataHeartRate.type]: [100, 101],
        [DataPower.type]: [220, 225],
        [DataPace.type]: [300, 295],
      }),
    ]);
    const mergeSpy = vi.spyOn(EventUtilities, 'mergeEvents')
      .mockReturnValue(merged);

    try {
      await getActivityChartDataFromSources({
        sourceFiles: [
          { path: 'first.fit', startDate: new Date(startDate) },
          { path: 'second.fit', startDate: new Date(startDate + 60_000) },
        ],
        existingActivities: [persistedIdentity(startDate, 2)],
        targetExistingIndex: 0,
      }, {
        metrics: ['heart_rate'],
        xAxis: 'elapsed_time',
      }, {
        loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
        parseSource: vi.fn()
          .mockResolvedValueOnce(parsedSources[0])
          .mockResolvedValueOnce(parsedSources[1]),
      });

      expect(merged.getActivities()[0].getAllStreams().map(stream => stream.type))
        .toEqual([DataHeartRate.type]);

      const oversizedMerged = eventWithActivities([
        activityJson(startDate, {
          [DataHeartRate.type]: [100],
          [DataPower.type]: Array.from(
            { length: MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES },
            () => 200,
          ),
        }),
      ]);
      mergeSpy.mockReturnValue(oversizedMerged);
      await expect(getActivityChartDataFromSources({
        sourceFiles: [
          { path: 'first.fit', startDate: new Date(startDate) },
          { path: 'second.fit', startDate: new Date(startDate + 60_000) },
        ],
        existingActivities: [persistedIdentity(startDate, 1)],
        targetExistingIndex: 0,
      }, {
        metrics: ['heart_rate'],
        xAxis: 'elapsed_time',
      }, {
        loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
        parseSource: vi.fn()
          .mockResolvedValueOnce(eventWithActivities([
            activityJson(startDate, { [DataHeartRate.type]: [100] }),
          ]))
          .mockResolvedValueOnce(eventWithActivities([
            activityJson(startDate + 60_000, { [DataHeartRate.type]: [101] }),
          ])),
      })).rejects.toThrow('selected-sample');
    } finally {
      mergeSpy.mockRestore();
    }
  });

  it('spatially simplifies breadcrumbs while preserving endpoints and aligned axes', async () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const parsed = eventWithActivities([
      activityJson(startDate, {
        [DataHeartRate.type]: [100, 101, 102, 103, 104],
        [DataLatitudeDegrees.type]: [0, 0, 5, 0, 0],
        [DataLongitudeDegrees.type]: [0, 1, 2, 3, 4],
      }),
    ]);
    const result = await getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 5)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
      includeLocation: true,
      maxLocationPoints: 3,
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue(parsed),
    });

    expect(result.location).toMatchObject({
      xValues: [0, 2, 4],
      latitudeDegrees: [0, 5, 0],
      longitudeDegrees: [0, 2, 4],
      returnedSampleCount: 3,
    });
  });

  it('merges source events and matches the requested persisted identity', async () => {
    const firstStart = Date.parse('2026-07-01T08:00:00.000Z');
    const secondStart = Date.parse('2026-07-01T09:00:00.000Z');
    const events = [
      eventWithActivities([activityJson(firstStart, {
        [DataHeartRate.type]: [100, 101],
      })]),
      eventWithActivities([activityJson(secondStart, {
        [DataHeartRate.type]: [150, 151],
      })]),
    ];
    const parseSource = vi.fn()
      .mockResolvedValueOnce(events[0])
      .mockResolvedValueOnce(events[1]);
    const result = await getActivityChartDataFromSources({
      sourceFiles: [
        { path: 'first.fit', startDate: new Date(firstStart) },
        { path: 'second.fit', startDate: new Date(secondStart) },
      ],
      existingActivities: [
        persistedIdentity(firstStart, 2),
        persistedIdentity(secondStart, 2),
      ],
      targetExistingIndex: 1,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource,
    });

    expect(result.series[0].values).toEqual([150, 151]);
    expect(result).not.toHaveProperty('source');
  });

  it('rejects hard point limits and ambiguous identities before or without source output', async () => {
    const loadSource = vi.fn();
    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date() }],
      existingActivities: [],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
      maxPoints: 401,
    }, { loadSource })).rejects.toThrow('maxPoints');
    expect(loadSource).not.toHaveBeenCalled();
    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date() }],
      existingActivities: [],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
      includeLocation: true,
      maxLocationPoints: 1_001,
    }, { loadSource })).rejects.toThrow('maxLocationPoints');
    expect(loadSource).not.toHaveBeenCalled();

    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const parsed = eventWithActivities([
      activityJson(startDate, { [DataHeartRate.type]: [100, 101] }),
      activityJson(startDate, { [DataHeartRate.type]: [110, 111] }),
    ]);
    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [
        persistedIdentity(startDate, 2),
        persistedIdentity(startDate, 2),
      ],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue(parsed),
    })).rejects.toThrow('identity');
  });

  it('fails the whole request when sample or runtime budgets are exceeded', async () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const oversized = Array.from(
      { length: MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES + 1 },
      () => 100,
    );
    const parsed = eventWithActivities([
      activityJson(startDate, { [DataHeartRate.type]: oversized }),
    ]);
    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, oversized.length)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue(parsed),
    })).rejects.toThrow('selected-sample');

    const now = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(20_001);
    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 2)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      now,
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue(eventWithActivities([
        activityJson(startDate, { [DataHeartRate.type]: [100, 101] }),
      ])),
    })).rejects.toThrow('runtime');
  });

  it('enforces source-count, raw-input, decompressed-input, and response budgets', async () => {
    const startDate = Date.parse('2026-07-01T08:00:00.000Z');
    const smallEvent = eventWithActivities([
      activityJson(startDate, { [DataHeartRate.type]: [100, 101] }),
    ]);
    const loadSource = vi.fn().mockResolvedValue(Buffer.from('source'));
    await expect(getActivityChartDataFromSources({
      sourceFiles: Array.from(
        { length: MCP_ACTIVITY_CHART_MAX_SOURCE_FILES + 1 },
        (_unused, index) => ({
          path: `original-${index}.fit`,
          startDate: new Date(startDate),
        }),
      ),
      existingActivities: [persistedIdentity(startDate, 2)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource,
      parseSource: vi.fn().mockResolvedValue(smallEvent),
    })).rejects.toThrow('bounded source set');
    expect(loadSource).not.toHaveBeenCalled();

    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.zip', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 2)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource,
      parseSource: vi.fn().mockResolvedValue(smallEvent),
    })).rejects.toThrow('format is not supported');
    expect(loadSource).not.toHaveBeenCalled();

    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 2)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(
        Buffer.alloc(MCP_ACTIVITY_CHART_MAX_RAW_BYTES + 1),
      ),
      parseSource: vi.fn().mockResolvedValue(smallEvent),
    })).rejects.toThrow('raw size limit');

    const decompressionBomb = gzipSync(
      Buffer.alloc(MCP_ACTIVITY_CHART_MAX_DECOMPRESSED_BYTES + 1),
    );
    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit.gz', startDate: new Date(startDate) }],
      existingActivities: [persistedIdentity(startDate, 2)],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(decompressionBomb),
      parseSource: vi.fn().mockResolvedValue(smallEvent),
    })).rejects.toThrow('decompression');

    const oversizedActivityType = 'x'.repeat(MCP_ACTIVITY_CHART_MAX_RESPONSE_BYTES);
    const fakeActivity = {
      startDate,
      endDate: startDate + 1_000,
      type: oversizedActivityType,
      getAllStreams: () => [{
        type: DataHeartRate.type,
        getData: () => [100, 101],
      }],
      removeStream: vi.fn(),
      getStreamData: (type: string) => (
        type === DataHeartRate.type ? [100, 101] : []
      ),
      getStat: () => null,
    };
    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(startDate) }],
      existingActivities: [{
        startDate,
        endDate: startDate + 1_000,
        type: oversizedActivityType,
        getStat: () => null,
      }],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue({
        getActivities: () => [fakeActivity],
      }),
    })).rejects.toThrow('response size limit');
  });

  it('counts selected samples across every parsed activity and never assigns IDs', async () => {
    const firstStart = Date.parse('2026-07-01T08:00:00.000Z');
    const secondStart = Date.parse('2026-07-01T09:00:00.000Z');
    const samplesPerActivity = Math.floor(
      MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES / 2,
    ) + 1;
    const setID = vi.fn();
    const activities = [
      activityJson(firstStart, {
        [DataHeartRate.type]: Array(samplesPerActivity).fill(100),
      }),
      activityJson(secondStart, {
        [DataHeartRate.type]: Array(samplesPerActivity).fill(110),
      }),
    ];
    const parsed = eventWithActivities(activities);
    const parsedActivity = parsed.getActivities()[0] as unknown as {
      setID?: (id: string) => unknown;
    };
    parsedActivity.setID = setID;

    await expect(getActivityChartDataFromSources({
      sourceFiles: [{ path: 'original.fit', startDate: new Date(firstStart) }],
      existingActivities: [
        persistedIdentity(firstStart, samplesPerActivity),
        persistedIdentity(secondStart, samplesPerActivity),
      ],
      targetExistingIndex: 0,
    }, {
      metrics: ['heart_rate'],
      xAxis: 'elapsed_time',
    }, {
      loadSource: vi.fn().mockResolvedValue(Buffer.from('source')),
      parseSource: vi.fn().mockResolvedValue(parsed),
    })).rejects.toThrow('selected-sample');
    expect(setID).not.toHaveBeenCalled();
  });
});
