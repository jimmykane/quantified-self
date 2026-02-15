import {
  DataAltitudeAvg,
  DataCadenceAvg,
  DataHeartRateAvg,
  DataJumpHeightAvg,
  DataJumpHeightMax,
  DataJumpHeightMin,
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
      resolveMetricFamilyTypes('Average Ground Contact Time'),
      resolveMetricFamilyTypes(DataJumpHeightAvg.type),
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

  it('should expand diff source types for ground contact time family', () => {
    const expanded = expandStatsTypesForCompositeDiff(['Average Ground Contact Time']);

    expect(expanded).toContain('Average Ground Contact Time');
    expect(expanded).toContain('Minimum Ground Contact Time');
    expect(expanded).toContain('Maximum Ground Contact Time');
  });

  it('should resolve jump height family with avg/min/max triplet', () => {
    const family = resolveMetricFamilyTypes(DataJumpHeightAvg.type);

    expect(family).toBeTruthy();
    expect(family?.familyType).toBe('Jump Height');
    expect(family?.avgType).toBe(DataJumpHeightAvg.type);
    expect(family?.minType).toBe(DataJumpHeightMin.type);
    expect(family?.maxType).toBe(DataJumpHeightMax.type);
  });

  it('should expand diff source types for jump height family', () => {
    const expanded = expandStatsTypesForCompositeDiff([DataJumpHeightAvg.type]);

    expect(expanded).toContain(DataJumpHeightAvg.type);
    expect(expanded).toContain(DataJumpHeightMin.type);
    expect(expanded).toContain(DataJumpHeightMax.type);
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
    expect(cards[0].label).toBe('Average Speed');
    expect(cards[0].valueItems.map((item) => item.type)).toEqual([avgStat.getType()]);
  });

  it('should normalize composite family and value labels for unit-derived stats', () => {
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
      ])
    );

    expect(cards.length).toBe(1);
    expect(cards[0].isComposite).toBe(true);
    expect(cards[0].label).toBe('Speed');
    expect(cards[0].valueItems.map((item) => item.displayType)).toEqual([
      'Average Speed',
      'Minimum Speed',
      'Maximum Speed',
    ]);
  });

  it('should strip trailing units from composite value display cells', () => {
    const createStat = (type: string, label: string, value: string, unit = '') => ({
      getType: () => type,
      getDisplayType: () => label,
      getDisplayValue: () => value,
      getDisplayUnit: () => unit,
    } as any);

    const avgStat = createStat(DataPowerAvg.type, 'Average Power', '250 W', 'W');
    const minStat = createStat(DataPowerMin.type, 'Minimum Power', '120 W', 'W');
    const maxStat = createStat(DataPowerMax.type, 'Maximum Power', '680 W', 'W');

    const cards = buildHeaderStatCards(
      [avgStat],
      new Map([
        [avgStat.getType(), avgStat],
        [minStat.getType(), minStat],
        [maxStat.getType(), maxStat],
      ])
    );

    expect(cards.length).toBe(1);
    expect(cards[0].isComposite).toBe(true);
    expect(cards[0].valueItems.map((item) => item.displayValue)).toEqual(['250', '120', '680']);
    expect(cards[0].valueItems.map((item) => item.displayUnit)).toEqual(['W', 'W', 'W']);
  });
});
