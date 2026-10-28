import {
  DataAltitude, DataCadence, DataGradeAdjustedSpeed, DataHeartRate, DataPace, DataPower, DataSpeed,
  DataDepth,
  DataPotentialStamina,
  DataStamina,
  DataStrokeRate,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  getUserChartDataTypesToUse,
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
    it('returns enabled chart data types in canonical order with event chart priority overrides', () => {
        const user = {
            settings: {
                chartSettings: {
                    dataTypeSettings: {
                        [DataAltitude.type]: { enabled: true },
                        [DataCadence.type]: { enabled: true },
                        [DataGradeAdjustedSpeed.type]: { enabled: true },
                        [DataHeartRate.type]: { enabled: true },
                        [DataPace.type]: { enabled: true },
                        [DataPotentialStamina.type]: { enabled: true },
                        [DataSpeed.type]: { enabled: true },
                        [DataStamina.type]: { enabled: true },
                        [DataPower.type]: { enabled: true },
                        customType: { enabled: true },
                    }
                }
            }
        } as any;

        const canonicalChartDataTypes = getAppCanonicalChartDataTypes();
        const enabledDataTypes = [
            DataAltitude.type,
            DataCadence.type,
            DataGradeAdjustedSpeed.type,
            DataHeartRate.type,
            DataPace.type,
            DataPotentialStamina.type,
            DataPower.type,
            DataSpeed.type,
            DataStamina.type,
            'customType'
        ];
        const canonicalEnabledDataTypes = canonicalChartDataTypes.filter((dataType) => enabledDataTypes.includes(dataType));
        const expectedOrderedDataTypes = [
            DataHeartRate.type,
            DataPace.type,
            DataSpeed.type,
            DataGradeAdjustedSpeed.type,
            DataPower.type,
            DataCadence.type,
            ...canonicalEnabledDataTypes.filter((dataType) => ![
                DataHeartRate.type,
                DataPace.type,
                DataSpeed.type,
                DataGradeAdjustedSpeed.type,
                DataPower.type,
                DataCadence.type,
            ].includes(dataType)),
            'customType'
        ];

        expect(getUserChartDataTypesToUse(user)).toEqual(expectedOrderedDataTypes);
    });


});
