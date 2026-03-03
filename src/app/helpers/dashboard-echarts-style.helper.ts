import { buildOfficialEChartsThemeTokens } from './echarts-theme.helper';

export interface DashboardEChartsStyleTokens {
  darkTheme: boolean;
  textColor: string;
  secondaryTextColor: string;
  axisColor: string;
  gridColor: string;
  tooltipBackgroundColor: string;
  tooltipBorderColor: string;
  tooltipTextColor: string;
  subtleBorderColor: string;
  trendLineColor: string;
  isCompactLayout: boolean;
  axisFontSize: number;
}

const DEFAULT_COMPACT_WIDTH = 680;

export function buildDashboardEChartsStyleTokens(
  darkTheme: boolean,
  chartWidth: number,
  compactWidth: number = DEFAULT_COMPACT_WIDTH
): DashboardEChartsStyleTokens {
  const isCompactLayout = chartWidth > 0 && chartWidth < compactWidth;
  const themeTokens = buildOfficialEChartsThemeTokens(darkTheme);

  return {
    darkTheme,
    textColor: themeTokens.textPrimary,
    secondaryTextColor: themeTokens.textSecondary,
    axisColor: themeTokens.axisLineColor,
    gridColor: themeTokens.splitLineColor,
    tooltipBackgroundColor: themeTokens.tooltipBackgroundColor,
    tooltipBorderColor: themeTokens.tooltipBorderColor,
    tooltipTextColor: themeTokens.tooltipTextColor,
    subtleBorderColor: themeTokens.subtleBorderColor,
    trendLineColor: themeTokens.trendLineColor,
    isCompactLayout,
    axisFontSize: isCompactLayout ? 11 : 12
  };
}
