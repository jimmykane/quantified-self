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
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildDashboardEChartsStyleTokens } from './dashboard-echarts-style.helper';
import { buildHealthChartModels, buildHealthMetricEChartsOption } from './health-metric-chart.helper';
import { HealthWorkspaceSeries } from './health-workspace.helper';

const DAY_MS = 24 * 60 * 60 * 1000;

interface HealthMetricColorOption {
  series: Array<{
    lineStyle: { color: string };
    itemStyle: { color: string };
  }>;
}

interface StressStateColorOption {
  visualMap: {
    pieces: Array<{ value: string; color: string }>;
  };
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
        { timestampMs: 0, calendarDate: '1970-01-01', value: 'relaxing', qualityCode: null },
        { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 'active', qualityCode: null },
        { timestampMs: DAY_MS * 2, calendarDate: '1970-01-03', value: 'stressful', qualityCode: null },
        { timestampMs: DAY_MS * 3, calendarDate: '1970-01-04', value: 'provider-specific', qualityCode: null },
      ],
    })], 0, DAY_MS * 3)[0];
    const style = buildDashboardEChartsStyleTokens(false, 640);
    const option = buildHealthMetricEChartsOption(
      model,
      0,
      DAY_MS * 3,
      style,
      false,
    ) as StressStateColorOption;

    expect(option.visualMap.pieces).toEqual([
      { value: 'relaxing', color: AppDataColors.Altitude },
      { value: 'active', color: AppDataColors.Stress },
      { value: 'stressful', color: AppDataColors['Heart Rate_0'] },
      { value: 'provider specific', color: style.trendLineColor },
    ]);
    expect(option.tooltip.formatter({ value: [DAY_MS * 3, 'provider-specific'] }))
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

  it('uses singular reading text in the chart accessibility label', () => {
    const model = buildHealthChartModels([series({
      points: [{ timestampMs: 0, calendarDate: '1970-01-01', value: 50, qualityCode: null }],
    })], 0, DAY_MS)[0];

    expect(model.ariaLabel).toContain('1 reading.');
    expect(model.ariaLabel).not.toContain('1 readings.');
  });
});
