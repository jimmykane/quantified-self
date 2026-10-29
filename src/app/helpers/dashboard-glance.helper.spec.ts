import { buildDashboardGlanceSignals, type DashboardGlanceReadiness, type DashboardGlanceTrainingState } from './dashboard-glance.helper';
import { buildDashboardGlanceSummary } from './health-change-summary.helper';

const normal = (): DashboardGlanceReadiness => ({
  loading: false, awaitingSleep: false, warningText: '', label: 'Ready', scoreText: '82/100',
  confidenceText: 'High confidence', evidenceText: '4/4 signals', sleepText: '87/100', sleepContextText: 'Today',
  overnightHeartRateText: '-4%', overnightHeartRateTone: 'positive', overnightHeartRateContextText: 'Today', loadText: '+5 / +1',
  changeSignals: [
    { id: 'sleep', label: 'Sleep', state: 'recorded', sourceLabel: 'Suunto', statusText: 'Recorded', detailText: 'Night ended 15 Oct, 08:00.' },
    { id: 'hrv', label: 'HRV · 7-day average', state: 'within-range', sourceLabel: 'Garmin · Overnight HRV',
      statusText: 'Within range', detailText: '7-day average · 60-day range · Last recorded 15 Oct' },
  ],
});
const training: DashboardGlanceTrainingState = { label: 'Balanced', caption: 'Stable load', scalePosition: 2, scaleTone: 'positive', contextText: 'Derived load through 15 Oct' };
const project = (view = normal(), load = training, availability: Parameters<typeof buildDashboardGlanceSignals>[2] = 'available') =>
  buildDashboardGlanceSignals(view, load, availability);

