import type { EChartsType } from 'echarts/core';
import { timelineNoteEnd, timelineNoteDates, TIMELINE_NOTE_LABELS, type TimelineNote, type TimelineNoteRange } from '@shared/timeline-notes';
import { escapeDashboardEChartsTooltipHtml } from './dashboard-echarts-style.helper';

type Option = Parameters<EChartsType['setOption']>[0];
export interface TimelineNoteChartContext {
  notes: readonly TimelineNote[];
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
interface Axis { type?: string; min?: unknown; max?: unknown; data?: unknown[]; gridIndex?: number; axisLabel?: { color?: string } }
interface Series { name?: string; xAxisIndex?: number; yAxisIndex?: number; data?: unknown[] }
interface NoteGroup { startDate: string; endDate: string; notes: TimelineNote[] }
interface Projection { range: TimelineNoteRange; x: (date: string, end: boolean) => number | null }
const DAY = 86_400_000;

function day(ms: number, offsetSeconds = 0): string { return new Date(ms + offsetSeconds * 1000).toISOString().slice(0, 10); }
function addDays(date: string, amount: number): string { return day(Date.parse(`${date}T00:00:00Z`) + amount * DAY); }
function projection(axis: Axis, series: Series[], hints: TimelineNoteAxisHints): Projection | null {
  if (axis.type === 'category') {
    const dates = hints.categoryDates ?? axis.data?.map(value => typeof value === 'number' ? day(value) : '');
    if (!dates?.length || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date))) return null;
    const days = hints.bucketDays ?? 1;
    return { range: { startDate: [...dates].sort()[0], endDate: addDays([...dates].sort().at(-1)!, days - 1) },
      x: (date, end) => {
        const indexes = dates.map((start, i) => ({ start, end: addDays(start, days - 1), i }))
          .filter(bucket => end ? bucket.start <= date : bucket.end >= date);
        if (!indexes.length) return null;
        return end ? indexes.at(-1)!.i : indexes[0].i;
      } };
  }
  if (axis.type !== 'time') return null;
  const values = series.flatMap(item => item.data ?? []).map(value => Array.isArray(value) ? Number(value[0]) : NaN).filter(Number.isFinite);
  const min = typeof axis.min === 'number' ? axis.min : values.length ? values.reduce((a, b) => Math.min(a, b), Infinity) : NaN;
  const max = typeof axis.max === 'number' ? axis.max : values.length ? values.reduce((a, b) => Math.max(a, b), -Infinity) : NaN;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  const offset = hints.offsetSeconds ?? (() => 0);
  return { range: { startDate: day(min, offset(min)), endDate: addDays(day(max, offset(max)), (hints.bucketDays ?? 1) - 1) },
    x: (date, end) => {
      const utc = Date.parse(`${date}T00:00:00Z`) + (end ? DAY - 1 : 0);
      // Resolve against the chart's existing recorded-offset convention, not the viewer's timezone.
      const initial = utc - offset(utc) * 1000;
      return Math.max(min, Math.min(max, utc - offset(initial) * 1000));
    } };
}

