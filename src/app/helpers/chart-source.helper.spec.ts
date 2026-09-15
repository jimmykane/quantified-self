import { describe, expect, it } from 'vitest';
import { healthChartSourceChoice } from './chart-source.helper';

describe('compact chart source attribution', () => {
  const series = { id: 'stable-key', sourceLabel: 'Suunto · Account 2', aggregation: 'average', nativeOnly: false,
    semanticVariant: 'sleep_session_average_hrv', semanticLabel: 'Average HRV · Sleep session · Provider summary · Provider calculated' };
  it('keeps account and reading meaning while moving provenance to expanded details', () => {
    const choice = healthChartSourceChoice(series);
    expect(choice.key).toBe(series.id);
    expect(choice.shortLabel).toBe('Suunto · Account 2 · Sleep average');
    expect(choice.detail).toBe(series.semanticLabel);
    expect(choice.label).toBe(`${series.sourceLabel} · ${series.semanticLabel}`);
    expect(healthChartSourceChoice({ ...series, semanticVariant: 'sleep_overnight_hrv' }).shortLabel).toContain('Overnight average');
  });
  it('keeps new Sleep vital labels compact without disguising minimums, maximums or naps', () => {
    for (const [variant, label] of [['sleep_session_minimum_heart_rate', 'Sleep minimum'], ['sleep_session_maximum_spo2', 'Sleep maximum'],
      ['sleep_session_resting_heart_rate', 'Sleep resting'], ['nap_average_respiration', 'Nap average']]) {
      const choice = healthChartSourceChoice({ ...series, semanticVariant: variant });
      expect(choice.shortLabel).toBe(`Suunto · Account 2 · ${label}`);
      expect(choice.detail).toBe(series.semanticLabel);
    }
  });
  it('preserves daily and rolling statistics, unknown semantics and native scales', () => {
    expect(healthChartSourceChoice({ ...series, semanticVariant: 'rolling_7_day_average' }).shortLabel).toContain('7-day average');
    expect(healthChartSourceChoice({ ...series, semanticVariant: 'daily_resting', semanticLabel: 'Average · Daily resting · Provider summary · Provider calculated' }).shortLabel).toContain('Daily resting');
    const native = healthChartSourceChoice({ ...series, semanticVariant: 'provider_new_reading', semanticLabel: 'Special reading · Recorded · Device', nativeOnly: true });
    expect(native.shortLabel).toContain('Special reading · Provider scale');
    expect(native.detail).toBe('Special reading · Recorded · Device · Native provider scale');
  });
});
