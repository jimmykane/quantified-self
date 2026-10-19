import { describe, expect, it } from 'vitest';
import { healthChartSourceChoice } from './chart-source.helper';

describe('compact chart source attribution', () => {
  const series = { id: 'stable-key', sourceLabel: 'Suunto · Account 2', aggregation: 'average', nativeOnly: false,
    semanticVariant: 'sleep_session_average_hrv', semanticLabel: 'Average HRV · Sleep session · Provider summary · Provider calculated' };
  it('groups comparable daytime readings while separating rolling, sleep and nap measurements', () => {
    const choice = (semanticVariant: string) => healthChartSourceChoice({ ...series, metricId: 'heart_rate', semanticVariant });
    expect(choice('daily_15_second').readingKey).toBe('daytime');
    expect(choice('activity_interval_average').readingKey).toBe('daytime');
    expect(choice('rolling_7_day_average').readingKey).not.toBe('daytime');
    expect(choice('sleep_session_average_heart_rate').readingKey).toBe('sleep-average');
    expect(choice('qs_sleep_session_average_heart_rate').readingKey).toBe('sleep-average');
    expect(choice('sleep_session_minimum_heart_rate').readingKey).toBe('sleep-minimum');
    expect(choice('nap_average_heart_rate').readingKey).toBe('nap-average');
    expect(choice('unknown_provider_variant').readingKey).toContain('unknown_provider_variant');
  });
  it('keeps account and reading meaning while moving provenance to expanded details', () => {
    const choice = healthChartSourceChoice(series);
    expect(choice.key).toBe(series.id);
    expect(choice.shortLabel).toBe('Suunto · Account 2 · Average sleep HRV');
    expect(choice.detail).toBe(series.semanticLabel);
    expect(choice.label).toBe(`${series.sourceLabel} · ${series.semanticLabel}`);
    expect(healthChartSourceChoice({ ...series, semanticVariant: 'sleep_overnight_hrv' }).shortLabel).toContain('Overnight HRV');
  });
  it('keeps new Sleep vital labels compact without disguising minimums, maximums or naps', () => {
    for (const [variant, label] of [['sleep_session_minimum_heart_rate', 'Minimum sleep HR'], ['sleep_session_maximum_spo2', 'Maximum sleep SpO₂'],
      ['sleep_session_resting_heart_rate', 'Sleep resting HR'], ['nap_average_respiration', 'Nap average']]) {
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

  it('distinguishes daily resting heart rate from sleep average and minimum heart rate in the visible label', () => {
    const resting = healthChartSourceChoice({ ...series, semanticVariant: 'daily_resting',
      semanticLabel: 'Average · Daily resting · Provider summary · Provider calculated', sourceLabel: 'Garmin' });
    const average = healthChartSourceChoice({ ...series, semanticVariant: 'sleep_session_average_heart_rate' });
    const minimum = healthChartSourceChoice({ ...series, semanticVariant: 'sleep_session_minimum_heart_rate' });
    expect(resting.shortLabel).toBe('Garmin · Daily resting HR');
    expect(average.shortLabel).toBe('Suunto · Account 2 · Average sleep HR');
    expect(minimum.shortLabel).toBe('Suunto · Account 2 · Minimum sleep HR');
    expect(minimum.key).toBe(series.id);
  });
});
