import {
  DataPotentialStamina,
  DataStamina,
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

  it('includes stamina when resolving show-all stream requests', () => {
    expect(getAppNonUnitBasedChartDataTypes(true, [])).toEqual(expect.arrayContaining([
      DataStamina.type,
      DataPotentialStamina.type,
    ]));
  });
});
