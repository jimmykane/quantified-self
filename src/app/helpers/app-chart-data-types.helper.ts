import {
  DataPotentialStamina,
  DataStamina,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib';

export const APP_CHART_EXTRA_DATA_TYPES: string[] = [
  DataStamina.type,
  DataPotentialStamina.type,
];

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
