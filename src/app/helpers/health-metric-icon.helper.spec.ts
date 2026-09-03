import { describe, expect, it } from 'vitest';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { healthMetricIcon } from './health-metric-icon.helper';

describe('Health metric icons', () => {
  it('maps every Health catalog metric and the Sleep overview to a Material icon', () => {
    expect(healthMetricIcon('sleep')).toBe('bedtime');
    for (const metric of Object.values(HEALTH_METRIC_IDS)) {
      expect(healthMetricIcon(metric)).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('uses the established stats vocabulary for common measurements', () => {
    expect(healthMetricIcon(HEALTH_METRIC_IDS.HeartRate)).toBe('favorite');
    expect(healthMetricIcon(HEALTH_METRIC_IDS.Distance)).toBe('route');
    expect(healthMetricIcon(HEALTH_METRIC_IDS.BodyEnergy)).toBe('battery_full');
    expect(healthMetricIcon(HEALTH_METRIC_IDS.SkinTemperatureDeviation)).toBe('device_thermostat');
  });
});
