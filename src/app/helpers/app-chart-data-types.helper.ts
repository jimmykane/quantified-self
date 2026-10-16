import {
  DataPotentialStamina,
  DataStamina,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib';
import { SUSTAINABLE_DISTANCE_TYPE, getEnduranceMetricLabel } from '@shared/endurance-metrics';

export const APP_CHART_EXTRA_DATA_TYPES: string[] = [
  DataStamina.type,
  DataPotentialStamina.type,
  // Activate with the coordinated Sports Lib release; published 21.6.14 remains compatible.
  ...(() => {
    try { DynamicDataLoader.getDataClassFromDataType(SUSTAINABLE_DISTANCE_TYPE); return [SUSTAINABLE_DISTANCE_TYPE]; }
    catch { return []; }
  })(),
];

export const getChartMetricPickerLabel = (type: string): string => getEnduranceMetricLabel(type, { surface: 'picker' }) ?? type;

export const getAppBasicChartDataTypes = (): string[] => {
  return [...DynamicDataLoader.basicDataTypes];
};

export const getAppAdvancedChartDataTypes = (): string[] => {
  const basicTypeSet = new Set(getAppBasicChartDataTypes());
  return [
    ...DynamicDataLoader.advancedDataTypes.filter((dataType) => !basicTypeSet.has(dataType)),
    ...APP_CHART_EXTRA_DATA_TYPES.filter((dataType) => !basicTypeSet.has(dataType)),
  ].filter((dataType, index, allDataTypes) => allDataTypes.indexOf(dataType) === index);
};

export const getAppCanonicalChartDataTypes = (): string[] => {
  return [
    ...getAppBasicChartDataTypes(),
    ...getAppAdvancedChartDataTypes(),
  ].filter((dataType, index, allDataTypes) => allDataTypes.indexOf(dataType) === index);
};

export const getAppNonUnitBasedChartDataTypes = (
  showAllData: boolean,
  dataTypesToUse: string[]
): string[] => {
  if (!showAllData) {
    return DynamicDataLoader.getNonUnitBasedDataTypes(false, dataTypesToUse);
  }

  return getAppCanonicalChartDataTypes();
};
