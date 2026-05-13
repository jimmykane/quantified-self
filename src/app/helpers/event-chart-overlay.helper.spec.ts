import { describe, expect, it } from 'vitest';

import {
  areEventChartOverlayMapsEqual,
  normalizeEventChartOverlayDataTypeByPrimary,
} from './event-chart-overlay.helper';

describe('event-chart-overlay.helper', () => {
  it('normalizes valid directional overlay pairs', () => {
    expect(normalizeEventChartOverlayDataTypeByPrimary({
      ' Heart Rate ': ' Altitude ',
      Altitude: 'Heart Rate',
    })).toEqual({
      'Heart Rate': 'Altitude',
      Altitude: 'Heart Rate',
    });
  });

  it('drops malformed, empty, and self-referential overlay pairs', () => {
    expect(normalizeEventChartOverlayDataTypeByPrimary({
      Power: 'Power',
      Cadence: '',
      Speed: 12,
      '': 'Altitude',
      HeartRate: 'Altitude',
    })).toEqual({
      HeartRate: 'Altitude',
    });
  });

  it('drops unsafe object-prototype keys from overlay pairs', () => {
    expect(normalizeEventChartOverlayDataTypeByPrimary({
      constructor: 'Altitude',
      Power: '__proto__',
      HeartRate: 'Altitude',
    })).toEqual({
      HeartRate: 'Altitude',
    });
  });

  it('compares maps after normalization', () => {
    expect(areEventChartOverlayMapsEqual(
      { Power: ' Altitude ', Speed: 'Speed' },
      { Power: 'Altitude' }
    )).toBe(true);

    expect(areEventChartOverlayMapsEqual(
      { Power: 'Altitude' },
      { Power: 'Heart Rate' }
    )).toBe(false);
  });
});
