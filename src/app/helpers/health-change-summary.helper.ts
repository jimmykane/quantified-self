import type { PersonalMetricRangeTone } from '@shared/personal-metric-range';
import type { AppHealthHighlightSources } from '../models/app-user.interface';
import type { HealthPriorityCardView } from '../components/health/health-priority-summary.component';
import { selectDefaultHealthSourceKey } from './health-source-selection.helper';
import { getDateTimeFormatter } from './date-time-format.helper';

export type HealthChangeState = 'outside-range' | 'within-range' | 'insufficient' | 'recorded' | 'loading' | 'unavailable';

/** Presentation of existing evidence only. This is not an anomaly detector or a score. */
export interface HealthChangeSignal {
  id: string;
  label: string;
  sourceLabel: string;
  state: HealthChangeState;
  statusText: string;
  detailText: string;
}

interface PersonalRangeSummary {
  tone: PersonalMetricRangeTone;
  currentAverage: number | null;
  normalRange: { min: number; max: number } | null;
}

export function personalRangeChangeState(range: PersonalRangeSummary | null | undefined): HealthChangeState {
  if (!range || range.currentAverage === null || !Number.isFinite(range.currentAverage)
    || !range.normalRange || !Number.isFinite(range.normalRange.min) || !Number.isFinite(range.normalRange.max)
    || range.normalRange.min > range.normalRange.max) return 'insufficient';
  if (range.tone === 'positive') return 'within-range';
  if (range.tone === 'caution' || range.tone === 'negative') return 'outside-range';
  return 'insufficient';
}

/** Attribution only: never guess from a separately selected/paged chart. */
export function resolveHealthChangeSourceLabel(
  sources: readonly { id: string; sourceKey?: string; providerLabel: string }[],
  hasEvidence: boolean,
): string {
  if (!hasEvidence) return 'No eligible current source';
  if (!sources.length) return 'Source attribution unavailable';
  const identities = new Set(sources.map(source => JSON.stringify([source.providerLabel, source.sourceKey || source.id])));
  return identities.size === 1 ? sources[0].providerLabel : 'Multiple recorded sources';
}

export function buildHealthChangeSummary(signals: readonly HealthChangeSignal[]) {
  const changes = signals.filter(signal => signal.state === 'outside-range');
  const count = (state: HealthChangeState) => signals.filter(signal => signal.state === state).length;
  const within = count('within-range');
  const loading = count('loading');
  const unavailable = count('unavailable');
  const insufficient = count('insufficient');
  const recorded = count('recorded');
  const parts = [
    changes.length ? `${changes.length} outside usual range` : '',
    within ? `${within} within usual range` : '',
    insufficient ? `${insufficient} ${insufficient === 1 ? 'needs' : 'need'} more readings` : '',
    recorded ? `${recorded} ${recorded === 1 ? 'reading' : 'readings'} shown without comparison` : '',
    loading ? `${loading} loading` : '',
    unavailable ? `${unavailable} unavailable` : '',
  ].filter(Boolean);
  const headline = changes.length
    ? changes.length === 1 ? 'One reading is outside your usual range.' : `${changes.length} readings are outside your usual range.`
    : loading ? 'We’re still loading some of your readings.'
    : unavailable ? 'We couldn’t load some of your readings.'
    : within ? 'The readings we can compare are within your usual range.'
    : insufficient ? 'More readings are needed to find your usual range.'
    : recorded ? 'Your latest readings are shown below.'
    : 'No sleep or nightly HRV readings to compare yet.';
  return { changes, headline, coverageText: parts.join(' · ') };
}

/** Mirrors Highlight source selection; never combines provider/account or semantic series. */
export function buildHealthHighlightChangeSignals(
  cards: readonly (HealthPriorityCardView & { comparisonUnavailable?: boolean })[],
  preferences: AppHealthHighlightSources,
): HealthChangeSignal[] {
  return cards.map(card => {
    const candidates = card.chartSeries.length ? card.chartSeries.map(series => ({ ...series,
      key: series.sourceSelectionKey || series.id })) : card.rows.map(row => ({
      key: row.sourceSelectionKey || row.id, metricId: 'sleep_duration' as const,
      points: row.sleepPoint ? [{ value: row.sleepPoint.totalSeconds, timestampMs: row.observedAtMs,
        calendarDate: row.sleepPoint.sleepDate }] : [],
    }));
    const preferred = preferences[card.id];
    const key = preferred || selectDefaultHealthSourceKey(candidates);
    const series = card.chartSeries.find(series => (series.sourceSelectionKey || series.id) === key);
    const row = card.rows.find(row => (row.sourceSelectionKey || row.id) === key);
    const sourceLabel = series ? `${series.sourceLabel} · ${series.semanticLabel}`
      : row?.sourceLabel || (card.loading ? 'Source loading' : preferred ? 'Preferred source unavailable' : 'No comparable source');
    const base = { id: card.id, label: card.label, sourceLabel };
    if (card.loading) return { ...base, state: 'loading', statusText: 'Loading evidence', detailText: 'Waiting for the existing source reads to finish.' };
    if (card.error || card.comparisonUnavailable) return { ...base, state: 'unavailable', statusText: 'Evidence unavailable',
      detailText: 'A source read failed or was incomplete. Available charts remain visible; no range conclusion is made.' };
    if (preferred && !series && !row) return { ...base, state: 'unavailable', statusText: 'Preferred source unavailable',
      detailText: 'Your preferred source has no readings in this view. No other source is substituted.' };
    if (series) {
      const status = card.chartStatuses?.[series.id];
      const state = personalRangeChangeState(status);
      // Do not retain a reassuring label/detail after rejecting its numeric range.
      // Valid neutral statuses still explain baseline/recent-night progress.
      const displayStatus = state !== 'insufficient' || status?.tone === 'neutral' ? status : null;
      const last = series.points.at(-1);
      const recorded = last ? `Last recorded ${getDateTimeFormatter(undefined, { dateStyle: 'medium' }).format(last.timestampMs)}.` : '';
      return { ...base, state, statusText: displayStatus?.label || 'Not enough comparable evidence',
        detailText: [displayStatus?.detailText || 'No established personal range for this reading.', recorded].filter(Boolean).join(' · ') };
    }
    if (row) return { ...base, state: 'recorded', statusText: 'Recorded context',
      detailText: `${row.valueText} · ${row.contextText}. No change assessment for this metric.` };
    return { ...base, state: 'insufficient', statusText: 'Not enough comparable evidence', detailText: card.emptyText };
  });
}
