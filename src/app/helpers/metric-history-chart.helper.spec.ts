import { describe, expect, it } from 'vitest';
import { buildMetricHistoryChartOption, normalizeMetricHistoryPoints } from './metric-history-chart.helper';
import { usesDashboardKpiHistoryColumns } from './dashboard-kpi-sparkline.helper';
import { DASHBOARD_ACWR_KPI_CHART_TYPE, DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE, DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE, DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE } from './dashboard-special-chart-types';

const week = 7 * 86400000;
const options = { color: 'accent', mutedColor: 'muted', baselineColor: 'baseline' };
const build = (values: (number | null)[], mode?: 'columns' | 'forecast') => buildMetricHistoryChartOption(
  values.map((value, index) => ({ time: index * week, value })), { ...options, mode },
) as any;

describe('metric history columns', () => {
  it('sorts and trims only empty edges, preserving internal gaps and real zero', () => {
    expect(normalizeMetricHistoryPoints([
      { time: 4, value: null }, { time: 2, value: NaN }, { time: 0, value: null },
      { time: 3, value: 0 }, { time: 1, value: -2 }, { time: NaN, value: 4 },
    ])).toEqual([{ time: 1, value: -2 }, { time: 2, value: null }, { time: 3, value: 0 }]);
  });

  it('uses actual dates with unclipped endpoints and a zero baseline', () => {
    const option = build([2, null, 4]);
    expect(option.xAxis).toMatchObject({ min: -week / 2, max: week * 2.5 });
    expect(option.yAxis).toMatchObject({ min: 0 });
    expect(option.series[0]).toMatchObject({ type: 'bar', barMaxWidth: 10, data: [[0, 2], [week, null], [week * 2, 4]] });
    expect(option.series[0].markLine.data).toEqual([{ yAxis: 0 }]);
    expect(option.series[0].itemStyle.color({ dataIndex: 0 })).toBe('muted');
    expect(option.series[0].itemStyle.color({ dataIndex: 2 })).toBe('accent');
  });

  it('keeps a single point and valid zeroes without inventing a positive column', () => {
    expect(build([0]).series[0].data).toEqual([[0, 0]]);
    expect(build([0]).xAxis).toMatchObject({ min: -week / 2, max: week / 2 });
    expect(build([null, null]).series).toEqual([]);
  });

  it('shows signed values either side of zero, including wholly negative histories', () => {
    expect(build([-5, 2]).yAxis.min).toBeLessThan(-5);
    expect(build([-5, 2]).yAxis.max).toBeGreaterThan(2);
    expect(build([-5, -2]).yAxis.max).toBe(0);
  });

  it('keeps the forecast dashed, unconnected across missing days and separate from history', () => {
    const option = build([2, null, 5], 'forecast');
    expect(option.series[0]).toMatchObject({ type: 'line', connectNulls: false, lineStyle: { type: 'dashed' } });
    expect(option.xAxis).toMatchObject({ min: 0, max: 2 * week });
  });

  it('keeps thumbnails silent and preserves the unrelated evidence charts', () => {
    const thumbnail = buildMetricHistoryChartOption([{ time: 0, value: 1 }], { ...options, silent: true }) as any;
    expect(thumbnail.series[0]).toMatchObject({ silent: true, emphasis: { disabled: true } });
    expect(usesDashboardKpiHistoryColumns(DASHBOARD_ACWR_KPI_CHART_TYPE)).toBe(true);
    for (const type of [DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE, DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE, DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE]) {
      expect(usesDashboardKpiHistoryColumns(type)).toBe(false);
    }
  });
});