export function groupTimelineNotes(notes: readonly TimelineNote[], range: TimelineNoteRange, nowMs = Date.now()): NoteGroup[] {
  const sorted = notes.map(note => ({ note, end: timelineNoteEnd(note, nowMs) }))
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
export function addTimelineNotesToChart(option: Option, notes: readonly TimelineNote[], hints: TimelineNoteAxisHints = {}, nowMs = Date.now()): {
  option: Option; range: TimelineNoteRange | null; groups: Map<string, readonly TimelineNote[]>;
} {
  const axes: Axis[] = option.xAxis ? (Array.isArray(option.xAxis) ? option.xAxis : [option.xAxis]) as Axis[] : [];
  const originalSeries = (Array.isArray(option.series) ? option.series : option.series ? [option.series] : []) as Series[];
  const groups = new Map<string, readonly TimelineNote[]>();
  const overlays: unknown[] = [];
  let range: TimelineNoteRange | null = null;
  axes.forEach((axis, axisIndex) => {
    const matchingSeries = originalSeries.filter(series => (series.xAxisIndex ?? 0) === axisIndex);
    if (!matchingSeries.length) return;
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
      // Different calendar days can share a weekly bucket or clipped endpoint. Keep one selectable marker.
      const existing = positions.get(start);
      const hasPeriod = group.startDate !== group.endDate;
      if (existing) {
        existing.notes.push(...group.notes);
        existing.end = Math.max(existing.end, end);
        existing.hasPeriod ||= hasPeriod;
      } else positions.set(start, { end, notes: [...group.notes], hasPeriod });
    });
    positions.forEach((group, start) => {
      const name = `timeline-note-${axisIndex}-${markers.length}`;
      groups.set(name, group.notes);
      const text = group.notes.map(note => `${TIMELINE_NOTE_LABELS[note.category]}: ${note.title} · ${timelineNoteDates(note)}`).join('\n');
      const tooltip = { show: true, trigger: 'item', formatter: () => escapeDashboardEChartsTooltipHtml(text).replace(/\n/g, '<br>') };
      const color = (option.textStyle as { color?: string } | undefined)?.color ?? axis.axisLabel?.color;
      markers.push({ name, xAxis: start, symbol: ['circle', 'none'], symbolSize: 8,
        lineStyle: { opacity: 0.2, color, type: 'dotted' }, itemStyle: { color },
        label: { show: true, position: 'insideStartTop', rotate: 0, opacity: 1, formatter: group.notes.length > 1 ? `${group.notes.length} notes` : 'Note', color, fontSize: 11 }, tooltip });
      if (group.hasPeriod) area.push([{ name, xAxis: start, itemStyle: { color, opacity: 0.055 }, tooltip }, { xAxis: group.end }]);
    });
    if (markers.length) overlays.push({ id: `timeline-note-overlay-${axisIndex}`, name: '', type: 'line', data: [],
      xAxisIndex: axisIndex, yAxisIndex: matchingSeries[0].yAxisIndex ?? 0, animation: false,
      markLine: { silent: false, symbol: ['circle', 'none'], symbolSize: 8, data: markers }, markArea: { silent: false, label: { show: false }, data: area } });
  });
  return { option: overlays.length ? { ...option, series: [...originalSeries, ...overlays] } as Option : option, range, groups };
}

/** No fetching here. The owning workspace supplies notes and handles navigation. */
export class TimelineNotesChartBinding {
  private context: TimelineNoteChartContext | null = null;
  private hints: TimelineNoteAxisHints = {};
  private chart: EChartsType | null = null;
  private groups = new Map<string, readonly TimelineNote[]>();
  private rangeKey = '';
  private readonly click = (event: { name?: string; componentType?: string }): void => {
    if (event.componentType !== 'markLine' && event.componentType !== 'markArea') return;
    const notes = this.groups.get(event.name ?? '');
    if (notes) { this.chart?.dispatchAction?.({ type: 'hideTip' }); this.context?.select(notes); }
  };
  set(context: TimelineNoteChartContext | null, hints: TimelineNoteAxisHints = {}): void {
    if (this.context?.reportRange !== context?.reportRange) { this.context?.reportRange(this, null); this.rangeKey = ''; }
    this.context = context; this.hints = hints;
  }
  apply(chart: EChartsType, option: Option): Option {
    if (!this.context) { this.detach(); return option; }
    if (this.chart !== chart) { this.detach(); this.chart = chart; chart.on('click', this.click); }
    const result = addTimelineNotesToChart(option, this.context.notes, this.hints);
    this.groups = result.groups;
    const key = JSON.stringify(result.range);
    if (key !== this.rangeKey) { this.rangeKey = key; this.context.reportRange(this, result.range); }
    return result.option;
  }
  detach(): void { this.chart?.off('click', this.click); this.chart = null; this.groups.clear(); }
  dispose(): void { this.detach(); this.context?.reportRange(this, null); this.context = null; this.rangeKey = ''; }
}
