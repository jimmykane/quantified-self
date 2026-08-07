import { describe, expect, it } from 'vitest';
import { ChartDataCategoryTypes } from '@sports-alliance/sports-lib';
import { buildTrainingLoadPoints } from '../../../shared/training-load';
import { createMcpOutputSchemaRegistry } from '../mcp/tool-output-schemas';
import {
  createAssistantVisualSource,
  downsampleAssistantChartPoints,
  resolveAssistantVisuals,
} from './visuals';

describe('Assistant visual projection', () => {
  it('projects sleep trends into allowlisted server-owned series', () => {
    const source = createAssistantVisualSource('get_sleep_trend', {
      timeZone: 'Europe/Helsinki',
      buckets: [{
        bucketStartMs: Date.parse('2026-08-01T00:00:00.000Z'),
        averageDurationSeconds: 28_800,
        averageScore: 81,
        averageVitals: {
          averageHrvMs: 54,
          averageHeartRateBpm: 49,
          maxSpo2Percent: 97,
          providerKey: 'must-not-leak',
        },
      }],
      sourceKey: 'must-not-leak',
    }, 'source_1');

    expect(source?.descriptor).toEqual({
      sourceId: 'source_1',
      chart: {
        title: 'Sleep and recovery trend',
        defaultChartType: 'line',
        availableSeries: expect.arrayContaining([
          { key: 'average_hrv', label: 'Average HRV', unit: 'ms' },
          { key: 'average_heart_rate', label: 'Average heart rate', unit: 'bpm' },
          {
            key: 'spo2',
            label: 'Maximum blood oxygen saturation',
            unit: '%',
          },
        ]),
      },
      map: null,
    });
    expect(JSON.stringify(source)).not.toContain('providerKey');
    expect(JSON.stringify(source)).not.toContain('must-not-leak');

    expect(resolveAssistantVisuals([source!], {
      chart: {
        sourceId: 'source_1',
        seriesKeys: ['average_hrv', 'average_heart_rate'],
        chartType: 'line',
      },
      map: null,
    })).toEqual([expect.objectContaining({
      kind: 'chart',
      title: 'Sleep and recovery trend',
      xAxis: {
        type: 'time',
        label: 'Date',
        unit: null,
        timeZone: 'Europe/Helsinki',
      },
      series: [{
        label: 'Average HRV',
        unit: 'ms',
        points: [{ x: '2026-08-01T00:00:00.000Z', y: 54 }],
      }, {
        label: 'Average heart rate',
        unit: 'bpm',
        points: [{ x: '2026-08-01T00:00:00.000Z', y: 49 }],
      }],
    })]);
  });

  it('keeps null measurement gaps and rejects unknown model-selected series', () => {
    const source = createAssistantVisualSource('query_measurements', {
      measurementType: {
        displayName: 'Body weight',
        canonicalMetric: { unit: 'kilograms' },
      },
      points: [{
        bucketStartTimeMs: Date.parse('2026-08-01T00:00:00.000Z'),
        value: 80,
      }, {
        bucketStartTimeMs: Date.parse('2026-08-02T00:00:00.000Z'),
        value: null,
      }],
    }, 'source_1');

    expect(source?.chart?.series[0].points).toEqual([
      { x: '2026-08-01T00:00:00.000Z', y: 80 },
      { x: '2026-08-02T00:00:00.000Z', y: null },
    ]);
    expect(resolveAssistantVisuals([source!], {
      chart: {
        sourceId: 'source_1',
        seriesKeys: ['invented'],
        chartType: 'bar',
      },
      map: null,
    })).toEqual([]);
  });

  it('keeps multiple aggregations of one metric semantically distinct', () => {
    const result = (valueType: string, aggregateValue: number) => ({
      metric: {
        type: 'HeartRate',
        displayType: 'Heart rate',
        unit: 'beats_per_minute',
      },
      aggregation: {
        valueType,
        categoryType: ChartDataCategoryTypes.DateType,
        buckets: [{
          bucketKey: '2026-08-01',
          time: Date.parse('2026-08-01T00:00:00.000Z'),
          aggregateValue,
        }],
      },
    });
    const source = createAssistantVisualSource('query_metrics', {
      results: [result('Average', 142), result('Maximum', 181)],
    }, 'source_2', 'Europe/Helsinki');

    expect(source?.descriptor.chart?.availableSeries).toEqual([
      { key: 'metric_0', label: 'Heart rate (Average)', unit: 'bpm' },
      { key: 'metric_1', label: 'Heart rate (Maximum)', unit: 'bpm' },
    ]);
    expect(resolveAssistantVisuals([source!], {
      chart: {
        sourceId: 'source_2',
        seriesKeys: ['metric_0', 'metric_1'],
        chartType: 'line',
      },
      map: null,
    })[0]).toMatchObject({
      kind: 'chart',
      xAxis: { timeZone: 'Europe/Helsinki' },
      series: [
        { label: 'Heart rate (Average)', dataType: 'HeartRate' },
        { label: 'Heart rate (Maximum)', dataType: 'HeartRate' },
      ],
    });
  });

  it('preserves canonical Sports Lib types for unit-aware chart display', () => {
    const source = createAssistantVisualSource('query_metric', {
      metric: {
        type: 'Distance',
        displayType: 'Distance',
        unit: 'meters',
      },
      aggregation: {
        valueType: 'Total',
        categoryType: ChartDataCategoryTypes.DateType,
        buckets: [{
          bucketKey: '2026-08-03',
          time: Date.parse('2026-08-03T00:00:00.000Z'),
          aggregateValue: 65_000,
        }],
      },
    }, 'source_distance', 'Europe/Helsinki');

    expect(resolveAssistantVisuals([source!], {
      chart: {
        sourceId: 'source_distance',
        seriesKeys: ['metric_0'],
        chartType: 'line',
      },
      map: null,
    })[0]).toMatchObject({
      kind: 'chart',
      series: [{
        label: 'Distance (Total)',
        unit: 'm',
        dataType: 'Distance',
        points: [{ x: '2026-08-03T00:00:00.000Z', y: 65_000 }],
      }],
    });
  });

  it('uses the authoritative aggregation category instead of guessing from labels', () => {
    const source = createAssistantVisualSource('query_metric', {
      metric: {
        type: 'Duration',
        displayType: 'Duration',
        unit: 'seconds',
      },
      aggregation: {
        valueType: 'Total',
        categoryType: ChartDataCategoryTypes.ActivityType,
        buckets: [{
          bucketKey: 'Adventure Racing Z',
          aggregateValue: 3_600,
        }],
      },
    }, 'source_2', 'Europe/Helsinki');

    expect(source?.chart?.xAxis).toEqual({
      type: 'category',
      label: 'Period',
      unit: null,
      timeZone: null,
    });
    expect(source?.chart?.series[0].points).toEqual([
      { x: 'Adventure Racing Z', y: 3_600 },
    ]);
  });

  it('uses the authoritative Training metric title without duplicating trend wording', () => {
    const source = createAssistantVisualSource('get_training_metric', {
      metricKind: 'efficiency_trend',
      payload: {
        dayBoundary: 'UTC',
        points: [{
          weekStartMs: Date.parse('2026-08-03T00:00:00.000Z'),
          value: 1.2,
        }],
      },
    }, 'source_2', 'Europe/Helsinki');

    expect(source?.descriptor.chart?.title).toBe('Aerobic efficiency trend');
    expect(source?.chart?.xAxis.timeZone).toBe('UTC');
  });

  it('reuses the canonical Training load engine for fitness, fatigue, and Form', () => {
    const firstDayMs = Date.parse('2026-08-01T00:00:00.000Z');
    const source = createAssistantVisualSource('get_training_metric', {
      metricKind: 'form',
      payload: {
        dayBoundary: 'UTC',
        rangeEndDayMs: firstDayMs + (24 * 60 * 60 * 1_000),
        dailyLoads: [{ dayMs: firstDayMs, load: 100 }],
      },
    }, 'source_2', 'Europe/Helsinki');

    expect(source?.descriptor.chart).toMatchObject({
      title: 'Fitness, fatigue, and Form history',
      availableSeries: [
        { key: 'load', label: 'Training load' },
        { key: 'ctl', label: 'Fitness' },
        { key: 'atl', label: 'Fatigue' },
        { key: 'form', label: 'Form' },
      ],
    });
    expect(source?.chart?.series.find(series => series.key === 'ctl')?.points)
      .toHaveLength(2);
    expect(source?.chart?.series.find(series => series.key === 'form')?.points)
      .toEqual(buildTrainingLoadPoints(
        [{ dayMs: firstDayMs, load: 100 }],
        firstDayMs + (24 * 60 * 60 * 1_000),
      ).map(point => ({
        x: new Date(point.dayMs).toISOString(),
        y: point.formSameDay,
      })));
  });

  it('fails closed instead of expanding an unbounded Training day range', () => {
    expect(createAssistantVisualSource('get_training_metric', {
      metricKind: 'form',
      payload: {
        dayBoundary: 'UTC',
        rangeEndDayMs: Date.parse('2026-08-01T00:00:00.000Z'),
        dailyLoads: [{
          dayMs: Date.parse('2000-01-01T00:00:00.000Z'),
          load: 100,
        }],
      },
    }, 'source_2', 'Europe/Helsinki')).toBeNull();
  });

  it('copies precise locations only from location-bearing MCP projections', () => {
    const source = createAssistantVisualSource('search_activities_near_location', {
      location: {
        resolvedLabel: 'Ioannina, Greece',
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.853,
      },
      activities: [{
        activityType: 'Mountain Biking',
        nearestPosition: { latitudeDegrees: 39.67, longitudeDegrees: 20.86 },
        startPosition: { latitudeDegrees: 39.66, longitudeDegrees: 20.85 },
        endPosition: null,
        activityRef: 'opaque-reference',
      }],
    }, 'source_2');

    const visuals = resolveAssistantVisuals([source!], {
      chart: null,
      map: { sourceId: 'source_2' },
    });
    expect(visuals).toEqual([expect.objectContaining({
      kind: 'map',
      style: 'user_preference',
      markers: expect.arrayContaining([
        expect.objectContaining({ kind: 'search', label: 'Ioannina, Greece' }),
        expect.objectContaining({ kind: 'nearby', label: 'Mountain Biking nearest' }),
      ]),
    })]);
    expect(JSON.stringify(visuals)).not.toContain('opaque-reference');
  });

  it('keeps jump timestamps as activity-relative offsets', () => {
    const source = createAssistantVisualSource('list_activity_jumps', {
      items: [{
        index: 1,
        timestampMs: 320_000,
        distanceMeters: 7.4,
        heightMeters: null,
        hangTimeSeconds: null,
        speedMetersPerSecond: null,
      }],
    }, 'source_3', 'Europe/Helsinki');

    expect(resolveAssistantVisuals([source!], {
      chart: {
        sourceId: 'source_3',
        seriesKeys: ['distance'],
        chartType: 'bar',
      },
      map: null,
    })[0]).toMatchObject({
      kind: 'chart',
      xAxis: {
        type: 'linear',
        label: 'Activity time',
        unit: 's',
        timeZone: null,
      },
      series: [{ points: [{ x: 320, y: 7.4 }] }],
    });
  });

  it('maps only the authoritative ranked jump record from the same activity', () => {
    const activityRef = 'opaque-record-activity-reference';
    const rankingSource = createAssistantVisualSource('rank_activities_by_metric', {
      metric: {
        type: 'Maximum Jump Distance',
        displayType: 'Maximum Jump Distance',
        unit: 'm',
      },
      activities: [{
        rank: 1,
        activityRef,
        startTime: '2026-07-31T07:50:22.000Z',
        value: 10.41,
      }],
    }, 'source_2');
    const jumpSource = createAssistantVisualSource('list_activity_jumps', {
      items: [{
        index: 4,
        timestampMs: 624_000,
        distanceMeters: 5.2,
        heightMeters: 0.8,
        hangTimeSeconds: 0.5,
        speedMetersPerSecond: 8,
        rotations: 0,
        score: 60,
        latitudeDegrees: 39.66,
        longitudeDegrees: 20.85,
      }, {
        index: 7,
        timestampMs: 1_024_000,
        distanceMeters: 10.41,
        heightMeters: 1.4,
        hangTimeSeconds: 0.9,
        speedMetersPerSecond: 12,
        rotations: 0,
        score: 92,
        latitudeDegrees: 39.67,
        longitudeDegrees: 20.86,
      }],
    }, 'source_3', 'UTC', { activityRef });

    expect(jumpSource?.descriptor).toMatchObject({
      sourceId: 'source_3',
      map: { markerCount: 2 },
    });
    expect(JSON.stringify(jumpSource?.descriptor)).not.toContain(activityRef);
    expect(resolveAssistantVisuals([rankingSource!, jumpSource!], {
      chart: null,
      map: { sourceId: 'source_3' },
    })).toEqual([expect.objectContaining({
      kind: 'map',
      title: 'Record jump location',
      markers: [{
        kind: 'jump',
        label: 'Jump 8',
        latitudeDegrees: 39.67,
        longitudeDegrees: 20.86,
      }],
    })]);
  });

  it('keeps every located jump tied for the ranked record', () => {
    const activityRef = 'opaque-tied-record-activity-reference';
    const rankingSource = createAssistantVisualSource('rank_activities_by_metric', {
      metric: {
        type: 'Maximum Jump Score',
        displayType: 'Maximum Jump Score',
        unit: '',
      },
      activities: [{
        rank: 1,
        activityRef,
        startTime: '2026-07-31T07:50:22.000Z',
        value: 92,
      }],
    }, 'source_2');
    const jumpSource = createAssistantVisualSource('list_activity_jumps', {
      items: [{
        index: 2,
        score: 92,
        latitudeDegrees: 39.66,
        longitudeDegrees: 20.85,
      }, {
        index: 5,
        score: 80,
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.855,
      }, {
        index: 8,
        score: 92,
        latitudeDegrees: 39.67,
        longitudeDegrees: 20.86,
      }],
    }, 'source_3', 'UTC', { activityRef });

    expect(resolveAssistantVisuals([rankingSource!, jumpSource!], {
      chart: null,
      map: { sourceId: 'source_3' },
    })[0]).toMatchObject({
      title: 'Record jump locations',
      markers: [{ label: 'Jump 3' }, { label: 'Jump 9' }],
    });
  });

  it('suppresses a record-jump map instead of showing unrelated page markers', () => {
    const activityRef = 'opaque-record-activity-reference';
    const rankingSource = createAssistantVisualSource('rank_activities_by_metric', {
      metric: {
        type: 'Maximum Jump Height',
        displayType: 'Maximum Jump Height',
        unit: 'm',
      },
      activities: [{
        rank: 1,
        activityRef,
        startTime: '2026-07-31T07:50:22.000Z',
        value: 2.5,
      }],
    }, 'source_2');
    const jumpSource = createAssistantVisualSource('list_activity_jumps', {
      items: [{
        index: 0,
        timestampMs: 624_000,
        distanceMeters: 5.2,
        heightMeters: 0.8,
        hangTimeSeconds: 0.5,
        speedMetersPerSecond: 8,
        rotations: 0,
        score: 60,
        latitudeDegrees: 39.66,
        longitudeDegrees: 20.85,
      }],
    }, 'source_3', 'UTC', { activityRef });

    expect(resolveAssistantVisuals([rankingSource!, jumpSource!], {
      chart: null,
      map: { sourceId: 'source_3' },
    })).toEqual([]);
  });

  it('uses the latest matching jump ranking when one turn compares record metrics', () => {
    const activityRef = 'opaque-record-activity-reference';
    const ranking = (
      sourceId: string,
      type: string,
      value: number,
    ) => createAssistantVisualSource('rank_activities_by_metric', {
      metric: { type, displayType: type, unit: 'm' },
      activities: [{
        rank: 1,
        activityRef,
        startTime: '2026-07-31T07:50:22.000Z',
        value,
      }],
    }, sourceId);
    const jumpSource = createAssistantVisualSource('list_activity_jumps', {
      items: [{
        index: 0,
        distanceMeters: 10.41,
        heightMeters: 0.8,
        latitudeDegrees: 39.66,
        longitudeDegrees: 20.85,
      }, {
        index: 1,
        distanceMeters: 8.2,
        heightMeters: 1.4,
        latitudeDegrees: 39.67,
        longitudeDegrees: 20.86,
      }],
    }, 'source_3', 'UTC', { activityRef });

    expect(resolveAssistantVisuals([
      ranking('source_1', 'Maximum Jump Distance', 10.41)!,
      ranking('source_2', 'Maximum Jump Height', 1.4)!,
      jumpSource!,
    ], {
      chart: null,
      map: { sourceId: 'source_3' },
    })[0]).toMatchObject({
      markers: [{ label: 'Jump 2' }],
    });
  });

  it('keeps all jump markers when no record ranking applies', () => {
    const jumpSource = createAssistantVisualSource('list_activity_jumps', {
      items: [{
        index: 0,
        distanceMeters: 5.2,
        latitudeDegrees: 39.66,
        longitudeDegrees: 20.85,
      }, {
        index: 1,
        distanceMeters: 6.2,
        latitudeDegrees: 39.67,
        longitudeDegrees: 20.86,
      }],
    }, 'source_3', 'UTC', { activityRef: 'activity-a' });

    expect(resolveAssistantVisuals([jumpSource!], {
      chart: null,
      map: { sourceId: 'source_3' },
    })[0]).toMatchObject({
      title: 'Jump locations',
      markers: [{ label: 'Jump 1' }, { label: 'Jump 2' }],
    });
  });

  it('builds an activity chart and path from the existing chart-data tool', () => {
    const output = createMcpOutputSchemaRegistry({
      activityLocation: true,
      routeLocation: false,
    }).get_activity_chart_data.parse({
      activityType: 'Mountain Biking',
      xAxis: 'distance',
      xAxisUnit: 'meters',
      series: [{
        metric: 'heart_rate',
        canonicalUnit: 'beats_per_minute',
        xValues: [0, 100],
        values: [120, 145],
        sourceSampleCount: 2,
        returnedSampleCount: 2,
        missingSampleCount: 0,
      }],
      location: {
        xValues: [0, 100],
        latitudeDegrees: [39.66, 39.67],
        longitudeDegrees: [20.85, 20.86],
        sourceSampleCount: 2,
        returnedSampleCount: 2,
        missingSampleCount: 0,
      },
    });
    const source = createAssistantVisualSource(
      'get_activity_chart_data',
      output,
      'source_3',
    );

    const visuals = resolveAssistantVisuals([source!], {
      chart: {
        sourceId: 'source_3',
        seriesKeys: ['series_0'],
        chartType: 'line',
      },
      map: { sourceId: 'source_3' },
    });
    expect(visuals.map(visual => visual.kind)).toEqual(['chart', 'map']);
    expect(visuals[0]).toMatchObject({
      xAxis: {
        type: 'linear',
        label: 'Distance',
        unit: 'm',
        dataType: 'Distance',
        timeZone: null,
      },
      series: [{ label: 'Heart rate', unit: 'bpm', dataType: 'Heart Rate' }],
    });
    expect(visuals[1]).toMatchObject({
      path: [
        { latitudeDegrees: 39.66, longitudeDegrees: 20.85 },
        { latitudeDegrees: 39.67, longitudeDegrees: 20.86 },
      ],
    });
  });

  it('downsamples deterministically while preserving endpoints and extrema', () => {
    const points = Array.from({ length: 1_000 }, (_, index) => ({
      x: index,
      y: index === 500 ? 10_000 : index === 501 ? -10_000 : index,
    }));

    const downsampled = downsampleAssistantChartPoints(points, 100);
    expect(downsampled.length).toBeLessThanOrEqual(100);
    expect(downsampled[0]).toEqual(points[0]);
    expect(downsampled.at(-1)).toEqual(points.at(-1));
    expect(downsampled).toContainEqual(points[500]);
    expect(downsampled).toContainEqual(points[501]);
    expect(downsampleAssistantChartPoints(points, 100)).toEqual(downsampled);
  });

  it('retains interior null runs so downsampling cannot imply missing readings', () => {
    const points = Array.from({ length: 1_000 }, (_, index) => ({
      x: index,
      y: index >= 500 && index <= 503 ? null : index,
    }));

    const downsampled = downsampleAssistantChartPoints(points, 100);
    expect(downsampled.length).toBeLessThanOrEqual(100);
    expect(downsampled.some(point => point.y === null)).toBe(true);
    expect(downsampled[0]).toEqual(points[0]);
    expect(downsampled.at(-1)).toEqual(points.at(-1));
  });
});
