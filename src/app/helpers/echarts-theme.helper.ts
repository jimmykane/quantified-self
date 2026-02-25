import { ChartThemes } from '@sports-alliance/sports-lib';

export function isDarkChartThemeActive(chartTheme: ChartThemes | string | null | undefined): boolean {
  const normalizedTheme = `${chartTheme || ''}`.trim().toLowerCase();
  if (normalizedTheme === 'dark' || normalizedTheme === 'amchartsdark') {
    return true;
  }

  if (typeof document === 'undefined') {
    return false;
  }

  return document.body.classList.contains('dark-theme');
}
