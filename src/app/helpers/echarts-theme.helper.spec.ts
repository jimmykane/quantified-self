import { ChartThemes } from '@sports-alliance/sports-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { isDarkChartThemeActive } from './echarts-theme.helper';

describe('isDarkChartThemeActive', () => {
  afterEach(() => {
    document.body.classList.remove('dark-theme');
  });

  it('should return true for explicit dark chart themes', () => {
    expect(isDarkChartThemeActive(ChartThemes.Dark)).toBe(true);
    expect(isDarkChartThemeActive(ChartThemes.ChartsDark)).toBe(true);
    expect(isDarkChartThemeActive('dark')).toBe(true);
    expect(isDarkChartThemeActive('customdark')).toBe(true);
  });

  it('should fallback to body class when chart theme is not dark', () => {
    expect(isDarkChartThemeActive(ChartThemes.Material)).toBe(false);
    document.body.classList.add('dark-theme');
    expect(isDarkChartThemeActive(ChartThemes.Material)).toBe(true);
    expect(isDarkChartThemeActive(null)).toBe(true);
  });
});
