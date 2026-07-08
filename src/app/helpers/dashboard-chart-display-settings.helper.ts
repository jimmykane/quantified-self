import type {
  AppDashboardChartTileDisplaySettingsInterface,
  AppDashboardDerivedChartRange,
  AppDashboardFormTimelineWindow,
  AppDashboardPowerCurveCompareMode,
} from '../models/app-user.interface';
import {
  DASHBOARD_DERIVED_CHART_DEFAULT_RANGE,
  normalizeDashboardDerivedChartRange,
} from './dashboard-derived-chart-range.helper';
import {
  isDashboardEfficiencyTrendChartType,
  isDashboardFormChartType,
  isDashboardIntensityDistributionChartType,
  isDashboardPowerCurveChartType,
} from './dashboard-special-chart-types';
import {
  DASHBOARD_POWER_CURVE_DEFAULT_COMPARE_MODE,
  normalizeDashboardPowerCurveCompareMode,
} from './dashboard-power-curve.helper';

export const DASHBOARD_FORM_TIMELINE_DEFAULT_WINDOW: AppDashboardFormTimelineWindow = 'w';

const DASHBOARD_FORM_TIMELINE_WINDOWS = new Set<AppDashboardFormTimelineWindow>(['w', 'm', 'y']);

interface NormalizeDashboardChartTileDisplaySettingsOptions {
  includeDerivedChartRange?: boolean;
  includeFormTimelineWindow?: boolean;
  includePowerCurveCompareMode?: boolean;
  includeDefaults?: boolean;
}

function hasOwn(value: object, key: keyof AppDashboardChartTileDisplaySettingsInterface): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalizeDashboardFormTimelineWindow(value: unknown): AppDashboardFormTimelineWindow {
  const stringValue = `${value || ''}`;
  return DASHBOARD_FORM_TIMELINE_WINDOWS.has(stringValue as AppDashboardFormTimelineWindow)
    ? stringValue as AppDashboardFormTimelineWindow
    : DASHBOARD_FORM_TIMELINE_DEFAULT_WINDOW;
}

export function normalizeDashboardChartTileDisplaySettings(
  value: unknown,
  options: NormalizeDashboardChartTileDisplaySettingsOptions = {},
): AppDashboardChartTileDisplaySettingsInterface | undefined {
  const source = value && typeof value === 'object'
    ? value as Partial<AppDashboardChartTileDisplaySettingsInterface>
    : {};
  const normalized: AppDashboardChartTileDisplaySettingsInterface = {};
  const shouldNormalizeDerivedRange = options.includeDerivedChartRange !== false
    && (hasOwn(source, 'derivedChartRange') || options.includeDefaults === true);
  const shouldNormalizeFormWindow = options.includeFormTimelineWindow !== false
    && (hasOwn(source, 'formTimelineWindow') || options.includeDefaults === true);
  const shouldNormalizePowerCurveCompareMode = options.includePowerCurveCompareMode !== false
    && (hasOwn(source, 'powerCurveCompareMode') || options.includeDefaults === true);

  if (shouldNormalizeDerivedRange) {
    normalized.derivedChartRange = normalizeDashboardDerivedChartRange(
      source.derivedChartRange || (options.includeDefaults ? DASHBOARD_DERIVED_CHART_DEFAULT_RANGE : undefined),
    ) as AppDashboardDerivedChartRange;
  }

  if (shouldNormalizeFormWindow) {
    normalized.formTimelineWindow = normalizeDashboardFormTimelineWindow(
      source.formTimelineWindow || (options.includeDefaults ? DASHBOARD_FORM_TIMELINE_DEFAULT_WINDOW : undefined),
    );
  }

  if (shouldNormalizePowerCurveCompareMode) {
    normalized.powerCurveCompareMode = normalizeDashboardPowerCurveCompareMode(
      source.powerCurveCompareMode || (options.includeDefaults ? DASHBOARD_POWER_CURVE_DEFAULT_COMPARE_MODE : undefined),
    ) as AppDashboardPowerCurveCompareMode;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeDashboardChartTileDisplaySettingsForChartType(
  chartType: unknown,
  value: unknown,
  includeDefaults = true,
): AppDashboardChartTileDisplaySettingsInterface | undefined {
  return normalizeDashboardChartTileDisplaySettings(value, {
    includeDerivedChartRange: isDashboardIntensityDistributionChartType(chartType)
      || isDashboardEfficiencyTrendChartType(chartType),
    includeFormTimelineWindow: isDashboardFormChartType(chartType),
    includePowerCurveCompareMode: isDashboardPowerCurveChartType(chartType),
    includeDefaults,
  });
}

export function getDefaultDashboardChartTileDisplaySettingsForChartType(
  chartType: unknown,
): AppDashboardChartTileDisplaySettingsInterface | undefined {
  return normalizeDashboardChartTileDisplaySettingsForChartType(chartType, {}, true);
}

export function cloneDashboardChartTileDisplaySettingsForChartType(
  chartType: unknown,
  value: unknown,
): AppDashboardChartTileDisplaySettingsInterface | undefined {
  return normalizeDashboardChartTileDisplaySettingsForChartType(chartType, value, false);
}
