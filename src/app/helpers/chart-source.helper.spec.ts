import { describe, expect, it } from 'vitest';
import { healthChartSourceChoice } from './chart-source.helper';

describe('compact chart source attribution', () => {
  const series = { id: 'stable-key', sourceLabel: 'Suunto · Account 2', aggregation: 'average', nativeOnly: false,
    semanticVariant: 'sleep_session_average_hrv', semanticLabel: 'Average HRV · Sleep session · Provider summary · Provider calculated' };
  it('groups comparable daytime readings while separating rolling, sleep and nap measurements', () => {
    const choice = (semanticVariant: string) => healthChartSourceChoice({ ...series, metricId: 'heart_rate', semanticVariant });
    expect(choice('daily_15_second').readingKey).toBe('daytime');
    expect(choice('activity_interval_average').readingKey).toBe('daytime');
    for (const variant of ['daily_15_second', 'activity_interval_average', 'qs_daily_sample_mean', 'qs_daily_interval_mean']) {
      expect(choice(variant)).toMatchObject({ readingKey: 'daytime', readingLabel: 'Heart rate', secondaryMeasurement: false });
    }
    expect(choice('sleep_session_average_heart_rate').secondaryMeasurement).toBe(false);
    for (const variant of ['sleep_session_minimum_heart_rate', 'rolling_7_day_average', 'activity_interval_minimum', 'qs_daily_interval_low']) {
      expect(choice(variant).secondaryMeasurement).toBe(true);
    }
    expect(choice('qs_daily_interval_mean').readingDescription).toContain('One average per recorded day');
    expect(choice('qs_daily_interval_low').readingLabel).toBe('Daily lowest average HR');
    expect(choice('qs_daily_interval_minimum_low').readingLabel).toBe('Daily lowest HR');
    expect(choice('daily_15_second').readingMethod).toBe('Recorded by your watch');
    expect(choice('activity_interval_average').readingMethod).toBe('Recorded by your watch');
    expect(choice('activity_interval_average').readingDescription).toContain('average heart rate for each short recording period');
    expect(choice('rolling_7_day_average').readingKey).not.toBe('daytime');
    expect(choice('sleep_session_average_heart_rate').readingKey).toBe('sleep-average');
    expect(choice('qs_sleep_session_average_heart_rate').readingKey).toBe('sleep-average');
    expect(choice('sleep_session_minimum_heart_rate').readingKey).toBe('sleep-minimum');
    expect(choice('nap_average_heart_rate').readingKey).toBe('nap-average');
    expect(choice('unknown_provider_variant').readingKey).toContain('unknown_provider_variant');
    const calculated = healthChartSourceChoice({ ...series, semanticVariant: 'qs_sleep_session_average_heart_rate',
      semanticLabel: 'Average heart rate · Sleep session · Calculated by QS from recorded heart rate' });
    expect(calculated.detail).toBe('Average sleep HR · Calculated by QS');
    expect(calculated.key).toBe(series.id);
    const future = healthChartSourceChoice({ ...series, semanticVariant: 'new_average', origin: 'quantified_self_derived',
      semanticLabel: 'Average · New reading · Quantified self derived' });
    expect(future.detail).toBe('New reading · Calculated by QS');
    expect(future.shortLabel).toContain('Calculated by QS');
  });
  it('keeps account and reading meaning while moving provenance to expanded details', () => {
    const choice = healthChartSourceChoice(series);
    expect(choice.key).toBe(series.id);
    expect(choice.shortLabel).toBe('Suunto · Account 2 · Average sleep HRV');
    expect(choice.detail).toBe('Average sleep HRV');
    expect(choice.label).toBe(`${series.sourceLabel} · Average sleep HRV`);
    expect(healthChartSourceChoice({ ...series, semanticVariant: 'sleep_overnight_hrv' }).shortLabel).toContain('Overnight HRV');
  });
  it.each(['average', 'minimum'] as const)('groups provider and calculated nap %s without losing provenance or series identity', kind => {
    const provider = healthChartSourceChoice({ ...series, id: `provider-${kind}`, metricId: 'heart_rate',
      aggregation: kind, semanticVariant: `nap_${kind}_heart_rate` });
    const calculated = healthChartSourceChoice({ ...series, id: `calculated-${kind}`, metricId: 'heart_rate',
      aggregation: kind, semanticVariant: `qs_nap_${kind}_heart_rate`, origin: 'quantified_self_derived' });
    expect(calculated.readingKey).toBe(provider.readingKey);
    expect(calculated.readingLabel).toBe(provider.readingLabel);
    expect(calculated.secondaryMeasurement).toBe(true);
    expect(calculated.key).not.toBe(provider.key);
    expect(calculated.detail).toContain('Calculated by QS');
    expect(provider.detail).not.toContain('Calculated by QS');
    const native = healthChartSourceChoice({ ...series, metricId: 'heart_rate', nativeOnly: true,
      aggregation: kind, semanticVariant: `qs_nap_${kind}_heart_rate` });
    expect(native.readingKey).not.toBe(provider.readingKey);
    expect(native.readingKey).not.toBe(healthChartSourceChoice({ ...series, metricId: 'heart_rate', nativeOnly: true,
      aggregation: kind, semanticVariant: `nap_${kind}_heart_rate` }).readingKey);
  });
  it('does not group unknown sleep or nap variants just because they share a calculation prefix', () => {
    for (const variant of ['sleep_future_reading', 'nap_future_reading']) {
      const provider = healthChartSourceChoice({ ...series, metricId: 'heart_rate', semanticVariant: variant });
      const calculated = healthChartSourceChoice({ ...series, metricId: 'heart_rate', semanticVariant: `qs_${variant}` });
      expect(provider.readingKey).not.toBe(calculated.readingKey);
      expect(provider.secondaryMeasurement).toBe(true);
      expect(calculated.secondaryMeasurement).toBe(true);
    }
  });
  it('keeps new Sleep vital labels compact without disguising minimums, maximums or naps', () => {
    for (const [variant, label] of [['sleep_session_minimum_heart_rate', 'Minimum sleep HR'], ['sleep_session_maximum_spo2', 'Maximum sleep SpO₂'],
      ['sleep_session_resting_heart_rate', 'Sleep resting HR'], ['nap_average_respiration', 'Average nap breathing rate'],
      ['sleep_session_average_respiration', 'Average sleep breathing rate'], ['nap_maximum_spo2', 'Maximum nap SpO₂'],
      ['nap_average_heart_rate', 'Average nap HR'], ['nap_minimum_heart_rate', 'Minimum nap HR'], ['nap_resting_heart_rate', 'Nap resting HR']]) {
      const choice = healthChartSourceChoice({ ...series, semanticVariant: variant });
      expect(choice.shortLabel).toBe(`Suunto · Account 2 · ${label}`);
      expect(choice.detail).toBe(label);
    }
  });
  it('preserves daily and rolling statistics, unknown semantics and native scales', () => {
    expect(healthChartSourceChoice({ ...series, semanticVariant: 'rolling_7_day_average' }).shortLabel).toContain('7-day average');
    expect(healthChartSourceChoice({ ...series, semanticVariant: 'daily_resting', semanticLabel: 'Average · Daily resting · Provider summary · Provider calculated' }).shortLabel).toContain('Daily resting');
    const native = healthChartSourceChoice({ ...series, semanticVariant: 'provider_new_reading', semanticLabel: 'Special reading · Recorded · Device', nativeOnly: true });
    expect(native.shortLabel).toContain('Special reading · Source format');
    expect(native.detail).toBe('Special reading · Original source format');
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
