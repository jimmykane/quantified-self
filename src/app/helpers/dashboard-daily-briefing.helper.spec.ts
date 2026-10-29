import { buildDashboardDailyBriefing } from './dashboard-daily-briefing.helper';
import { buildDashboardGlanceSignals, type DashboardGlanceReadiness } from './dashboard-glance.helper';
import type { HealthChangeSignal } from './health-change-summary.helper';

const health: HealthChangeSignal[] = [
  { id: 'hrv', label: 'HRV', sourceLabel: 'Garmin', state: 'within-range', statusText: 'Within range', detailText: '' },
  { id: 'sleep', label: 'Sleep', sourceLabel: 'Garmin', state: 'recorded', statusText: 'Recorded', detailText: '' },
];
function signals(overrides: Partial<DashboardGlanceReadiness> = {}, load: 'available' | 'loading' | 'unavailable' | 'insufficient' = 'available') {
  return buildDashboardGlanceSignals({ loading: false, awaitingSleep: false, warningText: '', label: 'Ready', scoreText: '82/100',
    confidenceText: 'High', evidenceText: '4/4', sleepText: '87/100', sleepContextText: 'Today', loadText: '+5',
    overnightHeartRateText: '-4%', overnightHeartRateTone: 'positive', overnightHeartRateContextText: '', changeSignals: health,
    ...overrides }, { label: 'Fresh', caption: 'Ready to train', scalePosition: 1, scaleTone: 'positive' }, load);
}

describe('Dashboard daily briefing', () => {
  it.each(['Ready', 'Mixed', 'Recover'])('summarizes %s readiness in one short sentence with the existing assessment tone', label => {
    const result = buildDashboardDailyBriefing(signals({ label }));
    expect(result).toMatchObject({ headline: `Training state is Fresh, readiness is ${label}, and 7-day HRV is within your usual range.`,
      tone: label === 'Ready' ? 'positive' : 'caution' });
    expect(result.headline).not.toMatch(/82|87|4%|train today/i);
  });
  it('keeps each phrase’s own color when readiness needs attention', () => {
    const result = buildDashboardDailyBriefing(signals({ label: 'Mixed' }));
    expect(result.parts).toEqual([
      { text: 'Training state is Fresh', tone: 'positive' }, { text: ', ', tone: 'neutral' },
      { text: 'readiness is Mixed', tone: 'caution' }, { text: ', and ', tone: 'neutral' },
      { text: '7-day HRV is within your usual range', tone: 'positive' }, { text: '.', tone: 'neutral' },
    ]);
    expect(result.parts.map(part => part.text).join('')).toBe(result.headline);
  });
  it('preserves explicit assessment colors rather than inferring them from availability', () => {
    const input = signals({ label: 'Recover' });
    input[1] = { ...input[1], tone: 'neutral' };
    const result = buildDashboardDailyBriefing(input);
    expect(result.parts.filter(part => part.text.trim() && ![', ', ', and ', '.'].includes(part.text)).map(part => part.tone))
      .toEqual(['neutral', 'error', 'positive']);
  });
  it.each(['loading', 'insufficient', 'recorded'] as const)('keeps %s evidence neutral', state => {
    const result = buildDashboardDailyBriefing([{ ...health[0], state }]);
    expect(result.parts.length).toBeGreaterThan(0);
    expect(result.parts.every(part => part.tone === 'neutral')).toBe(true);
    expect(result.parts.map(part => part.text).join('')).toBe(result.headline);
  });
  it.each([
    ['unavailable', 'error'], ['loading', 'neutral'], ['insufficient', 'neutral'], ['recorded', 'neutral'],
    ['attention', 'caution'], ['outside-range', 'caution'],
  ] as const)('does not let stale positive styling override %s evidence', (state, tone) => {
    const result = buildDashboardDailyBriefing([{ ...health[0], state, tone: 'positive' }]);
    expect(result.parts.some(part => part.text.length > 5 && part.tone === tone)).toBe(true);
    expect(result.parts.some(part => part.tone === 'positive')).toBe(false);
  });
  it('prioritizes an elevated overnight HR over an ordinary HRV status', () => {
    expect(buildDashboardDailyBriefing(signals({ overnightHeartRateTone: 'negative' }))).toMatchObject({
      headline: 'Training state is Fresh, readiness is Ready, and overnight heart rate is above baseline.', tone: 'caution',
    });
  });
  it('keeps the seven-day HRV assessment distinct from a latest nightly reading', () => {
    const result = buildDashboardDailyBriefing(signals({ changeSignals: [{ ...health[0], state: 'outside-range' }, health[1]] }));
    expect(result.headline).toContain('7-day HRV is outside your usual range'); expect(result.tone).toBe('caution');
  });
  it('retains a negative training state even with Ready readiness', () => {
    const input = signals(); input[1] = { ...input[1], state: 'attention', tone: 'error', summaryText: 'training state is Overreached' };
    expect(buildDashboardDailyBriefing(input)).toMatchObject({
      headline: 'Training state is Overreached, readiness is Ready, and 7-day HRV is within your usual range.', tone: 'caution',
    });
  });
  it('states missing current sleep instead of endorsing older evidence', () => {
    const result = buildDashboardDailyBriefing(signals({ awaitingSleep: true }));
    expect(result.headline).toContain('readiness is waiting for today’s sleep');
    expect(result.headline).toContain('today’s sleep is not recorded yet');
    expect(result.headline).not.toContain('within your usual range'); expect(result.tone).toBe('neutral');
  });
  it.each(['loading', 'insufficient', 'unavailable'] as const)('does not turn %s load into a positive summary', state => {
    const result = buildDashboardDailyBriefing(signals({}, state));
    expect(result.tone).toBe(state === 'unavailable' ? 'error' : 'neutral');
    expect(result.headline).not.toContain('Training state is Fresh');
  });
  it('states an unavailable assessment even when another signal needs attention', () => {
    const input = signals({ label: 'Mixed' }); input[3] = { ...input[3], state: 'unavailable', summaryText: 'HRV is unavailable' };
    expect(buildDashboardDailyBriefing(input)).toMatchObject({
      headline: 'Training state is Fresh, readiness is Mixed, and HRV is unavailable.', tone: 'error',
    });
  });
  it('keeps partial evidence neutral instead of claiming full readiness', () => {
    const result = buildDashboardDailyBriefing(signals({ changeSignals: [{ ...health[0], state: 'insufficient' }, health[1]] }));
    expect(result.headline).toContain('HRV needs more comparable readings'); expect(result.tone).toBe('neutral');
    expect(buildDashboardDailyBriefing([health[0]]).tone).toBe('neutral');
  });
  it('replaces all-loading evidence with one neutral message and handles empty input', () => {
    expect(buildDashboardDailyBriefing(signals({ loading: true }, 'loading'))).toMatchObject({
      headline: 'Today’s training and recovery signals are still loading.', tone: 'neutral',
    });
    expect(buildDashboardDailyBriefing([])).toMatchObject({ headline: 'Today’s training and recovery signals are not available yet.', tone: 'neutral' });
  });
});
