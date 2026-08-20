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
  getAppCanonicalChartDataTypes,
  getAppNonUnitBasedChartDataTypes,
} from './app-chart-data-types.helper';

describe('app-chart-data-types.helper', () => {
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
