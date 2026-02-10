import {
  DataAltitudeAvg,
  DataCadenceAvg,
  DataHeartRateAvg,
  DataPaceAvgMinutesPerMile,
  DataPowerAvg,
  DataPowerMax,
  DataPowerMin,
  DataSpeedAvg,
  DataSpeedAvgKilometersPerHour,
  DataTemperatureAvg
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { buildHeaderStatCards, expandStatsTypesForCompositeDiff, resolveMetricFamilyTypes } from './header-stats-composite.helper';

describe('header-stats-composite.helper', () => {
  it('should resolve family types for title-case and lower-case average labels', () => {
    const titleCase = resolveMetricFamilyTypes('Average Speed in kilometers per hour');
    const lowerCase = resolveMetricFamilyTypes('average speed in kilometers per hour');

    expect(titleCase).toBeTruthy();
    expect(lowerCase).toBeTruthy();
    expect(titleCase?.familyType).toBe('Speed in kilometers per hour');
    expect(lowerCase?.familyType).toBe('Speed in kilometers per hour');
    expect(titleCase?.avgType).toBe(DataSpeedAvgKilometersPerHour.type);
    expect(lowerCase?.avgType).toBe(DataSpeedAvgKilometersPerHour.type);
  });

  it('should resolve avg/min/max triplets for supported metric families', () => {
    const families = [
      resolveMetricFamilyTypes(DataPowerAvg.type),
      resolveMetricFamilyTypes(DataHeartRateAvg.type),
      resolveMetricFamilyTypes(DataCadenceAvg.type),
      resolveMetricFamilyTypes(DataTemperatureAvg.type),
      resolveMetricFamilyTypes(DataAltitudeAvg.type),
      resolveMetricFamilyTypes(DataSpeedAvgKilometersPerHour.type),
      resolveMetricFamilyTypes(DataPaceAvgMinutesPerMile.type),
    ];

    families.forEach((family) => {
      expect(family).toBeTruthy();
      expect(family?.avgType).toBeTruthy();
      expect(family?.minType).toBeTruthy();
      expect(family?.maxType).toBeTruthy();
    });
  });

  it('should expand diff source types with family triplets and dedupe', () => {
    const expanded = expandStatsTypesForCompositeDiff([
      DataPowerAvg.type,
      DataPowerMin.type,
    ]);

    expect(expanded).toContain(DataPowerAvg.type);
    expect(expanded).toContain(DataPowerMin.type);
    expect(expanded).toContain(DataPowerMax.type);
    expect(expanded.filter((type) => type === DataPowerAvg.type).length).toBe(1);
    expect(expanded.filter((type) => type === DataPowerMin.type).length).toBe(1);
    expect(expanded.filter((type) => type === DataPowerMax.type).length).toBe(1);
  });

  it('should force single card by family when avg type is configured as single-value', () => {
    const speedFamily = resolveMetricFamilyTypes(DataSpeedAvgKilometersPerHour.type)!;

    const createStat = (type: string, label: string, value: string, unit = '') => ({
      getType: () => type,
      getDisplayType: () => label,
      getDisplayValue: () => value,
      getDisplayUnit: () => unit,
    } as any);

    const avgStat = createStat(speedFamily.avgType!, 'Average speed in kilometers per hour', '30', 'km/h');
    const minStat = createStat(speedFamily.minType!, 'Minimum speed in kilometers per hour', '10', 'km/h');
    const maxStat = createStat(speedFamily.maxType!, 'Maximum speed in kilometers per hour', '55', 'km/h');

    const cards = buildHeaderStatCards(
      [avgStat],
      new Map([
        [avgStat.getType(), avgStat],
        [minStat.getType(), minStat],
        [maxStat.getType(), maxStat],
      ]),
      [DataSpeedAvg.type]
    );

    expect(cards.length).toBe(1);
    expect(cards[0].isComposite).toBe(false);
    expect(cards[0].valueItems.map((item) => item.type)).toEqual([avgStat.getType()]);
  });
});
