import { buildOfficialEChartsThemeTokens } from './echarts-theme.helper';

export interface EventEChartsVisualTokens {
  darkTheme: boolean;
  textColor: string;
  secondaryTextColor: string;
  tertiaryTextColor: string;
  axisColor: string;
  gridColor: string;
  axisLabelFontSize: number;
  tooltipExtraCssText: string;
  tooltipBackgroundColor: string;
  tooltipBorderColor: string;
  tooltipTextColor: string;
  subtleBorderColor: string;
  emphasisShadowColor: string;
  dataZoomTrackColor: string;
  dataZoomSelectionColor: string;
  dataZoomHandleColor: string;
  dataZoomOverviewLineColor: string;
  dataZoomOverviewFillColor: string;
  brushFillColor: string;
  brushBorderColor: string;
  watermarkColor: string;
  lapLineColor: string;
  trendLineColor: string;
}

export interface EventEChartsAxisRangeOptions {
  minFloor?: number;
  fallbackMin: number;
  fallbackMax: number;
  paddingRatio?: number;
  minPadding?: number;
}

const MOBILE_TOOLTIP_EXTRA_CSS_TEXT = 'max-width: min(80vw, 280px); white-space: normal; overflow-wrap: anywhere; word-break: break-word;';

export function buildEventEChartsVisualTokens(
  darkTheme: boolean,
  isMobile: boolean
): EventEChartsVisualTokens {
  const themeTokens = buildOfficialEChartsThemeTokens(darkTheme);

  return {
    darkTheme,
    textColor: themeTokens.textPrimary,
    secondaryTextColor: themeTokens.textSecondary,
    tertiaryTextColor: themeTokens.textTertiary,
    axisColor: themeTokens.axisLineColor,
    gridColor: themeTokens.splitLineColor,
    axisLabelFontSize: isMobile ? 11 : 12,
    tooltipExtraCssText: isMobile ? MOBILE_TOOLTIP_EXTRA_CSS_TEXT : '',
    tooltipBackgroundColor: themeTokens.tooltipBackgroundColor,
    tooltipBorderColor: themeTokens.tooltipBorderColor,
    tooltipTextColor: themeTokens.tooltipTextColor,
    subtleBorderColor: themeTokens.subtleBorderColor,
    emphasisShadowColor: themeTokens.emphasisShadowColor,
    dataZoomTrackColor: themeTokens.dataZoomTrackColor,
    dataZoomSelectionColor: themeTokens.dataZoomSelectionColor,
    dataZoomHandleColor: themeTokens.dataZoomHandleColor,
    dataZoomOverviewLineColor: themeTokens.dataZoomOverviewLineColor,
    dataZoomOverviewFillColor: themeTokens.dataZoomOverviewFillColor,
    brushFillColor: themeTokens.brushFillColor,
    brushBorderColor: themeTokens.brushBorderColor,
    watermarkColor: themeTokens.watermarkColor,
    lapLineColor: themeTokens.lapLineColor,
    trendLineColor: themeTokens.trendLineColor,
  };
}

export function calculateEventEChartsAxisRange(
  values: number[],
  options: EventEChartsAxisRangeOptions
): [number, number] {
  const validValues = values.filter((value) => Number.isFinite(value));
  if (!validValues.length) {
    return [options.fallbackMin, options.fallbackMax];
  }

  const minRaw = Math.min(...validValues);
  const maxRaw = Math.max(...validValues);
  const range = Math.max(1, maxRaw - minRaw);
  const paddingRatio = Number.isFinite(options.paddingRatio) ? Number(options.paddingRatio) : 0.12;
  const minPadding = Number.isFinite(options.minPadding) ? Number(options.minPadding) : 0.05;
  const padding = Math.max(minPadding, range * paddingRatio);

  let min = minRaw - padding;
  let max = maxRaw + padding;

  if (Number.isFinite(options.minFloor)) {
    min = Math.max(options.minFloor as number, min);
  }

  if (max <= min) {
    max = min + 1;
  }

  return [min, max];
}

export function toFiniteEventEChartsNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}
