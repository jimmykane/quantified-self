import { describe, expect, it } from 'vitest';

import {
  areEventChartOverlayMapsEqual,
  getEventChartOverlaySelectionKey,
  normalizeEventChartOverlayDataTypeByPrimary,
} from './event-chart-overlay.helper';

describe('event-chart-overlay.helper', () => {
  it('treats Distance unit aliases as one selection without merging other recorded sources', () => {
    expect(getEventChartOverlaySelectionKey('Distance')).toBe('Distance');
    expect(getEventChartOverlaySelectionKey('Distance in miles')).toBe('Distance');
    expect(getEventChartOverlaySelectionKey('Distance in feet')).toBe('Distance');
    expect(getEventChartOverlaySelectionKey('GNSS Distance')).toBe('GNSS Distance');
    expect(getEventChartOverlaySelectionKey('GNSS Distance in miles')).toBe('GNSS Distance');
    expect(getEventChartOverlaySelectionKey('Distance (Stryd)')).toBe('Distance (Stryd)');
    expect(getEventChartOverlaySelectionKey('Estimated Sustainable Distance')).toBe('Estimated Sustainable Distance');
  });

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
