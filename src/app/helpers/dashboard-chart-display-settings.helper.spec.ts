import { describe, expect, it } from 'vitest';
import {
  cloneDashboardChartTileDisplaySettingsForChartType,
  getDefaultDashboardChartTileDisplaySettingsForChartType,
  normalizeDashboardChartTileDisplaySettingsForChartType,
} from './dashboard-chart-display-settings.helper';
import {
  DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
} from './dashboard-special-chart-types';

describe('dashboard-chart-display-settings.helper', () => {
  it('keeps Month as the legacy default and saves only supported calendar modes', () => {
    expect(normalizeDashboardChartTileDisplaySettingsForChartType(DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE, undefined)).toEqual({ calendarView: 'month' });
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE, { calendarView: '30d' })).toEqual({ calendarView: '30d' });
    expect(normalizeDashboardChartTileDisplaySettingsForChartType(DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE, { calendarView: 'invalid' })).toEqual({ calendarView: 'month' });
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_FORM_CHART_TYPE, { calendarView: '30d' })).toBeUndefined();
  });

  it('defaults only display settings supported by each chart type', () => {
    expect(getDefaultDashboardChartTileDisplaySettingsForChartType(DASHBOARD_FORM_CHART_TYPE)).toEqual({
      formTimelineWindow: 'w',
    });
    expect(getDefaultDashboardChartTileDisplaySettingsForChartType(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE)).toEqual({
      derivedChartRange: '12w',
    });
    expect(getDefaultDashboardChartTileDisplaySettingsForChartType(DASHBOARD_POWER_CURVE_CHART_TYPE)).toEqual({
      powerCurveCompareMode: 'latest',
    });
    expect(getDefaultDashboardChartTileDisplaySettingsForChartType(DASHBOARD_RECOVERY_NOW_CHART_TYPE)).toBeUndefined();
  });

  it('does not materialize missing defaults when cloning display settings', () => {
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_FORM_CHART_TYPE, undefined)).toBeUndefined();
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE, {})).toBeUndefined();
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_POWER_CURVE_CHART_TYPE, {})).toBeUndefined();
  });

  it('drops stale settings that do not belong to the chart type', () => {
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_FORM_CHART_TYPE, {
      formTimelineWindow: 'm',
      derivedChartRange: 'all',
    })).toEqual({
      formTimelineWindow: 'm',
    });
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE, {
      formTimelineWindow: 'y',
      derivedChartRange: '8w',
      powerCurveCompareMode: 'best30d',
    })).toEqual({
      derivedChartRange: '8w',
    });
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_POWER_CURVE_CHART_TYPE, {
      formTimelineWindow: 'y',
      derivedChartRange: '8w',
      powerCurveCompareMode: 'best90d',
    })).toEqual({
      powerCurveCompareMode: 'best90d',
    });
  });

  it('repairs invalid persisted values while preserving the supported key', () => {
    expect(normalizeDashboardChartTileDisplaySettingsForChartType(DASHBOARD_FORM_CHART_TYPE, {
      formTimelineWindow: 'bad',
    }, false)).toEqual({
      formTimelineWindow: 'w',
    });
    expect(normalizeDashboardChartTileDisplaySettingsForChartType(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE, {
      derivedChartRange: 'bad',
    }, false)).toEqual({
      derivedChartRange: '1y',
    });
    expect(normalizeDashboardChartTileDisplaySettingsForChartType(DASHBOARD_POWER_CURVE_CHART_TYPE, {
      powerCurveCompareMode: 'bad',
    }, false)).toEqual({
      powerCurveCompareMode: 'latest',
    });
  });
});
