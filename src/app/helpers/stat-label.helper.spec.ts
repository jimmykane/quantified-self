import { DataPowerAvg, DataSpeedAvgKilometersPerHour } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { normalizeUnitDerivedStatLabel, normalizeUnitDerivedTypeLabel } from './stat-label.helper';

describe('stat-label.helper', () => {
  it('should normalize unit-derived type labels without qualifiers', () => {
    expect(normalizeUnitDerivedTypeLabel('Speed in kilometers per hour')).toBe('Speed');
    expect(normalizeUnitDerivedTypeLabel('Distance in miles')).toBe('Distance');
  });

  it('should normalize unit-derived labels while preserving avg/min/max qualifiers', () => {
    expect(normalizeUnitDerivedTypeLabel('Average speed in kilometers per hour')).toBe('Average Speed');
    expect(normalizeUnitDerivedTypeLabel('minimum pace in minutes per mile')).toBe('Minimum Pace');
    expect(normalizeUnitDerivedTypeLabel('MAXIMUM speed in miles per hour')).toBe('Maximum Speed');
    expect(normalizeUnitDerivedTypeLabel('Average jump speed in kilometers per hour')).toBe('Average Jump Speed');
    expect(normalizeUnitDerivedTypeLabel('Minimum jump speed in miles per hour')).toBe('Minimum Jump Speed');
  });

  it('should normalize unit-derived base family labels for jump speed variants', () => {
    expect(normalizeUnitDerivedTypeLabel('jump speed in kilometers per hour')).toBe('Jump Speed');
    expect(normalizeUnitDerivedTypeLabel('Jump speed in knots')).toBe('Jump Speed');
  });

  it('should use fallback label to disambiguate overlapping unit-derived variants', () => {
    expect(normalizeUnitDerivedTypeLabel('Distance in miles', 'Jump Distance')).toBe('Jump Distance');
    expect(normalizeUnitDerivedTypeLabel('Distance in miles', 'GNSS Distance')).toBe('GNSS Distance');
  });

  it('should leave non-unit-derived labels unchanged', () => {
    expect(normalizeUnitDerivedTypeLabel(DataPowerAvg.type, 'Average Power')).toBe('Average Power');
    expect(normalizeUnitDerivedTypeLabel('VO2 Max')).toBe('VO2 Max');
  });

  it('should fall back to provided display label for non-unit-derived stat instances', () => {
    const mockStat = {
      getType: () => DataPowerAvg.type,
      getDisplayType: () => 'Average Power',
    } as any;
    expect(normalizeUnitDerivedStatLabel(mockStat)).toBe('Average Power');
  });

  it('should normalize unit-derived stat instance labels using type identity', () => {
    const mockStat = {
      getType: () => DataSpeedAvgKilometersPerHour.type,
      getDisplayType: () => 'Average speed in kilometers per hour',
    } as any;
    expect(normalizeUnitDerivedStatLabel(mockStat)).toBe('Average Speed');
  });
});
