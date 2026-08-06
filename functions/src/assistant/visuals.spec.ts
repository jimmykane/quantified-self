import { describe, expect, it } from 'vitest';
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
        { label: 'Heart rate (Average)' },
        { label: 'Heart rate (Maximum)' },
      ],
    });
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
      style: 'satellite',
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
      xAxis: { type: 'linear', label: 'Distance', unit: 'm', timeZone: null },
      series: [{ label: 'Heart rate', unit: 'bpm' }],
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
});
