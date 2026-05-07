import { buildOfficialEChartsThemeTokens, ECHARTS_GLOBAL_FONT_FAMILY } from './echarts-theme.helper';

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
  tooltipTypography: DashboardEChartsTooltipTypography;
}

export interface DashboardEChartsTooltipTypography {
  bodyFontSize: number;
  labelFontSize: number;
  valueFontSize: number;
  titleFontSize: number;
  dateFontSize: number;
  textLineHeight: number;
  valueLineHeight: number;
  metricGapPx: number;
  metricValueGapPx: number;
  cardPadding: string;
  maxWidthPx: number;
}

export interface DashboardEChartsTooltipTextStyle {
  color: string;
  fontFamily: string;
  fontSize: number;
}

export interface DashboardEChartsTooltipChrome {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  padding: number;
  textStyle: DashboardEChartsTooltipTextStyle;
}

export interface DashboardEChartsTooltipMetricRow {
  label: string;
  value: string;
  markerColor?: string | null;
  labelColor?: string | null;
  valueColor?: string | null;
}

export interface DashboardEChartsTooltipCardOptions {
  title?: string | null;
  subtitle?: string | null;
  titleColor?: string | null;
  rows?: ReadonlyArray<DashboardEChartsTooltipMetricRow>;
  notes?: ReadonlyArray<string>;
}

const DEFAULT_COMPACT_WIDTH = 680;

export function buildDashboardEChartsStyleTokens(
  darkTheme: boolean,
  chartWidth: number,
  compactWidth: number = DEFAULT_COMPACT_WIDTH
): DashboardEChartsStyleTokens {
  const isCompactLayout = chartWidth > 0 && chartWidth < compactWidth;
  const themeTokens = buildOfficialEChartsThemeTokens(darkTheme);
  const tooltipTypography: DashboardEChartsTooltipTypography = {
    bodyFontSize: isCompactLayout ? 12 : 13,
    labelFontSize: isCompactLayout ? 11 : 12,
    valueFontSize: isCompactLayout ? 13 : 14,
    titleFontSize: isCompactLayout ? 12 : 13,
    dateFontSize: 12,
    textLineHeight: 1.2,
    valueLineHeight: 1.15,
    metricGapPx: 6,
    metricValueGapPx: 18,
    cardPadding: isCompactLayout ? '10px 12px 9px' : '11px 13px 10px',
    maxWidthPx: isCompactLayout ? 240 : 260,
  };

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
    axisFontSize: isCompactLayout ? 11 : 12,
    tooltipTypography,
  };
}

export function buildDashboardEChartsTooltipTextStyle(
  styleTokens: DashboardEChartsStyleTokens,
): DashboardEChartsTooltipTextStyle {
  return {
    color: styleTokens.tooltipTextColor,
    fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
    fontSize: styleTokens.tooltipTypography.bodyFontSize,
  };
}

export function buildDashboardEChartsTooltipChrome(
  styleTokens: DashboardEChartsStyleTokens,
): DashboardEChartsTooltipChrome {
  return {
    backgroundColor: styleTokens.tooltipBackgroundColor,
    borderColor: styleTokens.tooltipBorderColor,
    borderWidth: 1,
    padding: 0,
    textStyle: buildDashboardEChartsTooltipTextStyle(styleTokens),
  };
}

