import type { EChartsType } from 'echarts/core';

type ChartOption = Parameters<EChartsType['setOption']>[0];

export interface HomeSignalChartPalette {
  primary: string;
  secondary: string;
  tertiary: string;
  error: string;
}

export interface HomeSignalChartPreview {
  key: 'readiness' | 'freshness' | 'intensity' | 'efficiency';
  title: string;
  value: string;
  context: string;
  ariaLabel: string;
  option: ChartOption;
}

// These values are deliberately altered and normalized illustrative data. They preserve
// broad aggregate trend shapes without embedding account measurements in the public page.
const READINESS_POINTS = [57, 55, 59, 62, 65, 68, 72, 69] as const;
const FRESHNESS_POINTS = [8, 15, 23, 30, 36, 41, 45, 48] as const;
const EFFICIENCY_POINTS = [97, 104, 100, 96, 102, 105, 108, 105] as const;
const INTENSITY_POINTS = {
  easy: [82, 78, 85, 74, 88, 86, 84, 87],
  moderate: [15, 18, 12, 23, 10, 12, 14, 11],
  hard: [3, 4, 3, 3, 2, 2, 2, 2],
} as const;

export function buildHomeSignalChartPreviews(
  palette: HomeSignalChartPalette,
): readonly HomeSignalChartPreview[] {
  return [
    {
      key: 'readiness',
      title: 'Readiness',
      value: '69',
      context: '14-day score',
      ariaLabel: 'Illustrative readiness trend rising before a small pullback.',
      option: buildLineOption(READINESS_POINTS, palette.primary, 45, 85),
    },
    {
      key: 'freshness',
      title: 'Freshness',
      value: '+48',
      context: '7-day forecast',
      ariaLabel: 'Illustrative zero-load freshness forecast rising over seven days.',
      option: buildLineOption(FRESHNESS_POINTS, palette.tertiary, 0, 58),
    },
    {
      key: 'intensity',
      title: 'Intensity mix',
      value: '87% easy',
      context: '8-week split',
      ariaLabel: 'Illustrative eight-week intensity mix dominated by easy training.',
      option: buildIntensityOption(palette),
    },
    {
      key: 'efficiency',
      title: 'Efficiency',
      value: '105',
      context: 'indexed trend',
      ariaLabel: 'Illustrative efficiency index improving with week-to-week variation.',
      option: buildLineOption(EFFICIENCY_POINTS, palette.secondary, 88, 114),
    },
  ];
}

function buildLineOption(
  values: readonly number[],
  color: string,
  minimum: number,
  maximum: number,
): ChartOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 0, right: 0, top: 5, bottom: 1, containLabel: false },
    tooltip: { show: false },
    xAxis: {
      type: 'category',
      show: false,
      boundaryGap: false,
      data: values.map((_, index) => index),
    },
    yAxis: {
      type: 'value',
      show: false,
      min: minimum,
      max: maximum,
    },
    series: [{
      type: 'line',
      data: [...values],
      silent: true,
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { color, width: 2.25 },
      areaStyle: { color, opacity: 0.12 },
      emphasis: { disabled: true },
    }],
  };
}

function buildIntensityOption(palette: HomeSignalChartPalette): ChartOption {
  const buildSeries = (
    name: string,
    data: readonly number[],
    color: string,
  ) => ({
    name,
    type: 'bar' as const,
    stack: 'intensity',
    data: [...data],
    silent: true,
    barWidth: '58%',
    itemStyle: { color },
    emphasis: { disabled: true },
  });

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 0, right: 0, top: 4, bottom: 1, containLabel: false },
    tooltip: { show: false },
    xAxis: {
      type: 'category',
      show: false,
      data: INTENSITY_POINTS.easy.map((_, index) => index),
    },
    yAxis: {
      type: 'value',
      show: false,
      min: 0,
      max: 100,
    },
    series: [
      buildSeries('Easy', INTENSITY_POINTS.easy, palette.primary),
      buildSeries('Moderate', INTENSITY_POINTS.moderate, palette.tertiary),
      buildSeries('Hard', INTENSITY_POINTS.hard, palette.error),
    ],
  };
}
