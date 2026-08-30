import {
  DataActivityTypes,
  DataActiveEnergy,
  DataAirTimeRemaining,
  DataDepthAvg,
  DataDepthAvgFeet,
  DataDistance,
  DataDiveAscentRateAvg,
  DataDiveAscentRateAvgFeetPerSecond,
  DataLatitudeDegrees,
  DataMetabolicCalories,
  DataPressureSACAvg,
  DataRestingCalories,
  DataSleepDuration,
  DataStrokeRate,
  DynamicDataLoader,
  UnitSystem,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildSportsLibNumericMetricCatalog,
  getSportsLibNumericMetricCatalog,
  MCP_NON_ACTIVITY_SPORTS_LIB_TYPES,
  projectSportsLibNumericMetricValue,
  resolveAvailableSportsLibMetrics,
  resolveSportsLibNumericMetric,
} from './metric-catalog';

describe('MCP Sports Lib metric catalog', () => {
  it('enumerates canonical numeric data classes with their native metadata', () => {
    const distance = resolveSportsLibNumericMetric(DataDistance.type);

    expect(distance).toEqual(expect.objectContaining({
      type: DataDistance.type,
      displayType: expect.any(String),
      unit: 'm',
      unitSystem: 'metric',
    }));
    expect(getSportsLibNumericMetricCatalog().length).toBeGreaterThan(300);
    expect(resolveSportsLibNumericMetric(DataStrokeRate.type)).toEqual({
      type: DataStrokeRate.type,
      displayType: DataStrokeRate.type,
      unit: 'spm',
      unitSystem: 'metric',
    });
    expect(resolveSportsLibNumericMetric(DataDepthAvg.type)).toEqual({
      type: DataDepthAvg.type,
      displayType: 'Average Depth',
      unit: 'm',
      unitSystem: 'metric',
    });
    expect(resolveSportsLibNumericMetric(DataPressureSACAvg.type)).toEqual({
      type: DataPressureSACAvg.type,
      displayType: 'Average Pressure SAC',
      unit: 'bar/min',
      unitSystem: 'metric',
    });
    expect(resolveSportsLibNumericMetric(DataMetabolicCalories.type)).toEqual({
      type: DataMetabolicCalories.type,
      displayType: DataMetabolicCalories.type,
      unit: 'kcal',
      unitSystem: 'metric',
    });
    expect(resolveSportsLibNumericMetric(DataRestingCalories.type)?.type).toBe(
      DataRestingCalories.type,
    );
    expect(resolveSportsLibNumericMetric(DataRestingCalories.type)?.type).not.toBe(
      DataMetabolicCalories.type,
    );
  });

  it('canonicalizes Sports Lib aliases through DynamicDataLoader', () => {
    const alias = Object.keys(DynamicDataLoader.dataTypeMinDataType)
      .find(type => DynamicDataLoader.dataTypeMinDataType[type] !== type);
    expect(alias).toBeTruthy();

    const canonicalClass = DynamicDataLoader.getDataClassFromDataType(alias!);
    const resolved = resolveSportsLibNumericMetric(alias!);

    expect(resolved?.type).toBe(canonicalClass.type);
  });

  it('rejects non-numeric and precise-position data classes', () => {
    expect(resolveSportsLibNumericMetric(DataActivityTypes.type)).toBeNull();
    expect(resolveSportsLibNumericMetric(DataLatitudeDegrees.type)).toBeNull();
    expect(resolveSportsLibNumericMetric('unknown metric')).toBeNull();
  });

  it('keeps 20.3 Health and sleep storage classes out of generic activity metrics', () => {
    expect(MCP_NON_ACTIVITY_SPORTS_LIB_TYPES).toHaveLength(45);
    expect(new Set(MCP_NON_ACTIVITY_SPORTS_LIB_TYPES).size).toBe(45);
    for (const type of MCP_NON_ACTIVITY_SPORTS_LIB_TYPES) {
      expect(resolveSportsLibNumericMetric(type)).toBeNull();
    }
    expect(buildSportsLibNumericMetricCatalog({ DataActiveEnergy, DataSleepDuration })).toEqual([]);
  });

  it('projects only finite values accepted by the canonical Sports Lib class', () => {
    expect(projectSportsLibNumericMetricValue(DataDistance.type, 12_345)).toBe(12_345);
    expect(projectSportsLibNumericMetricValue(DataDistance.type, '12,345')).toBeNull();
    expect(projectSportsLibNumericMetricValue(DataDistance.type, Number.NaN)).toBeNull();
    expect(projectSportsLibNumericMetricValue(DataLatitudeDegrees.type, 39.665)).toBeNull();
    expect(projectSportsLibNumericMetricValue(
      DataAirTimeRemaining.type,
      4_294_961_197,
    )).toBe(4_294_961_197);
    expect(projectSportsLibNumericMetricValue('unknown metric', 42)).toBeNull();
  });

  it('keeps unit-derived dive display variants out of canonical persisted availability', () => {
    const available = resolveAvailableSportsLibMetrics([
      {
        [DataDepthAvg.type]: 3.86,
        [DataDiveAscentRateAvg.type]: 0.044,
      },
    ]);
    const availableTypes = available.map(metric => metric.type);

    expect(availableTypes).toEqual(
      expect.arrayContaining([
        DataDepthAvg.type,
        DataDiveAscentRateAvg.type,
      ]),
    );
    expect(availableTypes).not.toContain(DataDepthAvgFeet.type);
    expect(availableTypes).not.toContain(DataDiveAscentRateAvgFeetPerSecond.type);
  });

  it('discovers a newly persisted numeric class without a manual MCP registry entry', () => {
    class DataFutureNumericMetric {
      static type = 'Future Numeric Metric';
      static displayType = 'Future metric';
      static unit = 'widgets';
      static unitSystem = UnitSystem.Metric;

      constructor(private readonly value: unknown) {}

      getValue(): unknown {
        return this.value;
      }

      getDisplayType(): string {
        return DataFutureNumericMetric.displayType;
      }

      getUnit(): string {
        return DataFutureNumericMetric.unit;
      }

      getUnitSystem(): UnitSystem {
        return DataFutureNumericMetric.unitSystem;
      }

      isValueTypeValid(value: unknown): boolean {
        return typeof value === 'number' && Number.isFinite(value);
      }
    }

    const catalog = buildSportsLibNumericMetricCatalog({
      DataFutureNumericMetric,
    });

    expect(catalog).toEqual([{
      type: 'Future Numeric Metric',
      displayType: 'Future metric',
      unit: 'widgets',
      unitSystem: 'metric',
    }]);
    expect(resolveAvailableSportsLibMetrics([
      { 'Future Numeric Metric': 42 },
    ], catalog)).toEqual(catalog);
  });
});
