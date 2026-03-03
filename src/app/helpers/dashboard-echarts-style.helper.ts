export interface DashboardEChartsStyleTokens {
  darkTheme: boolean;
  textColor: string;
  axisColor: string;
  gridColor: string;
  tooltipBackgroundColor: string;
  tooltipBorderColor: string;
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

  return {
    darkTheme,
    textColor: darkTheme ? '#f5f5f5' : '#1f1f1f',
    axisColor: darkTheme ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.24)',
    gridColor: darkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    tooltipBackgroundColor: darkTheme ? '#303030' : '#ffffff',
    tooltipBorderColor: darkTheme ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
    isCompactLayout,
    axisFontSize: isCompactLayout ? 11 : 12
  };
}
