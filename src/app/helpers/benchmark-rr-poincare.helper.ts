import type { EChartsCoreOption } from 'echarts/core';
import { DataDuration, DataRRMeanInterval, type RRAnalyzedBeat, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import type { BenchmarkRRChartAnalysis, BenchmarkRRChartOptions, BenchmarkRRChartRecording } from './benchmark-rr-chart.helper';
import { formatBenchmarkRRValue } from './benchmark-rr.helper';
import { buildOfficialEChartsThemeTokens, ECHARTS_GLOBAL_FONT_FAMILY } from './echarts-theme.helper';
import { escapeDashboardEChartsTooltipHtml } from './dashboard-echarts-style.helper';

type PairKind = 'accepted' | 'artifact' | 'suspected-ectopic';
export interface RRPoincarePoint { value: [number, number]; time: number; kind: PairKind; }
export interface RRPoincareSeries { id: string; sourceKey: string; label: string; points: RRPoincarePoint[]; }
export interface RRPoincareSelection { seriesId: string; dataIndex: number; sourceKey: string; label: string; point: RRPoincarePoint; }
export interface RRPoincarePlot {
  option: EChartsCoreOption;
  series: RRPoincareSeries[];
  flagged: RRPoincareSelection[];
  pairCount: number;
  sampled: boolean;
}
const MAX_POINTS = 4000;
const KINDS: PairKind[] = ['accepted', 'artifact', 'suspected-ectopic'];
export const RR_POINCARE_SYMBOLS = {
  solid: { symbol: 'circle', icon: 'circle' }, dashed: { symbol: 'rect', icon: 'square' },
  dotted: { symbol: 'triangle', icon: 'change_history' }, 'dash-dot': { symbol: 'diamond', icon: 'diamond' },
} as const;

/** Pair original neighbours before filtering; invalid observations and segment boundaries break adjacency. */
function eachPair(analysis: BenchmarkRRChartAnalysis, visit: (a: RRAnalyzedBeat, b: RRAnalyzedBeat, kind: PairKind) => void): void {
  let previous: RRAnalyzedBeat | null = null;
  for (const beat of analysis.beats) {
    if (!Number.isFinite(beat.interval) || beat.interval <= 0 || !Number.isFinite(beat.time)) { previous = null; continue; }
    if (previous && beat.time <= previous.time) { previous = null; continue; }
    if (previous && previous.segment === beat.segment) {
      const artifact = (previous.classification !== 'accepted' && previous.classification !== 'suspected-ectopic')
        || (beat.classification !== 'accepted' && beat.classification !== 'suspected-ectopic');
      const kind = artifact ? 'artifact' : previous.classification === 'suspected-ectopic' || beat.classification === 'suspected-ectopic'
        ? 'suspected-ectopic' : 'accepted';
      visit(previous, beat, kind);
    }
    previous = beat;
  }
}

/** Two passes keep allocation bounded even for long recordings. Extents/counts include unsampled points. */
export function buildRRPoincareSeries(analysis: BenchmarkRRChartAnalysis, excludeFlagged: boolean) {
  const counts = { accepted: 0, artifact: 0, 'suspected-ectopic': 0 };
  let min = Infinity, max = -Infinity;
  eachPair(analysis, (a, b, kind) => {
    min = Math.min(min, a.interval, b.interval); max = Math.max(max, a.interval, b.interval);
    if (!excludeFlagged || kind === 'accepted') counts[kind]++;
  });
  const points: Record<PairKind, RRPoincarePoint[]> = { accepted: [], artifact: [], 'suspected-ectopic': [] };
  const seen = { accepted: 0, artifact: 0, 'suspected-ectopic': 0 };
  eachPair(analysis, (a, b, kind) => {
    if (excludeFlagged && kind !== 'accepted') return;
    const index = seen[kind]++;
    const target = counts[kind] <= MAX_POINTS ? index : Math.round(points[kind].length * (counts[kind] - 1) / (MAX_POINTS - 1));
    if (points[kind].length >= MAX_POINTS || index !== target) return;
    points[kind].push({ value: [a.interval, b.interval], time: a.time, kind });
  });
  return { points, min, max, pairCount: KINDS.reduce((sum, kind) => sum + counts[kind], 0),
    sampled: KINDS.some(kind => counts[kind] > MAX_POINTS) };
}

export function formatRRPoincareSelection(selection: RRPoincareSelection, settings?: UserUnitSettingsInterface) {
  const { point } = selection;
  return {
    label: selection.label,
    current: formatBenchmarkRRValue(DataRRMeanInterval.type, point.value[0], settings)?.text ?? 'Unavailable',
    next: formatBenchmarkRRValue(DataRRMeanInterval.type, point.value[1], settings)?.text ?? 'Unavailable',
    time: resolveUnitAwareDisplayStat(new DataDuration(point.time / 1000), settings)?.text ?? '',
    classification: point.kind === 'accepted' ? 'Unflagged' : point.kind === 'artifact' ? 'Artifact flagged' : 'Suspected pair',
  };
}

export function buildRRPoincareChartOptions(input: BenchmarkRRChartOptions & { height: number }): RRPoincarePlot {
  const theme = buildOfficialEChartsThemeTokens(input.darkTheme);
  const origin = input.recordings.reduce((min, source) => Math.min(min, source.startTimeMs), Infinity);
  const data = input.recordings.map(source => ({ source, ...buildRRPoincareSeries(source.analysis, input.excludeFlagged) }));
  const min = data.reduce((min, row) => Math.min(min, row.min), Infinity);
  const max = data.reduce((max, row) => Math.max(max, row.max), -Infinity);
  const pad = Number.isFinite(min) && Number.isFinite(max) ? Math.max(20, (max - min) * .08) : 0;
  const lower = Number.isFinite(min) ? Math.max(0, min - pad) : 0, upper = Number.isFinite(max) ? max + pad : 1;
  const width = Math.max(140, input.width), height = Math.max(140, input.height);
  const plotSize = Math.max(1, Math.min(width - 96, height - 80));
  const series: RRPoincareSeries[] = data.flatMap(({ source, points }) => KINDS.map(kind => ({
    id: `${source.key}:poincare:${kind}`, sourceKey: source.key, label: source.label,
    points: points[kind].map(point => ({ ...point, time: point.time + source.startTimeMs - origin })),
  })));
  const flagged = series.flatMap(row => row.points.flatMap((point, dataIndex) => point.kind !== 'accepted'
    ? [{ seriesId: row.id, sourceKey: row.sourceKey, label: row.label, point, dataIndex }] : []))
    .sort((a, b) => a.point.time - b.point.time || a.sourceKey.localeCompare(b.sourceKey));
  const unit = formatBenchmarkRRValue(DataRRMeanInterval.type, 0, input.unitSettings)?.unit ?? '';
  const axis = { type: 'value' as const, min: lower, max: upper, splitNumber: input.width < 500 ? 3 : 5,
    axisLabel: { hideOverlap: true, showMinLabel: false, showMaxLabel: false, formatter: (value: number) => formatBenchmarkRRValue(DataRRMeanInterval.type, value, input.unitSettings)?.value ?? '' },
    nameTextStyle: { color: theme.textSecondary }, axisTick: { show: false },
    splitLine: { lineStyle: { color: theme.splitLineColor } } };
  const sources = new Map<string, BenchmarkRRChartRecording>(input.recordings.map(source => [source.key, source]));
  return {
    series, flagged, pairCount: data.reduce((sum, row) => sum + row.pairCount, 0), sampled: data.some(row => row.sampled),
    option: { animation: false, backgroundColor: 'transparent', textStyle: { fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
      grid: { left: 68 + (width - 96 - plotSize) / 2, top: 18 + (height - 80 - plotSize) / 2, width: plotSize, height: plotSize },
      xAxis: { ...axis, name: `Current R–R interval (${unit})`, nameLocation: 'middle', nameGap: 35 },
      yAxis: { ...axis, name: `Next R–R interval (${unit})`, nameLocation: 'middle', nameGap: 52 },
      aria: { enabled: true, label: { description: 'Consecutive R–R intervals within each recording. Crosses flag artifacts and rings flag suspected pairs. Both axes have equal interval scales.' } },
      tooltip: { trigger: 'item', confine: true, backgroundColor: theme.tooltipBackgroundColor, borderColor: theme.tooltipBorderColor,
        textStyle: { color: theme.tooltipTextColor }, formatter: (params: unknown) => {
          const event = params as { seriesId?: string; dataIndex?: number };
          const row = series.find(row => row.id === event?.seriesId), point = row?.points[event?.dataIndex ?? -1];
          if (!row || !point) return '';
          const value = formatRRPoincareSelection({ ...row, seriesId: row.id, point, dataIndex: event.dataIndex! }, input.unitSettings);
          return [value.label, `Elapsed ${value.time}`, value.classification, `Current: ${value.current}`, `Next: ${value.next}`]
            .map(escapeDashboardEChartsTooltipHtml).join('<br>');
        } },
      series: [
        { id: 'poincare-identity', type: 'line', data: [[lower, lower], [upper, upper]], showSymbol: false, silent: true,
          lineStyle: { color: theme.textTertiary, width: 1, type: 'dashed' }, tooltip: { show: false }, z: 0 },
        ...series.map(row => {
          const source = sources.get(row.sourceKey)!, kind = row.id.split(':').at(-1);
          return { id: row.id, name: row.label, type: 'scatter' as const, data: row.points,
            symbol: kind === 'artifact' ? 'path://M-5,-3L-3,-5L0,-2L3,-5L5,-3L2,0L5,3L3,5L0,2L-3,5L-5,3L-2,0Z'
              : kind === 'suspected-ectopic' ? 'emptyCircle' : RR_POINCARE_SYMBOLS[source.lineStyle].symbol,
            symbolSize: kind === 'accepted' ? 3 : 8,
            itemStyle: { color: source.color, opacity: kind === 'accepted' ? .45 : .95 },
            emphasis: { scale: 1.6 }, z: kind === 'accepted' ? 2 : 4 };
        }),
      ],
    },
  };
}
