import { describe, expect, it } from 'vitest';
import {
  cloneDashboardChartTileDisplaySettingsForChartType,
  getDefaultDashboardChartTileDisplaySettingsForChartType,
  normalizeDashboardChartTileDisplaySettingsForChartType,
} from './dashboard-chart-display-settings.helper';
import {
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
} from './dashboard-special-chart-types';

describe('dashboard-chart-display-settings.helper', () => {
  it('defaults only display settings supported by each chart type', () => {
    expect(getDefaultDashboardChartTileDisplaySettingsForChartType(DASHBOARD_FORM_CHART_TYPE)).toEqual({
      formTimelineWindow: 'w',
    });
    expect(getDefaultDashboardChartTileDisplaySettingsForChartType(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE)).toEqual({
      derivedChartRange: '1y',
    });
    expect(getDefaultDashboardChartTileDisplaySettingsForChartType(DASHBOARD_RECOVERY_NOW_CHART_TYPE)).toBeUndefined();
  });

  it('does not materialize missing defaults when cloning display settings', () => {
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_FORM_CHART_TYPE, undefined)).toBeUndefined();
    expect(cloneDashboardChartTileDisplaySettingsForChartType(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE, {})).toBeUndefined();
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
    })).toEqual({
      derivedChartRange: '8w',
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
  });
});
