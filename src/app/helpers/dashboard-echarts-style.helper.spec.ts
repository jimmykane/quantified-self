import { describe, expect, it } from 'vitest';
import {
  buildDashboardEChartsStyleTokens,
  buildDashboardEChartsTooltipChrome,
  buildDashboardEChartsTooltipTextStyle,
  renderDashboardEChartsTooltipCard,
} from './dashboard-echarts-style.helper';

describe('buildDashboardEChartsStyleTokens', () => {
  it('should return compact layout values for narrow charts', () => {
    const tokens = buildDashboardEChartsStyleTokens(false, 420);

    expect(tokens.isCompactLayout).toBe(true);
    expect(tokens.axisFontSize).toBe(11);
    expect(tokens.tooltipTypography).toEqual({
      bodyFontSize: 12,
      labelFontSize: 11,
      valueFontSize: 13,
      titleFontSize: 12,
      dateFontSize: 12,
      textLineHeight: 1.2,
      valueLineHeight: 1.15,
      metricGapPx: 6,
      metricValueGapPx: 18,
      cardPadding: '10px 12px 9px',
      maxWidthPx: 240,
    });
    expect(tokens.textColor).toBe('#3c3c41');
    expect(tokens.axisColor).toBe('#54555a');
  });

  it('should return dark values for dark app themes', () => {
    const tokens = buildDashboardEChartsStyleTokens(true, 900);

    expect(tokens.darkTheme).toBe(true);
    expect(tokens.isCompactLayout).toBe(false);
    expect(tokens.axisFontSize).toBe(12);
    expect(tokens.tooltipTypography.bodyFontSize).toBe(13);
    expect(tokens.tooltipTypography.labelFontSize).toBe(12);
    expect(tokens.tooltipTypography.valueFontSize).toBe(14);
    expect(tokens.tooltipTypography.titleFontSize).toBe(13);
    expect(tokens.tooltipTypography.cardPadding).toBe('11px 13px 10px');
    expect(tokens.tooltipTypography.maxWidthPx).toBe(260);
    expect(tokens.textColor).toBe('rgba(223,223,225,1)');
    expect(tokens.tooltipBackgroundColor).toBe('rgba(58,62,68,1)');
    expect(tokens.tooltipBorderColor).toBe('rgba(91,94,100,1)');
  });

  it('should build the shared tooltip text style from tooltip typography tokens', () => {
    const tokens = buildDashboardEChartsStyleTokens(false, 900);

    expect(buildDashboardEChartsTooltipTextStyle(tokens)).toEqual({
      color: tokens.tooltipTextColor,
      fontFamily: "'Barlow Condensed', sans-serif",
      fontSize: tokens.tooltipTypography.bodyFontSize,
    });
  });

  it('should build shared tooltip chrome without extra outer padding', () => {
    const tokens = buildDashboardEChartsStyleTokens(true, 900);

    expect(buildDashboardEChartsTooltipChrome(tokens)).toEqual({
      backgroundColor: tokens.tooltipBackgroundColor,
      borderColor: tokens.tooltipBorderColor,
      borderWidth: 1,
      padding: 0,
      textStyle: buildDashboardEChartsTooltipTextStyle(tokens),
    });
  });

  it('should render shared tooltip card typography for custom formatter html', () => {
    const tokens = buildDashboardEChartsStyleTokens(false, 900);

    const html = renderDashboardEChartsTooltipCard(tokens, {
      title: 'Freshness Forecast',
      subtitle: 'May 7, 2026 · Forecast',
      rows: [
        { label: 'TSS', value: '103' },
        { label: 'Fitness (CTL)', value: '47', markerColor: '#42a5f5' },
      ],
      notes: ['Assumes zero load.'],
    });

    expect(html).toContain('qs-dashboard-echarts-tooltip-card');
    expect(html).toContain('font-size:14px');
    expect(html).toContain('font-size:13px');
    expect(html).toContain('font-size:12px');
    expect(html).toContain('aria-label="TSS: 103"');
    expect(html).toContain('aria-label="Fitness (CTL): 47"');
    expect(html).not.toContain('<strong>');
  });
});
