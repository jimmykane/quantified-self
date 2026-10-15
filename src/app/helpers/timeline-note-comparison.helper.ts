import { HEALTH_METRIC_IDS, type HealthMetricId } from '@shared/health';
import { HRV_PERSONAL_RANGE_VARIANTS } from '@shared/personal-metric-range';
import { formatCanonicalHealthMetricSportsLibValue, formatCanonicalSleepMetricSportsLibValue } from '@shared/sports-lib-health-data';
import { isTimelineDate, timelineToday, type TimelineNote, type TimelineNoteRange } from '@shared/timeline-notes';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { HealthWorkspaceSeries, HealthWorkspaceSeriesPoint } from './health-workspace.helper';
import { getDateTimeFormatter } from './date-time-format.helper';

export const NOTE_COMPARISON_WINDOWS = [7, 14, 28] as const;
export type NoteComparisonDays = typeof NOTE_COMPARISON_WINDOWS[number];
export const NOTE_COMPARISON_METRICS = [
  { id: HEALTH_METRIC_IDS.SleepDuration, label: 'Sleep duration', countLabel: 'nights' },
  { id: HEALTH_METRIC_IDS.HeartRateVariability, label: 'Nightly HRV', countLabel: 'nights' },
  { id: HEALTH_METRIC_IDS.RestingHeartRate, label: 'Daily resting heart rate', countLabel: 'days' },
] as const;
export type NoteComparisonMetric = typeof NOTE_COMPARISON_METRICS[number]['id'];
export interface NoteComparisonWindow {
  days: NoteComparisonDays;
  anchor: string;
  timeZone: string;
  before: TimelineNoteRange;
  after: TimelineNoteRange;
  today: string;
  incomplete: boolean;
  minimumDays: number;
}
export type NoteComparisonStatus = 'comparable' | 'in-progress' | 'unavailable' | 'conflicting'
  | 'no-source' | 'source-unavailable' | 'insufficient' | 'mixed-devices' | 'calendar-mismatch';
export interface NoteComparisonRow {
  metricId: NoteComparisonMetric;
  label: string;
  countLabel: string;
  choices: readonly HealthWorkspaceSeries[];
  selectedKey: string | null;
  series: HealthWorkspaceSeries | null;
  before: number | null;
  after: number | null;
  beforeCount: number;
  afterCount: number;
  difference: number | null;
  status: NoteComparisonStatus;
  reason: string;
  dailySeries: HealthWorkspaceSeries | null;
}
const DAY = 86_400_000;

