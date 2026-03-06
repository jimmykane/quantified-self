export const ECHARTS_GLOBAL_FONT_FAMILY = "'Barlow Condensed', sans-serif";

export interface EChartsOfficialThemeTokens {
  themeName: 'light' | 'dark';
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  axisLineColor: string;
  splitLineColor: string;
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

const LIGHT_TOKENS: EChartsOfficialThemeTokens = {
  themeName: 'light',
  textPrimary: '#3c3c41',
  textSecondary: '#54555a',
  textTertiary: '#6d6e73',
  axisLineColor: '#54555a',
  splitLineColor: '#dbdee4',
  tooltipBackgroundColor: '#ffffff',
  tooltipBorderColor: '#b7b9be',
  tooltipTextColor: '#6d6e73',
  subtleBorderColor: 'rgba(255,255,255,0.45)',
  emphasisShadowColor: 'rgba(0,0,0,0.18)',
  dataZoomTrackColor: 'rgba(219,222,228,0.55)',
  dataZoomSelectionColor: 'rgba(101,120,186,0.22)',
  dataZoomHandleColor: '#6578ba',
  dataZoomOverviewLineColor: 'rgba(101,120,186,0.7)',
  dataZoomOverviewFillColor: 'rgba(101,120,186,0.18)',
  brushFillColor: 'rgba(101,120,186,0.14)',
  brushBorderColor: 'rgba(101,120,186,0.68)',
  watermarkColor: 'rgba(0,0,0,0.16)',
  lapLineColor: 'rgba(0,0,0,0.30)',
  trendLineColor: '#6d6e73',
};

const DARK_TOKENS: EChartsOfficialThemeTokens = {
  themeName: 'dark',
  textPrimary: 'rgba(223,223,225,1)',
  textSecondary: 'rgba(203,203,206,1)',
  textTertiary: 'rgba(179,180,183,1)',
  axisLineColor: '#B9B8CE',
  splitLineColor: '#484753',
  tooltipBackgroundColor: 'rgba(58,62,68,1)',
  tooltipBorderColor: 'rgba(91,94,100,1)',
  tooltipTextColor: 'rgba(179,180,183,1)',
  subtleBorderColor: 'rgba(91,94,100,0.65)',
  emphasisShadowColor: 'rgba(0,0,0,0.35)',
  dataZoomTrackColor: 'rgba(40,44,52,0.65)',
  dataZoomSelectionColor: 'rgba(119,130,166,0.30)',
  dataZoomHandleColor: 'rgba(175,181,201,1)',
  dataZoomOverviewLineColor: 'rgba(175,181,201,1)',
  dataZoomOverviewFillColor: 'rgba(119,130,166,0.28)',
  brushFillColor: 'rgba(119,130,166,0.18)',
  brushBorderColor: 'rgba(175,181,201,0.72)',
  watermarkColor: 'rgba(255,255,255,0.18)',
  lapLineColor: 'rgba(255,255,255,0.26)',
  trendLineColor: 'rgba(179,180,183,1)',
};

export function buildOfficialEChartsThemeTokens(darkTheme: boolean): EChartsOfficialThemeTokens {
  return darkTheme ? DARK_TOKENS : LIGHT_TOKENS;
}

export function resolveEChartsThemeName(darkTheme: boolean): 'light' | 'dark' {
  return darkTheme ? 'dark' : 'light';
}
