import type { EChartsType } from 'echarts/core';
import { isTimelineNoteVisible, timelineNoteEnd, timelineNoteDates, TIMELINE_NOTE_LABELS, type TimelineNote, type TimelineNoteRange } from '@shared/timeline-notes';
import {
  buildDashboardEChartsStyleTokens,
  buildDashboardEChartsTooltipChrome,
  renderDashboardEChartsTooltipCard,
  type DashboardEChartsStyleTokens,
} from './dashboard-echarts-style.helper';
import { timelineNoteGroupColor } from './timeline-note-appearance.helper';

type Option = Parameters<EChartsType['setOption']>[0];
export interface TimelineNoteChartContext {
  /** Private workspace owner. Omitted only for explicit synthetic previews. */
  ownerUid?: string | null;
  notes: readonly TimelineNote[];
  /** Optional bounded current-day projection, independent of a capped chart-history scan. */
  currentNotes?: readonly TimelineNote[];
  /** Resolve a moving calendar window at read time, before foreground revalidation starts. */
  reportCurrentRange?: (key: object, range: (() => TimelineNoteRange) | null) => void;
  select: (notes: readonly TimelineNote[]) => void;
  reportRange: (key: object, range: TimelineNoteRange | null) => void;
}
export interface TimelineNoteAxisHints {
  /** Sleep uses normalized sleepDate, never the display category or viewer timezone. */
  categoryDates?: readonly string[];
  bucketDays?: number;
  /** Health preserves the recorded timezone nearest each timestamp. */
  offsetSeconds?: (timestampMs: number) => number;
}
interface Axis { type?: string; min?: unknown; max?: unknown; data?: unknown[]; gridIndex?: number; boundaryGap?: boolean; inverse?: boolean; axisLabel?: { color?: string } }
interface Series { name?: string; xAxisIndex?: number; yAxisIndex?: number; data?: unknown[] }
interface NoteOverlaySeries { id: string; [key: string]: unknown }
interface NoteGroup { startDate: string; endDate: string; notes: TimelineNote[] }
interface Projection { range: TimelineNoteRange; x: (date: string, end: boolean) => number | null; fraction: (x: number) => number }
const DAY = 86_400_000;

function day(ms: number, offsetSeconds = 0): string { return new Date(ms + offsetSeconds * 1000).toISOString().slice(0, 10); }
function addDays(date: string, amount: number): string { return day(Date.parse(`${date}T00:00:00Z`) + amount * DAY); }
function projection(axis: Axis, series: Series[], hints: TimelineNoteAxisHints): Projection | null {
  if (axis.type === 'category') {
    const dates = hints.categoryDates ?? axis.data?.map(value => typeof value === 'number' ? day(value) : '');
    if (!dates?.length || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date))) return null;
    const days = hints.bucketDays ?? 1;
    return { range: { startDate: [...dates].sort()[0], endDate: addDays([...dates].sort().at(-1)!, days - 1) },
      fraction: x => axis.boundaryGap !== false ? (x + 0.5) / dates.length : dates.length > 1 ? x / (dates.length - 1) : 0.5,
      x: (date, end) => {
        const indexes = dates.map((start, i) => ({ start, end: addDays(start, days - 1), i }))
          .filter(bucket => end ? bucket.start <= date : bucket.end >= date);
        if (!indexes.length) return null;
        return end ? indexes.at(-1)!.i : indexes[0].i;
      } };
  }
  if (axis.type !== 'time') return null;
  // Most chart models already bound their time axis; note edits need not traverse their readings.
  const values = typeof axis.min === 'number' && typeof axis.max === 'number' ? []
    : series.flatMap(item => item.data ?? []).map(value => Array.isArray(value) ? Number(value[0]) : NaN).filter(Number.isFinite);
  const min = typeof axis.min === 'number' ? axis.min : values.length ? values.reduce((a, b) => Math.min(a, b), Infinity) : NaN;
  const max = typeof axis.max === 'number' ? axis.max : values.length ? values.reduce((a, b) => Math.max(a, b), -Infinity) : NaN;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  const offset = hints.offsetSeconds ?? (() => 0);
  return { range: { startDate: day(min, offset(min)), endDate: addDays(day(max, offset(max)), (hints.bucketDays ?? 1) - 1) },
    fraction: x => min === max ? 0.5 : (x - min) / (max - min),
    x: (date, end) => {
      const utc = Date.parse(`${date}T00:00:00Z`) + (end ? DAY - 1 : 0);
      // Resolve against the chart's existing recorded-offset convention, not the viewer's timezone.
      const initial = utc - offset(utc) * 1000;
      return Math.max(min, Math.min(max, utc - offset(initial) * 1000));
    } };
}

