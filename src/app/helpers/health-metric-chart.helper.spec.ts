import { describe, expect, it } from 'vitest';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import {
  HEALTH_METRIC_IDS,
  HEALTH_PROVIDERS,
  HEALTH_RECORDING_METHODS,
  HEALTH_VALUE_ORIGINS,
  HEALTH_VALUE_TYPES,
} from '@shared/health';
import { AppDataColors } from '../services/color/app.data.colors';
import { AppColors } from '../services/color/app.colors';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildDashboardEChartsStyleTokens } from './dashboard-echarts-style.helper';
import { buildHealthChartModels, buildHealthMetricEChartsOption } from './health-metric-chart.helper';
import { HealthWorkspaceSeries } from './health-workspace.helper';

const DAY_MS = 24 * 60 * 60 * 1000;

interface HealthMetricColorOption {
  series: Array<{
    lineStyle: { color: string; width: number };
    itemStyle: { color: string };
  }>;
}

interface StressStateColorOption {
  visualMap: {
    type: string;
    dimension: number;
    pieces: Array<{ value: number; color: string }>;
    outOfRange: { color: string };
  };
  yAxis: { axisLabel: { color: (value: string) => string } };
  series: Array<{
    data: Array<[number, string | null, number | null]>;
    lineStyle: { color?: string; width: number };
    itemStyle?: unknown;
  }>;
  tooltip: {
    formatter: (params: { value?: unknown }) => string;
  };
}

interface RecoveryBalanceColorOption {
  series: Array<{
    type: string;
    itemStyle: { color: (params: { value?: unknown }) => string };
  }>;
  tooltip: {
    formatter: (params: { value?: unknown }) => string;
  };
}

