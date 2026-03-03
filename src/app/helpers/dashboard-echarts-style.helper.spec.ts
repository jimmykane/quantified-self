import { describe, expect, it } from 'vitest';
import { buildDashboardEChartsStyleTokens } from './dashboard-echarts-style.helper';

describe('buildDashboardEChartsStyleTokens', () => {
  it('should return compact layout values for narrow charts', () => {
    const tokens = buildDashboardEChartsStyleTokens(false, 420);

    expect(tokens.isCompactLayout).toBe(true);
    expect(tokens.axisFontSize).toBe(11);
    expect(tokens.textColor).toBe('#1f1f1f');
    expect(tokens.axisColor).toBe('rgba(0,0,0,0.24)');
  });

  it('should return dark values for dark app themes', () => {
    const tokens = buildDashboardEChartsStyleTokens(true, 900);

    expect(tokens.darkTheme).toBe(true);
    expect(tokens.isCompactLayout).toBe(false);
    expect(tokens.axisFontSize).toBe(12);
    expect(tokens.textColor).toBe('#f5f5f5');
    expect(tokens.tooltipBackgroundColor).toBe('#303030');
    expect(tokens.tooltipBorderColor).toBe('rgba(255,255,255,0.14)');
  });
});
