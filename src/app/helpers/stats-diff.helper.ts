import { ActivityInterface, DynamicDataLoader, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';

export interface StatDiffResult {
  display: string;
  percent: number;
}

const getStatValueForDisplayType = (
  activity: ActivityInterface,
  baseStatType: string,
  displayStatType: string,
  unitSettings: UserUnitSettingsInterface
): number | null => {
  if (!activity || typeof (activity as any).getStat !== 'function') {
    return null;
  }
  const direct = activity.getStat(displayStatType as any);
  if (direct && typeof (direct as any).getValue === 'function') {
    const value = direct.getValue();
    return typeof value === 'number' ? value : null;
  }
  const base = activity.getStat(baseStatType as any);
  if (!base) {
    return null;
  }
  const unitStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(base as any, unitSettings);
  const match = unitStats.find(stat => stat.getType() === displayStatType);
  if (match && typeof (match as any).getValue === 'function') {
    const value = match.getValue();
    return typeof value === 'number' ? value : null;
  }
  return null;
};

export const computeStatDiff = (
  activityA: ActivityInterface,
  activityB: ActivityInterface,
  baseStatType: string,
  displayStatType: string,
  unitSettings: UserUnitSettingsInterface
): StatDiffResult | null => {
  if (!activityA || !activityB || !unitSettings) {
    return null;
  }

  const valueA = getStatValueForDisplayType(activityA, baseStatType, displayStatType, unitSettings);
  const valueB = getStatValueForDisplayType(activityB, baseStatType, displayStatType, unitSettings);
  if (valueA === null || valueB === null) {
    return null;
  }
  if (typeof valueA !== 'number' || typeof valueB !== 'number') {
    return null;
  }

  const diffValue = Math.abs(valueA - valueB);
  const denom = (valueA + valueB) / 2;
  const percent = denom === 0 ? 0 : 100 * Math.abs((valueA - valueB) / denom);
  const diffStat = DynamicDataLoader.getDataInstanceFromDataType(displayStatType, diffValue);
  const display = `${diffStat.getDisplayValue()} ${diffStat.getDisplayUnit()}`.trim();

  return { display, percent };
};
