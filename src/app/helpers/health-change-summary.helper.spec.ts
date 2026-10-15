import { buildHealthChangeSummary, buildHealthHighlightChangeSignals, personalRangeChangeState, resolveHealthChangeSourceLabel, type HealthChangeSignal } from './health-change-summary.helper';
import type { HealthPriorityCardView } from '../components/health/health-priority-summary.component';
import type { HealthWorkspaceSeries } from './health-workspace.helper';

const signal = (state: HealthChangeSignal['state'], id: string = state): HealthChangeSignal => ({
  id, state, label: 'HRV', sourceLabel: 'Suunto · Overnight average', statusText: state, detailText: 'Same-source evidence',
});

describe('Health change summary', () => {
  it('separates normal evidence from missing, pending, failed and unassessed evidence', () => {
    const summary = buildHealthChangeSummary(['within-range', 'insufficient', 'recorded', 'loading', 'unavailable'].map(state => signal(state as HealthChangeSignal['state'])));
    expect(summary.headline).toBe('Some signals are still loading.');
    expect(summary.coverageText).toBe('1 within range · 1 needs more evidence · 1 recorded only · 1 loading · 1 unavailable');
    expect(summary.changes).toEqual([]);
  });
  it('surfaces outside-range evidence even while another source is missing', () => {
    const summary = buildHealthChangeSummary([signal('outside-range'), signal('insufficient')]);
    expect(summary.headline).toBe('One signal is outside its usual range.');
    expect(summary.changes).toEqual([signal('outside-range')]);
    expect(buildHealthChangeSummary([signal('outside-range'), signal('outside-range', 'second')]).headline)
      .toBe('2 signals are outside their usual ranges.');
  });
  it('qualifies the within-range conclusion instead of making an all-clear claim', () => {
    expect(buildHealthChangeSummary([signal('within-range'), signal('insufficient')]).headline)
      .toBe('Assessed signals are within their personal ranges.');
    expect(buildHealthChangeSummary([]).headline).toBe('More evidence is needed to assess changes.');
    expect(buildHealthChangeSummary([signal('recorded')]).headline).toBe('More evidence is needed to assess changes.');
    expect(buildHealthChangeSummary([signal('unavailable')]).headline).toBe('Some evidence is unavailable.');
  });
  it('uses the existing personal-range tone, including caution, and refuses incomplete numeric ranges', () => {
    const range = { currentAverage: 40, normalRange: { min: 35, max: 45 }, tone: 'positive' as const };
    expect(personalRangeChangeState(range)).toBe('within-range');
    expect(personalRangeChangeState({ ...range, tone: 'caution' })).toBe('outside-range');
    expect(personalRangeChangeState({ ...range, tone: 'negative' })).toBe('outside-range');
    expect(personalRangeChangeState({ ...range, tone: 'neutral' })).toBe('insufficient');
    expect(personalRangeChangeState({ ...range, currentAverage: null })).toBe('insufficient');
    expect(personalRangeChangeState({ ...range, currentAverage: NaN })).toBe('insufficient');
    expect(personalRangeChangeState({ ...range, normalRange: { min: 50, max: 40 } })).toBe('insufficient');
    expect(personalRangeChangeState(null)).toBe('insufficient');
  });

  it('keeps source attribution separate from evidence availability and does not expose account keys', () => {
    const source = { id: 'first-reading', sourceKey: 'private-source-identity', providerLabel: 'Suunto' };
    expect(resolveHealthChangeSourceLabel([source], true)).toBe('Suunto');
    expect(resolveHealthChangeSourceLabel([source, { ...source, id: 'another-reading' }], true)).toBe('Suunto');
    expect(resolveHealthChangeSourceLabel([source, { ...source, sourceKey: 'other-private-account' }], true)).toBe('Multiple recorded sources');
    expect(resolveHealthChangeSourceLabel([source, { ...source, providerLabel: 'Garmin' }], true)).toBe('Multiple recorded sources');
    expect(resolveHealthChangeSourceLabel([], true)).toBe('Source attribution unavailable');
    expect(resolveHealthChangeSourceLabel([], false)).toBe('No eligible current source');
  });

  it('follows the selected Highlight account without blending sources or overwriting a missing preference', () => {
    const series = (id: string, sourceLabel: string, value: number): HealthWorkspaceSeries => ({
      id, sourceSelectionKey: id, metricId: 'heart_rate_variability', provider: 'SuuntoApp', providerLabel: 'Suunto',
      sourceLabel, accountLabel: null, semanticLabel: 'Overnight HRV', aggregation: 'average', semanticVariant: 'overnight_average',
      origin: 'provider_summary', recordingMethod: 'provider_calculated', unit: 'ms', normalizationStatus: 'canonical',
      nativeOnly: false, valueType: 'number', chartKind: 'line', sampleBased: false, deviceLabel: null,
      coverageText: '', freshnessText: '', hasConflict: false,
      points: [{ value, timestampMs: 1000, calendarDate: '2026-10-14', qualityCode: null }],
    });
    const card: HealthPriorityCardView = { id: 'heart_rate_variability', label: 'HRV', icon: 'monitor_heart',
      metric: 'heart_rate_variability', rows: [], chartSeries: [series('first', 'Suunto · Account 1', 40), series('second', 'Suunto · Account 2', 70)],
      chartStatuses: {
        first: { tone: 'positive', label: 'Within personal range', detailText: '7-day average 40 ms',
          currentAverage: 40, normalRange: { min: 35, max: 45 }, observationDayCount: 20, requiredObservationDayCount: 14, pointStatuses: [] },
        second: { tone: 'caution', label: 'Outside personal range', detailText: '7-day average 70 ms',
          currentAverage: 70, normalRange: { min: 40, max: 50 }, observationDayCount: 20, requiredObservationDayCount: 14, pointStatuses: [] },
      }, available: true, loading: false, error: false, emptyText: 'No nightly HRV.' };
    expect(buildHealthHighlightChangeSignals([card], { heart_rate_variability: 'second' })[0]).toMatchObject({
      sourceLabel: 'Suunto · Account 2 · Overnight HRV', state: 'outside-range', statusText: 'Outside personal range',
    });
    const preferences = { heart_rate_variability: 'missing' };
    expect(buildHealthHighlightChangeSignals([card], preferences)[0].state).toBe('within-range');
    expect(preferences.heart_rate_variability).toBe('missing');
    expect(buildHealthHighlightChangeSignals([{ ...card, comparisonUnavailable: true }], {})[0].state).toBe('unavailable');
    expect(buildHealthHighlightChangeSignals([{ ...card, loading: true }], {})[0].state).toBe('loading');
    expect(buildHealthHighlightChangeSignals([{ ...card, chartSeries: [] }], {})[0].state).toBe('insufficient');
    const invalidStatus = { ...card, chartStatuses: { ...card.chartStatuses,
      first: { ...card.chartStatuses!.first, normalRange: null },
    } };
    expect(buildHealthHighlightChangeSignals([invalidStatus], {})[0]).toMatchObject({
      state: 'insufficient', statusText: 'Not enough comparable evidence',
    });
    expect(buildHealthHighlightChangeSignals([invalidStatus], {})[0].detailText).not.toContain('7-day average 40');
    const buildingStatus = { ...card, chartStatuses: { ...card.chartStatuses, first: {
      ...card.chartStatuses!.first, tone: 'neutral' as const, currentAverage: null, normalRange: null,
      label: 'Building personal range', detailText: '6/14 nights',
    } } };
    expect(buildHealthHighlightChangeSignals([buildingStatus], {})[0]).toMatchObject({
      state: 'insufficient', statusText: 'Building personal range', detailText: expect.stringContaining('6/14 nights'),
    });
  });
});