export function renderDashboardEChartsTooltipCard(
  styleTokens: DashboardEChartsStyleTokens,
  options: DashboardEChartsTooltipCardOptions,
): string {
  const typography = styleTokens.tooltipTypography;
  const title = `${options.title || ''}`.trim();
  const subtitle = `${options.subtitle || ''}`.trim();
  const rows = options.rows || [];
  const notes = (options.notes || []).filter(note => `${note}`.trim().length > 0);
  const hasHeader = title.length > 0 || subtitle.length > 0;
  const hasBody = rows.length > 0 || notes.length > 0;

  const headerHtml = hasHeader
    ? (
      `<div style="display:flex;align-items:center;justify-content:flex-start;gap:12px;min-width:0;">`
      + (title.length > 0
        ? `<div style="font-size:${typography.titleFontSize}px;line-height:${typography.textLineHeight};font-weight:700;color:${escapeDashboardEChartsTooltipHtml(options.titleColor || styleTokens.tooltipTextColor)};white-space:nowrap;">${escapeDashboardEChartsTooltipHtml(title)}</div>`
        : '')
      + (subtitle.length > 0
        ? `<div style="font-size:${typography.dateFontSize}px;line-height:${typography.textLineHeight};color:${styleTokens.secondaryTextColor};white-space:nowrap;">${escapeDashboardEChartsTooltipHtml(subtitle)}</div>`
        : '')
      + `</div>`
    )
    : '';
  const dividerHtml = hasHeader && hasBody
    ? `<div style="height:1px;background:${styleTokens.tooltipBorderColor};margin:9px 0 10px;"></div>`
    : '';
  const rowsHtml = rows.length > 0
    ? (
      `<div style="display:flex;flex-direction:column;gap:${typography.metricGapPx}px;">`
      + rows.map(row => renderDashboardEChartsTooltipMetricRow(styleTokens, row)).join('')
      + `</div>`
    )
    : '';
  const notesHtml = notes.length > 0
    ? (
      `<div style="display:flex;flex-direction:column;gap:4px;margin-top:${rows.length > 0 ? 8 : 0}px;">`
      + notes.map(note => (
        `<div style="font-size:${typography.labelFontSize}px;line-height:${typography.textLineHeight};color:${styleTokens.secondaryTextColor};white-space:nowrap;">${escapeDashboardEChartsTooltipHtml(note)}</div>`
      )).join('')
      + `</div>`
    )
    : '';

  return (
    `<div class="qs-dashboard-echarts-tooltip-card" style="width:max-content;min-width:0;max-width:min(${typography.maxWidthPx}px, calc(100vw - 32px));`
    + `padding:${typography.cardPadding};font-family:${ECHARTS_GLOBAL_FONT_FAMILY};">`
    + headerHtml
    + dividerHtml
    + rowsHtml
    + notesHtml
    + `</div>`
  );
}

export function escapeDashboardEChartsTooltipHtml(value: string | number | null | undefined): string {
  return `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDashboardEChartsTooltipMetricRow(
  styleTokens: DashboardEChartsStyleTokens,
  row: DashboardEChartsTooltipMetricRow,
): string {
  const typography = styleTokens.tooltipTypography;
  const label = `${row.label}`.trim();
  const value = `${row.value}`.trim();
  const labelColor = row.labelColor || styleTokens.secondaryTextColor;
  const valueColor = row.valueColor || styleTokens.tooltipTextColor;
  const markerHtml = row.markerColor
    ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${escapeDashboardEChartsTooltipHtml(row.markerColor)};margin-right:6px;flex:0 0 auto;"></span>`
    : '';

  return (
    `<div aria-label="${escapeDashboardEChartsTooltipHtml(`${label}: ${value}`)}" style="display:flex;align-items:baseline;justify-content:space-between;gap:${typography.metricValueGapPx}px;min-width:0;">`
    + `<div style="display:flex;align-items:center;min-width:0;">`
    + markerHtml
    + `<span style="font-size:${typography.labelFontSize}px;line-height:${typography.textLineHeight};color:${labelColor};white-space:nowrap;">${escapeDashboardEChartsTooltipHtml(label)}:</span>`
    + `</div>`
    + `<div style="font-family:${ECHARTS_GLOBAL_FONT_FAMILY};font-size:${typography.valueFontSize}px;line-height:${typography.valueLineHeight};font-weight:700;color:${valueColor};text-align:right;white-space:nowrap;">${escapeDashboardEChartsTooltipHtml(value)}</div>`
    + `</div>`
  );
}
