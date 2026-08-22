import {
  DataActivityTypes,
  DataAirTimeRemaining,
  DataDepthAvg,
  DataDepthAvgFeet,
  DataDistance,
  DataDiveAscentRateAvg,
  DataDiveAscentRateAvgFeetPerSecond,
  DataLatitudeDegrees,
  DataPressureSACAvg,
  DataStrokeRate,
  DynamicDataLoader,
  UnitSystem,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildSportsLibNumericMetricCatalog,
  getSportsLibNumericMetricCatalog,
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
