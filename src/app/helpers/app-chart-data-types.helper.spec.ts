import {
  DataDepth,
  DataPotentialStamina,
  DataStamina,
  DataStrokeRate,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  getAppAdvancedChartDataTypes,
  getChartMetricPickerLabel,
  getAppCanonicalChartDataTypes,
  getAppNonUnitBasedChartDataTypes,
} from './app-chart-data-types.helper';

describe('app-chart-data-types.helper', () => {
  it('uses searchable labels without duplicating or renaming saved canonical identifiers', () => {
    expect(getChartMetricPickerLabel(DataStamina.type)).toBe('Stamina / Suunto EnergySense Endurance');
    expect(getChartMetricPickerLabel('Estimated Sustainable Distance')).toContain('EnergySense Sustainable Distance');
    expect(getAppCanonicalChartDataTypes().filter(type => type === DataStamina.type)).toHaveLength(1);
    expect(getAppCanonicalChartDataTypes()).not.toContain('EnergySense Endurance');
  });

  it('adds stamina stream types to the app chart metric catalog', () => {
    expect(DynamicDataLoader.getDataClassFromDataType(DataStamina.type)).toBeTruthy();
    expect(DynamicDataLoader.getDataClassFromDataType(DataPotentialStamina.type)).toBeTruthy();

    expect(getAppAdvancedChartDataTypes()).toEqual(expect.arrayContaining([
      DataStamina.type,
      DataPotentialStamina.type,
    ]));
    expect(getAppCanonicalChartDataTypes()).toEqual(expect.arrayContaining([
      DataStamina.type,
      DataPotentialStamina.type,
    ]));
  });

  it('surfaces Sports Lib depth as an advanced generic chart metric', () => {
    expect(getAppAdvancedChartDataTypes()).toContain(DataDepth.type);
    expect(getAppCanonicalChartDataTypes()).toContain(DataDepth.type);
  });

  it('surfaces Sports Lib Stroke Rate through the automatic chart catalog', () => {
    expect(DynamicDataLoader.getDataClassFromDataType(DataStrokeRate.type)).toBeTruthy();
    expect(getAppCanonicalChartDataTypes()).toContain(DataStrokeRate.type);
  });

  it('includes stamina when resolving show-all stream requests', () => {
    expect(getAppNonUnitBasedChartDataTypes(true, [])).toEqual(expect.arrayContaining([
      DataStamina.type,
      DataPotentialStamina.type,
    ]));
  });
});