describe('Dashboard existing-assessment projection', () => {
  it('covers all five signals with one normal-day sentence and no new score or attention rows', () => {
    const view = normal();
    const signals = project(view);
    expect(signals.map(signal => signal.id)).toEqual(['readiness', 'training-load', 'sleep', 'hrv', 'overnight-hr']);
    expect(buildDashboardGlanceSummary(signals)).toEqual({
      headline: 'Readiness is Ready, training state is Balanced, and today’s sleep is recorded.', attentionSignals: [], state: 'available',
    });
    expect(view.scoreText).toBe('82/100');
    expect(signals.find(signal => signal.id === 'sleep')).toMatchObject({ state: 'recorded', statusText: 'Sleep score 87/100' });
  });
  it.each(['Mixed', 'Recover'])('uses %s unchanged and includes source-separated contributing evidence in details', label => {
    const signals = project({ ...normal(), label, scoreText: '64/100' });
    const result = buildDashboardGlanceSummary(signals);
    expect(result.headline).toBe(`Readiness is ${label}.`);
    expect(result.attentionSignals).toHaveLength(5);
    expect(result.attentionSignals.find(signal => signal.id === 'readiness')?.statusText).toBe(`${label} · 64/100`);
    expect(result.attentionSignals.find(signal => signal.id === 'sleep')?.sourceLabel).toBe('Suunto');
    expect(result.attentionSignals.find(signal => signal.id === 'hrv')?.sourceLabel).toBe('Garmin · Overnight HRV');
  });
  it('preserves the existing assessment colors independently from availability', () => {
    const mixed = project({ ...normal(), label: 'Mixed', overnightHeartRateTone: 'neutral' }, { ...training, scaleTone: 'neutral' });
    expect(mixed.find(signal => signal.id === 'training-load')).toMatchObject({ state: 'available', tone: 'neutral' });
    expect(mixed.find(signal => signal.id === 'readiness')?.tone).toBe('caution');
    expect(mixed.find(signal => signal.id === 'overnight-hr')).toMatchObject({ state: 'available', tone: 'neutral' });
    const recover = project({ ...normal(), label: 'Recover' }, { ...training, scaleTone: 'negative' });
    expect(recover.find(signal => signal.id === 'readiness')?.tone).toBe('error');
    expect(recover.find(signal => signal.id === 'training-load')?.tone).toBe('error');
  });
  it('keeps a still-loading driver visible in a Mixed assessment rather than implying complete evidence', () => {
    const result = buildDashboardGlanceSummary(project({ ...normal(), label: 'Mixed' }, training, 'loading'));
    expect(result.headline).toBe('Readiness is Mixed.');
    expect(result.attentionSignals).toHaveLength(5);
    expect(result.attentionSignals.find(signal => signal.id === 'training-load')).toMatchObject({
      state: 'loading', statusText: 'Loading training load',
    });
  });
  it('surfaces load and overnight-HR assessments without calling either a personal range', () => {
    const result = buildDashboardGlanceSummary(project({ ...normal(), overnightHeartRateTone: 'negative', overnightHeartRateText: '+6%' },
      { ...training, label: 'Fatigued', caption: 'Absorb the load', scaleTone: 'negative' }));
    expect(result.headline).toBe('Training state is Fatigued; overnight heart rate is above baseline.');
    expect(result.attentionSignals.map(signal => signal.id)).toEqual(['training-load', 'overnight-hr']);
    expect(result.attentionSignals[0].detailText).toContain('Derived load through 15 Oct');
    expect(result.attentionSignals[1].detailText).toContain('+6% vs recorded sleep-source baseline');
  });
  it('preserves Sleep as recorded context even with a low source score, without inventing thresholds', () => {
    const signals = project({ ...normal(), label: 'Mixed', sleepText: '30/100' });
    expect(signals.find(signal => signal.id === 'sleep')).toMatchObject({ state: 'recorded', statusText: 'Sleep score 30/100' });
    expect(buildDashboardGlanceSummary(signals).headline).toBe('Readiness is Mixed.');
  });
  it('does not turn yesterday’s sleep or missing HRV into a green current-day summary', () => {
    const view = { ...normal(), awaitingSleep: true, label: 'Awaiting today’s sleep', scoreText: '', sleepContextText: 'Last available · 14 Oct' };
    const signals = project(view);
    expect(signals.find(signal => signal.id === 'sleep')?.state).toBe('insufficient');
    expect(signals.find(signal => signal.id === 'overnight-hr')?.state).toBe('insufficient');
    const result = buildDashboardGlanceSummary(signals);
    expect(result.headline).toContain('waiting for today’s sleep');
    expect(result.state).toBe('insufficient');
    expect(result.attentionSignals.some(signal => signal.detailText.includes('Last available · 14 Oct'))).toBe(true);
    expect(result.attentionSignals.find(signal => signal.id === 'sleep')?.detailText).toContain('Last available sleep score 87/100');
  });
  it('does not show an available load assessment without an existing Training-state classification', () => {
    const result = buildDashboardGlanceSummary(project(normal(), { ...training, label: 'Awaiting data', scalePosition: null }));
    expect(result.state).toBe('insufficient');
    expect(result.headline).toBe('No current training-load assessment.');
    expect(result.attentionSignals.find(signal => signal.id === 'training-load')?.detailText).not.toContain('Stable load');
  });
  it('keeps independent load available during a Sleep failure, without a false all-clear', () => {
    const result = buildDashboardGlanceSummary(project({ ...normal(), warningText: 'Sleep could not be loaded.' }));
    expect(result.headline).toContain('Readiness is unavailable');
    expect(result.state).toBe('unavailable');
    expect(result.attentionSignals.map(signal => signal.id)).not.toContain('training-load');
    expect(result.attentionSignals.find(signal => signal.id === 'hrv')?.state).toBe('unavailable');
  });
  it('distinguishes a recorded night without a score from missing sleep', () => {
    const result = buildDashboardGlanceSummary(project({ ...normal(), sleepText: '--' }));
    expect(result.headline).toBe('Today’s sleep is recorded without a score.');
    expect(result.state).toBe('insufficient');
  });
  it.each(['hrv', 'overnight-hr'])('keeps an unassessable %s visible even when the existing Readiness label is Ready', id => {
    const view = normal();
    if (id === 'hrv') view.changeSignals = view.changeSignals.map(signal => signal.id === 'hrv'
      ? { ...signal, state: 'insufficient', statusText: 'Building personal range' } : signal);
    else view.overnightHeartRateText = '--';
    const result = buildDashboardGlanceSummary(project(view));
    expect(result.state).toBe('insufficient');
    expect(result.attentionSignals.map(signal => signal.id)).toContain(id);
    expect(result.headline).not.toContain('Readiness is Ready');
  });
  it('copies formatted evidence without parsing values or replacing the selected sources', () => {
    const result = project({ ...normal(), label: 'Mixed', sleepText: '87 / 100', overnightHeartRateText: '+6,1 %', overnightHeartRateTone: 'negative' });
    expect(result.find(signal => signal.id === 'overnight-hr')?.detailText).toContain('+6,1 %');
    expect(result.find(signal => signal.id === 'sleep')?.statusText).toBe('Sleep score 87 / 100');
    expect(result.find(signal => signal.id === 'hrv')?.sourceLabel).toBe('Garmin · Overnight HRV');
  });
  it.each(['loading', 'unavailable', 'insufficient'] as const)('does not mask %s load behind ready recovery evidence', availability => {
    const result = buildDashboardGlanceSummary(project(normal(), training, availability));
    expect(result.state).toBe(availability);
    expect(result.headline).not.toContain('Readiness is Ready');
  });
});