function noteLabelLayout(option: Option, axis: Axis, fraction: number, chartWidth: number, maxWidth: number, inverseY: boolean, markerPixel?: number) {
  const grids = Array.isArray(option.grid) ? option.grid : [option.grid];
  const grid = grids[axis.gridIndex ?? 0];
  const pixels = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\d+(\.\d+)?%$/.test(value)) return chartWidth * parseFloat(value) / 100;
    return fallback;
  };
  const plotWidth = Math.max(0, pixels(grid?.width, chartWidth
    - pixels(grid?.left, chartWidth * 0.1) - pixels(grid?.right, chartWidth * 0.1)));
  const anchor = Number.isFinite(markerPixel) ? markerPixel! - pixels(grid?.left, chartWidth * 0.1) : plotWidth * fraction;
  const leftSpace = Math.max(0, anchor - 6);
  const rightSpace = Math.max(0, plotWidth - anchor - 6);
  const faceLeft = plotWidth > 0 ? rightSpace < maxWidth && leftSpace > rightSpace : fraction > 0.5;
  return {
    // Reversed value axes start at the top. Keep titles at the plot's bottom endpoint;
    // native insideEnd placement reverses the horizontal distance from that endpoint.
    position: inverseY ? 'insideEndTop' as const : 'insideStartTop' as const,
    align: faceLeft ? 'right' as const : 'left' as const,
    distance: [(faceLeft ? -6 : 6) * (inverseY ? -1 : 1), 6],
    width: plotWidth > 0 ? Math.min(maxWidth, faceLeft ? leftSpace : rightSpace) : maxWidth,
  };
}

export function groupTimelineNotes(notes: readonly TimelineNote[], range: TimelineNoteRange, nowMs = Date.now()): NoteGroup[] {
  const sorted = notes.filter(isTimelineNoteVisible).map(note => ({ note, end: timelineNoteEnd(note, nowMs) }))
    .filter(({ note, end }) => note.startDate <= range.endDate && end >= range.startDate)
    .sort((a, b) => a.note.startDate.localeCompare(b.note.startDate) || a.note.id.localeCompare(b.note.id));
  const groups: NoteGroup[] = [];
  for (const { note, end } of sorted) {
    const startDate = note.startDate < range.startDate ? range.startDate : note.startDate;
    const endDate = end > range.endDate ? range.endDate : end;
    const last = groups.at(-1);
    if (last && startDate <= last.endDate) { last.notes.push(note); if (endDate > last.endDate) last.endDate = endDate; }
    else groups.push({ startDate, endDate, notes: [note] });
  }
  return groups;
}

