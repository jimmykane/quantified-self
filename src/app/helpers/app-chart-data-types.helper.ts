import type { User } from '@sports-alliance/sports-lib';
import { applyEventChartCanonicalOrderOverride } from './event-chart-order.helper';
import {
  DataPotentialStamina,
  DataStamina,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib/metrics';
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

export function getUserChartDataTypesToUse(user: User): string[] {
  if (!user.settings?.chartSettings?.dataTypeSettings) {
    return [];
  }

  const enabledDataTypeSet = new Set(
    Object.keys(user.settings.chartSettings.dataTypeSettings).filter((dataTypeSettingKey) => {
      return user.settings.chartSettings.dataTypeSettings[dataTypeSettingKey].enabled === true;
    })
  );
  const canonicalDataTypes = getAppCanonicalChartDataTypes();
  const orderedDataTypes = applyEventChartCanonicalOrderOverride(
    canonicalDataTypes.filter((dataType) => enabledDataTypeSet.has(dataType))
  );
  const extraEnabledDataTypes = [...enabledDataTypeSet]
    .filter((dataType) => !orderedDataTypes.includes(dataType))
    .sort((left, right) => left.localeCompare(right));

  return orderedDataTypes.concat(extraEnabledDataTypes);
}
