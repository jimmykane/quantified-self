import { describe, expect, it } from 'vitest';

import {
  areEventChartOverlayMapsEqual,
  getEventChartOverlaySelectionKey,
  resolveEventChartOverlayDataType,
  normalizeEventChartOverlayDataTypeByPrimary,
} from './event-chart-overlay.helper';

describe('event-chart-overlay.helper', () => {
  it('treats Distance unit aliases as one selection without merging other recorded sources', () => {
    expect(getEventChartOverlaySelectionKey('Distance')).toBe('Distance');
    expect(getEventChartOverlaySelectionKey('Distance in miles')).toBe('Distance');
    expect(getEventChartOverlaySelectionKey('Distance in feet')).toBe('Distance in feet');
    expect(getEventChartOverlaySelectionKey('GNSS Distance')).toBe('GNSS Distance');
    expect(getEventChartOverlaySelectionKey('GNSS Distance in miles')).toBe('GNSS Distance');
    expect(getEventChartOverlaySelectionKey('Distance (Stryd)')).toBe('Distance (Stryd)');
    expect(getEventChartOverlaySelectionKey('Estimated Sustainable Distance')).toBe('Estimated Sustainable Distance');
  });

  it.each([
    { name: 'exact choice beats old aliases', primary: 'Speed in miles per hour',
      available: ['Speed in miles per hour', 'Power', 'Heart Rate'],
      saved: { 'Speed in miles per hour': 'Power', Speed: 'Heart Rate' }, expected: 'Power' },
    { name: 'an unavailable exact choice does not fall back', primary: 'Speed in miles per hour',
      available: ['Speed in miles per hour', 'Heart Rate'],
      saved: { 'Speed in miles per hour': 'Power', Speed: 'Heart Rate' }, expected: null },
    { name: 'old target aliases can agree on one current unit', primary: 'Speed in miles per hour',
      available: ['Speed in miles per hour', 'Depth in feet'],
      saved: { Speed: 'Depth', 'Speed in kilometers per hour': 'Depth in feet' }, expected: 'Depth in feet' },
    { name: 'unavailable and available old choices conflict', primary: 'Speed in miles per hour',
      available: ['Speed in miles per hour', 'Heart Rate'],
      saved: { Speed: 'Power', 'Speed in kilometers per hour': 'Heart Rate' }, expected: null },
    { name: 'several available units prevent primary alias migration', primary: 'Speed in miles per hour',
      available: ['Speed in miles per hour', 'Speed', 'Heart Rate'],
      saved: { 'Speed in kilometers per hour': 'Heart Rate' }, expected: null },
    { name: 'several available target units prevent target alias migration', primary: 'Power',
      available: ['Power', 'Speed', 'Speed in miles per hour'],
      saved: { Power: 'Speed in kilometers per hour' }, expected: null },
    { name: 'exact target remains selected among multiple units', primary: 'Power',
      available: ['Power', 'Speed', 'Speed in miles per hour'],
      saved: { Power: 'Speed' }, expected: 'Speed' },
    { name: 'aliases cannot create a self overlay', primary: 'Speed in miles per hour',
      available: ['Speed in miles per hour'], saved: { Speed: 'Speed in kilometers per hour' }, expected: null },
  ])('$name', ({ primary, available, saved, expected }) => {
    const before = structuredClone(saved);
    expect(resolveEventChartOverlayDataType(primary, Object.freeze(available), Object.freeze(saved))).toBe(expected);
    expect(saved).toEqual(before);
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