/** Appends empty marker series; metric data, axes, reference bands and formulas are untouched. */
export function addTimelineNotesToChart(option: Option, notes: readonly TimelineNote[], hints: TimelineNoteAxisHints = {}, nowMs = Date.now(),
  style: DashboardEChartsStyleTokens = buildDashboardEChartsStyleTokens(false, 0), chartWidth = 0,
  markerPixel?: (axisIndex: number, value: number) => number | undefined): {
  option: Option; range: TimelineNoteRange | null; groups: Map<string, readonly TimelineNote[]>; overlays: NoteOverlaySeries[]; layoutKey: string;
} {
  const axes: Axis[] = option.xAxis ? (Array.isArray(option.xAxis) ? option.xAxis : [option.xAxis]) as Axis[] : [];
  const yAxes: Axis[] = option.yAxis ? (Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis]) as Axis[] : [];
  const originalSeries = (Array.isArray(option.series) ? option.series : option.series ? [option.series] : []) as Series[];
  const groups = new Map<string, readonly TimelineNote[]>();
  const overlays: NoteOverlaySeries[] = [];
  const layouts: unknown[] = [];
  let range: TimelineNoteRange | null = null;
  axes.forEach((axis, axisIndex) => {
    const matchingSeries = originalSeries.filter(series => (series.xAxisIndex ?? 0) === axisIndex);
    if (!matchingSeries.length) return;
    const yAxisIndex = matchingSeries[0].yAxisIndex ?? 0;
    const projected = projection(axis, matchingSeries, hints);
    if (!projected) return;
    range = range ? { startDate: range.startDate < projected.range.startDate ? range.startDate : projected.range.startDate,
      endDate: range.endDate > projected.range.endDate ? range.endDate : projected.range.endDate } : projected.range;
    const area: unknown[] = [];
    const markers: unknown[] = [];
    const positions = new Map<number, { end: number; notes: TimelineNote[]; hasPeriod: boolean }>();
    groupTimelineNotes(notes, projected.range, nowMs).forEach(group => {
      const start = projected.x(group.startDate, false);
      const end = projected.x(group.endDate, true);
      if (start === null || end === null || start > end) return;
      // Different calendar days can share a weekly bucket or clipped endpoint. Keep one tooltip marker.
      const existing = positions.get(start);
      // Clipping a period to a one-day view must not turn it into a point
      // note. Preserve its original duration, including newly ongoing notes.
      const hasPeriod = group.notes.some(note => note.endDate === null || note.startDate !== note.endDate);
      if (existing) {
        existing.notes.push(...group.notes);
        existing.end = Math.max(existing.end, end);
        existing.hasPeriod ||= hasPeriod;
      } else positions.set(start, { end, notes: [...group.notes], hasPeriod });
    });
    let groupIndex = 0;
    positions.forEach((group, start) => {
      const index = groupIndex++;
      const name = `timeline-note-${axisIndex}-${index}`;
      groups.set(name, group.notes);
      const tooltip = {
        ...buildDashboardEChartsTooltipChrome(style),
        show: true,
        trigger: 'item',
        formatter: () => group.notes.map(note => renderDashboardEChartsTooltipCard(style, {
          title: `${TIMELINE_NOTE_LABELS[note.category]}: ${note.title}`,
          subtitle: timelineNoteDates(note),
          stackHeader: true,
        })).join(''),
      };
      const labelColor = (option.textStyle as { color?: string } | undefined)?.color ?? axis.axisLabel?.color;
      const color = timelineNoteGroupColor(group.notes);
      const label = group.notes.length > 1 ? `${group.notes.length} notes` : group.notes[0].title.replace(/\s+/g, ' ');
      // A period collapsed into one weekly bucket still needs only one tooltip marker.
      const showPeriod = group.hasPeriod && start < group.end;
      const startsBeforeWindow = group.notes.some(note => note.startDate < projected.range.startDate);
      const hasOpenEnd = group.notes.some(note => note.endDate === null || note.endDate > projected.range.endDate);
      const labelLayout = noteLabelLayout(option, axis, projected.fraction(start), chartWidth,
        style.isCompactLayout ? 100 : 160, yAxes[yAxisIndex]?.inverse === true, markerPixel?.(axisIndex, start));
      layouts.push([axisIndex, start, labelLayout]);
      markers.push({ name, xAxis: start,
        symbol: showPeriod ? startsBeforeWindow ? 'emptyCircle' : 'arrow' : 'circle',
        symbolRotate: showPeriod && !startsBeforeWindow ? -90 : 0, symbolSize: showPeriod ? 10 : 8,
        lineStyle: { opacity: showPeriod ? 0.45 : 0.2, color, type: 'dotted' }, itemStyle: { color },
        label: { show: true, rotate: 0, opacity: 1,
          ...labelLayout,
          // A callback keeps literal title text such as {b} out of ECharts' template interpolation.
          formatter: () => label, overflow: 'truncate', ellipsis: '…',
          offset: [0, style.isCompactLayout && index % 2 ? -14 : 0],
          color: labelColor, fontSize: 11 }, tooltip });
      if (showPeriod) markers.push({ name, xAxis: group.end, symbol: hasOpenEnd ? 'emptyCircle' : 'arrow',
        symbolRotate: hasOpenEnd ? 0 : 90, symbolSize: 10,
        lineStyle: { opacity: 0.45, color, type: 'dotted' }, itemStyle: { color }, label: { show: false }, tooltip });
      if (group.hasPeriod) area.push([{ name, xAxis: start, itemStyle: { color, opacity: 0.055 } }, { xAxis: group.end }]);
    });
    if (markers.length) overlays.push({ id: `timeline-note-overlay-${axisIndex}`, name: '', type: 'line', data: [],
      xAxisIndex: axisIndex, yAxisIndex, animation: false,
      markLine: { silent: false, symbol: ['circle', 'none'], symbolSize: 8, data: markers },
      // Period fills must not intercept axis tooltips or taps intended for metric readings.
      // Note tooltips remain on the title and boundary markers.
      markArea: { silent: true, tooltip: { show: false }, emphasis: { disabled: true }, label: { show: false }, data: area } });
  });
  return { option: overlays.length ? { ...option, series: [...originalSeries, ...overlays] } as Option : option,
    range, groups, overlays, layoutKey: JSON.stringify(layouts) };
}