function series(overrides: Partial<HealthWorkspaceSeries> = {}): HealthWorkspaceSeries {
  return {
    id: 'series-1',
    metricId: HEALTH_METRIC_IDS.RestingHeartRate,
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
  it.each([1, 14, 30, 90, 365])('keeps %i-day date axes collision-safe without changing readings or the selected window', days => {
    const start = Date.UTC(2026, 5, 11);
    const end = start + days * DAY_MS - 1;
    const model = buildHealthChartModels([series({
      metricId: HEALTH_METRIC_IDS.HeartRate,
      points: [{ timestampMs: end, calendarDate: new Date(end).toISOString().slice(0, 10), value: 80, qualityCode: null }],
    })], start, end)[0];
    for (const width of [280, 360, 640, 1000]) {
      const option = buildHealthMetricEChartsOption(model, start, end,
        buildDashboardEChartsStyleTokens(false, width), width < 600) as {
        xAxis: { type: string; min: number; max: number; splitNumber: number; axisLabel: { hideOverlap: boolean } };
        series: Array<{ data: unknown }>;
      };
      expect(option.xAxis).toMatchObject({
        type: 'time', min: start, max: end, splitNumber: width < 680 ? 3 : 6,
        axisLabel: { hideOverlap: true },
      });
      expect(option.series[0].data).toBe(model.data);
    }
  });

  it('inserts null ECharts data across gaps instead of connecting missing periods', () => {
    const model = buildHealthChartModels([series()], 0, DAY_MS * 13)[0];
    expect(model.data.filter(([, value]) => value === null)).toHaveLength(1);
    expect(model.ariaLabel).toContain('not combined with other sources');
  });

  it('uses Sports Lib formatting in chart accessibility text and tooltips', () => {
    const vo2Series = series({
      metricId: HEALTH_METRIC_IDS.Vo2Max,
      unit: 'ml_per_kg_per_min',
      points: [{ timestampMs: 0, calendarDate: '1970-01-01', value: 52, qualityCode: null }],
    });
    const model = buildHealthChartModels([vo2Series], 0, DAY_MS)[0];
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS,
      buildDashboardEChartsStyleTokens(false, 640),
      false,
    ) as { tooltip: { formatter: (params: { value?: unknown }) => string } };

    expect(model.ariaLabel).toContain('Latest 52.00 ml/kg/min');
    expect(option.tooltip.formatter({ value: [0, 52] })).toContain('52.00 ml/kg/min');
  });

  it('keeps compact Health charts focused on the trend without duplicate axes', () => {
    const model = buildHealthChartModels([series()], 0, DAY_MS * 13)[0];
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS * 13,
      buildDashboardEChartsStyleTokens(false, 320),
      false,
      null,
      true,
    ) as {
      grid: { left: number; right: number };
      xAxis: { show: boolean };
      yAxis: { show: boolean };
      series: Array<{ showSymbol: boolean }>;
    };

    expect(option.grid).toMatchObject({ left: 2, right: 2 });
    expect(option.xAxis.show).toBe(false);
    expect(option.yAxis.show).toBe(false);
    expect(option.series).toHaveLength(1);
    expect(option.series[0].showSymbol).toBe(false);

    const sparseModel = buildHealthChartModels([
      series({ points: [series().points[0]] }),
    ], 0, DAY_MS * 13)[0];
    const sparseOption = buildHealthMetricEChartsOption(
      sparseModel,
      0,
      DAY_MS * 13,
      buildDashboardEChartsStyleTokens(false, 320),
      false,
      null,
      true,
    ) as { series: Array<{ showSymbol: boolean; symbolSize: number }> };
    expect(sparseOption.series[0]).toMatchObject({ showSymbol: true, symbolSize: 4 });
  });

  it.each([false, true])('plots each HRV range and color at its own date (compact: %s)', compact => {
    const hrvSeries = series({
      metricId: HEALTH_METRIC_IDS.HeartRateVariability,
      unit: 'millisecond',
      points: [
        { timestampMs: 0, calendarDate: '1970-01-01', value: 40, qualityCode: null },
        { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 46, qualityCode: null },
      ],
    });
    const model = buildHealthChartModels([hrvSeries], 0, DAY_MS)[0];
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS,
      buildDashboardEChartsStyleTokens(false, 320),
      false,
      compact ? normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }) : null,
      compact,
      {
        normalRangeColor: AppDataColors.Altitude,
        statusColor: AppDataColors.Stress,
        pointStatuses: [
          { timestampMs: 0, color: AppDataColors.Altitude, label: 'Within personal range', normalRange: { min: 30, max: 44 } },
          { timestampMs: DAY_MS, color: AppDataColors.Stress, label: 'Outside personal range', normalRange: { min: 35, max: 50 } },
        ],
      },
    ) as {
      yAxis: { min: number; max: number };
      series: Array<{
        id?: string;
        data: Array<[number, number | null]>;
        showSymbol: boolean;
        z?: number;
        lineStyle: { color?: string; width: number };
        itemStyle?: { color: (params: { value?: unknown }) => string };
        markArea: { itemStyle: { color: string; opacity: number }; data: unknown };
        markPoint: { itemStyle: { color: string }; data: Array<{ coord: [number, number] }> };
      }>;
      tooltip: { formatter: (params: { value?: unknown }) => string };
    };

    expect(option.yAxis.min).toBeLessThanOrEqual(30);
    expect(option.yAxis.max).toBeGreaterThanOrEqual(50);
    expect(option.series[0].data).toEqual([
      [0, 40],
      [DAY_MS, 46],
    ]);
    expect(option.series[0].showSymbol).toBe(true);
    expect(option.series[0].z).toBe(3);
    expect(option.series[0].lineStyle).toEqual({ color: 'transparent', width: 1.5 });
    expect(option.series[0].itemStyle?.color({ value: [0, 40] })).toBe(AppDataColors.Altitude);
    expect(option.series[0].itemStyle?.color({ value: [DAY_MS, 46] })).toBe(AppDataColors.Stress);
    expect(option.series[1]).toMatchObject({
      data: [[0, 40], [DAY_MS, 46]],
      showSymbol: false,
      lineStyle: { color: AppDataColors.Stress, width: 1.5 },
      silent: true,
    });
    expect(option.series[0].markArea).toBeUndefined();
    expect(option.series.find(item => item.id === 'hrv-personal-range-lower')).toMatchObject({
      data: [[0, 30], [DAY_MS, 35]], silent: true, connectNulls: false,
    });
    expect(option.series.find(item => item.id === 'hrv-personal-range-band')).toMatchObject({
      data: [[0, 14], [DAY_MS, 15]],
      areaStyle: { color: AppDataColors.Altitude, opacity: 0.1 },
      silent: true, connectNulls: false, z: 0,
    });
    expect(option.series[0].markPoint).toMatchObject({
      itemStyle: { color: AppDataColors.Stress },
      data: [{ coord: [DAY_MS, 46] }],
    });
    expect(option.tooltip.formatter({ value: [0, 40] }))
      .toContain('Personal range: Within personal range');
    expect(option.tooltip.formatter({ value: [0, 40] })).toContain('30 ms–44 ms');
    expect(option.tooltip.formatter({ value: [DAY_MS, 46] })).toContain('35 ms–50 ms');
    expect(option.tooltip.formatter({ value: [DAY_MS, 46] }))
      .toContain(`background:${AppDataColors.Stress}`);
  });

  it('does not connect point-in-time HRV colors across missing nights', () => {
    const hrvSeries = series({
      metricId: HEALTH_METRIC_IDS.HeartRateVariability,
      unit: 'millisecond',
      points: [
        { timestampMs: 0, calendarDate: '1970-01-01', value: 40, qualityCode: null },
        { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 42, qualityCode: null },
        { timestampMs: DAY_MS * 8, calendarDate: '1970-01-09', value: 46, qualityCode: null },
      ],
    });
    const model = buildHealthChartModels([hrvSeries], 0, DAY_MS * 8)[0];
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS * 8,
      buildDashboardEChartsStyleTokens(false, 320),
      false,
      null,
      true,
      {
        normalRangeColor: AppDataColors.Altitude,
        statusColor: AppDataColors.Stress,
        pointStatuses: [
          { timestampMs: 0, color: AppDataColors.Altitude, label: 'Within personal range', normalRange: { min: 30, max: 44 } },
          { timestampMs: DAY_MS, color: AppDataColors.Altitude, label: 'Within personal range', normalRange: { min: 32, max: 46 } },
          { timestampMs: DAY_MS * 8, color: AppColors.MediumGray, label: 'Building personal range', normalRange: null },
        ],
      },
    ) as {
      series: Array<{ id?: string; data: Array<[number, number | null]> }>;
    };

    expect(option.series).toHaveLength(4);
    expect(option.series[0].data).toContainEqual([DAY_MS * 4 + DAY_MS / 2, null]);
    expect(option.series[1].data).toEqual([[0, 40], [DAY_MS, 42]]);
    expect(option.series.find(item => item.id === 'hrv-personal-range-lower')?.data)
      .toEqual([[0, 30], [DAY_MS, 32], [DAY_MS * 4 + DAY_MS / 2, null], [DAY_MS * 8, null]]);
    expect(option.series.find(item => item.id === 'hrv-personal-range-band')?.data)
      .toEqual([[0, 14], [DAY_MS, 14], [DAY_MS * 4 + DAY_MS / 2, null], [DAY_MS * 8, null]]);
  });

  it('does not fabricate a band when the point-in-time baseline is unavailable', () => {
    const model = buildHealthChartModels([series({ metricId: HEALTH_METRIC_IDS.HeartRateVariability })], 0, DAY_MS * 13)[0];
    const option = buildHealthMetricEChartsOption(model, 0, DAY_MS * 13,
      buildDashboardEChartsStyleTokens(false, 320), false, null, false, {
        normalRangeColor: AppDataColors.Altitude, statusColor: AppColors.MediumGray,
        pointStatuses: model.displayedPoints.map(point => ({ timestampMs: point.timestampMs,
          color: AppColors.MediumGray, label: 'Building personal range', normalRange: null })),
      }) as { series: Array<{ id?: string; markArea?: unknown }> };
    expect(option.series.some(item => item.id?.startsWith('hrv-personal-range'))).toBe(false);
    expect(option.series.every(item => !item.markArea)).toBe(true);
  });

  it('uses the selected Sports Lib unit conversion consistently across a chart', () => {
    const unitSettings = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    const distanceSeries = series({
      metricId: HEALTH_METRIC_IDS.Distance,
      unit: 'meter',
      points: [{ timestampMs: 0, calendarDate: '1970-01-01', value: 10_000, qualityCode: null }],
    });
    const model = buildHealthChartModels([distanceSeries], 0, DAY_MS, unitSettings)[0];
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS,
      buildDashboardEChartsStyleTokens(false, 640),
      false,
      unitSettings,
    ) as {
      tooltip: { formatter: (params: { value?: unknown }) => string };
      yAxis: { axisLabel: { formatter: (value: number) => string } };
    };

    expect(model.ariaLabel).toContain('Latest 6.22 mi');
    expect(model.displayUnit).toBe('mi');
    expect(option.tooltip.formatter({ value: [0, 10_000] })).toContain('6.22 mi');
    expect(option.yAxis.axisLabel.formatter(10_000)).toBe('6.22');
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

  it('caps percentage Health charts at a Sports Lib-formatted 100%', () => {
    const model = buildHealthChartModels([series({
      metricId: HEALTH_METRIC_IDS.BloodOxygenSaturation,
      unit: 'percent',
      points: [
        { timestampMs: 0, calendarDate: '1970-01-01', value: 96, qualityCode: null },
        { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 99, qualityCode: null },
      ],
    })], 0, DAY_MS)[0];
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS,
      buildDashboardEChartsStyleTokens(false, 640),
      false,
    ) as {
      yAxis: {
        max: number;
        axisLabel: { formatter: (value: number) => string };
      };
    };

    expect(model.numericBounds?.min).toBeLessThan(96);
    expect(model.numericBounds?.max).toBe(100);
    expect(model.yMaxLabel).toBe('100%');
    expect(option.yAxis.max).toBe(100);
    expect(option.yAxis.axisLabel.formatter(100)).toBe('100%');

    const emptyModel = buildHealthChartModels([series({
      metricId: HEALTH_METRIC_IDS.BodyFat,
      unit: 'percent',
      points: [],
    })], 0, DAY_MS)[0];
    expect(emptyModel.numericBounds).toEqual({ min: 0, max: 100 });
    expect(emptyModel.yMaxLabel).toBe('100%');
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

  it('uses the established app data colors for matching Health metrics', () => {
    const style = buildDashboardEChartsStyleTokens(false, 640);
    const cases = [
      [HEALTH_METRIC_IDS.HeartRate, AppDataColors['Heart Rate']],
      [HEALTH_METRIC_IDS.BloodOxygenSaturation, AppDataColors['Blood Oxygen']],
      [HEALTH_METRIC_IDS.RespirationRate, AppDataColors.Respiration],
      [HEALTH_METRIC_IDS.Steps, AppDataColors.Distance],
      [HEALTH_METRIC_IDS.FloorsClimbed, AppDataColors.Altitude],
      [HEALTH_METRIC_IDS.SleepDuration, AppDataColors.Duration],
      [HEALTH_METRIC_IDS.BodyEnergy, AppDataColors.Energy],
      [HEALTH_METRIC_IDS.RecoveryScore, AppDataColors['Recovery Time']],
      [HEALTH_METRIC_IDS.BodyWeight, AppDataColors['Body Composition']],
      [HEALTH_METRIC_IDS.SkinTemperatureDeviation, AppDataColors.Temperature],
    ] as const;

    for (const [metricId, color] of cases) {
      const model = buildHealthChartModels([series({ metricId })], 0, DAY_MS)[0];
      const option = buildHealthMetricEChartsOption(
        model,
        0,
        DAY_MS,
        style,
        false,
      ) as HealthMetricColorOption;
      expect(option.series[0].lineStyle.color).toBe(color);
      expect(option.series[0].lineStyle.width).toBe(1.5);
      expect(option.series[0].itemStyle.color).toBe(color);
    }

    for (const metricId of Object.values(HEALTH_METRIC_IDS)) {
      const model = buildHealthChartModels([series({ metricId })], 0, DAY_MS)[0];
      const option = buildHealthMetricEChartsOption(
        model,
        0,
        DAY_MS,
        style,
        false,
      ) as HealthMetricColorOption;
      expect(option.series[0].lineStyle.color).not.toBe(style.trendLineColor);
    }
  });

  it('colors known Stress states without treating unknown provider values as severe', () => {
    const model = buildHealthChartModels([series({
      metricId: HEALTH_METRIC_IDS.StressState,
      chartKind: 'step',
      valueType: HEALTH_VALUE_TYPES.Category,
      unit: 'category',
      points: [
        { timestampMs: 0, calendarDate: '1970-01-01', value: 'passive', qualityCode: null },
        { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 'stressful', qualityCode: null },
        { timestampMs: DAY_MS * 2, calendarDate: '1970-01-03', value: 'relaxing', qualityCode: null },
        { timestampMs: DAY_MS * 3, calendarDate: '1970-01-04', value: 'active', qualityCode: null },
        { timestampMs: DAY_MS * 4, calendarDate: '1970-01-05', value: 'provider-specific', qualityCode: null },
      ],
    })], 0, DAY_MS * 4)[0];
    const style = buildDashboardEChartsStyleTokens(false, 640);
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS * 4,
      style,
      false,
    ) as StressStateColorOption;

    expect(model.categoryLabels).toEqual([
      'relaxing',
      'active',
      'passive',
      'stressful',
      'provider specific',
    ]);
    expect(option.visualMap).toMatchObject({
      type: 'piecewise',
      dimension: 2,
      outOfRange: { color: style.secondaryTextColor },
    });
    expect(option.visualMap.pieces).toEqual([
      { value: 0, color: AppDataColors.Altitude },
      { value: 1, color: AppDataColors.Distance },
      { value: 2, color: AppColors.MediumGray },
      { value: 3, color: AppDataColors['Heart Rate_0'] },
      { value: 4, color: style.trendLineColor },
    ]);
    expect(option.series[0].data).toEqual([
      [0, 'passive', 2],
      [DAY_MS, 'stressful', 3],
      [DAY_MS * 2, 'relaxing', 0],
      [DAY_MS * 3, 'active', 1],
      [DAY_MS * 4, 'provider specific', 4],
    ]);
    expect(option.series[0].lineStyle).toEqual({ width: 1.5 });
    expect(option.series[0].itemStyle).toBeUndefined();
    expect(option.yAxis.axisLabel.color('relaxing')).toBe(AppDataColors.Altitude);
    expect(option.yAxis.axisLabel.color('active')).toBe(AppDataColors.Distance);
    expect(option.yAxis.axisLabel.color('passive')).toBe(AppColors.MediumGray);
    expect(option.yAxis.axisLabel.color('stressful')).toBe(AppDataColors['Heart Rate_0']);
    expect(option.tooltip.formatter({ value: [DAY_MS * 4, 'provider-specific', 4] }))
      .toContain(`background:${style.trendLineColor}`);
  });

  it('renders provider-specific Body Energy as separately graded resource bars', () => {
    const model = buildHealthChartModels([series({
      metricId: HEALTH_METRIC_IDS.BodyEnergy,
      provider: HEALTH_PROVIDERS.SuuntoApp,
      providerLabel: 'Suunto',
      sourceLabel: 'Suunto',
      semanticVariant: 'recovery_balance',
      chartKind: 'bar',
      unit: 'percent',
      points: [
        { timestampMs: 0, calendarDate: '1970-01-01', value: 20, qualityCode: null },
        { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 45, qualityCode: null },
        { timestampMs: DAY_MS * 2, calendarDate: '1970-01-03', value: 70, qualityCode: null },
        { timestampMs: DAY_MS * 3, calendarDate: '1970-01-04', value: 90, qualityCode: null },
      ],
    })], 0, DAY_MS * 3)[0];
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS * 3,
      buildDashboardEChartsStyleTokens(false, 640),
      false,
    ) as RecoveryBalanceColorOption;
    const color = option.series[0].itemStyle.color;

    expect(option.series[0].type).toBe('bar');
    expect(color({ value: [0, 20] })).toBe(AppDataColors['Body Energy Low']);
    expect(color({ value: [DAY_MS, 45] })).toBe(AppDataColors['Body Energy Reduced']);
    expect(color({ value: [DAY_MS * 2, 70] })).toBe(AppDataColors['Body Energy Moderate']);
    expect(color({ value: [DAY_MS * 3, 90] })).toBe(AppDataColors['Body Energy High']);
    expect(option.tooltip.formatter({ value: [DAY_MS * 3, 90] }))
      .toContain(`background:${AppDataColors['Body Energy High']}`);

    const garminModel = buildHealthChartModels([series({
      metricId: HEALTH_METRIC_IDS.BodyEnergy,
      semanticVariant: 'garmin_body_battery',
      chartKind: 'bar',
      points: [{ timestampMs: 0, calendarDate: '1970-01-01', value: 45, qualityCode: null }],
    })], 0, DAY_MS)[0];
    const garminOption = buildHealthMetricEChartsOption(
      garminModel,
      0,
      DAY_MS,
      buildDashboardEChartsStyleTokens(false, 640),
      false,
    ) as RecoveryBalanceColorOption;
    expect(garminOption.series[0].itemStyle.color({ value: [0, 45] }))
      .toBe(AppDataColors['Body Energy Reduced']);
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

  it('formats Health axes and tooltips in each reading recorded timezone', () => {
    const timestampMs = Date.parse('2026-09-06T21:00:00.000Z');
    const timezoneOffsetSeconds = 3 * 60 * 60;
    const stressSeries = series({
      metricId: HEALTH_METRIC_IDS.StressState,
      valueType: HEALTH_VALUE_TYPES.Category,
      chartKind: 'step',
      unit: 'category',
      points: [{
        timestampMs,
        calendarDate: '2026-09-07',
        timezoneOffsetSeconds,
        value: 'passive',
        qualityCode: '3',
      }],
    });
    const endTimeMs = timestampMs + DAY_MS - 1;
    const model = buildHealthChartModels([stressSeries], timestampMs, endTimeMs)[0];
    const option = buildHealthMetricEChartsOption(
      model,
      timestampMs,
      endTimeMs,
      buildDashboardEChartsStyleTokens(false, 640),
      false,
    ) as {
      xAxis: { axisLabel: { formatter: (value: number) => string } };
      tooltip: { formatter: (params: { value?: unknown }) => string };
    };
    const providerLocalTimestampMs = timestampMs + timezoneOffsetSeconds * 1_000;
    const expectedAxisDate = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(providerLocalTimestampMs));
    const expectedAxisTime = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(providerLocalTimestampMs));
    const expectedTooltipDate = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(providerLocalTimestampMs));

    expect(model.startLabel).toBe(expectedAxisDate);
    expect(option.xAxis.axisLabel.formatter(timestampMs)).toBe(expectedAxisTime);
    expect(option.tooltip.formatter({ value: [timestampMs, 'passive', 2] }))
      .toContain(`${expectedTooltipDate} UTC+3`);
  });

  it('uses singular reading text in the chart accessibility label', () => {
    const model = buildHealthChartModels([series({
      points: [{ timestampMs: 0, calendarDate: '1970-01-01', value: 50, qualityCode: null }],
    })], 0, DAY_MS)[0];

    expect(model.ariaLabel).toContain('1 reading.');
    expect(model.ariaLabel).not.toContain('1 readings.');
  });
});
