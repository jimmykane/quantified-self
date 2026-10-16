import { DataPowerAvg, DataSpeedAvgKilometersPerHour } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { normalizeUnitDerivedStatLabel, normalizeUnitDerivedTypeLabel } from './stat-label.helper';
import { getCommonMetricManufacturer, getEnduranceMetricLabel } from '@shared/endurance-metrics';

describe('stat-label.helper', () => {
  it('labels verified Suunto endurance without renaming canonical or Garmin metrics', () => {
    expect(normalizeUnitDerivedTypeLabel('Average Stamina', undefined, { manufacturer: 'suunto' })).toBe('Average EnergySense Endurance');
    expect(normalizeUnitDerivedTypeLabel('Stamina', undefined, { manufacturer: 'Garmin' })).toBe('Stamina');
    expect(normalizeUnitDerivedTypeLabel('Potential Stamina', undefined, { manufacturer: 'Suunto' })).toBe('Potential Stamina');
    expect(normalizeUnitDerivedTypeLabel('Stamina')).toBe('Stamina');
    expect(getEnduranceMetricLabel('Stamina', { surface: 'picker' })).toContain('Stamina / Suunto EnergySense Endurance');
    expect(getEnduranceMetricLabel('EnergySense')).toBeNull();
  });

  it('keeps ending estimates distinct from streams and preserves qualifiers in imperial labels', () => {
    expect(normalizeUnitDerivedTypeLabel('Estimated Sustainable Distance', undefined, { manufacturer: 'Suunto', surface: 'stat' })).toBe('Ending EnergySense Sustainable Distance');
    expect(normalizeUnitDerivedTypeLabel('Estimated Sustainable Distance in miles', undefined, { manufacturer: 'Suunto', surface: 'stream' })).toBe('EnergySense Sustainable Distance');
    expect(normalizeUnitDerivedTypeLabel('Minimum Estimated Sustainable Distance in miles', undefined, { manufacturer: 'Suunto', surface: 'stat' })).toBe('Minimum EnergySense Sustainable Distance');
    expect(normalizeUnitDerivedTypeLabel('Estimated Sustainable Distance', undefined, { surface: 'stat' })).toBe('Ending Sustainable Distance');
  });

  it('requires common explicit manufacturer evidence in combined views', () => {
    expect(getCommonMetricManufacturer([{ creator: { manufacturer: 'Suunto' } }])).toBe('Suunto');
    expect(getCommonMetricManufacturer([{ creator: { manufacturer: 'Suunto' } }, { creator: { manufacturer: 'Garmin' } }])).toBeUndefined();
    expect(getCommonMetricManufacturer([{ creator: { manufacturer: 'Suunto' } }, {}])).toBeUndefined();
    expect(getCommonMetricManufacturer([])).toBeUndefined();
  });
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
  });

  it('should normalize GNSS-specific imperial type without fallback disambiguation', () => {
    expect(normalizeUnitDerivedTypeLabel('GNSS Distance in miles')).toBe('GNSS Distance');
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