/** No fetching or navigation here. The owning workspace supplies notes for tooltips. */
export class TimelineNotesChartBinding {
  private context: TimelineNoteChartContext | null = null;
  private hints: TimelineNoteAxisHints = {};
  private rangeKey = '';
  private baseOption: Option | null = null;
  private overlayIds: string[] = [];
  private layoutKey = '';
  get hasLabels(): boolean { return !!this.context && this.overlayIds.length > 0; }
  set(context: TimelineNoteChartContext | null, hints: TimelineNoteAxisHints = this.hints): void {
    if (this.context?.reportRange !== context?.reportRange) { this.context?.reportRange(this, null); this.rangeKey = ''; }
    this.context = context; this.hints = hints;
  }
  apply(chart: EChartsType, option: Option, darkTheme = false): Option {
    this.baseOption = option;
    this.overlayIds = [];
    if (!this.context) return option;
    const result = this.project(chart, option, darkTheme);
    this.layoutKey = result.layoutKey;
    this.overlayIds = result.overlays.map(overlay => overlay.id);
    return result.option;
  }
  /** Merge only our marker series; never resend metric data, axes, zoom or legends. */
  update(chart: EChartsType, darkTheme = false): Option | null {
    if (!this.baseOption) return null;
    const result = this.context ? this.project(chart, this.baseOption, darkTheme, true) : null;
    const overlays = result?.overlays ?? [];
    this.layoutKey = result?.layoutKey ?? '';
    const ids = new Set(overlays.map(overlay => overlay.id));
    const cleared = this.overlayIds.filter(id => !ids.has(id)).map(id => ({
      id, markLine: { data: [] }, markArea: { data: [] },
    }));
    this.overlayIds = [...ids];
    return overlays.length || cleared.length ? { series: [...overlays, ...cleared] } as Option : null;
  }
  /** Refine after native layout (including automatic axis-label margins), once per changed geometry. */
  updateLayout(chart: EChartsType, darkTheme = false): Option | null {
    if (!this.baseOption || !this.context || !this.overlayIds.length) return null;
    const result = this.project(chart, this.baseOption, darkTheme, true);
    if (result.layoutKey === this.layoutKey) return null;
    this.layoutKey = result.layoutKey;
    return { series: result.overlays } as Option;
  }
  private project(chart: EChartsType, option: Option, darkTheme: boolean, rendered = false): ReturnType<typeof addTimelineNotesToChart> {
    const style = buildDashboardEChartsStyleTokens(darkTheme, chart.getWidth());
    const result = addTimelineNotesToChart(option, this.context!.notes, this.hints, Date.now(), style, chart.getWidth(),
      rendered && chart.convertToPixel ? (axisIndex, value) => {
        const pixel = chart.convertToPixel({ xAxisIndex: axisIndex }, value);
        return typeof pixel === 'number' ? pixel : undefined;
      } : undefined);
    const key = JSON.stringify(result.range);
    if (key !== this.rangeKey) { this.rangeKey = key; this.context.reportRange(this, result.range); }
    return result;
  }
  dispose(): void {
    this.context?.reportRange(this, null);
    this.context = null; this.hints = {}; this.rangeKey = '';
    this.baseOption = null; this.overlayIds = []; this.layoutKey = '';
  }
}
