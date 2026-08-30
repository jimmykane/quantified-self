import { describe, expect, it } from 'vitest';
import {
  HEALTH_PROVIDERS,
  HEALTH_RECORDING_METHODS,
  HEALTH_VALUE_ORIGINS,
  HEALTH_VALUE_TYPES,
} from '@shared/health';
import { buildDashboardEChartsStyleTokens } from './dashboard-echarts-style.helper';
import { buildHealthChartModels, buildHealthMetricEChartsOption } from './health-metric-chart.helper';
import { HealthWorkspaceSeries } from './health-workspace.helper';

const DAY_MS = 24 * 60 * 60 * 1000;

function series(overrides: Partial<HealthWorkspaceSeries> = {}): HealthWorkspaceSeries {
  return {
    id: 'series-1',
    provider: HEALTH_PROVIDERS.GarminAPI,
    providerLabel: 'Garmin',
    sourceLabel: 'Garmin',
    accountLabel: null,
    semanticLabel: 'Average · Daily resting · Provider summary · Provider calculated',
    aggregation: 'average',
    semanticVariant: 'daily_resting',
    origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
    recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
    unit: 'bpm',
    normalizationStatus: 'canonical',
    nativeOnly: false,
    valueType: HEALTH_VALUE_TYPES.Number,
    chartKind: 'line',
    points: [
      { timestampMs: 0, calendarDate: '1970-01-01', value: 50, qualityCode: null },
      { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 52, qualityCode: null },
      { timestampMs: DAY_MS * 8, calendarDate: '1970-01-09', value: 49, qualityCode: null },
    ],
    deviceLabel: 'Garmin Test',
    coverageText: '3/14 days',
    freshnessText: 'Fresh',
    hasConflict: false,
    ...overrides,
  };
}

describe('Health metric chart helpers', () => {
  it('inserts null ECharts data across gaps instead of connecting missing periods', () => {
    const model = buildHealthChartModels([series()], 0, DAY_MS * 13)[0];
    expect(model.data.filter(([, value]) => value === null)).toHaveLength(1);
    expect(model.ariaLabel).toContain('not combined with other sources');
  });

  it('uses an ECharts bar series for totals and starts positive totals at zero', () => {
    const model = buildHealthChartModels([series({
      aggregation: 'total',
      chartKind: 'bar',
      unit: 'count',
      points: [
        { timestampMs: 0, calendarDate: '1970-01-01', value: 100, qualityCode: null },
        { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 200, qualityCode: null },
      ],
    })], 0, DAY_MS)[0];
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS,
      buildDashboardEChartsStyleTokens(false, 640),
      false,
    ) as any;
    expect(option.series[0].type).toBe('bar');
    expect(option.series[0].data).toEqual([[0, 100], [DAY_MS, 200]]);
    expect(model.numericBounds?.min).toBe(0);
    expect(model.yMinLabel).toBe('0');
  });

  it('keeps signed totals on opposite sides of the ECharts zero baseline', () => {
    const model = buildHealthChartModels([series({
      aggregation: 'total',
      chartKind: 'bar',
      unit: 'percent',
      points: [
        { timestampMs: 0, calendarDate: '1970-01-01', value: -10, qualityCode: null },
        { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 15, qualityCode: null },
      ],
    })], 0, DAY_MS)[0];
    expect(model.numericBounds).toEqual({ min: -10, max: 15 });
    expect(model.data).toEqual([[0, -10], [DAY_MS, 15]]);
  });

  it('creates an ECharts stepped categorical series without coercing categories to numbers', () => {
    const model = buildHealthChartModels([series({
      chartKind: 'step',
      valueType: HEALTH_VALUE_TYPES.Category,
      unit: 'category',
      points: [
        { timestampMs: 0, calendarDate: '1970-01-01', value: 'rest', qualityCode: null },
        { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 'high', qualityCode: null },
      ],
    })], 0, DAY_MS)[0];
    expect(model.categoryLabels).toEqual(['rest', 'high']);
    expect(model.data).toEqual([[0, 'rest'], [DAY_MS, 'high']]);
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS,
      buildDashboardEChartsStyleTokens(false, 640),
      false,
    ) as any;
    expect(option.series[0]).toMatchObject({ type: 'line', step: 'end', connectNulls: false });
    expect(option.yAxis).toMatchObject({ type: 'category', data: ['rest', 'high'] });
  });

  it('bounds visual DOM points while preserving the first and last reading', () => {
    const points = Array.from({ length: 1_000 }, (_, index) => ({
      timestampMs: index * 1_000,
      calendarDate: '1970-01-01',
      value: index,
      qualityCode: null,
    }));
    const model = buildHealthChartModels([series({ points })], 0, 999_000)[0];
    expect(model.displayedPoints).toHaveLength(600);
    expect(model.data).toHaveLength(600);
    expect(model.omittedPointCount).toBe(400);
    expect(model.displayedPoints[0].value).toBe(0);
    expect(model.displayedPoints.at(-1)?.value).toBe(999);
  });

  it('labels calendar-window bounds in UTC so the final day does not roll forward locally', () => {
    const startTimeMs = Date.parse('2026-08-01T00:00:00.000Z');
    const endTimeMs = Date.parse('2026-08-30T23:59:59.999Z');
    const model = buildHealthChartModels([series()], startTimeMs, endTimeMs)[0];
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

    expect(model.startLabel).toBe(formatter.format(new Date(startTimeMs)));
    expect(model.endLabel).toBe(formatter.format(new Date(endTimeMs)));
  });

  it('uses singular reading text in the chart accessibility label', () => {
    const model = buildHealthChartModels([series({
      points: [{ timestampMs: 0, calendarDate: '1970-01-01', value: 50, qualityCode: null }],
    })], 0, DAY_MS)[0];

    expect(model.ariaLabel).toContain('1 reading.');
    expect(model.ariaLabel).not.toContain('1 readings.');
  });
});
