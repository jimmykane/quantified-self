import type { EChartsCoreOption } from 'echarts/core';
import { DataDuration, DataRRMeanInterval, DataRRDFAAlpha1Median, type RRAnalysis, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { formatBenchmarkRRValue } from './benchmark-rr.helper';
import { buildOfficialEChartsThemeTokens, ECHARTS_GLOBAL_FONT_FAMILY } from './echarts-theme.helper';
import { deviceChartLineType } from './device-chart-appearance.helper';

type Point = [number, number | null];
export interface BenchmarkRRChartRecording {
  key: string;
  label: string;
  analysis: RRAnalysis;
  startTimeMs: number;
  durationMs: number;
  color: string;
  lineStyle: 'solid' | 'dashed' | 'dotted' | 'dash-dot';
}
export interface BenchmarkRRChartOptions {
  recordings: readonly BenchmarkRRChartRecording[];
  excludeFlagged: boolean;
  darkTheme: boolean;
  artifactColor: string;
  width: number;
  unitSettings?: UserUnitSettingsInterface;
  zoom?: { start: number; end: number };
}

const MAX_MARKERS = 4000;

/** Bound marker density across the complete recording, retaining both ends. Counts always describe the full analysis. */
function sampleMarkers(points: Point[]): Point[] {
  if (points.length <= MAX_MARKERS) return points;
  return Array.from({ length: MAX_MARKERS }, (_, index) => points[Math.round(index * (points.length - 1) / (MAX_MARKERS - 1))]);
}

export function buildBenchmarkRRSeries(analysis: RRAnalysis, excludeFlagged: boolean) {
  const intervals: Point[] = [];
  const artifacts: Point[] = [];
  const ectopics: Point[] = [];
  let previousSegment: number | undefined;
  for (const beat of analysis.beats) {
    if (previousSegment !== undefined && beat.segment !== previousSegment) intervals.push([beat.time, null]);
    previousSegment = beat.segment;
    const point: Point = [beat.time, beat.interval];
    const flagged = beat.classification !== 'accepted';
    intervals.push([beat.time, excludeFlagged && flagged ? null : beat.interval]);
    if (excludeFlagged || !flagged) continue;
    (beat.classification === 'suspected-ectopic' ? ectopics : artifacts).push(point);
  }
  return {
    intervals, artifacts: sampleMarkers(artifacts), ectopics: sampleMarkers(ectopics),
    markerSampling: artifacts.length > MAX_MARKERS || ectopics.length > MAX_MARKERS,
    dfa: analysis.windows.map(window => [window.time, window.dfaAlpha1] as Point),
  };
}

export function buildBenchmarkRRChartOptions(input: BenchmarkRRChartOptions): { rr: EChartsCoreOption; dfa: EChartsCoreOption; markerSampling: boolean } {
  const { recordings, unitSettings } = input;
  const origin = recordings.reduce((min, source) => Math.min(min, source.startTimeMs), Infinity);
  const data = recordings.map(source => {
    const series = buildBenchmarkRRSeries(source.analysis, input.excludeFlagged);
    const offset = source.startTimeMs - origin;
    const shift = (points: Point[]) => points.map(([time, value]) => [time + offset, value] as Point);
    return { source, ...series, intervals: shift(series.intervals), artifacts: shift(series.artifacts),
      ectopics: shift(series.ectopics), dfa: shift(series.dfa) };
  });
  const durationMs = recordings.reduce((max, source) => Math.max(max, source.startTimeMs - origin + source.durationMs), 1);
  const theme = buildOfficialEChartsThemeTokens(input.darkTheme);
  const formatTime = (value: number) => resolveUnitAwareDisplayStat(new DataDuration(value / 1000), unitSettings, { compactDuration: true })?.value ?? '';
  const formatHoverTime = (value: number) => resolveUnitAwareDisplayStat(new DataDuration(value / 1000), unitSettings)?.text ?? '';
  const intervalUnit = formatBenchmarkRRValue(DataRRMeanInterval.type, 0, unitSettings)?.unit ?? '';
  const zoom = { start: input.zoom?.start ?? 0, end: input.zoom?.end ?? 100 };
  const xAxis = {
    type: 'value' as const, min: 0, max: durationMs,
    splitNumber: input.width < 500 ? 3 : 6,
    axisLabel: { formatter: formatTime, hideOverlap: true },
    axisPointer: { label: { formatter: (params: { value: number }) => formatHoverTime(params.value) } },
    axisTick: { show: false }, splitLine: { show: false },
  };
  const tooltip = { trigger: 'axis' as const, backgroundColor: theme.tooltipBackgroundColor,
    borderColor: theme.tooltipBorderColor, textStyle: { color: theme.tooltipTextColor }, confine: true };
  // ECharts forwards zoom actions by dataZoom ID between connected charts.
  // Both hosts must own both IDs, including the DFA chart's hidden slider.
  const insideZoom = { id: 'rr-inside', type: 'inside' as const, ...zoom, zoomOnMouseWheel: false, moveOnMouseWheel: false };
  const sliderZoom = { id: 'rr-slider', type: 'slider' as const, ...zoom, height: 18, bottom: 3,
    showDetail: false, showDataShadow: false, borderColor: theme.subtleBorderColor,
    fillerColor: theme.dataZoomSelectionColor, handleStyle: { color: theme.dataZoomHandleColor }, brushSelect: false };
  const grid = { left: 60, right: 24, top: 30, bottom: 62 };
  const base: EChartsCoreOption = { animation: false, backgroundColor: 'transparent',
    textStyle: { fontFamily: ECHARTS_GLOBAL_FONT_FAMILY }, xAxis, grid, aria: { enabled: true } };
  const values = recordings.flatMap(source => source.analysis.beats.map(beat => beat.interval)).filter(Number.isFinite);
  const min = values.reduce((value, next) => Math.min(value, next), Infinity);
  const max = values.reduce((value, next) => Math.max(value, next), -Infinity);
  const pad = Math.max(20, (max - min) * .08);
  const alphas = recordings.flatMap(source => source.analysis.windows.map(window => window.dfaAlpha1)).filter((value): value is number => value !== null && Number.isFinite(value));
  const alphaMin = alphas.reduce((min, value) => Math.min(min, value), 0);
  const alphaMax = alphas.reduce((max, value) => Math.max(max, value), 1.5);
  return {
    markerSampling: data.some(series => series.markerSampling),
    rr: { ...base, tooltip: { ...tooltip, valueFormatter: value => formatBenchmarkRRValue(DataRRMeanInterval.type, value, unitSettings)?.text ?? 'Unavailable' },
      yAxis: { type: 'value', min: Number.isFinite(min) ? Math.max(0, min - pad) : 0, max: Number.isFinite(max) ? max + pad : 1,
        name: intervalUnit, axisLabel: { formatter: (value: number) => formatBenchmarkRRValue(DataRRMeanInterval.type, value, unitSettings)?.value ?? '' },
        splitLine: { lineStyle: { color: theme.splitLineColor } } },
      dataZoom: [insideZoom, sliderZoom],
      series: data.flatMap(({ source, intervals, artifacts, ectopics }) => [
        // Native LTTB can join unrelated points around null barriers. Keep the
        // original line order and gaps; only the dense marker overlays are sampled.
        { id: `${source.key}:rr`, name: `${source.label} · R–R interval`, type: 'line', showSymbol: false, connectNulls: false, data: intervals,
          lineStyle: { width: 1.2, color: source.color, type: deviceChartLineType(source.lineStyle) }, itemStyle: { color: source.color } },
        { id: `${source.key}:artifacts`, name: `${source.label} · Strap artifact`, type: 'scatter', data: artifacts, symbolSize: 5, itemStyle: { color: input.artifactColor, borderColor: source.color }, z: 3 },
        { id: `${source.key}:pairs`, name: `${source.label} · Suspected ectopic pair`, type: 'scatter', data: ectopics, symbolSize: 7,
          itemStyle: { color: theme.tooltipBackgroundColor, borderColor: source.color, borderWidth: 1.3 }, z: 4 },
      ]),
    },
    dfa: { ...base, grid: { ...grid, bottom: 32 },
      tooltip: { ...tooltip, valueFormatter: value => formatBenchmarkRRValue(DataRRDFAAlpha1Median.type, value, unitSettings)?.text ?? 'Unavailable' },
      yAxis: { type: 'value', min: alphaMin, max: alphaMax + (alphaMax - alphaMin) * .05,
        axisLabel: { formatter: (value: number) => formatBenchmarkRRValue(DataRRDFAAlpha1Median.type, value, unitSettings)?.value ?? '' },
        splitLine: { lineStyle: { color: theme.splitLineColor } } }, dataZoom: [insideZoom, { ...sliderZoom, show: false }],
      series: data.map(({ source, dfa }, index) => ({ id: `${source.key}:dfa`, name: `${source.label} · DFA α1`, type: 'line', showSymbol: false, connectNulls: false, data: dfa,
        lineStyle: { color: source.color, width: 1.7, type: deviceChartLineType(source.lineStyle) }, itemStyle: { color: source.color },
        markLine: index === 0 ? { silent: true, symbol: ['none', 'none'], label: { show: false },
          lineStyle: { type: 'dashed', width: 1, color: theme.textTertiary }, data: [{ yAxis: .75 }, { yAxis: .5 }] } : undefined })),
    },
  };
}
