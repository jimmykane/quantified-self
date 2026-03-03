import { describe, expect, it } from 'vitest';
import { buildDashboardEChartsStyleTokens } from './dashboard-echarts-style.helper';

describe('buildDashboardEChartsStyleTokens', () => {
  it('should return compact layout values for narrow charts', () => {
    const tokens = buildDashboardEChartsStyleTokens(false, 420);

    expect(tokens.isCompactLayout).toBe(true);
    expect(tokens.axisFontSize).toBe(11);
    expect(tokens.textColor).toBe('#3c3c41');
    expect(tokens.axisColor).toBe('#54555a');
  });

  it('should return dark values for dark app themes', () => {
    const tokens = buildDashboardEChartsStyleTokens(true, 900);

    expect(tokens.darkTheme).toBe(true);
    expect(tokens.isCompactLayout).toBe(false);
    expect(tokens.axisFontSize).toBe(12);
    expect(tokens.textColor).toBe('rgba(223,223,225,1)');
    expect(tokens.tooltipBackgroundColor).toBe('rgba(58,62,68,1)');
    expect(tokens.tooltipBorderColor).toBe('rgba(91,94,100,1)');
  });
});