/** Calendar carriers only, never an elapsed-day calculation in a local timezone. */
export function addComparisonDays(date: string, days: number): string {
  if (!isTimelineDate(date)) throw new Error('Invalid comparison date.');
  const result = new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  if (!isTimelineDate(result)) throw new Error('Comparison date is outside the supported calendar.');
  return result;
}
export function comparisonDateCarrier(date: string): number { return Date.parse(`${date}T12:00:00Z`); }
export function comparisonDateLabel(date: string): string {
  return getDateTimeFormatter(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(comparisonDateCarrier(date));
}
export function noteComparisonWindow(note: Pick<TimelineNote, 'startDate' | 'timeZone'>,
  days: NoteComparisonDays, nowMs = Date.now()): NoteComparisonWindow {
  if (!NOTE_COMPARISON_WINDOWS.includes(days) || !isTimelineDate(note.startDate)) throw new Error('Invalid comparison window.');
  const today = timelineToday(note.timeZone, nowMs);
  const after = { startDate: addComparisonDays(note.startDate, 1), endDate: addComparisonDays(note.startDate, days) };
  return { days, anchor: note.startDate, timeZone: note.timeZone,
    before: { startDate: addComparisonDays(note.startDate, -days), endDate: addComparisonDays(note.startDate, -1) },
    after, today, incomplete: after.endDate >= today, minimumDays: Math.ceil(days * 0.7) };
}
function eligible(series: HealthWorkspaceSeries, metric: NoteComparisonMetric): boolean {
  if (series.metricId !== metric || series.nativeOnly || series.sampleBased || series.valueType !== 'number') return false;
  if (metric === HEALTH_METRIC_IDS.SleepDuration) return series.semanticVariant === 'session_duration';
  if (metric === HEALTH_METRIC_IDS.RestingHeartRate) return series.semanticVariant === 'daily_resting';
  return (HRV_PERSONAL_RANGE_VARIANTS as readonly string[]).includes(series.semanticVariant);
}
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
}
/** Equal-weight recorded days. Source dates retain their meaning; no upload/viewer-date rebucketing. */
function dailyPoints(series: HealthWorkspaceSeries, window: NoteComparisonWindow): HealthWorkspaceSeriesPoint[] {
  const dates = new Map<string, number[]>();
  for (const point of series.points) {
    if (!isTimelineDate(point.calendarDate) || !Number.isFinite(new Date(point.timestampMs).getTime())
      || typeof point.value !== 'number' || !Number.isFinite(point.value) || point.value < 0
      || point.calendarDate < window.before.startDate || point.calendarDate > window.after.endDate
      || point.calendarDate === window.anchor || point.calendarDate >= window.today
      || point.qualityCode === 'invalid') continue;
    const values = dates.get(point.calendarDate) || [];
    values.push(point.value); dates.set(point.calendarDate, values);
  }
  return [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([calendarDate, values]) => ({
    calendarDate, timestampMs: comparisonDateCarrier(calendarDate), timezoneOffsetSeconds: 0,
    value: median(values)!, qualityCode: null,
  }));
}
export function buildNoteComparisonRows(series: readonly HealthWorkspaceSeries[], window: NoteComparisonWindow,
  complete: Readonly<Partial<Record<NoteComparisonMetric, boolean>>>,
  selected: Readonly<Partial<Record<NoteComparisonMetric, string>>> = {}): NoteComparisonRow[] {
  return NOTE_COMPARISON_METRICS.map(metric => {
    const candidates = series.filter(value => eligible(value, metric.id)).map(value => {
      const points = dailyPoints(value, window);
      return { series: value, points,
        before: points.filter(point => point.calendarDate < window.anchor).map(point => point.value as number),
        after: points.filter(point => point.calendarDate > window.anchor).map(point => point.value as number) };
    }).filter(candidate => candidate.points.length > 0);
    const choices = candidates.map(candidate => candidate.series);
    // Prefer evidence on both sides, then coverage. Never choose one source per side.
    const ranked = [...candidates].sort((a, b) =>
      Number(b.before.length > 0 && b.after.length > 0) - Number(a.before.length > 0 && a.after.length > 0)
      || Math.min(b.before.length, b.after.length) - Math.min(a.before.length, a.after.length)
      || b.points.length - a.points.length || a.series.id.localeCompare(b.series.id));
    const key = selected[metric.id] ?? ranked[0]?.series.id ?? null;
    const chosen = candidates.find(candidate => candidate.series.id === key);
    const before = median(chosen?.before || []), after = median(chosen?.after || []);
    const calendarMismatch = chosen?.series.points.some(point => {
      const offset = point.timezoneOffsetSeconds;
      if (offset == null || !Number.isFinite(offset) || Math.abs(offset) > 14 * 3600
        || !Number.isFinite(new Date(point.timestampMs).getTime())
        || point.calendarDate < window.before.startDate || point.calendarDate > window.after.endDate
        || point.calendarDate === window.anchor || point.calendarDate >= window.today) return false;
      // Compare known recorded/view-zone calendar conventions, not an interval summary's inclusive/exclusive end date.
      return new Date(point.timestampMs + offset * 1000).toISOString().slice(0, 10)
        !== timelineToday(window.timeZone, point.timestampMs);
    });
    const status: NoteComparisonStatus = !complete[metric.id] ? 'unavailable'
      : !key ? 'no-source' : !chosen ? 'source-unavailable'
      : chosen.series.hasConflict ? 'conflicting' : chosen.series.deviceLabel === 'Multiple devices' ? 'mixed-devices'
      : calendarMismatch ? 'calendar-mismatch' : window.incomplete ? 'in-progress'
      : (chosen.before.length < window.minimumDays || chosen.after.length < window.minimumDays) ? 'insufficient' : 'comparable';
    const reasons: Record<NoteComparisonStatus, string> = { comparable: 'Same source',
      'in-progress': 'After window in progress', unavailable: 'Read failed or reached its limit',
      conflicting: 'Conflicting source readings', 'no-source': 'No eligible source',
      'source-unavailable': 'Selected source unavailable', insufficient: 'Too few same-source days',
      'mixed-devices': 'Multiple reported devices', 'calendar-mismatch': 'Recorded timezone dates differ' };
    return { metricId: metric.id, label: metric.label, countLabel: metric.countLabel, choices, selectedKey: key,
      series: chosen?.series || null, before, after, beforeCount: chosen?.before.length || 0,
      afterCount: chosen?.after.length || 0, difference: status === 'comparable' ? after! - before! : null,
      status, reason: reasons[status], dailySeries: chosen ? { ...chosen.series, chartKind: 'line', points: chosen.points } : null };
  });
}
/** Both the canonical value and unit come from the same Sports Lib display. */
export function comparisonValueText(metric: HealthMetricId, value: number | null,
  units: UserUnitSettingsInterface | null = null, signed = false): string {
  if (value === null) return '—';
  const display = metric === HEALTH_METRIC_IDS.SleepDuration
    ? formatCanonicalSleepMetricSportsLibValue('duration', Math.abs(value), units, { compactDuration: true })
    : formatCanonicalHealthMetricSportsLibValue(metric, Math.abs(value), units);
  if (!display) return '—';
  const prefix = signed ? value < 0 ? '−' : value > 0 ? '+' : '' : value < 0 ? '−' : '';
  return `${prefix}${display.value}${display.unit ? ` ${display.unit}` : ''}`;
}
