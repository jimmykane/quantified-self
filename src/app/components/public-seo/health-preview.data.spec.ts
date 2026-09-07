import { describe, expect, it } from 'vitest';
import { HEALTH_PROVIDERS, HEALTH_RECORDING_METHODS, HEALTH_VALUE_ORIGINS } from '@shared/health';
import { MANUAL_HEALTH_AGGREGATION, MANUAL_POINT_SEMANTIC_VARIANT } from '@shared/manual-health';
import { buildHealthPreviewSeries, buildHealthPreviewSleepTrend, HEALTH_PREVIEW_END, HEALTH_PREVIEW_START } from './health-preview.data';

describe('public Health sample data', () => {
  it('keeps the weight preview on a gentle, consistent trend without daily spikes', () => {
    const values = buildHealthPreviewSeries('weight').points.map(point => Number(point.value));
    expect(values).toHaveLength(14);
    expect(values[0] - values.at(-1)!).toBeGreaterThan(0);
    expect(values[0] - values.at(-1)!).toBeLessThan(0.5);
    for (let index = 1; index < values.length; index++) {
      const change = values[index] - values[index - 1];
      expect(change).toBeLessThanOrEqual(1e-10);
      expect(Math.abs(change)).toBeLessThanOrEqual(0.08 + 1e-10);
    }
  });

  it('uses the same nightly HRV readings in the sleep and personal-range previews', () => {
    const hrv = buildHealthPreviewSeries('hrv');
    const sleep = buildHealthPreviewSleepTrend();
    for (const night of sleep.points) {
      const reading = hrv.points.find(point => point.calendarDate === night.sleepDate);
      expect(reading).toBeDefined();
      expect(night.provider).toBe(hrv.provider);
      expect(night.averageHrvMs).toBe(reading?.value);
    }
  });

  it('retains baseline history outside the visible HRV window', () => {
    const points = buildHealthPreviewSeries('hrv').points;
    expect(points.filter(point => point.timestampMs < HEALTH_PREVIEW_START)).toHaveLength(60);
    expect(points.filter(point => point.timestampMs >= HEALTH_PREVIEW_START && point.timestampMs <= HEALTH_PREVIEW_END)).toHaveLength(14);
  });

  it('uses the app manual-measurement contract for weight observations', () => {
    expect(buildHealthPreviewSeries('weight')).toMatchObject({
      provider: HEALTH_PROVIDERS.QuantifiedSelf,
      origin: HEALTH_VALUE_ORIGINS.Recorded,
      recordingMethod: HEALTH_RECORDING_METHODS.Manual,
      aggregation: MANUAL_HEALTH_AGGREGATION,
      semanticVariant: MANUAL_POINT_SEMANTIC_VARIANT,
      nativeOnly: false,
    });
  });
});
